import { access, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountDraft, FolderSummary, MessageSummary } from "../src/shared/contracts";
import { createAttachmentSaveReview } from "../src/shared/attachment-safety";

const mocks = vi.hoisted(() => ({
  testAccount: vi.fn(),
  listFolders: vi.fn(),
  listMessages: vi.fn(),
  getAttachments: vi.fn(),
  historySnapshot: vi.fn(),
  showOpenDialog: vi.fn(),
  showSaveDialog: vi.fn(),
}));

vi.mock("electron", () => ({
  app: { getAppPath: () => process.cwd(), getVersion: () => "0.1.0-test" },
  dialog: { showOpenDialog: mocks.showOpenDialog, showSaveDialog: mocks.showSaveDialog },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value, "utf8"),
    decryptString: (value: Buffer) => value.toString("utf8"),
  },
}));

vi.mock("../src/main/history-repository.js", () => ({
  HistoryRepository: class {
    snapshot(filePath: string): Promise<void> { return mocks.historySnapshot(filePath); }
  },
}));

vi.mock("../src/main/mail-service.js", () => ({
  MailService: class {
    testAccount(account: unknown): Promise<unknown> { return mocks.testAccount(account); }
    listFolders(account: { id: string }): Promise<FolderSummary[]> { return mocks.listFolders(account); }
    listMessages(account: { id: string }, folderPath: string): Promise<MessageSummary[]> { return mocks.listMessages(account, folderPath); }
    getAttachments(account: unknown, folderPath: string, uid: number, uidValidity: string): Promise<unknown[]> {
      return mocks.getAttachments(account, folderPath, uid, uidValidity);
    }
  },
}));

import { AppService } from "../src/main/app-service";

const accountDraft: AccountDraft = {
  displayName: "Quarantine Test",
  email: "quarantine@example.test",
  incoming: { host: "imap.example.test", port: 993, security: "tls", username: "quarantine@example.test" },
  outgoing: { host: "smtp.example.test", port: 465, security: "tls", username: "quarantine@example.test" },
  authMode: "password",
  secret: "fixture-only-secret",
};

const attachments = [
  { filename: "notes.txt", contentType: "text/plain", content: Buffer.from("ordinary notes") },
  { filename: "invoice.pdf.exe", contentType: "application/pdf", content: Buffer.from("dangerous fixture") },
  { filename: "forecast.xlsm", contentType: "application/vnd.ms-excel.sheet.macroenabled.12", content: Buffer.from("macro fixture") },
];

