import { beforeEach, describe, expect, it, vi } from "vitest";

const imapMocks = vi.hoisted(() => ({
  mailboxUidValidity: 777n as bigint | undefined,
  permanentFlags: new Set<string>() as Set<string> | undefined,
  connect: vi.fn(),
  logout: vi.fn(),
  close: vi.fn(),
  release: vi.fn(),
  messageFlagsAdd: vi.fn(),
  messageFlagsRemove: vi.fn(),
  fetchOne: vi.fn(),
}));

vi.mock("imapflow", () => ({
  ImapFlow: class {
    readonly capabilities = new Map<string, boolean | number>();
    readonly usable = true;

    get mailbox(): { uidValidity?: bigint; permanentFlags?: Set<string> } {
      return {
        ...(imapMocks.mailboxUidValidity === undefined ? {} : { uidValidity: imapMocks.mailboxUidValidity }),
        ...(imapMocks.permanentFlags === undefined ? {} : { permanentFlags: imapMocks.permanentFlags }),
      };
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

import {
  MESSAGE_TAG_KEYWORD_LIMIT,
  MESSAGE_TAG_KEYWORD_PREFIX,
  MailKeywordError,
  MailboxGenerationMismatchError,
  MailService,
  messageTagKeyword,
  messageTagKeywordName,
  type RuntimeAccount,
} from "../src/main/mail-service";
import { MESSAGE_TAGS_PER_MESSAGE_LIMIT } from "../src/shared/message-tags";

const account: RuntimeAccount = {
  id: "keyword-test",
  displayName: "Keyword Test",
  email: "keyword@example.test",
  incoming: { host: "imap.example.test", port: 993, security: "tls", username: "keyword@example.test" },
  outgoing: { host: "smtp.example.test", port: 465, security: "tls", username: "keyword@example.test" },
  authMode: "password",
  kind: "imap",
  createdAt: "2026-08-02T00:00:00.000Z",
  secret: "fixture-only-secret",
};

/** What the fake server holds for UID 41; a real server folds keyword case, so removal does too. */
const serverFlags = new Set<string>();

const anyKeywordAllowed = (): Set<string> => new Set(["\\Seen", "\\Flagged", "\\Deleted", "\\*"]);

describe("IMAP keyword encoding", () => {
  it("round trips a tag name through a lowercase, case-fold-proof atom", () => {
    for (const name of ["Work", "work", "Dim Sum Orders", "Q4 (draft) 100%", "報稅", "under_score", "a-b"]) {
      const keyword = messageTagKeyword(name);
      expect(keyword.startsWith(MESSAGE_TAG_KEYWORD_PREFIX)).toBe(true);
      expect(keyword).toBe(keyword.toLowerCase());
      expect(keyword).toMatch(/^[0-9a-z_-]+$/u);
      expect(messageTagKeywordName(keyword)).toBe(name);
      expect(messageTagKeywordName(keyword.toUpperCase())).toBe(name);
    }
  });

  it("keeps names that differ only in case on separate atoms", () => {
    expect(messageTagKeyword("Work")).not.toBe(messageTagKeyword("work"));
    expect(messageTagKeyword("Work")).toBe("mtag-_57ork");
    expect(messageTagKeyword("work")).toBe("mtag-work");
  });

  it("claims only its own atoms", () => {
    expect(messageTagKeywordName("$Forwarded")).toBeNull();
    expect(messageTagKeywordName("NotJunk")).toBeNull();
    expect(messageTagKeywordName(`${MESSAGE_TAG_KEYWORD_PREFIX}truncated_5`)).toBeNull();
  });

  it("refuses a name it cannot encode rather than truncating it into a colliding atom", () => {
    expect(() => messageTagKeyword("   ")).toThrow(MailKeywordError);
    const oversized = "x".repeat(MESSAGE_TAG_KEYWORD_LIMIT);
    expect(() => messageTagKeyword(oversized)).toThrow(new RegExp(`${MESSAGE_TAG_KEYWORD_LIMIT}-character limit`, "u"));
    expect(() => messageTagKeyword(oversized)).toThrow(/was not stored/u);
  });
});

describe("IMAP keyword persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    serverFlags.clear();
    imapMocks.mailboxUidValidity = 777n;
    imapMocks.permanentFlags = anyKeywordAllowed();
    imapMocks.connect.mockResolvedValue(undefined);
    imapMocks.logout.mockResolvedValue(undefined);
    imapMocks.fetchOne.mockImplementation(() => Promise.resolve({ uid: 41, flags: new Set(serverFlags) }));
    imapMocks.messageFlagsAdd.mockImplementation((_uid: unknown, flags: string[]) => {
      for (const flag of flags) serverFlags.add(flag);
      return Promise.resolve(true);
    });
    imapMocks.messageFlagsRemove.mockImplementation((_uid: unknown, flags: string[]) => {
      const folded = new Set(flags.map(flag => flag.toLowerCase()));
      for (const existing of [...serverFlags]) if (folded.has(existing.toLowerCase())) serverFlags.delete(existing);
      return Promise.resolve(true);
    });
  });

  it("stores the encoded keywords and reports what the server ended up holding", async () => {
    await expect(new MailService().setMessageKeywords(account, "Inbox", 41, ["Work", "Dim Sum Orders"], "777")).resolves.toEqual({
      added: [messageTagKeyword("Dim Sum Orders"), messageTagKeyword("Work")],
      removed: [],
      keywords: [messageTagKeyword("Dim Sum Orders"), messageTagKeyword("Work")],
    });
    expect(imapMocks.messageFlagsAdd).toHaveBeenCalledWith(41, [messageTagKeyword("Dim Sum Orders"), messageTagKeyword("Work")], { uid: true });
    expect(imapMocks.messageFlagsRemove).not.toHaveBeenCalled();
  });

  it("leaves keywords this application did not write untouched", async () => {
    serverFlags.add("\\Seen");
    serverFlags.add("$Forwarded");
    serverFlags.add("NotJunk");
    serverFlags.add(messageTagKeyword("Later"));

    const result = await new MailService().setMessageKeywords(account, "Inbox", 41, ["Work"], "777");
    expect(result.added).toEqual([messageTagKeyword("Work")]);
    expect(result.removed).toEqual([messageTagKeyword("Later")]);
    expect(result.keywords).toEqual(["$Forwarded", "NotJunk", messageTagKeyword("Work")].sort());
    expect(imapMocks.messageFlagsRemove).toHaveBeenCalledWith(41, [messageTagKeyword("Later")], { uid: true });
    expect(serverFlags.has("\\Seen")).toBe(true);
  });

  it("issues no STORE when the server already holds exactly those keywords", async () => {
    serverFlags.add(messageTagKeyword("Work"));

    await expect(new MailService().setMessageKeywords(account, "Inbox", 41, ["Work"], "777")).resolves.toEqual({
      added: [],
      removed: [],
      keywords: [messageTagKeyword("Work")],
    });
    expect(imapMocks.messageFlagsAdd).not.toHaveBeenCalled();
    expect(imapMocks.messageFlagsRemove).not.toHaveBeenCalled();
  });

  it("refuses a server that does not advertise keyword support and stores nothing", async () => {
    const service = new MailService();
    for (const permanentFlags of [undefined, new Set<string>(), new Set(["\\Seen", "\\Flagged"])]) {
      imapMocks.permanentFlags = permanentFlags;
      const error = await service.setMessageKeywords(account, "Inbox", 41, ["Work"], "777").catch(caught => caught);
      expect(error).toBeInstanceOf(MailKeywordError);
      expect(error).toMatchObject({ code: "KEYWORDS_UNSUPPORTED" });
      expect((error as Error).message).toContain("Inbox");
    }
    expect(imapMocks.messageFlagsAdd).not.toHaveBeenCalled();
    expect(imapMocks.messageFlagsRemove).not.toHaveBeenCalled();
  });

  it("accepts a server that advertises the exact keywords without the wildcard", async () => {
    imapMocks.permanentFlags = new Set(["\\Seen", messageTagKeyword("Work")]);

    await expect(new MailService().setMessageKeywords(account, "Inbox", 41, ["Work"], "777")).resolves.toMatchObject({
      added: [messageTagKeyword("Work")],
    });
  });

  it("fails explicitly when the server answers OK and keeps nothing", async () => {
    imapMocks.messageFlagsAdd.mockResolvedValue(true);

    const error = await new MailService().setMessageKeywords(account, "Inbox", 41, ["Work"], "777").catch(caught => caught);
    expect(error).toBeInstanceOf(MailKeywordError);
    expect(error).toMatchObject({ code: "KEYWORD_NOT_STORED" });
    expect((error as Error).message).toContain("did not keep the keywords");
  });

  it("treats a false STORE result as failure instead of local success", async () => {
    imapMocks.messageFlagsAdd.mockResolvedValue(false);

    await expect(new MailService().setMessageKeywords(account, "Inbox", 41, ["Work"], "777")).rejects.toMatchObject({
      code: "KEYWORD_NOT_STORED",
    });
  });

  it("fails closed under the mailbox lock when the mailbox generation moved", async () => {
    imapMocks.mailboxUidValidity = 778n;

    await expect(new MailService().setMessageKeywords(account, "Inbox", 41, ["Work"], "777")).rejects.toBeInstanceOf(
      MailboxGenerationMismatchError,
    );
    expect(imapMocks.fetchOne).not.toHaveBeenCalled();
    expect(imapMocks.messageFlagsAdd).not.toHaveBeenCalled();
    expect(imapMocks.messageFlagsRemove).not.toHaveBeenCalled();
    expect(imapMocks.release).toHaveBeenCalledTimes(1);
  });

  it("reports a vanished message rather than a stored tag", async () => {
    imapMocks.fetchOne.mockResolvedValue(undefined);

    await expect(new MailService().setMessageKeywords(account, "Inbox", 41, ["Work"], "777")).rejects.toMatchObject({
      code: "MESSAGE_UNAVAILABLE",
    });
  });

  it("never surfaces the provider's own error text", async () => {
    imapMocks.messageFlagsAdd.mockRejectedValue(new Error("ImapFlow socket hang up at /home/runner/imap.js:12:3"));

    const error = await new MailService().setMessageKeywords(account, "Inbox", 41, ["Work"], "777").catch(caught => caught);
    expect(error).toBeInstanceOf(MailKeywordError);
    expect((error as Error).message).toBe("The mail server did not confirm the tag change.");
  });

  it("refuses more tags than one message may carry before opening a connection", async () => {
    const names = Array.from({ length: MESSAGE_TAGS_PER_MESSAGE_LIMIT + 1 }, (_value, index) => `Tag ${index}`);

    await expect(new MailService().setMessageKeywords(account, "Inbox", 41, names, "777")).rejects.toMatchObject({
      code: "TOO_MANY_KEYWORDS",
    });
    expect(imapMocks.connect).not.toHaveBeenCalled();
  });

  it("refuses an unencodable tag name before opening a connection", async () => {
    await expect(
      new MailService().setMessageKeywords(account, "Inbox", 41, ["x".repeat(MESSAGE_TAG_KEYWORD_LIMIT)], "777"),
    ).rejects.toMatchObject({ code: "KEYWORD_UNENCODABLE" });
    expect(imapMocks.connect).not.toHaveBeenCalled();
  });
});
