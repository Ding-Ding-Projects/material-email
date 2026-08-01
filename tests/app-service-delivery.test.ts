import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AccountDraft,
  ComposeDraft,
  HistoryRecord,
  NotificationRecord,
  SendResult,
} from "../src/shared/contracts";

const serviceMocks = vi.hoisted(() => ({
  mailTestAccount: vi.fn(),
  mailSendMessage: vi.fn(),
  historySnapshot: vi.fn(),
}));

vi.mock("electron", () => ({
  app: {
    getAppPath: () => process.cwd(),
    getVersion: () => "0.1.0-test",
  },
  dialog: {
    showOpenDialog: vi.fn(),
    showSaveDialog: vi.fn(),
  },
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
      return serviceMocks.mailTestAccount(account);
    }

    sendMessage(account: unknown, draft: unknown): Promise<SendResult> {
      return serviceMocks.mailSendMessage(account, draft);
    }
  },
}));

import { AppService } from "../src/main/app-service";

interface PersistedDeliveryState {
  drafts: ComposeDraft[];
  outbox: Array<{ draft: ComposeDraft }>;
  notifications: NotificationRecord[];
  history: HistoryRecord[];
}

const deferred = <T>(): { promise: Promise<T>; resolve(value: T): void; reject(error: unknown): void } => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const accountDraft: AccountDraft = {
  displayName: "Delivery Test",
  email: "delivery@example.test",
  incoming: { host: "imap.example.test", port: 993, security: "tls", username: "delivery@example.test" },
  outgoing: { host: "smtp.example.test", port: 465, security: "tls", username: "delivery@example.test" },
  authMode: "password",
  secret: "fixture-only-secret",
};

const composeDraft = (accountId: string, id: string): ComposeDraft => ({
  id,
  accountId,
  to: ["accepted-one@example.test", "accepted-two@example.test"],
  cc: [],
  bcc: ["rejected@example.test"],
  subject: "Delivery accounting",
  text: "Keep recipient outcomes exact.",
  attachments: [],
});

const readState = async (directory: string): Promise<PersistedDeliveryState> =>
  JSON.parse(await readFile(path.join(directory, "material-email-state-v1.json"), "utf8")) as PersistedDeliveryState;

