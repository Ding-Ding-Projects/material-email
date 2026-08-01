import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountDraft, ComposeDraft, FolderSummary, MessageSummary, SendResult } from "../src/shared/contracts";
import { AUTOMATIC_MAIL_QUEUE_ATTEMPT_LIMIT } from "../src/shared/contracts";

const serviceMocks = vi.hoisted(() => ({
  testAccount: vi.fn(),
  listFolders: vi.fn(),
  listMessages: vi.fn(),
  setFlags: vi.fn(),
  moveMessage: vi.fn(),
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
    testAccount(account: unknown): Promise<unknown> { return serviceMocks.testAccount(account); }
    listFolders(account: unknown): Promise<FolderSummary[]> { return serviceMocks.listFolders(account); }
    listMessages(account: unknown, folderPath: string): Promise<MessageSummary[]> { return serviceMocks.listMessages(account, folderPath); }
    setFlags(account: unknown, folderPath: string, uid: number, patch: unknown, expectedUidValidity: string): Promise<void> {
      return serviceMocks.setFlags(account, folderPath, uid, patch, expectedUidValidity);
    }
    moveMessage(account: unknown, folderPath: string, uid: number, destination: string, expectedUidValidity: string): Promise<unknown> {
      return serviceMocks.moveMessage(account, folderPath, uid, destination, expectedUidValidity);
    }
    sendMessage(account: unknown, draft: unknown): Promise<SendResult> { return serviceMocks.sendMessage(account, draft); }
  },
}));

import { AppService } from "../src/main/app-service";

const accountDraft: AccountDraft = {
  displayName: "Queue Test",
  email: "queue@example.test",
  incoming: { host: "imap.example.test", port: 993, security: "tls", username: "queue@example.test" },
  outgoing: { host: "smtp.example.test", port: 465, security: "tls", username: "queue@example.test" },
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
  to: [{ name: "Queue Test", address: "queue@example.test" }],
  cc: [],
  subject: "Queued identity",
  date: "2026-08-01T12:00:00.000Z",
  preview: "Queue mutations must stay ordered and reviewable.",
  unread: true,
  starred: false,
  hasAttachments: false,
  size: 52,
});

const compose = (accountId: string, id: string): ComposeDraft => ({
  id,
  accountId,
  to: [`${id}@example.test`],
  cc: [],
  bcc: [],
  subject: id,
  text: `Queued delivery ${id}`,
  attachments: [],
});

const deferred = <T>(): { promise: Promise<T>; resolve(value: T): void; reject(error: unknown): void } => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

