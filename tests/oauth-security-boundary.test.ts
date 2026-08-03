import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFile(path, "utf8");

describe("OAuth security boundary", () => {
  it("keeps the authorization machine ephemeral and free of persistence, logging, or any local listener", async () => {
    const source = await read("src/main/oauth-authorization.ts");
    expect(source).not.toMatch(/\b(?:console|safeStorage|JsonStore|writeFile|appendFile|localStorage|sessionStorage)\b/u);
    // The redirect is captured by asking the user to paste it back, not by a local listener — so
    // there is no port to bind, no request to trust the transport of, and nothing on this machine
    // ever accepts an inbound connection for this flow. Assert the listener is genuinely gone, not
    // only unused: no node:http import, no server construction of any kind.
    expect(source).not.toMatch(/\bnode:http\b/u);
    expect(source).not.toMatch(/\bcreateServer\b/u);
    expect(source).not.toMatch(/\.listen\(/u);
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

  it("keeps mock token sources out of production while wiring only the reviewed Windows vault boundary", async () => {
    const [mockLifecycle, vault, main, appService, preload, providerConfig] = await Promise.all([
      read("src/main/mock-oauth-token-lifecycle.ts"),
      read("src/main/oauth-token-vault.ts"),
      read("src/main/index.ts"),
      read("src/main/app-service.ts"),
      read("src/preload/index.ts"),
      read("src/main/oauth-provider-config.ts"),
    ]);
    expect(mockLifecycle).toContain("EphemeralAesGcmOAuthTokenStorage");
    expect(mockLifecycle).toContain('createCipheriv("aes-256-gcm"');
    expect(mockLifecycle).not.toMatch(/\b(?:console|fetch|writeFile|readFile|JsonStore|safeStorage|ipcMain|ipcRenderer|process\.env)\b/u);
    expect(vault).toContain("class WindowsSafeStorageOAuthTokenVault");
    expect(vault).toContain("safeStorage.encryptString");
    expect(vault).toContain("safeStorage.decryptString");
    expect(vault).not.toMatch(/\b(?:console|fetch|ipcMain|ipcRenderer|process\.env)\b/u);
    // Registration is real now: environment-driven rather than a literal empty array. The
    // invariant that actually matters survives the change and is asserted directly — no client ID
    // or secret is ever a literal in source, only ever read from the environment at startup, and a
    // malformed value degrades to disabled rather than crashing the whole app.
    expect(main).toContain("resolveMicrosoftOAuthConfig(process.env)");
    expect(main).not.toMatch(/clientId\s*:\s*["'`][^"'`]/u);
    expect(main).not.toMatch(/client_secret/iu);
    expect(providerConfig).toContain("env.MATERIAL_EMAIL_MICROSOFT_CLIENT_ID");
    expect(providerConfig).not.toMatch(/MATERIAL_EMAIL_MICROSOFT_CLIENT_ID\s*[:=]\s*["'`][^"'`]/u);
    expect(providerConfig).not.toMatch(/client_secret/iu);
    // A public desktop client has no secret to keep, so the concept must not exist anywhere in the
    // OAuth surface at all, registered provider or not.
    expect(`${vault}\n${main}\n${appService}`).not.toMatch(/client_secret/iu);
    expect(main).toContain("revokers: []");
    expect(main).toContain('path.join(app.getPath("userData"), "oauth-token-vault.json")');
    expect(`${main}\n${appService}\n${preload}`).not.toContain("mock-oauth-token-lifecycle");
  });

  it("hands the authorization code to the main process alone, and exposes only a token-free sign-in snapshot to the renderer", async () => {
    const [contracts, preload, main, appService] = await Promise.all([
      read("src/shared/contracts.ts"),
      read("src/preload/index.ts"),
      read("src/main/index.ts"),
      read("src/main/app-service.ts"),
    ]);
    // The exchange callback is wired directly from the authorization service to AppService, inside
    // the main process, never through ipcMain/ipcRenderer.
    expect(main).toContain("onAuthorizationCode: grant => { void service.completeOAuthSignIn(grant); }");
    expect(contracts).not.toContain("completeOAuthSignIn");
    expect(preload).not.toContain("completeOAuthSignIn");
    // The renderer-facing status method exists and carries no token.
    expect(contracts).toContain("getOAuthSignInStatus(): Promise<OAuthSignInSnapshot | null>");
    expect(preload).toContain('ipcRenderer.invoke("account:oauth-signin-status")');
    expect(main).toContain('handleValidated("account:oauth-signin-status"');
    expect(appService).toMatch(/getOAuthSignInStatus\(\): OAuthSignInSnapshot \| null \{\s*return this\.#oauthSignInStatus;/u);
    // The same broad ban from the test above, restated for this specific seam so a future OAuth
    // change that touches only these files still trips it.
    expect(`${contracts}\n${preload}\n${main}`).not.toMatch(/(?:OAuth|oauth).*(?:accessToken|refreshToken|authorizationCode|codeVerifier)/u);
  });
});
