import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountDraft } from "../src/shared/contracts";

const serviceMocks = vi.hoisted(() => ({
  mailTestAccount: vi.fn(),
  encryptString: vi.fn((value: string) => Buffer.from(value, "utf8")),
}));

vi.mock("electron", () => ({
  app: { getAppPath: () => process.cwd(), getVersion: () => "0.1.0-test" },
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: serviceMocks.encryptString,
    decryptString: (value: Buffer) => value.toString("utf8"),
  },
}));

vi.mock("../src/main/mail-service.js", () => ({
  MailService: class {
    testAccount(account: unknown): Promise<unknown> { return serviceMocks.mailTestAccount(account); }
  },
}));

import { AppService } from "../src/main/app-service";

const validDraft = (): AccountDraft => ({
  displayName: "Certificate Preflight",
  email: "preflight@example.test",
  incoming: { host: "imap.example.test", port: 993, security: "tls", username: "preflight@example.test" },
  outgoing: { host: "smtp.example.test", port: 587, security: "starttls", username: "preflight@example.test" },
  authMode: "password",
  secret: "fixture-only-secret",
});

describe("AppService connection preflight boundary", () => {
  let directory = "";

  beforeEach(async () => {
    vi.clearAllMocks();
    directory = await mkdtemp(path.join(os.tmpdir(), "material-email-certificate-preflight-"));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("rejects a blocking hostname diagnostic before the mail service can test transports", async () => {
    const draft = validDraft();
    draft.incoming.host = "*.example.test";

    await expect(new AppService(directory).testAccount(draft)).rejects.toThrow(/before any server is contacted.*certificate wildcard/iu);
    expect(serviceMocks.mailTestAccount).not.toHaveBeenCalled();
  });

  it("rejects a blocking TLS/port inversion before encrypting or persisting a new account", async () => {
    const draft = validDraft();
    draft.outgoing.port = 465;

    await expect(new AppService(directory).addAccount(draft)).rejects.toThrow(/before any server is contacted.*STARTTLS on the conventional implicit-TLS port/iu);
    expect(serviceMocks.mailTestAccount).not.toHaveBeenCalled();
    expect(serviceMocks.encryptString).not.toHaveBeenCalled();
  });
});