describe("local attachment quarantine", () => {
  let directory = "";
  let service: AppService;
  let accountId = "";

  beforeEach(async () => {
    vi.clearAllMocks();
    directory = await mkdtemp(path.join(os.tmpdir(), "material-email-quarantine-"));
    mocks.historySnapshot.mockResolvedValue(undefined);
    mocks.testAccount.mockResolvedValue({ incoming: true, outgoing: true });
    mocks.listFolders.mockImplementation(async (account: { id: string }) => [{
      accountId: account.id,
      path: "Inbox",
      name: "Inbox",
      role: "inbox",
      unread: 1,
      total: 1,
      uidValidity: "77",
    } satisfies FolderSummary]);
    mocks.listMessages.mockImplementation(async (account: { id: string }) => [{
      id: `${account.id}:Inbox:42`,
      accountId: account.id,
      folderPath: "Inbox",
      uid: 42,
      uidValidity: "77",
      messageId: "<quarantine-fixture@example.test>",
      from: [{ name: "Fixture", address: "fixture@example.test" }],
      to: [{ name: "Recipient", address: "recipient@example.test" }],
      cc: [],
      subject: "Attachment safety",
      date: "2026-08-01T00:00:00.000Z",
      preview: "Synthetic fixture",
      unread: true,
      starred: false,
      hasAttachments: true,
      size: 64,
    } satisfies MessageSummary]);
    mocks.getAttachments.mockResolvedValue(attachments);
    service = new AppService(directory);
    accountId = (await service.addAccount(accountDraft)).id;
    await service.syncAccount(accountId);
  });

  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it("quarantines a reviewed dangerous attachment before any destination prompt and survives restart", async () => {
    const review = createAttachmentSaveReview(attachments.slice(0, 2));
    await expect(service.saveAttachment(accountId, "Inbox", 42, 1)).rejects.toThrow(/review the current risky attachment/i);

    const outcome = await service.saveAttachment(accountId, "Inbox", 42, 1, review);
    expect(outcome).toMatchObject({ status: "quarantined", quarantine: { filename: "invoice.pdf.exe", risk: { level: "dangerous" } } });
    expect(mocks.showSaveDialog).not.toHaveBeenCalled();
    if (outcome.status !== "quarantined") throw new Error("Expected a quarantined outcome.");
    const payloadPath = path.join(directory, "attachment-quarantine-v1", `${outcome.quarantine.id}.quarantine`);
    await expect(readFile(payloadPath, "utf8")).resolves.toBe("dangerous fixture");

    const restarted = new AppService(directory);
    const persisted = (await restarted.bootstrap()).quarantinedAttachments;
    expect(persisted).toEqual([expect.objectContaining({
      id: outcome.quarantine.id,
      filename: "invoice.pdf.exe",
      size: Buffer.byteLength("dangerous fixture"),
      source: expect.objectContaining({ accountId, folderPath: "Inbox", uid: 42, uidValidity: "77", attachmentIndex: 1 }),
    })]);

    const releasedPath = path.join(directory, "released-invoice.exe");
    mocks.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: releasedPath });
    await expect(restarted.releaseQuarantinedAttachment(outcome.quarantine.id)).resolves.toBe(releasedPath);
    await expect(readFile(releasedPath, "utf8")).resolves.toBe("dangerous fixture");
    await expect(access(payloadPath)).rejects.toMatchObject({ code: "ENOENT" });
    expect((await restarted.bootstrap()).quarantinedAttachments).toEqual([]);
  });

  it("saves only ordinary batch members and requires explicit deletion for quarantined members", async () => {
    const destination = path.join(directory, "saved");
    mocks.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [destination] });
    const outcome = await service.saveAllAttachments(accountId, "Inbox", 42, createAttachmentSaveReview(attachments));

    expect(outcome).toMatchObject({ ordinarySaveCancelled: false });
    expect(outcome.savedPaths.map(file => path.basename(file))).toEqual(["notes.txt"]);
    expect(outcome.quarantined.map(item => [item.filename, item.risk.level])).toEqual([
      ["invoice.pdf.exe", "dangerous"],
      ["forecast.xlsm", "caution"],
    ]);
    await expect(readFile(path.join(destination, "notes.txt"), "utf8")).resolves.toBe("ordinary notes");
    await expect(readdir(destination)).resolves.toEqual(["notes.txt"]);

    for (const record of outcome.quarantined) await service.deleteQuarantinedAttachment(record.id);
    expect((await service.bootstrap()).quarantinedAttachments).toEqual([]);
    expect(await readdir(path.join(directory, "attachment-quarantine-v1"))).toEqual([]);
  });

  it("refuses release when the quarantined bytes no longer match persisted integrity metadata", async () => {
    const outcome = await service.saveAttachment(accountId, "Inbox", 42, 1, createAttachmentSaveReview(attachments.slice(0, 2)));
    if (outcome.status !== "quarantined") throw new Error("Expected a quarantined outcome.");
    const payloadPath = path.join(directory, "attachment-quarantine-v1", `${outcome.quarantine.id}.quarantine`);
    await writeFile(payloadPath, "changed bytes");
    await expect(service.releaseQuarantinedAttachment(outcome.quarantine.id)).rejects.toThrow(/changed on disk/i);
    expect(mocks.showSaveDialog).not.toHaveBeenCalled();
    expect((await service.bootstrap()).quarantinedAttachments).toHaveLength(1);
  });
});
