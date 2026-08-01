import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountDraft, ComposeDraft, FolderSummary, MessageDetail, MessageSummary, SendResult } from "../src/shared/contracts";
import type { MailMoveResult } from "../src/main/mail-service";

const serviceMocks = vi.hoisted(() => ({
  testAccount: vi.fn(),
  listFolders: vi.fn(),
  listMessages: vi.fn(),
  getMessage: vi.fn(),
  moveMessage: vi.fn(),
  setFlags: vi.fn(),
  sendMessage: vi.fn(),
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

vi.mock("../src/main/mail-service.js", () => ({
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

    getMessage(account: unknown, folderPath: string, uid: number, expectedUidValidity: string): Promise<MessageDetail> {
      return serviceMocks.getMessage(account, folderPath, uid, expectedUidValidity);
    }

    moveMessage(account: unknown, folderPath: string, uid: number, destination: string, expectedUidValidity: string): Promise<MailMoveResult> {
      return serviceMocks.moveMessage(account, folderPath, uid, destination, expectedUidValidity);
    }

    setFlags(account: unknown, folderPath: string, uid: number, patch: unknown, expectedUidValidity: string): Promise<void> {
      return serviceMocks.setFlags(account, folderPath, uid, patch, expectedUidValidity);
    }

    sendMessage(account: unknown, draft: unknown): Promise<SendResult> {
      return serviceMocks.sendMessage(account, draft);
    }
  },
}));

import { AppService } from "../src/main/app-service";

const accountDraft: AccountDraft = {
  displayName: "Move Test",
  email: "move@example.test",
  incoming: { host: "imap.example.test", port: 993, security: "tls", username: "move@example.test" },
  outgoing: { host: "smtp.example.test", port: 465, security: "tls", username: "move@example.test" },
  authMode: "password",
  secret: "fixture-only-secret",
};

const sourceMessage = (accountId: string): MessageSummary => ({
  id: `${accountId}:Inbox:41`,
  accountId,
  folderPath: "Inbox",
  uid: 41,
  uidValidity: "777",
  from: [{ name: "Sender", address: "sender@example.test" }],
  to: [{ name: "Move Test", address: "move@example.test" }],
  cc: [],
  subject: "Mailbox-scoped identity",
  date: "2026-07-31T12:00:00.000Z",
  preview: "Never recycle a source UID in another mailbox.",
  unread: true,
  starred: false,
  hasAttachments: false,
  size: 42,
});

const sourceDetail = (accountId: string): MessageDetail => ({
  ...sourceMessage(accountId),
  text: "Old generation detail body.",
  html: "<p>Old generation detail body.</p>",
  attachments: [],
  replyTo: [{ name: "Sender", address: "sender@example.test" }],
});

interface StoredState {
  accounts: unknown[];
  folders: Record<string, FolderSummary[]>;
  messages: Record<string, MessageSummary[]>;
  details: Record<string, MessageDetail>;
  drafts: ComposeDraft[];
  outbox: Array<{ draft: ComposeDraft }>;
  pendingOperations: Array<{ accountId: string; uidValidity?: string }>;
  notifications: Array<{ kind: string; title: string; body: string }>;
}

describe("AppService move identity and account removal", () => {
  let directory = "";

  beforeEach(() => {
    vi.clearAllMocks();
    serviceMocks.testAccount.mockResolvedValue({ incoming: true, outgoing: true });
    serviceMocks.historySnapshot.mockResolvedValue(undefined);
    serviceMocks.listFolders.mockImplementation((account: { id: string }) =>
      Promise.resolve([
        { accountId: account.id, path: "Inbox", name: "Inbox", role: "inbox", unread: 1, total: 1, uidValidity: "777" },
        { accountId: account.id, path: "Archive", name: "Archive", role: "archive", unread: 0, total: 0, uidValidity: "888" },
      ] satisfies FolderSummary[]),
    );
    serviceMocks.listMessages.mockImplementation((account: { id: string }, folderPath: string) =>
      Promise.resolve(folderPath === "Inbox" ? [sourceMessage(account.id)] : []),
    );
    serviceMocks.setFlags.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
    directory = "";
  });

  const createService = async (): Promise<{ service: AppService; accountId: string }> => {
    directory = await mkdtemp(path.join(os.tmpdir(), "material-email-move-"));
    const service = new AppService(directory);
    const account = await service.addAccount(accountDraft);
    await service.syncAccount(account.id);
    return { service, accountId: account.id };
  };

  const readState = async (): Promise<StoredState> =>
    JSON.parse(await readFile(path.join(directory, "material-email-state-v1.json"), "utf8")) as StoredState;

  it("uses an explicit destination UID mapping and drops the source UIDVALIDITY", async () => {
    const { service, accountId } = await createService();
    serviceMocks.moveMessage.mockResolvedValue({ destinationUid: 9001, destinationUidValidity: "888" });

    await service.moveMessage(accountId, "Inbox", 41, "Archive");

    expect(serviceMocks.moveMessage).toHaveBeenCalledWith(expect.objectContaining({ id: accountId }), "Inbox", 41, "Archive", "777");
    const state = await readState();
    expect(state.messages[`${accountId}\u0000Inbox`]).toEqual([]);
    expect(state.messages[`${accountId}\u0000Archive`]).toEqual([
      expect.objectContaining({ id: `${accountId}:Archive:9001`, folderPath: "Archive", uid: 9001, uidValidity: "888" }),
    ]);
    expect(JSON.stringify(state.messages)).not.toContain(`${accountId}:Archive:41`);
  });

  it("defers destination caching when a successful MOVE has no UIDPLUS mapping", async () => {
    const { service, accountId } = await createService();
    serviceMocks.moveMessage.mockResolvedValue({});

    await service.moveMessage(accountId, "Inbox", 41, "Archive");

    expect(serviceMocks.moveMessage).toHaveBeenCalledWith(expect.objectContaining({ id: accountId }), "Inbox", 41, "Archive", "777");
    const state = await readState();
    expect(state.messages[`${accountId}\u0000Inbox`]).toEqual([]);
    expect(state.messages[`${accountId}\u0000Archive`] ?? []).toEqual([]);
    expect(JSON.stringify(state.messages)).not.toContain(`${accountId}:Archive:41`);
    expect(state.notifications[0]).toMatchObject({
      kind: "success",
      title: "Message moved",
      body: expect.stringContaining("destination will appear after that folder refreshes"),
    });
  });

  it("queues an offline move without inventing a destination UID", async () => {
    const { service, accountId } = await createService();
    serviceMocks.moveMessage.mockRejectedValue(new Error("Fixture offline"));

    await service.moveMessage(accountId, "Inbox", 41, "Archive");

    expect(serviceMocks.moveMessage).toHaveBeenCalledWith(expect.objectContaining({ id: accountId }), "Inbox", 41, "Archive", "777");
    const state = await readState();
    expect(state.messages[`${accountId}\u0000Inbox`]).toEqual([]);
    expect(state.messages[`${accountId}\u0000Archive`] ?? []).toEqual([]);
    expect(JSON.stringify(state.messages)).not.toContain(`${accountId}:Archive:41`);
    expect(state.pendingOperations).toEqual([expect.objectContaining({ accountId, uidValidity: "777" })]);
    expect(state.notifications[0]).toMatchObject({ kind: "warning", title: "Move queued for synchronization" });
  });

  it("fails closed instead of converting a live UIDVALIDITY mismatch into queued flag or move work", async () => {
    const { service, accountId } = await createService();
    const generationMismatch = Object.assign(new Error("Fixture mailbox generation changed"), {
      code: "MAILBOX_GENERATION_MISMATCH",
    });
    serviceMocks.setFlags.mockRejectedValueOnce(generationMismatch);

    await expect(service.setMessageFlags(accountId, "Inbox", 41, { starred: true })).rejects.toBe(generationMismatch);
    expect(serviceMocks.setFlags).toHaveBeenCalledWith(expect.objectContaining({ id: accountId }), "Inbox", 41, { starred: true }, "777");
    let state = await readState();
    expect(state.messages[`${accountId}\u0000Inbox`]).toEqual([sourceMessage(accountId)]);
    expect(state.pendingOperations).toEqual([]);

    serviceMocks.moveMessage.mockRejectedValueOnce(generationMismatch);
    await expect(service.moveMessage(accountId, "Inbox", 41, "Archive")).rejects.toBe(generationMismatch);
    expect(serviceMocks.moveMessage).toHaveBeenCalledWith(expect.objectContaining({ id: accountId }), "Inbox", 41, "Archive", "777");
    state = await readState();
    expect(state.messages[`${accountId}\u0000Inbox`]).toEqual([sourceMessage(accountId)]);
    expect(state.messages[`${accountId}\u0000Archive`] ?? []).toEqual([]);
    expect(state.pendingOperations).toEqual([]);
  });

  it("does not let a late detail fetch repopulate a UID after synchronization replaced its UIDVALIDITY generation", async () => {
    const { service, accountId } = await createService();
    let resolveDetail!: (detail: MessageDetail) => void;
    serviceMocks.getMessage.mockReturnValueOnce(new Promise<MessageDetail>(resolve => {
      resolveDetail = resolve;
    }));

    const detailPromise = service.getMessage(accountId, "Inbox", 41);
    await vi.waitFor(() =>
      expect(serviceMocks.getMessage).toHaveBeenCalledWith(expect.objectContaining({ id: accountId }), "Inbox", 41, "777"),
    );

    serviceMocks.listFolders.mockResolvedValueOnce([
      { accountId, path: "Inbox", name: "Inbox", role: "inbox", unread: 1, total: 1, uidValidity: "778" },
      { accountId, path: "Archive", name: "Archive", role: "archive", unread: 0, total: 0, uidValidity: "888" },
    ] satisfies FolderSummary[]);
    const replacement = {
      ...sourceMessage(accountId),
      uidValidity: "778",
      subject: "Replacement generation",
      preview: "This row reused UID 41 in the new mailbox generation.",
    };
    serviceMocks.listMessages.mockResolvedValueOnce([replacement]);
    await service.syncAccount(accountId);
    resolveDetail(sourceDetail(accountId));

    await expect(detailPromise).rejects.toThrow(/generation changed.*UIDVALIDITY 777.*778/iu);
    const state = await readState();
    expect(state.details[`${accountId}:Inbox:41`]).toBeUndefined();
    expect(state.messages[`${accountId}\u0000Inbox`]).toEqual([replacement]);
  });

  it("does not remove a replacement UID when an older-generation MOVE completes after reconciliation", async () => {
    const { service, accountId } = await createService();
    let resolveMove!: (result: MailMoveResult) => void;
    serviceMocks.moveMessage.mockReturnValueOnce(new Promise<MailMoveResult>(resolve => {
      resolveMove = resolve;
    }));

    const movePromise = service.moveMessage(accountId, "Inbox", 41, "Archive");
    await vi.waitFor(() =>
      expect(serviceMocks.moveMessage).toHaveBeenCalledWith(expect.objectContaining({ id: accountId }), "Inbox", 41, "Archive", "777"),
    );

    serviceMocks.listFolders.mockResolvedValueOnce([
      { accountId, path: "Inbox", name: "Inbox", role: "inbox", unread: 1, total: 1, uidValidity: "778" },
      { accountId, path: "Archive", name: "Archive", role: "archive", unread: 0, total: 0, uidValidity: "888" },
    ] satisfies FolderSummary[]);
    const replacement = {
      ...sourceMessage(accountId),
      uidValidity: "778",
      subject: "Replacement generation",
      preview: "Do not remove this reused UID after the old MOVE resolves.",
    };
    serviceMocks.listMessages.mockResolvedValueOnce([replacement]);
    await service.syncAccount(accountId);
    resolveMove({ destinationUid: 9001, destinationUidValidity: "888" });

    await expect(movePromise).rejects.toThrow(/generation changed.*UIDVALIDITY 777.*778/iu);
    const state = await readState();
    expect(state.messages[`${accountId}\u0000Inbox`]).toEqual([replacement]);
    expect(state.messages[`${accountId}\u0000Archive`] ?? []).toEqual([]);
  });

  it("removes every live draft, outbox item, and queued operation owned by a removed account", async () => {
    const { service, accountId } = await createService();
    await service.saveDraft({
      id: "saved-draft",
      accountId,
      to: ["saved@example.test"],
      cc: [],
      bcc: [],
      subject: "Saved private draft",
      text: "This live row must leave with the account.",
      attachments: [],
    });
    serviceMocks.sendMessage.mockRejectedValue(new Error("Fixture network outage"));
    await service.sendMessage({
      id: "queued-draft",
      accountId,
      to: ["queued@example.test"],
      cc: [],
      bcc: [],
      subject: "Queued private draft",
      text: "This outbox row must leave with the account.",
      attachments: [],
    });
    serviceMocks.setFlags.mockRejectedValue(new Error("Fixture network outage"));
    await service.setMessageFlags(accountId, "Inbox", 41, { starred: true });
    expect(serviceMocks.setFlags).toHaveBeenCalledWith(expect.objectContaining({ id: accountId }), "Inbox", 41, { starred: true }, "777");
    const before = await readState();
    expect(before.drafts).toHaveLength(1);
    expect(before.outbox).toHaveLength(1);
    expect(before.pendingOperations).toHaveLength(1);

    await service.removeAccount(accountId);

    const after = await readState();
    expect(after.accounts).toEqual([]);
    expect(after.drafts).toEqual([]);
    expect(after.outbox).toEqual([]);
    expect(after.pendingOperations).toEqual([]);
    expect(JSON.stringify({ drafts: after.drafts, outbox: after.outbox, pendingOperations: after.pendingOperations })).not.toContain(
      "This live row must leave with the account.",
    );
  });

  it("rejects a draft save after account removal instead of recreating private account state", async () => {
    const { service, accountId } = await createService();
    await service.removeAccount(accountId);

    await expect(service.saveDraft({
      accountId,
      to: ["recipient@example.test"],
      cc: [],
      bcc: [],
      subject: "Orphan draft must be refused",
      text: "Private body must not return after account removal.",
      attachments: [],
    })).rejects.toThrow(/account no longer exists/i);

    const state = await readState();
    expect(state.accounts).toEqual([]);
    expect(state.drafts).toEqual([]);
    expect(JSON.stringify(state)).not.toContain("Private body must not return after account removal.");
  });

  it("does not let in-flight cache or send results repopulate an account after removal", async () => {
    const { service, accountId } = await createService();
    let resolveMessages!: (messages: MessageSummary[]) => void;
    const delayedMessages = new Promise<MessageSummary[]>(resolve => { resolveMessages = resolve; });
    serviceMocks.listMessages.mockReturnValue(delayedMessages);
    const listPromise = service.listMessages(accountId, "Delayed");
    await vi.waitFor(() => expect(serviceMocks.listMessages).toHaveBeenCalledWith(expect.objectContaining({ id: accountId }), "Delayed"));

    let resolveSend!: (result: SendResult) => void;
    const delayedSend = new Promise<SendResult>(resolve => { resolveSend = resolve; });
    serviceMocks.sendMessage.mockReturnValue(delayedSend);
    const sendPromise = service.sendMessage({
      accountId,
      to: ["recipient@example.test"],
      cc: [],
      bcc: [],
      subject: "In-flight private message",
      text: "Neither cache nor outbox may resurrect this account.",
      attachments: [],
    });
    await vi.waitFor(() => expect(serviceMocks.sendMessage).toHaveBeenCalled());

    await service.removeAccount(accountId);
    resolveMessages([{ ...sourceMessage(accountId), folderPath: "Delayed", id: `${accountId}:Delayed:41`, preview: "Delayed private cache" }]);
    resolveSend({ messageId: "<accepted-after-removal@example.test>", accepted: ["recipient@example.test"], rejected: [], queued: false });

    await expect(listPromise).rejects.toThrow(/account no longer exists/i);
    await expect(sendPromise).rejects.toThrow(/account no longer exists/i);
    const state = await readState();
    expect(state.accounts).toEqual([]);
    expect(state.drafts).toEqual([]);
    expect(state.outbox).toEqual([]);
    expect(Object.keys(state.messages).some(key => key.startsWith(`${accountId}\u0000`))).toBe(false);
    expect(JSON.stringify(state)).not.toContain("Delayed private cache");
    expect(JSON.stringify(state)).not.toContain("Neither cache nor outbox may resurrect this account.");
  });
});
