import { beforeEach, describe, expect, it, vi } from "vitest";

const imapMocks = vi.hoisted(() => ({
  capabilities: new Map<string, boolean | number>(),
  mailboxUidValidity: 777n as bigint | undefined,
  connect: vi.fn(),
  logout: vi.fn(),
  close: vi.fn(),
  release: vi.fn(),
  messageMove: vi.fn(),
  messageCopy: vi.fn(),
  messageDelete: vi.fn(),
  messageFlagsAdd: vi.fn(),
  messageFlagsRemove: vi.fn(),
  fetchOne: vi.fn(),
}));

vi.mock("imapflow", () => ({
  ImapFlow: class {
    readonly capabilities = imapMocks.capabilities;
    readonly usable = true;

    get mailbox(): { uidValidity?: bigint } {
      return imapMocks.mailboxUidValidity === undefined ? {} : { uidValidity: imapMocks.mailboxUidValidity };
    }

    connect(): Promise<void> {
      return imapMocks.connect();
    }

    logout(): Promise<void> {
      return imapMocks.logout();
    }

    close(): void {
      imapMocks.close();
    }

    getMailboxLock(): Promise<{ release(): void }> {
      return Promise.resolve({ release: imapMocks.release });
    }

    messageMove(...args: unknown[]): Promise<unknown> {
      return imapMocks.messageMove(...args);
    }

    messageCopy(...args: unknown[]): Promise<unknown> {
      return imapMocks.messageCopy(...args);
    }

    messageDelete(...args: unknown[]): Promise<unknown> {
      return imapMocks.messageDelete(...args);
    }

    messageFlagsAdd(...args: unknown[]): Promise<boolean> {
      return imapMocks.messageFlagsAdd(...args);
    }

    messageFlagsRemove(...args: unknown[]): Promise<boolean> {
      return imapMocks.messageFlagsRemove(...args);
    }

    fetchOne(...args: unknown[]): Promise<unknown> {
      return imapMocks.fetchOne(...args);
    }
  },
}));

vi.mock("nodemailer", () => ({ default: { createTransport: vi.fn() } }));

import { MailboxGenerationMismatchError, MailService, type RuntimeAccount } from "../src/main/mail-service";
import { MIME_SAFETY_LIMITS, MimeSafetyError } from "../src/main/mime-safety";

const account: RuntimeAccount = {
  id: "move-test",
  displayName: "Move Test",
  email: "move@example.test",
  incoming: { host: "imap.example.test", port: 993, security: "tls", username: "move@example.test" },
  outgoing: { host: "smtp.example.test", port: 465, security: "tls", username: "move@example.test" },
  authMode: "password",
  kind: "imap",
  createdAt: "2026-07-31T00:00:00.000Z",
  secret: "fixture-only-secret",
};

