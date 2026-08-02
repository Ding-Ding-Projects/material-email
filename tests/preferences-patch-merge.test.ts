import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountDraft } from "../src/shared/contracts";

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
    snapshot(): Promise<void> { return Promise.resolve(); }
  },
}));

vi.mock("../src/main/mail-service.js", () => ({
  MailService: class {
    testAccount(): Promise<unknown> { return Promise.resolve({ incoming: true, outgoing: true }); }
  },
}));

import { AppService } from "../src/main/app-service";

const accountDraft: AccountDraft = {
  displayName: "Preferences Test",
  email: "prefs@example.test",
  incoming: { host: "imap.example.test", port: 993, security: "tls", username: "prefs@example.test" },
  outgoing: { host: "smtp.example.test", port: 465, security: "tls", username: "prefs@example.test" },
  authMode: "password",
  secret: "fixture-only-secret",
};

describe("AppService.savePreferences merge semantics", () => {
  let directory = "";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
    directory = "";
  });

  const createService = async (): Promise<AppService> => {
    directory = await mkdtemp(path.join(os.tmpdir(), "material-email-prefs-"));
    return new AppService(directory);
  };

  it("does not revert nativeNotificationsEnabled when an unrelated preference patch is saved", async () => {
    const service = await createService();
    const account = await service.addAccount(accountDraft);

    const enabled = await service.savePreferences({ nativeNotificationsEnabled: true });
    expect(enabled.nativeNotificationsEnabled).toBe(true);

    // This is exactly the shape the renderer sends on every account/folder switch. Before the fix,
    // preferencesPatchSchema silently reintroduced nativeNotificationsEnabled: false into this
    // patch (a .partial() over a field carrying .default() still injects that default), and the
    // merge in savePreferences then wrote that false straight over the real true.
    const afterUnrelatedPatch = await service.savePreferences({
      selectedAccountId: account.id,
      selectedFolderPath: "Inbox",
    });
    expect(afterUnrelatedPatch.nativeNotificationsEnabled).toBe(true);
    expect(afterUnrelatedPatch.selectedAccountId).toBe(account.id);
    expect(afterUnrelatedPatch.selectedFolderPath).toBe("Inbox");
  });

  it("does not revert historyRetentionDays when an unrelated preference patch is saved", async () => {
    const service = await createService();
    const account = await service.addAccount(accountDraft);

    const changed = await service.savePreferences({ historyRetentionDays: 731 });
    expect(changed.historyRetentionDays).toBe(731);

    const afterUnrelatedPatch = await service.savePreferences({ theme: "dark" });
    expect(afterUnrelatedPatch.historyRetentionDays).toBe(731);
    expect(afterUnrelatedPatch.theme).toBe("dark");

    // The exact sequence the failing e2e case exercised: toggle a preference, then let the renderer's
    // own startup/folder-selection call save selectedAccountId/selectedFolderPath, then reload.
    const restarted = new AppService(directory);
    const bootstrap = await restarted.bootstrap();
    expect(bootstrap.preferences.historyRetentionDays).toBe(731);
    void account;
  });
});
