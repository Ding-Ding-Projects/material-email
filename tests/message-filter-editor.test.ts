import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountDraft, FolderSummary, MessageFilterInput, MessageSummary, NotificationRecord } from "../src/shared/contracts";
import type { HistoryRecord } from "../src/shared/contracts";
import { MESSAGE_FILTER_RUN_LIMIT } from "../src/shared/message-filters";
import type { MailMoveResult } from "../src/main/mail-service";

const serviceMocks = vi.hoisted(() => ({
  testAccount: vi.fn(),
  listFolders: vi.fn(),
  listMessages: vi.fn(),
  moveMessage: vi.fn(),
  setFlags: vi.fn(),
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

    moveMessage(account: unknown, folderPath: string, uid: number, destination: string, expectedUidValidity: string): Promise<MailMoveResult> {
      return serviceMocks.moveMessage(account, folderPath, uid, destination, expectedUidValidity);
    }

    setFlags(account: unknown, folderPath: string, uid: number, patch: unknown, expectedUidValidity: string): Promise<void> {
      return serviceMocks.setFlags(account, folderPath, uid, patch, expectedUidValidity);
    }
  },
}));

import { AppService } from "../src/main/app-service";

const accountDraft: AccountDraft = {
  displayName: "Filter Test",
  email: "filters@example.test",
  incoming: { host: "imap.example.test", port: 993, security: "tls", username: "filters@example.test" },
  outgoing: { host: "smtp.example.test", port: 465, security: "tls", username: "filters@example.test" },
  authMode: "password",
  secret: "fixture-only-secret",
};

const inboxMessage = (accountId: string, uid: number, subject: string): MessageSummary => ({
  id: `${accountId}:Inbox:${uid}`,
  accountId,
  folderPath: "Inbox",
  uid,
  uidValidity: "901",
  from: [{ name: "Sender", address: "sender@example.test" }],
  to: [{ name: "Filter Test", address: "filters@example.test" }],
  cc: [],
  subject,
  date: "2026-08-01T09:00:00.000Z",
  preview: "A cached preview line.",
  unread: true,
  starred: false,
  hasAttachments: false,
  size: 512,
});

const filterInput = (patch: Partial<MessageFilterInput> = {}): MessageFilterInput => ({
  name: "Invoices",
  enabled: true,
  match: "all",
  runOnSync: true,
  accountId: null,
  conditions: [{ field: "subject", operator: "contains", value: "Invoice", caseSensitive: false }],
  actions: [{ kind: "mark-read", value: "" }],
  ...patch,
});

interface StoredState {
  accounts: Array<{ id: string; syncError?: string }>;
  messages: Record<string, MessageSummary[]>;
  notifications: NotificationRecord[];
  history: HistoryRecord[];
}

