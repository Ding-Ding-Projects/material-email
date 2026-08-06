import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountDraft, FolderSummary, MessageSummary } from "../src/shared/contracts";

const serviceMocks = vi.hoisted(() => ({
  testAccount: vi.fn(),
  listFolders: vi.fn(),
  listMessages: vi.fn(),
  setMessageKeywords: vi.fn(),
  historySnapshot: vi.fn(),
}));

vi.mock("electron", () => ({
  app: { getAppPath: () => process.cwd(), getVersion: () => "0.1.0-test" },
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value, "utf8"),
    decryptString: (value: Buffer) => value.toString("utf8"),
  },
}));

vi.mock("../src/main/history-repository.js", () => ({
  HistoryRepository: class {
    snapshot(filePath: string): Promise<void> {
      return serviceMocks.historySnapshot(filePath);
    }
  },
}));

vi.mock("../src/main/mail-service.js", async importOriginal => ({
  ...(await importOriginal<typeof import("../src/main/mail-service")>()),
  MailService: class {
    testAccount(account: unknown): Promise<unknown> {
      return serviceMocks.testAccount(account);
    }

    listFolders(account: unknown): Promise<unknown> {
      return serviceMocks.listFolders(account);
    }

    listMessages(account: unknown, folderPath: string): Promise<unknown> {
      return serviceMocks.listMessages(account, folderPath);
    }

    setMessageKeywords(
      account: unknown,
      folderPath: string,
      uid: number,
      tagNames: string[],
      expectedUidValidity: string,
    ): Promise<unknown> {
      return serviceMocks.setMessageKeywords(account, folderPath, uid, tagNames, expectedUidValidity);
    }
  },
}));

import { AppService } from "../src/main/app-service";

const accountDraft: AccountDraft = {
  displayName: "Tag Wiring Test",
  email: "tags@example.test",
  incoming: { host: "imap.example.test", port: 993, security: "tls", username: "tags@example.test" },
  outgoing: { host: "smtp.example.test", port: 465, security: "tls", username: "tags@example.test" },
  authMode: "password",
  secret: "fixture-only-secret",
};

const message = (accountId: string, uidValidity = "777"): MessageSummary => ({
  id: `${accountId}:Inbox:41`,
  accountId,
  folderPath: "Inbox",
  uid: 41,
  uidValidity,
  from: [{ name: "Sender", address: "sender@example.test" }],
  to: [{ name: "Tag Wiring Test", address: "tags@example.test" }],
  cc: [],
  subject: "Server-side keyword wiring",
  date: "2026-08-06T09:00:00.000Z",
  preview: "A cached preview line.",
  unread: true,
  starred: false,
  hasAttachments: false,
  size: 256,
});

/**
 * A stand-in for {@link import("../src/main/mail-service").MailKeywordError}. The real class lives in
 * a module this file mocks wholesale (like every other AppService-level test), so its exact identity
 * does not matter here: `setMessageTags` only reacts to a rejection and its message, exactly like it
 * would for the real class.
 */
const keywordError = (code: string, message: string): Error => Object.assign(new Error(message), { name: "MailKeywordError", code });

