import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFile(path, "utf8");

describe("OAuth security boundary", () => {
  it("keeps the authorization machine ephemeral and free of persistence or logging calls", async () => {
    const source = await read("src/main/oauth-authorization.ts");
    expect(source).not.toMatch(/\b(?:console|safeStorage|JsonStore|writeFile|appendFile|localStorage|sessionStorage)\b/u);
    expect(source).toContain('server.listen({ host: "127.0.0.1", port: 0, exclusive: true })');
    expect(source).toContain('response_type", "code"');
    expect(source).toContain('code_challenge_method", "S256"');
    expect(source).toContain("session.stateBytes.fill(0)");
    expect(source).toContain("session.verifierBytes.fill(0)");
  });

  it("exposes only status/start/cancel IPC and no callback, verifier, code, or token argument", async () => {
    const [contracts, preload, main, appService] = await Promise.all([
      read("src/shared/contracts.ts"),
      read("src/preload/index.ts"),
      read("src/main/index.ts"),
      read("src/main/app-service.ts"),
    ]);
    expect(contracts).toContain("getOAuthAuthorizationStatus(): Promise<OAuthAuthorizationSnapshot>");
    expect(contracts).toContain("startOAuthAuthorization(provider: OAuthProviderId): Promise<OAuthAuthorizationSnapshot>");
    expect(contracts).toContain("cancelOAuthAuthorization(): Promise<OAuthAuthorizationSnapshot>");
    expect(preload).toContain('ipcRenderer.invoke("account:oauth-start", provider)');
    expect(main).toContain('handleValidated("account:oauth-start", ipcPayloadSchemas.oauthProvider');
    const addAccount = appService.slice(appService.indexOf("async addAccount"), appService.indexOf("async testAccount"));
    const testAccount = appService.slice(appService.indexOf("async testAccount"), appService.indexOf("async removeAccount"));
    expect(addAccount.indexOf('draft.authMode === "oauth2"')).toBeLessThan(addAccount.indexOf("safeStorage.encryptString"));
    expect(testAccount.indexOf('draft.authMode === "oauth2"')).toBeLessThan(testAccount.indexOf("this.#mail.testAccount"));
    expect(`${contracts}\n${preload}\n${main}`).not.toMatch(/(?:OAuth|oauth).*(?:accessToken|refreshToken|authorizationCode|codeVerifier)/u);
  });

  it("keeps the mock token lifecycle out of production initialization, IPC, networking, files, and logs", async () => {
    const [mockLifecycle, main, appService, preload] = await Promise.all([
      read("src/main/mock-oauth-token-lifecycle.ts"),
      read("src/main/index.ts"),
      read("src/main/app-service.ts"),
      read("src/preload/index.ts"),
    ]);
    expect(mockLifecycle).toContain("EphemeralAesGcmOAuthTokenStorage");
    expect(mockLifecycle).toContain("ProductionEncryptedOAuthTokenStorageStub");
    expect(mockLifecycle).toContain('storageClass = "production-stub"');
    expect(mockLifecycle).toContain('createCipheriv("aes-256-gcm"');
    expect(mockLifecycle).not.toMatch(/\b(?:console|fetch|writeFile|readFile|JsonStore|safeStorage|ipcMain|ipcRenderer|process\.env)\b/u);
    expect(`${main}\n${appService}\n${preload}`).not.toContain("mock-oauth-token-lifecycle");
  });
});
