import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountDraft, Pop3AccountOptions } from "../src/shared/contracts";

const serviceMocks = vi.hoisted(() => ({
  mailTestAccount: vi.fn(),
  pop3TestAccount: vi.fn(),
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

vi.mock("../src/main/pop3-test-transport.js", () => ({
  testPop3Account: serviceMocks.pop3TestAccount,
}));

import { AppService } from "../src/main/app-service";

const pop3Options = (): Pop3AccountOptions => ({
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

  it("runs the bounded POP3 test transport without mail sync, encryption, or persistence, while add stays blocked", async () => {
    const service = new AppService(directory);
    serviceMocks.pop3TestAccount.mockResolvedValue({
      incoming: true,
      outgoing: false,
      incomingProtocol: "pop3",
      transport: "implicit-tls",
      tlsAuthorized: true,
      tlsProtocol: "TLSv1.3",
      tlsCipher: "TLS_AES_256_GCM_SHA384",
      capabilities: { capa: true, stls: false, uidl: true, user: true, pipelining: false, top: true },
      messageCount: 2,
      mailboxOctets: 300,
      sampledMessageCount: 2,
      uidlVerified: true,
      listVerified: true,
      leaveOnServer: true,
      deletionAttempted: false,
      messagesRetrieved: false,
      credentialsPersisted: false,
      fullSynchronization: false,
      quitConfirmed: true,
    });
    await expect(service.testAccount(pop3Draft())).resolves.toMatchObject({ incomingProtocol: "pop3", outgoing: false, deletionAttempted: false });
    expect(serviceMocks.pop3TestAccount).toHaveBeenCalledWith({
      host: "pop.example.test",
      port: 995,
      security: "tls",
      username: "pop3@example.test",
      secret: "fixture-only-secret",
      messageLimit: 3,
    }, { signal: expect.any(AbortSignal) });
    expect(serviceMocks.mailTestAccount).not.toHaveBeenCalled();
    expect(serviceMocks.encryptString).not.toHaveBeenCalled();

    await expect(service.addAccount(pop3Draft())).rejects.toThrow(/POP3 account saving.*No server was contacted.*no account was saved/iu);
    expect(serviceMocks.mailTestAccount).not.toHaveBeenCalled();
    expect(serviceMocks.encryptString).not.toHaveBeenCalled();
  });

  it("owns one cancellable POP3 test and clears the controller after cancellation", async () => {
    serviceMocks.pop3TestAccount.mockImplementation((_input: unknown, options: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(Object.assign(new Error("The POP3 account test was cancelled."), { code: "ECANCELLED" })), { once: true });
    }));
    const service = new AppService(directory);
    const pending = service.testAccount(pop3Draft());
    await vi.waitFor(() => expect(serviceMocks.pop3TestAccount).toHaveBeenCalledOnce());
    expect(service.cancelPop3AccountTest()).toBe(true);
    await expect(pending).rejects.toThrow(/POP3 account test was cancelled.*no account was saved/iu);
    expect(service.cancelPop3AccountTest()).toBe(false);
  });
});