describe("MailService server mutation truth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    imapMocks.capabilities.clear();
    imapMocks.mailboxUidValidity = 777n;
    imapMocks.connect.mockResolvedValue(undefined);
    imapMocks.logout.mockResolvedValue(undefined);
  });

  it("returns only the server-provided destination UID and UIDVALIDITY", async () => {
    imapMocks.capabilities.set("MOVE", true);
    imapMocks.messageMove.mockResolvedValue({
      path: "Inbox",
      destination: "Archive",
      uidValidity: 888n,
      uidMap: new Map([[41, 9001]]),
    });

    await expect(new MailService().moveMessage(account, "Inbox", 41, "Archive", "777")).resolves.toEqual({
      destinationUid: 9001,
      destinationUidValidity: "888",
    });
    expect(imapMocks.messageMove).toHaveBeenCalledWith(41, "Archive", { uid: true });
  });

  it("treats a false MOVE result as failure", async () => {
    imapMocks.capabilities.set("MOVE", true);
    imapMocks.messageMove.mockResolvedValue(false);

    await expect(new MailService().moveMessage(account, "Inbox", 41, "Archive", "777")).rejects.toThrow(/did not confirm the move/u);
  });

  it("fails closed without MOVE and never enters ImapFlow's unsafe copy-delete fallback", async () => {
    await expect(new MailService().moveMessage(account, "Inbox", 41, "Archive", "777")).rejects.toThrow(/does not advertise MOVE/u);
    expect(imapMocks.messageMove).not.toHaveBeenCalled();
    expect(imapMocks.messageCopy).not.toHaveBeenCalled();
    expect(imapMocks.messageDelete).not.toHaveBeenCalled();
  });

  it("treats a false flag result as failure instead of local success", async () => {
    imapMocks.messageFlagsAdd.mockResolvedValue(false);

    await expect(new MailService().setFlags(account, "Inbox", 41, { unread: false }, "777")).rejects.toThrow(/did not confirm the read-state/u);
  });

  it("fails closed under the mailbox lock before a reused UID can be fetched or mutated", async () => {
    imapMocks.mailboxUidValidity = 778n;
    imapMocks.capabilities.set("MOVE", true);
    const service = new MailService();

    await expect(service.getMessage(account, "Inbox", 41, "777")).rejects.toBeInstanceOf(MailboxGenerationMismatchError);
    await expect(service.getAttachments(account, "Inbox", 41, "777")).rejects.toBeInstanceOf(MailboxGenerationMismatchError);
    await expect(service.setFlags(account, "Inbox", 41, { starred: true }, "777")).rejects.toBeInstanceOf(MailboxGenerationMismatchError);
    await expect(service.moveMessage(account, "Inbox", 41, "Archive", "777")).rejects.toBeInstanceOf(MailboxGenerationMismatchError);

    expect(imapMocks.fetchOne).not.toHaveBeenCalled();
    expect(imapMocks.messageFlagsAdd).not.toHaveBeenCalled();
    expect(imapMocks.messageFlagsRemove).not.toHaveBeenCalled();
    expect(imapMocks.messageMove).not.toHaveBeenCalled();
    expect(imapMocks.release).toHaveBeenCalledTimes(4);
  });

  it("requests only a bounded raw MIME range for detail and attachment reads", async () => {
    const source = Buffer.from([
      "From: Sender <sender@example.test>",
      "Subject: Bounded fetch",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Small body",
    ].join("\r\n"));
    imapMocks.fetchOne
      .mockResolvedValueOnce({ uid: 41, source, flags: new Set<string>(), size: source.length })
      .mockResolvedValueOnce({ uid: 41, source, size: source.length });
    const service = new MailService();

    await expect(service.getMessage(account, "Inbox", 41, "777")).resolves.toMatchObject({ subject: "Bounded fetch" });
    await expect(service.getAttachments(account, "Inbox", 41, "777")).resolves.toEqual([]);

    const boundedSource = { start: 0, maxLength: MIME_SAFETY_LIMITS.sourceBytes + 1 };
    expect(imapMocks.fetchOne).toHaveBeenNthCalledWith(1, 41, {
      uid: true,
      source: boundedSource,
      envelope: true,
      flags: true,
      size: true,
    }, { uid: true });
    expect(imapMocks.fetchOne).toHaveBeenNthCalledWith(2, 41, {
      source: boundedSource,
      size: true,
    }, { uid: true });
  });

  it("rejects an oversized server-reported MIME size with a stable safety error", async () => {
    imapMocks.fetchOne.mockResolvedValueOnce({
      uid: 41,
      source: Buffer.from("Subject: Truncated\r\n\r\nsmall partial source"),
      flags: new Set<string>(),
      size: MIME_SAFETY_LIMITS.sourceBytes + 1,
    });

    const error = await new MailService().getMessage(account, "Inbox", 41, "777").catch(caught => caught);
    expect(error).toBeInstanceOf(MimeSafetyError);
    expect(error).toMatchObject({ code: "MIME_SOURCE_TOO_LARGE" });
    expect((error as Error).message).toContain("left unopened and unchanged");
  });
});