describe("AppService message tagging wired to server-side IMAP keywords", () => {
  let directory = "";

  beforeEach(() => {
    vi.clearAllMocks();
    serviceMocks.testAccount.mockResolvedValue({ incoming: true, outgoing: true });
    serviceMocks.historySnapshot.mockResolvedValue(undefined);
    serviceMocks.listFolders.mockImplementation((account: { id: string }) =>
      Promise.resolve([
        { accountId: account.id, path: "Inbox", name: "Inbox", role: "inbox", unread: 1, total: 1, uidValidity: "777" },
      ] satisfies FolderSummary[]),
    );
    serviceMocks.listMessages.mockImplementation((account: { id: string }) => Promise.resolve([message(account.id)]));
  });

  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
    directory = "";
  });

  const createService = async (): Promise<{ service: AppService; accountId: string }> => {
    directory = await mkdtemp(path.join(os.tmpdir(), "material-email-tag-wiring-"));
    const service = new AppService(directory);
    const account = await service.addAccount(accountDraft);
    await service.syncAccount(account.id);
    return { service, accountId: account.id };
  };

  it("asks the server to keep the tag as an IMAP keyword before applying it locally", async () => {
    const { service, accountId } = await createService();
    serviceMocks.setMessageKeywords.mockResolvedValue({ added: ["mtag-work"], removed: [], keywords: ["mtag-work"] });

    const applied = await service.setMessageTags(accountId, "Inbox", 41, ["work"]);

    expect(applied).toEqual(["work"]);
    expect(serviceMocks.setMessageKeywords).toHaveBeenCalledTimes(1);
    expect(serviceMocks.setMessageKeywords).toHaveBeenCalledWith(
      expect.objectContaining({ id: accountId }),
      "Inbox",
      41,
      ["Work"],
      "777",
    );
    expect(await service.listMessageTagAssignments()).toMatchObject({ [`${accountId}:Inbox:41`]: ["work"] });
  });

  it("fails closed and leaves local tags unchanged when the server rejects the keyword change", async () => {
    const { service, accountId } = await createService();
    serviceMocks.setMessageKeywords.mockRejectedValue(keywordError("KEYWORD_NOT_STORED", "The mail server did not confirm the tag change."));

    await expect(service.setMessageTags(accountId, "Inbox", 41, ["work"])).rejects.toThrow("The mail server did not confirm the tag change.");

    expect(await service.listMessageTagAssignments()).toEqual({});
  });

  it("fails closed when the account's mailbox does not advertise keyword support", async () => {
    const { service, accountId } = await createService();
    serviceMocks.setMessageKeywords.mockRejectedValue(
      keywordError("KEYWORDS_UNSUPPORTED", "The mail server does not accept tag keywords in Inbox, so the tags were left unchanged there."),
    );

    await expect(service.setMessageTags(accountId, "Inbox", 41, ["work"])).rejects.toThrow(/does not accept tag keywords in Inbox/u);

    // Nothing was ever confirmed by the server, so the local catalogue stays exactly as it was.
    expect(await service.listMessageTagAssignments()).toEqual({});
    expect(serviceMocks.setMessageKeywords).toHaveBeenCalledTimes(1);
  });

  it("removing the last server call still leaves state consistent after a prior successful tag", async () => {
    const { service, accountId } = await createService();
    serviceMocks.setMessageKeywords.mockResolvedValueOnce({ added: ["mtag-work"], removed: [], keywords: ["mtag-work"] });
    await service.setMessageTags(accountId, "Inbox", 41, ["work"]);
    expect(await service.listMessageTagAssignments()).toMatchObject({ [`${accountId}:Inbox:41`]: ["work"] });

    serviceMocks.setMessageKeywords.mockRejectedValueOnce(keywordError("KEYWORD_NOT_STORED", "The mail server did not confirm the tag change."));
    await expect(service.setMessageTags(accountId, "Inbox", 41, [])).rejects.toThrow("The mail server did not confirm the tag change.");

    // The failed removal must not have silently taken effect locally.
    expect(await service.listMessageTagAssignments()).toMatchObject({ [`${accountId}:Inbox:41`]: ["work"] });
  });

  it("never opens a network connection for the demo account and applies the tag locally", async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "material-email-tag-wiring-demo-"));
    const service = new AppService(directory);
    const demoAccount = await service.createDemoAccount();
    const demoMessages = await service.listMessages(demoAccount.id, "Inbox");
    const demoMessage = demoMessages[0]!;

    const applied = await service.setMessageTags(demoAccount.id, demoMessage.folderPath, demoMessage.uid, ["work"]);

    expect(applied).toEqual(["work"]);
    expect(serviceMocks.setMessageKeywords).not.toHaveBeenCalled();
    expect(await service.listMessageTagAssignments()).toMatchObject({ [demoMessage.id]: ["work"] });
  });
});