describe("AppService queued-operation recovery", () => {
  let directory = "";

  beforeEach(() => {
    vi.clearAllMocks();
    serviceMocks.testAccount.mockResolvedValue({ incoming: true, outgoing: true });
    serviceMocks.historySnapshot.mockResolvedValue(undefined);
    serviceMocks.setFlags.mockResolvedValue(undefined);
    serviceMocks.moveMessage.mockResolvedValue({ destinationUid: 9001, destinationUidValidity: "888" });
    serviceMocks.listFolders.mockImplementation((account: { id: string }) => Promise.resolve([
      { accountId: account.id, path: "Inbox", name: "Inbox", role: "inbox", unread: 1, total: 1, uidValidity: "777" },
      { accountId: account.id, path: "Archive", name: "Archive", role: "archive", unread: 0, total: 0, uidValidity: "888" },
    ] satisfies FolderSummary[]));
    serviceMocks.listMessages.mockImplementation((account: { id: string }) => Promise.resolve([message(account.id)]));
  });

  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
    directory = "";
  });

  const createService = async (): Promise<{ service: AppService; accountId: string }> => {
    directory = await mkdtemp(path.join(os.tmpdir(), "material-email-queue-"));
    const service = new AppService(directory);
    const account = await service.addAccount(accountDraft);
    await service.syncAccount(account.id);
    return { service, accountId: account.id };
  };

  it("stops automatic pending-operation replay at the public ceiling", async () => {
    const { service, accountId } = await createService();
    serviceMocks.setFlags.mockRejectedValue(new Error("Fixture offline"));

    await service.setMessageFlags(accountId, "Inbox", 41, { starred: true });
    for (let index = 0; index < AUTOMATIC_MAIL_QUEUE_ATTEMPT_LIMIT + 1; index += 1) await service.syncAccount(accountId);

    expect(serviceMocks.setFlags).toHaveBeenCalledTimes(1 + AUTOMATIC_MAIL_QUEUE_ATTEMPT_LIMIT);
    expect(await service.listPendingOperations(accountId)).toEqual([
      expect.objectContaining({
        attempts: AUTOMATIC_MAIL_QUEUE_ATTEMPT_LIMIT,
        automaticAttemptLimit: AUTOMATIC_MAIL_QUEUE_ATTEMPT_LIMIT,
        automaticRetryPaused: true,
        isQueueHead: true,
      }),
    ]);
  });

  it("persists a structured retry action together with independent read and dismiss state", async () => {
    const { service, accountId } = await createService();
    const transportLeak = Object.assign(new Error(String.raw`connect ECONNREFUSED C:\Users\private-user\mail\queued.eml https://smtp.example.test/send?token=private-token query=private-search ImapFlow`), { code: "ECONNREFUSED" });
    serviceMocks.setFlags.mockRejectedValue(transportLeak);

    await service.setMessageFlags(accountId, "Inbox", 41, { starred: true });
    const queued = (await service.bootstrap()).notifications.find(item => item.title === "Change queued for synchronization");
    expect(queued).toMatchObject({
      category: "mail",
      body: "The server refused the connection. Check the server address, port, security mode, and network, then retry.",
      read: false,
      dismissed: false,
      action: { kind: "retry", target: "pending-operation", accountId },
    });
    expect((await service.listPendingOperations(accountId))[0]?.lastError).toBe(queued!.body);
    expect(JSON.stringify({ queued, operations: await service.listPendingOperations(accountId) })).not.toMatch(/private-user|private-token|private-search|smtp\.example|ImapFlow/iu);

    await service.markNotificationRead(queued!.id, true);
    await service.markNotificationDismissed(queued!.id, true);
    const restarted = new AppService(directory);
    expect((await restarted.bootstrap()).notifications.find(item => item.id === queued!.id)).toMatchObject({
      read: true,
      dismissed: true,
      action: queued!.action,
    });
  });

  it("records a settings restore as an append-only undo action", async () => {
    const { service } = await createService();
    await service.savePreferences({ theme: "dark" });
    const source = (await service.bootstrap()).history.find(item => item.kind === "settings-changed")!;

    await service.restoreHistory(source.id);
    let bootstrap = await service.bootstrap();
    expect(bootstrap.preferences.theme).toBe("system");
    const restored = bootstrap.notifications.find(item => item.title === "Revision restored")!;
    expect(restored).toMatchObject({
      category: "history",
      action: { kind: "undo", target: "settings-revision" },
    });

    if (restored.action?.kind !== "undo") throw new Error("Expected the structured settings undo action.");
    await service.restoreHistory(restored.action.historyId);
    bootstrap = await service.bootstrap();
    expect(bootstrap.preferences.theme).toBe("dark");
    expect(bootstrap.history.filter(item => item.kind === "restored")).toHaveLength(2);
  });

  it("enforces queue-head order and rejects a concurrent manual flight while retaining identity", async () => {
    const { service, accountId } = await createService();
    serviceMocks.setFlags.mockRejectedValue(new Error("Fixture offline"));
    await service.setMessageFlags(accountId, "Inbox", 41, { starred: true });
    await service.setMessageFlags(accountId, "Inbox", 41, { unread: false });
    const [first, second] = await service.listPendingOperations(accountId);
    expect(first).toMatchObject({ isQueueHead: true, attempts: 0 });
    expect(second).toMatchObject({ isQueueHead: false, attempts: 0 });

    serviceMocks.setFlags.mockClear();
    await expect(service.retryPendingOperation(accountId, second!.id)).rejects.toThrow(/only the account queue head/i);
    expect(serviceMocks.setFlags).not.toHaveBeenCalled();

    const inFlight = deferred<void>();
    serviceMocks.setFlags.mockReturnValueOnce(inFlight.promise);
    const retry = service.retryPendingOperation(accountId, first!.id);
    await vi.waitFor(() => expect(serviceMocks.setFlags).toHaveBeenCalledOnce());
    await expect(service.retryPendingOperation(accountId, first!.id)).rejects.toThrow(/already running/i);
    inFlight.reject(new Error("Fixture retry failed"));
    await expect(retry).rejects.toThrow(/mail server operation could not complete/iu);

    const after = await service.listPendingOperations(accountId);
    expect(after[0]).toMatchObject({ id: first!.id, attempts: 1, isQueueHead: true, lastError: "The mail server operation could not complete. Check the account server settings and network, then retry." });
    expect(after[1]).toMatchObject({ id: second!.id, attempts: 0, isQueueHead: false });
  });

  it("preserves a UIDVALIDITY-conflicted queue row and refuses unsafe manual replay", async () => {
    const { service, accountId } = await createService();
    serviceMocks.setFlags.mockRejectedValueOnce(new Error("Fixture offline"));
    await service.setMessageFlags(accountId, "Inbox", 41, { starred: true });
    const queuedId = (await service.listPendingOperations(accountId))[0]!.id;

    const mismatch = Object.assign(new Error("Fixture mailbox generation changed"), { code: "MAILBOX_GENERATION_MISMATCH" });
    serviceMocks.setFlags.mockRejectedValueOnce(mismatch);
    serviceMocks.listFolders.mockResolvedValueOnce([
      { accountId, path: "Inbox", name: "Inbox", role: "inbox", unread: 1, total: 1, uidValidity: "778" },
      { accountId, path: "Archive", name: "Archive", role: "archive", unread: 0, total: 0, uidValidity: "888" },
    ] satisfies FolderSummary[]);
    serviceMocks.listMessages.mockResolvedValueOnce([message(accountId, "778")]);
    await service.syncAccount(accountId);

    const conflicted = (await service.listPendingOperations(accountId))[0]!;
    expect(conflicted).toMatchObject({ id: queuedId, attempts: 1, isQueueHead: true });
    expect(conflicted.conflictReason).toMatch(/UIDVALIDITY 777 to 778.*different message/iu);
    const callsBeforeManual = serviceMocks.setFlags.mock.calls.length;
    await expect(service.retryPendingOperation(accountId, queuedId)).rejects.toThrow(/cannot be retried safely|discard/iu);
    expect(serviceMocks.setFlags).toHaveBeenCalledTimes(callsBeforeManual);

    await service.discardPendingOperation(accountId, queuedId);
    expect(await service.listPendingOperations(accountId)).toEqual([]);
  });

  it("keeps MOVE failures fail-closed until the user explicitly discards them", async () => {
    const { service, accountId } = await createService();
    serviceMocks.moveMessage.mockRejectedValue(new Error("The mail server does not advertise MOVE; unsafe fallback refused."));

    await service.moveMessage(accountId, "Inbox", 41, "Archive");
    const before = (await service.listPendingOperations(accountId))[0]!;
    expect(before).toMatchObject({ kind: "move", destination: "Archive", attempts: 0, isQueueHead: true });
    await expect(service.retryPendingOperation(accountId, before.id)).rejects.toThrow(/does not advertise MOVE/iu);
    expect((await service.listPendingOperations(accountId))[0]).toMatchObject({ id: before.id, attempts: 1 });

    await service.discardPendingOperation(accountId, before.id);
    expect(await service.listPendingOperations(accountId)).toEqual([]);
  });

  it("preserves Outbox IDs and counts, blocks non-head delivery, and permits one manual attempt after the ceiling", async () => {
    const { service, accountId } = await createService();
    serviceMocks.sendMessage.mockRejectedValue(new Error("Fixture SMTP offline"));
    await service.sendMessage(compose(accountId, "first-outbox"));
    await service.sendMessage(compose(accountId, "second-outbox"));
    const [first, second] = await service.listOutbox(accountId);
    expect(first).toMatchObject({ isQueueHead: true, attempts: 0 });
    expect(second).toMatchObject({ isQueueHead: false, attempts: 0 });

    serviceMocks.sendMessage.mockClear();
    await expect(service.retryOutbox(accountId, second!.id)).rejects.toThrow(/only the account queue head/i);
    await expect(service.retryOutbox(accountId, first!.id)).rejects.toThrow(/mail server operation could not complete/iu);
    for (let index = 0; index < AUTOMATIC_MAIL_QUEUE_ATTEMPT_LIMIT; index += 1) await service.syncAccount(accountId);
    expect(serviceMocks.sendMessage).toHaveBeenCalledTimes(AUTOMATIC_MAIL_QUEUE_ATTEMPT_LIMIT);

    let rows = await service.listOutbox(accountId);
    expect(rows[0]).toMatchObject({ id: first!.id, attempts: AUTOMATIC_MAIL_QUEUE_ATTEMPT_LIMIT, automaticRetryPaused: true, isQueueHead: true });
    expect(rows[1]).toMatchObject({ id: second!.id, attempts: 0, isQueueHead: false });

    const restarted = new AppService(directory);
    rows = await restarted.listOutbox(accountId);
    expect(rows[0]).toMatchObject({
      id: first!.id,
      attempts: AUTOMATIC_MAIL_QUEUE_ATTEMPT_LIMIT,
      lastError: "The mail server operation could not complete. Check the account server settings and network, then retry.",
      automaticRetryPaused: true,
      isQueueHead: true,
    });
    expect(rows[1]).toMatchObject({ id: second!.id, attempts: 0, isQueueHead: false });

    await expect(restarted.retryOutbox(accountId, first!.id)).rejects.toThrow(/mail server operation could not complete/iu);
    rows = await restarted.listOutbox(accountId);
    expect(rows[0]).toMatchObject({ id: first!.id, attempts: AUTOMATIC_MAIL_QUEUE_ATTEMPT_LIMIT + 1, automaticRetryPaused: true });
    expect(serviceMocks.sendMessage).toHaveBeenCalledTimes(AUTOMATIC_MAIL_QUEUE_ATTEMPT_LIMIT + 1);
  });
});