describe("message filter editing and the post-synchronization run", () => {
  let directory = "";

  beforeEach(() => {
    vi.clearAllMocks();
    serviceMocks.testAccount.mockResolvedValue({ incoming: true, outgoing: true });
    serviceMocks.historySnapshot.mockResolvedValue(undefined);
    serviceMocks.setFlags.mockResolvedValue(undefined);
    serviceMocks.listFolders.mockImplementation((account: { id: string }) =>
      Promise.resolve([
        { accountId: account.id, path: "Inbox", name: "Inbox", role: "inbox", unread: 2, total: 2, uidValidity: "901" },
        { accountId: account.id, path: "Archive", name: "Archive", role: "archive", unread: 0, total: 0, uidValidity: "902" },
      ] satisfies FolderSummary[]),
    );
    serviceMocks.listMessages.mockResolvedValue([]);
  });

  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
    directory = "";
  });

  const createService = async (): Promise<{ service: AppService; accountId: string }> => {
    directory = await mkdtemp(path.join(os.tmpdir(), "material-email-filters-"));
    const service = new AppService(directory);
    const account = await service.addAccount(accountDraft);
    return { service, accountId: account.id };
  };

  const readState = async (): Promise<StoredState> =>
    JSON.parse(await readFile(path.join(directory, "material-email-state-v1.json"), "utf8")) as StoredState;

  const filterNotifications = (state: StoredState): NotificationRecord[] =>
    state.notifications.filter(item => item.title === "Filters ran after synchronization");

  it("creates, renames, and lists filters in the order they will run", async () => {
    const { service } = await createService();

    await service.saveMessageFilter(filterInput({ name: "First" }));
    await service.saveMessageFilter(filterInput({ name: "Second" }));
    const created = await service.listMessageFilters();

    expect(created.map(filter => filter.name)).toEqual(["First", "Second"]);
    expect(created.map(filter => filter.ordinal)).toEqual([0, 1]);

    const renamed = await service.saveMessageFilter(filterInput({ id: created[0]?.id ?? "", name: "First renamed", enabled: false }));
    expect(renamed[0]).toMatchObject({ id: created[0]?.id, name: "First renamed", enabled: false, ordinal: 0 });
    expect(renamed).toHaveLength(2);
  });

  it("refuses a filter the evaluator could never run", async () => {
    const { service } = await createService();

    await expect(service.saveMessageFilter(filterInput({ conditions: [] }))).rejects.toMatchObject({ code: "FILTER_CONDITION_REQUIRED" });
    await expect(service.saveMessageFilter(filterInput({ actions: [] }))).rejects.toMatchObject({ code: "FILTER_ACTION_REQUIRED" });
    await expect(service.saveMessageFilter(filterInput({
      conditions: [{ field: "subject", operator: "regex", value: "(unclosed", caseSensitive: false }],
    }))).rejects.toMatchObject({ code: "FILTER_PATTERN_INVALID" });
    await expect(service.saveMessageFilter(filterInput({
      conditions: [{ field: "size", operator: "contains", value: "10", caseSensitive: false }],
    }))).rejects.toMatchObject({ code: "FILTER_OPERATOR_UNSUPPORTED" });
    await expect(service.saveMessageFilter(filterInput({ actions: [{ kind: "add-tag", value: "  " }] })))
      .rejects.toMatchObject({ code: "FILTER_VALUE_REQUIRED" });

    expect(await service.listMessageFilters()).toEqual([]);
  });

  it("reorders filters and closes the gap in the order after a delete", async () => {
    const { service } = await createService();
    await service.saveMessageFilter(filterInput({ name: "A" }));
    await service.saveMessageFilter(filterInput({ name: "B" }));
    await service.saveMessageFilter(filterInput({ name: "C" }));
    const [a, b, c] = await service.listMessageFilters();

    // Only two of the three are named, so the unnamed one keeps its relative place behind them.
    const reordered = await service.reorderMessageFilters([c?.id ?? "", a?.id ?? ""]);
    expect(reordered.map(filter => filter.name)).toEqual(["C", "A", "B"]);
    expect(reordered.map(filter => filter.ordinal)).toEqual([0, 1, 2]);

    const remaining = await service.deleteMessageFilter(a?.id ?? "");
    expect(remaining.map(filter => filter.name)).toEqual(["C", "B"]);
    expect(remaining.map(filter => filter.ordinal)).toEqual([0, 1]);
    expect(remaining.some(filter => filter.id === b?.id)).toBe(true);
  });

  it("applies the run-on-sync filters to the messages a synchronization brought in", async () => {
    const { service, accountId } = await createService();
    await service.saveMessageFilter(filterInput());
    serviceMocks.listMessages.mockResolvedValue([
      inboxMessage(accountId, 1, "Invoice 1"),
      inboxMessage(accountId, 2, "Invoice 2"),
    ]);

    await service.syncAccount(accountId);

    expect(serviceMocks.setFlags).toHaveBeenCalledTimes(2);
    expect(serviceMocks.setFlags).toHaveBeenCalledWith(expect.objectContaining({ id: accountId }), "Inbox", 1, { unread: false }, "901");
    const state = await readState();
    expect(state.messages[`${accountId}\u0000Inbox`]?.map(message => message.unread)).toEqual([false, false]);
    expect(filterNotifications(state)[0]).toMatchObject({
      kind: "success",
      body: "2 of 2 newly arrived messages were updated.",
    });
    expect(state.history.some(record => record.label === "Ran filters on 2 newly synchronized messages")).toBe(true);
  });

  it("leaves a disabled filter and a manual-only filter out of the post-sync run", async () => {
    const { service, accountId } = await createService();
    await service.saveMessageFilter(filterInput({ name: "Disabled but automatic", enabled: false, runOnSync: true }));
    await service.saveMessageFilter(filterInput({ name: "Enabled but manual", enabled: true, runOnSync: false }));
    serviceMocks.listMessages.mockResolvedValue([inboxMessage(accountId, 1, "Invoice 1")]);

    await service.syncAccount(accountId);

    expect(serviceMocks.setFlags).not.toHaveBeenCalled();
    const state = await readState();
    expect(state.messages[`${accountId}\u0000Inbox`]?.[0]?.unread).toBe(true);
    expect(filterNotifications(state)).toEqual([]);
  });

  it("does not act twice on a message a later synchronization returns again", async () => {
    const { service, accountId } = await createService();
    await service.saveMessageFilter(filterInput());
    const first = inboxMessage(accountId, 1, "Invoice 1");
    const second = inboxMessage(accountId, 2, "Invoice 2");
    serviceMocks.listMessages.mockResolvedValue([first, second]);

    await service.syncAccount(accountId);
    expect(serviceMocks.setFlags).toHaveBeenCalledTimes(2);

    // The server reports the same two messages as unread again, plus one that is genuinely new.
    serviceMocks.setFlags.mockClear();
    serviceMocks.listMessages.mockResolvedValue([first, second, inboxMessage(accountId, 3, "Invoice 3")]);
    await service.syncAccount(accountId);

    expect(serviceMocks.setFlags).toHaveBeenCalledTimes(1);
    expect(serviceMocks.setFlags).toHaveBeenCalledWith(expect.objectContaining({ id: accountId }), "Inbox", 3, { unread: false }, "901");
    const state = await readState();
    expect(filterNotifications(state).map(item => item.body)).toEqual([
      "1 of 1 newly arrived messages were updated.",
      "2 of 2 newly arrived messages were updated.",
    ]);
  });

  it("does not resume a run-on-sync filter after a restart for messages already in the cache", async () => {
    const { service, accountId } = await createService();
    await service.saveMessageFilter(filterInput());
    serviceMocks.listMessages.mockResolvedValue([inboxMessage(accountId, 1, "Invoice 1")]);
    await service.syncAccount(accountId);
    expect(serviceMocks.setFlags).toHaveBeenCalledTimes(1);

    // A restart drops the in-memory ledger, so the arrival diff against the cache has to carry it.
    serviceMocks.setFlags.mockClear();
    await new AppService(directory).syncAccount(accountId);

    expect(serviceMocks.setFlags).not.toHaveBeenCalled();
    expect(filterNotifications(await readState())).toHaveLength(1);
  });

  it("stops at the run ceiling instead of filtering an unbounded arrival", async () => {
    const { service, accountId } = await createService();
    await service.saveMessageFilter(filterInput({ actions: [{ kind: "star", value: "" }] }));
    const bulk = Array.from({ length: MESSAGE_FILTER_RUN_LIMIT }, (_unused, index) => inboxMessage(accountId, index + 1, `Routine ${index + 1}`));
    const beyondCeiling = inboxMessage(accountId, MESSAGE_FILTER_RUN_LIMIT + 1, "Invoice beyond the ceiling");
    serviceMocks.listMessages.mockResolvedValue([...bulk, beyondCeiling]);

    await service.syncAccount(accountId);

    expect(serviceMocks.setFlags).not.toHaveBeenCalled();
    expect(filterNotifications(await readState())).toEqual([]);

    // The same filter still matches that subject: only the ceiling kept the message out of the run.
    const withinCeiling = inboxMessage(accountId, MESSAGE_FILTER_RUN_LIMIT + 2, "Invoice inside the ceiling");
    serviceMocks.listMessages.mockResolvedValue([...bulk, beyondCeiling, withinCeiling]);
    await service.syncAccount(accountId);

    expect(serviceMocks.setFlags).toHaveBeenCalledTimes(1);
    expect(serviceMocks.setFlags).toHaveBeenCalledWith(
      expect.objectContaining({ id: accountId }),
      "Inbox",
      MESSAGE_FILTER_RUN_LIMIT + 2,
      { starred: true },
      "901",
    );
  }, 60_000);

  it("keeps the synchronization successful when a filter action fails", async () => {
    const { service, accountId } = await createService();
    await service.saveMessageFilter(filterInput({ actions: [{ kind: "move", value: "Archive" }] }));
    serviceMocks.listMessages.mockResolvedValue([inboxMessage(accountId, 1, "Invoice 1")]);
    serviceMocks.moveMessage.mockRejectedValue(Object.assign(new Error("Fixture mailbox generation changed"), {
      code: "MAILBOX_GENERATION_MISMATCH",
    }));

    const result = await service.syncAccount(accountId);

    expect(result.messages.map(message => message.uid)).toEqual([1]);
    const state = await readState();
    expect(state.accounts[0]?.syncError).toBeUndefined();
    expect(state.messages[`${accountId}\u0000Inbox`]?.map(message => message.folderPath)).toEqual(["Inbox"]);
    expect(state.notifications.some(item => item.title === "Mail synchronized")).toBe(true);
    expect(filterNotifications(state)[0]).toMatchObject({
      kind: "warning",
      body: "0 of 1 newly arrived messages were updated. 1 could not be completed.",
    });
  });
});
