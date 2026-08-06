import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountDraft, FolderSummary } from "../src/shared/contracts";

const serviceMocks = vi.hoisted(() => ({
  testAccount: vi.fn(),
  listFolders: vi.fn(),
}));

const fakeSafeStorage = vi.hoisted(() => ({
  isEncryptionAvailable: () => true,
  encryptString: (value: string) => Buffer.from(`fixture:${Buffer.from(value, "utf8").toString("base64")}`, "utf8"),
  decryptString: (value: Buffer) => {
    const encoded = value.toString("utf8");
    if (!encoded.startsWith("fixture:")) throw new Error("fixture ciphertext rejected");
    return Buffer.from(encoded.slice("fixture:".length), "base64").toString("utf8");
  },
}));

vi.mock("electron", () => ({
  app: { getAppPath: () => process.cwd(), getVersion: () => "0.1.0-test" },
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
  safeStorage: fakeSafeStorage,
}));

vi.mock("../src/main/history-repository.js", () => ({
  HistoryRepository: class {
    snapshot(): Promise<void> { return Promise.resolve(); }
  },
}));

vi.mock("../src/main/mail-service.js", async importOriginal => ({
  ...(await importOriginal<typeof import("../src/main/mail-service")>()),
  MailService: class {
    testAccount(account: unknown): Promise<unknown> { return serviceMocks.testAccount(account); }
    listFolders(account: unknown): Promise<FolderSummary[]> { return serviceMocks.listFolders(account); }
  },
}));

import { AppService } from "../src/main/app-service";
import { WindowsSafeStorageOAuthTokenVault } from "../src/main/oauth-token-vault";

/** A real local HTTP server speaking the token-endpoint protocol, not a mocked fetch. */
const startTokenFixture = (handle: (body: URLSearchParams, response: ServerResponse) => void): Promise<{ server: Server; endpoint: string }> =>
  new Promise((resolve, reject) => {
    const server = createServer((request: IncomingMessage, response: ServerResponse) => {
      const chunks: Buffer[] = [];
      request.on("data", chunk => chunks.push(Buffer.from(chunk)));
      request.on("end", () => handle(new URLSearchParams(Buffer.concat(chunks).toString("utf8")), response));
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, endpoint: `http://127.0.0.1:${port}/token` });
    });
  });

const jsonResponse = (response: ServerResponse, body: unknown): void => {
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
};

/** A JWT-shaped string with the given payload claims and a garbage signature - never checked by this app. */
const fakeIdToken = (claims: Record<string, unknown>): string => {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" }), "utf8").toString("base64url");
  const payload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  return `${header}.${payload}.not-a-real-signature`;
};

const oauthDraft = (overrides: Partial<AccountDraft> = {}): AccountDraft => ({
  displayName: "OAuth Test",
  email: "oauth@example.test",
  incoming: { host: "outlook.office365.com", port: 993, security: "tls", username: "oauth@example.test" },
  outgoing: { host: "smtp.office365.com", port: 587, security: "starttls", username: "oauth@example.test" },
  authMode: "oauth2",
  secret: "",
  oauthProvider: "microsoft",
  ...overrides,
});