describe("AppService delivery accounting", () => {
  let directory = "";

  beforeEach(() => {
    vi.clearAllMocks();
    serviceMocks.mailTestAccount.mockResolvedValue({ incoming: true, outgoing: true });
    serviceMocks.historySnapshot.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
    directory = "";
  });

  const createService = async (): Promise<{ service: AppService; accountId: string }> => {
    directory = await mkdtemp(path.join(os.tmpdir(), "material-email-delivery-"));
    const service = new AppService(directory);
    const account = await service.addAccount(accountDraft);
    return { service, accountId: account.id };
  };

  it("returns the exact zero-accepted outcome and retains the unchanged draft for retry", async () => {
    const { service, accountId } = await createService();
    const draft = composeDraft(accountId, "retryable-draft");
    await service.saveDraft(draft);
    const result: SendResult = {
      messageId: "<rejected-all@example.test>",
      accepted: [],
      rejected: ["accepted-one@example.test", "accepted-two@example.test", "rejected@example.test"],
      queued: false,
    };
    serviceMocks.mailSendMessage.mockResolvedValueOnce(result);

    await expect(service.sendMessage(draft)).resolves.toEqual(result);

    const state = await readState(directory);
    expect(state.drafts).toEqual([draft]);
    expect(state.outbox).toEqual([]);
    expect(state.notifications[0]).toMatchObject({
      kind: "error",
      title: "Message not sent; draft kept",
      body: "0 recipients accepted; 3 rejected. Review the recipients and retry from this unchanged composer.",
    });
    expect(state.history[0]).toMatchObject({
      kind: "updated",
      entityType: "draft",
      entityId: draft.id,
      snapshot: {
        accountId,
        accepted: [],
        rejected: ["accepted-one@example.test", "accepted-two@example.test", "rejected@example.test"],
      },
    });
  });

  it("records partial delivery with exact counts and never reports blanket success", async () => {
    const { service, accountId } = await createService();
    const draft = composeDraft(accountId, "partial-draft");
    await service.saveDraft(draft);
    const result: SendResult = {
      messageId: "<partial@example.test>",
      accepted: ["accepted-one@example.test", "accepted-two@example.test"],
      rejected: ["rejected@example.test"],
      queued: false,
    };
    serviceMocks.mailSendMessage.mockResolvedValueOnce(result);

    await expect(service.sendMessage(draft)).resolves.toEqual(result);

    const state = await readState(directory);
    expect(state.drafts).toEqual([]);
    expect(state.outbox).toEqual([]);
    expect(state.notifications[0]).toMatchObject({
      kind: "warning",
      title: "Message partially sent",
      body: "2 recipients accepted; 1 rejected.",
    });
    expect(state.notifications).not.toContainEqual(expect.objectContaining({ title: "Message sent" }));
    expect(state.history[0]).toMatchObject({
      kind: "created",
      entityType: "message",
      entityId: result.messageId,
      label: "Partially sent “Delivery accounting”",
      snapshot: {
        accepted: result.accepted,
        rejected: result.rejected,
      },
    });
  });

  it.each([
    {
      label: "full acceptance",
      result: {
        messageId: "<accepted-while-saving@example.test>",
        accepted: ["accepted-one@example.test", "accepted-two@example.test", "rejected@example.test"],
        rejected: [],
        queued: false,
      } satisfies SendResult,
    },
    {
      label: "partial acceptance",
      result: {
        messageId: "<partial-while-saving@example.test>",
        accepted: ["accepted-one@example.test", "accepted-two@example.test"],
        rejected: ["rejected@example.test"],
        queued: false,
      } satisfies SendResult,
    },
  ])("preserves a newer same-id draft after $label finishes", async ({ result }) => {
    const { service, accountId } = await createService();
    const submitted = composeDraft(accountId, "concurrent-accepted-draft");
    await service.saveDraft(submitted);
    const smtp = deferred<SendResult>();
    serviceMocks.mailSendMessage.mockReturnValueOnce(smtp.promise);

    const sendPromise = service.sendMessage(submitted);
    await vi.waitFor(() => expect(serviceMocks.mailSendMessage).toHaveBeenCalledOnce());
    const newer = { ...submitted, subject: "Saved while SMTP was in flight", text: "This newer edit must survive delivery." };
    await service.saveDraft(newer);
    smtp.resolve(result);

    await expect(sendPromise).resolves.toEqual(result);
    const state = await readState(directory);
    expect(state.drafts).toEqual([newer]);
    expect(state.outbox).toEqual([]);
  });

  it("preserves a newer same-id draft while queuing the submitted snapshot after a transport failure", async () => {
    const { service, accountId } = await createService();
    const submitted = composeDraft(accountId, "concurrent-queued-draft");
    await service.saveDraft(submitted);
    const smtp = deferred<SendResult>();
    serviceMocks.mailSendMessage.mockReturnValueOnce(smtp.promise);

    const sendPromise = service.sendMessage(submitted);
    await vi.waitFor(() => expect(serviceMocks.mailSendMessage).toHaveBeenCalledOnce());
    const newer = { ...submitted, subject: "Saved after send started", text: "Keep this edit beside the queued snapshot." };
    await service.saveDraft(newer);
    smtp.reject(new Error("Fixture transport interruption"));

    await expect(sendPromise).resolves.toMatchObject({ accepted: [], rejected: [], queued: true });
    const state = await readState(directory);
    expect(state.drafts).toEqual([newer]);
    expect(state.outbox).toHaveLength(1);
    expect(state.outbox[0]?.draft).toEqual(submitted);
  });

  it("retains both the newer same-id draft and a separately identified submitted snapshot after total rejection", async () => {
    const { service, accountId } = await createService();
    const submitted = composeDraft(accountId, "concurrent-rejected-draft");
    await service.saveDraft(submitted);
    const smtp = deferred<SendResult>();
    serviceMocks.mailSendMessage.mockReturnValueOnce(smtp.promise);

    const sendPromise = service.sendMessage(submitted);
    await vi.waitFor(() => expect(serviceMocks.mailSendMessage).toHaveBeenCalledOnce());
    const newer = { ...submitted, subject: "Newer rejected-draft edit", text: "Do not overwrite this newer saved state." };
    await service.saveDraft(newer);
    const result: SendResult = {
      messageId: "<rejected-while-saving@example.test>",
      accepted: [],
      rejected: ["accepted-one@example.test", "accepted-two@example.test", "rejected@example.test"],
      queued: false,
    };
    smtp.resolve(result);

    await expect(sendPromise).resolves.toEqual(result);
    const state = await readState(directory);
    expect(state.drafts).toHaveLength(2);
    expect(state.drafts.find(draft => draft.id === submitted.id)).toEqual(newer);
    const retainedSubmitted = state.drafts.find(draft => draft.id !== submitted.id);
    expect(retainedSubmitted).toEqual({ ...submitted, id: expect.any(String) });
  });
});
