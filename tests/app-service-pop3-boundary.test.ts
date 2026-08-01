import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountDraft, Pop3AccountOptions } from "../src/shared/contracts";

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

const pop3Options = (): Pop3AccountOptions => ({
  transport: "local-demo",
  retrievalMode: "new-only",
  leaveOnServer: true,
  messageLimit: 3,
});

const pop3Draft = (): AccountDraft => ({
  displayName: "POP3 Boundary",
  email: "pop3@example.test",
  incomingProtocol: "pop3",
  incoming: { host: "pop.example.test", port: 995, security: "tls", username: "pop3@example.test" },
  outgoing: { host: "smtp.example.test", port: 587, security: "starttls", username: "pop3@example.test" },
  authMode: "password",
  secret: "fixture-only-secret",
  pop3: pop3Options(),
});

describe("AppService POP3 boundary", () => {
  let directory = "";

  beforeEach(async () => {
    vi.clearAllMocks();
    directory = await mkdtemp(path.join(os.tmpdir(), "material-email-pop3-boundary-"));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("runs only the credential-free local foundation", async () => {
    const snapshot = await new AppService(directory).runPop3Foundation(pop3Options());
    expect(snapshot).toMatchObject({ boundary: "local-demo-only", state: "disconnected", serverContacted: false, credentialsUsed: false });
    expect(serviceMocks.mailTestAccount).not.toHaveBeenCalled();
    expect(serviceMocks.encryptString).not.toHaveBeenCalled();
  });

  it("blocks POP3 test and add before mail transport, encryption, or persistence", async () => {
    const service = new AppService(directory);
    await expect(service.testAccount(pop3Draft())).rejects.toThrow(/Live POP3 account testing.*No server was contacted.*no credential/iu);
    await expect(service.addAccount(pop3Draft())).rejects.toThrow(/Live POP3 account connection.*No server was contacted.*no account was saved/iu);
    expect(serviceMocks.mailTestAccount).not.toHaveBeenCalled();
    expect(serviceMocks.encryptString).not.toHaveBeenCalled();
  });
});