describe("AppService OAuth account lifecycle", () => {
  let directory = "";
  let fixture: { server: Server; endpoint: string } | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    serviceMocks.testAccount.mockResolvedValue({ incoming: true, outgoing: true });
    serviceMocks.listFolders.mockResolvedValue([]);
  });

  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
    directory = "";
    if (fixture) await new Promise<void>(resolve => fixture!.server.close(() => resolve()));
    fixture = undefined;
  });

  const createHarness = async (tokenBody: (body: URLSearchParams, response: ServerResponse) => void): Promise<AppService> => {
    directory = await mkdtemp(path.join(os.tmpdir(), "material-email-oauth-app-"));
    fixture = await startTokenFixture(tokenBody);
    const vault = new WindowsSafeStorageOAuthTokenVault({
      filePath: path.join(directory, "oauth-token-vault.json"),
      safeStorage: fakeSafeStorage,
      platform: "win32",
      registrations: [{ provider: "microsoft", clientId: "fixture-client", tokenEndpoint: fixture.endpoint }],
    });
    return new AppService(directory, { oauthTokenVault: vault });
  };

  const readyTokenResponse = (overrides: Record<string, unknown> = {}) => ({
    access_token: "fixture-access-token",
    refresh_token: "fixture-refresh-token",
    expires_in: 3_600,
    scope: "IMAP.AccessAsUser.All SMTP.Send offline_access",
    ...overrides,
  });

  it("reports failed sign-in when no token vault is configured", async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "material-email-oauth-app-"));
    const service = new AppService(directory);
    await service.completeOAuthSignIn({ provider: "microsoft", code: "c", codeVerifier: "v", redirectUri: "http://127.0.0.1:1/oauth/callback" });
    expect(service.getOAuthSignInStatus()).toMatchObject({ provider: "microsoft", phase: "failed" });
  });

  it("exchanges a real code for tokens and reports the sign-in ready, without exposing the token", async () => {
    let received: URLSearchParams | undefined;
    const service = await createHarness((body, response) => {
      received = body;
      jsonResponse(response, readyTokenResponse());
    });
    await service.completeOAuthSignIn({ provider: "microsoft", code: "auth-code", codeVerifier: "verifier", redirectUri: "http://127.0.0.1:1/oauth/callback" });

    const status = service.getOAuthSignInStatus();
    expect(status).toEqual({ provider: "microsoft", phase: "ready", failure: null, accountHint: null });
    expect(JSON.stringify(status)).not.toContain("fixture-access-token");
    expect(received?.get("code")).toBe("auth-code");
    expect(received?.get("grant_type")).toBe("authorization_code");
  });

  it("surfaces a non-secret account hint decoded from an ID token, without exposing the token itself", async () => {
    const service = await createHarness((_body, response) => {
      jsonResponse(response, readyTokenResponse({ id_token: fakeIdToken({ email: "signed-in@example.test", name: "Signed In User" }) }));
    });
    await service.completeOAuthSignIn({ provider: "microsoft", code: "auth-code", codeVerifier: "verifier", redirectUri: "http://127.0.0.1:1/oauth/callback" });

    const status = service.getOAuthSignInStatus();
    expect(status).toEqual({
      provider: "microsoft",
      phase: "ready",
      failure: null,
      accountHint: { email: "signed-in@example.test", displayName: "Signed In User" },
    });
    expect(JSON.stringify(status)).not.toContain("fixture-access-token");
    expect(JSON.stringify(status)).not.toContain("not-a-real-signature");
  });

  it("reports no account hint when the token response carries no ID token", async () => {
    const service = await createHarness((_body, response) => jsonResponse(response, readyTokenResponse()));
    await service.completeOAuthSignIn({ provider: "microsoft", code: "auth-code", codeVerifier: "verifier", redirectUri: "http://127.0.0.1:1/oauth/callback" });
    expect(service.getOAuthSignInStatus()).toMatchObject({ phase: "ready", accountHint: null });
  });

  it("reports failure when the provider refuses the code, and leaves no sign-in ready", async () => {
    const service = await createHarness((_body, response) => {
      response.writeHead(400, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "invalid_grant" }));
    });
    await service.completeOAuthSignIn({ provider: "microsoft", code: "bad-code", codeVerifier: "verifier", redirectUri: "http://127.0.0.1:1/oauth/callback" });
    expect(service.getOAuthSignInStatus()).toMatchObject({ phase: "failed" });
    await expect(service.testAccount(oauthDraft())).rejects.toThrow(/sign in/iu);
  });

  it("refuses to add an OAuth account with no completed sign-in", async () => {
    const service = await createHarness((_body, response) => jsonResponse(response, readyTokenResponse()));
    await expect(service.addAccount(oauthDraft())).rejects.toThrow(/sign in/iu);
    expect(serviceMocks.testAccount).not.toHaveBeenCalled();
  });

  it("tests an OAuth account without consuming the pending sign-in, then adds it once", async () => {
    const service = await createHarness((_body, response) => jsonResponse(response, readyTokenResponse()));
    await service.completeOAuthSignIn({ provider: "microsoft", code: "auth-code", codeVerifier: "verifier", redirectUri: "http://127.0.0.1:1/oauth/callback" });

    // Testing twice must not exhaust the one-time sign-in.
    await expect(service.testAccount(oauthDraft())).resolves.toMatchObject({ incoming: true, outgoing: true });
    await expect(service.testAccount(oauthDraft())).resolves.toMatchObject({ incoming: true, outgoing: true });
    expect(serviceMocks.testAccount).toHaveBeenCalledTimes(2);
    expect(serviceMocks.testAccount.mock.calls[0]?.[0]).toMatchObject({ secret: "fixture-access-token", authMode: "oauth2" });

    const created = await service.addAccount(oauthDraft());
    expect(created).toMatchObject({ authMode: "oauth2", oauthProvider: "microsoft", email: "oauth@example.test" });
    expect(created).not.toHaveProperty("encryptedSecret");

    // The sign-in was consumed by the successful add; a second add attempt with nothing new fails.
    await expect(service.addAccount(oauthDraft({ email: "second@example.test" }))).rejects.toThrow(/sign in/iu);
  });

  it("leaves the pending sign-in usable when the connectivity test fails during add", async () => {
    const service = await createHarness((_body, response) => jsonResponse(response, readyTokenResponse()));
    await service.completeOAuthSignIn({ provider: "microsoft", code: "auth-code", codeVerifier: "verifier", redirectUri: "http://127.0.0.1:1/oauth/callback" });
    serviceMocks.testAccount.mockRejectedValueOnce(new Error("fixture connection refused"));

    await expect(service.addAccount(oauthDraft())).rejects.toThrow();
    serviceMocks.testAccount.mockResolvedValueOnce({ incoming: true, outgoing: true });
    const created = await service.addAccount(oauthDraft());
    expect(created.authMode).toBe("oauth2");
  });

  it("refreshes a near-expiry token before connecting, and rotates the vault", async () => {
    let tokenCalls = 0;
    const service = await createHarness((_body, response) => {
      tokenCalls += 1;
      // The first call is the initial exchange; the second is the refresh triggered by syncAccount.
      jsonResponse(response, tokenCalls === 1 ? readyTokenResponse({ expires_in: 30 }) : readyTokenResponse({ access_token: "rotated-access-token", expires_in: 3_600 }));
    });
    await service.completeOAuthSignIn({ provider: "microsoft", code: "auth-code", codeVerifier: "verifier", redirectUri: "http://127.0.0.1:1/oauth/callback" });
    const account = await service.addAccount(oauthDraft());

    await service.syncAccount(account.id);
    expect(tokenCalls).toBe(2);
    expect(serviceMocks.listFolders.mock.calls[0]?.[0]).toMatchObject({ secret: "rotated-access-token" });
  });

  it("does not refresh a token that is not close to expiring", async () => {
    let tokenCalls = 0;
    const service = await createHarness((_body, response) => {
      tokenCalls += 1;
      jsonResponse(response, readyTokenResponse());
    });
    await service.completeOAuthSignIn({ provider: "microsoft", code: "auth-code", codeVerifier: "verifier", redirectUri: "http://127.0.0.1:1/oauth/callback" });
    const account = await service.addAccount(oauthDraft());

    await service.syncAccount(account.id);
    expect(tokenCalls).toBe(1);
    expect(serviceMocks.listFolders.mock.calls[0]?.[0]).toMatchObject({ secret: "fixture-access-token" });
  });

  it("forgets exactly the removed account's tokens, not a sibling's", async () => {
    let issued = 0;
    const service = await createHarness((_body, response) => {
      issued += 1;
      jsonResponse(response, readyTokenResponse({ access_token: `fixture-access-${issued}` }));
    });
    await service.completeOAuthSignIn({ provider: "microsoft", code: "code-1", codeVerifier: "verifier", redirectUri: "http://127.0.0.1:1/oauth/callback" });
    const first = await service.addAccount(oauthDraft({ email: "first@example.test" }));
    await service.completeOAuthSignIn({ provider: "microsoft", code: "code-2", codeVerifier: "verifier", redirectUri: "http://127.0.0.1:1/oauth/callback" });
    const second = await service.addAccount(oauthDraft({ email: "second@example.test" }));

    await service.removeAccount(first.id);
    await expect(service.syncAccount(first.id)).rejects.toThrow();
    await expect(service.syncAccount(second.id)).resolves.toBeDefined();
    expect(serviceMocks.listFolders).toHaveBeenCalledTimes(1);
    expect(serviceMocks.listFolders.mock.calls[0]?.[0]).toMatchObject({ secret: "fixture-access-2" });
  });
});
