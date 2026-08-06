import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Proves the least-invasive integration point itself — AppService.searchCachedMail — actually
// exercises the on-disk SQLite index (not merely that the standalone class works in isolation),
// that a restart reuses the same file, and that a corrupted on-disk index is repaired invisibly
// to the caller: existing callers/tests of searchCachedMail keep working unchanged either way.

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
    snapshot(): Promise<void> {
      return Promise.resolve();
    }
  },
}));

vi.mock("../src/main/mail-service.js", async importOriginal => ({
  ...(await importOriginal<typeof import("../src/main/mail-service")>()),
  MailService: class {
    testAccount(): Promise<unknown> {
      return Promise.resolve({ incoming: true, outgoing: true });
    }
  },
}));

import { AppService } from "../src/main/app-service";
import { isCachedMailSqliteIndexSupported } from "../src/main/cached-mail-sqlite-index";

const INDEX_FILE_NAME = "cached-mail-index-v1.sqlite";

describe.skipIf(!isCachedMailSqliteIndexSupported())("searchCachedMail SQLite-index wiring", () => {
  let directory = "";

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "material-email-cached-mail-wiring-"));
  });

  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
    directory = "";
  });

  it("answers a demo-account search correctly and materializes a real on-disk index", async () => {
    const service = new AppService(directory);
    await service.createDemoAccount();

    const result = await service.searchCachedMail({ mode: "plain", pattern: "checklist", flags: "i", limit: 10 });
    expect(result.hits.length).toBeGreaterThan(0);
    expect(result.hits.some(hit => hit.message.subject.includes("Launch checklist"))).toBe(true);

    const { DatabaseSync } = await import("node:sqlite");
    const filePath = path.join(directory, INDEX_FILE_NAME);
    const db = new DatabaseSync(filePath, { readOnly: true });
    try {
      const documentCount = (db.prepare("SELECT COUNT(*) as count FROM documents").get() as { count: number }).count;
      expect(documentCount).toBe(4); // the four seeded demo Inbox messages
    } finally {
      db.close();
    }
  });

  it("reuses the persisted index across a restart and still finds the same result", async () => {
    const first = new AppService(directory);
    await first.createDemoAccount();
    const before = await first.searchCachedMail({ mode: "plain", pattern: "dim sum", flags: "i", limit: 10 });
    expect(before.hits).toHaveLength(1);

    const restarted = new AppService(directory);
    const after = await restarted.searchCachedMail({ mode: "plain", pattern: "dim sum", flags: "i", limit: 10 });
    expect(after).toEqual(before);
  });

  it("keeps searchCachedMail working, with no user-visible failure, when the on-disk index file is corrupt", async () => {
    const service = new AppService(directory);
    await service.createDemoAccount();
    // Prime the file, then corrupt it out-of-band before the next search.
    await service.searchCachedMail({ mode: "plain", pattern: "checklist", flags: "i", limit: 10 });
    await writeFile(path.join(directory, INDEX_FILE_NAME), "not a sqlite file", "utf8");

    await expect(
      service.searchCachedMail({ mode: "plain", pattern: "checklist", flags: "i", limit: 10 }),
    ).resolves.toMatchObject({ hits: [expect.objectContaining({ message: expect.objectContaining({ subject: expect.stringContaining("Launch checklist") }) })] });
  });
});
