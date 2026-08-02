import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { exchangeAuthorizationCode, refreshAccessToken } from "../src/main/oauth-token-exchange";

/** A real local HTTP server speaking the token-endpoint protocol, not a mocked fetch. */
const startFixture = (handle: (body: URLSearchParams, response: ServerResponse) => void): Promise<{ server: Server; endpoint: string }> =>
  new Promise((resolve, reject) => {
    const server = createServer((request: IncomingMessage, response: ServerResponse) => {
      const chunks: Buffer[] = [];
      request.on("data", chunk => chunks.push(Buffer.from(chunk)));
      request.on("end", () => {
        const body = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
        handle(body, response);
      });
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, endpoint: `http://127.0.0.1:${port}/token` });
    });
  });

const jsonResponse = (response: ServerResponse, status: number, body: unknown): void => {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
};

describe("OAuth token exchange", () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (!server) return;
    await new Promise<void>(resolve => server?.close(() => resolve()));
    server = undefined;
  });

  it("refuses a non-loopback, non-HTTPS token endpoint before making any request", async () => {
    // 93.184.216.34 is not routable from this test, so a real request would time out; the point is
    // that the module must reject it on inspection alone, well before any network attempt.
    await expect(exchangeAuthorizationCode({
      provider: "microsoft",
      tokenEndpoint: "http://93.184.216.34/token",
      clientId: "client-1",
      code: "auth-code",
      redirectUri: "http://127.0.0.1:9/oauth/callback",
      codeVerifier: "verifier",
    })).rejects.toMatchObject({ code: "invalid-response" });
  });

  it("exchanges an authorization code for tokens, sending exactly the PKCE fields and nothing else", async () => {
    let received: URLSearchParams | undefined;
    const fixture = await startFixture((body, response) => {
      received = body;
      jsonResponse(response, 200, {
        access_token: "fixture-access-token",
        refresh_token: "fixture-refresh-token",
        expires_in: 3_600,
        scope: "IMAP.AccessAsUser.All SMTP.Send offline_access",
        token_type: "Bearer",
      });
    });
    server = fixture.server;

    const result = await exchangeAuthorizationCode({
      provider: "microsoft",
      tokenEndpoint: fixture.endpoint,
      clientId: "client-1",
      code: "auth-code-xyz",
      redirectUri: "http://127.0.0.1:9/oauth/callback",
      codeVerifier: "verifier-abc",
    });

    expect(result).toEqual({
      accessToken: "fixture-access-token",
      refreshToken: "fixture-refresh-token",
      expiresInSeconds: 3_600,
      scopes: ["IMAP.AccessAsUser.All", "SMTP.Send", "offline_access"],
    });
    expect(received?.get("grant_type")).toBe("authorization_code");
    expect(received?.get("client_id")).toBe("client-1");
    expect(received?.get("code")).toBe("auth-code-xyz");
    expect(received?.get("redirect_uri")).toBe("http://127.0.0.1:9/oauth/callback");
    expect(received?.get("code_verifier")).toBe("verifier-abc");
    // No client secret: a desktop public client cannot keep one confidential, so PKCE stands alone.
    expect(received?.has("client_secret")).toBe(false);
  });

  it("refuses a code exchange whose response carries no refresh token", async () => {
    const fixture = await startFixture((_body, response) => {
      jsonResponse(response, 200, { access_token: "token-only", expires_in: 3_600 });
    });
    server = fixture.server;

    await expect(exchangeAuthorizationCode({
      provider: "microsoft",
      tokenEndpoint: fixture.endpoint,
      clientId: "client-1",
      code: "auth-code",
      redirectUri: "http://127.0.0.1:9/oauth/callback",
      codeVerifier: "verifier",
    })).rejects.toMatchObject({ code: "invalid-response" });
  });

  it("surfaces the provider's stated reason without leaking any request field", async () => {
    const fixture = await startFixture((_body, response) => {
      jsonResponse(response, 400, { error: "invalid_grant", error_description: "AADSTS70008: expired or already redeemed" });
    });
    server = fixture.server;

    let caught: unknown;
    try {
      await exchangeAuthorizationCode({
        provider: "microsoft",
        tokenEndpoint: fixture.endpoint,
        clientId: "client-1",
        code: "the-secret-code-value",
        redirectUri: "http://127.0.0.1:9/oauth/callback",
        codeVerifier: "the-secret-verifier-value",
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ code: "http-error" });
    const message = caught instanceof Error ? caught.message : "";
    expect(message).toContain("invalid_grant");
    expect(message).toContain("AADSTS70008");
    expect(message).not.toContain("the-secret-code-value");
    expect(message).not.toContain("the-secret-verifier-value");
  });

  it("refuses a response over the bounded size instead of buffering it without limit", async () => {
    const fixture = await startFixture((_body, response) => {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ access_token: "a".repeat(64 * 1024), expires_in: 3_600, refresh_token: "r" }));
    });
    server = fixture.server;

    await expect(exchangeAuthorizationCode({
      provider: "microsoft",
      tokenEndpoint: fixture.endpoint,
      clientId: "client-1",
      code: "auth-code",
      redirectUri: "http://127.0.0.1:9/oauth/callback",
      codeVerifier: "verifier",
    })).rejects.toMatchObject({ code: "response-too-large" });
  });

  it("refreshes an access token, sending the refresh grant with no code or verifier field", async () => {
    let received: URLSearchParams | undefined;
    const fixture = await startFixture((body, response) => {
      received = body;
      jsonResponse(response, 200, {
        access_token: "rotated-access-token",
        expires_in: 3_600,
        scope: "IMAP.AccessAsUser.All SMTP.Send offline_access",
      });
    });
    server = fixture.server;

    const result = await refreshAccessToken({
      provider: "microsoft",
      tokenEndpoint: fixture.endpoint,
      clientId: "client-1",
      refreshToken: "existing-refresh-token",
      scopes: ["IMAP.AccessAsUser.All", "SMTP.Send", "offline_access"],
    });

    expect(result.accessToken).toBe("rotated-access-token");
    // A refresh that does not rotate the refresh token must not fabricate one; the caller keeps
    // the value it already has.
    expect(result.refreshToken).toBeNull();
    expect(received?.get("grant_type")).toBe("refresh_token");
    expect(received?.get("refresh_token")).toBe("existing-refresh-token");
    expect(received?.has("code")).toBe(false);
    expect(received?.has("code_verifier")).toBe(false);
  });

  it("carries a rotated refresh token through when the provider returns one", async () => {
    const fixture = await startFixture((_body, response) => {
      jsonResponse(response, 200, { access_token: "new-access", refresh_token: "new-refresh", expires_in: 3_600, scope: "a b" });
    });
    server = fixture.server;

    const result = await refreshAccessToken({
      provider: "microsoft",
      tokenEndpoint: fixture.endpoint,
      clientId: "client-1",
      refreshToken: "old-refresh",
      scopes: ["a", "b"],
    });
    expect(result.refreshToken).toBe("new-refresh");
  });

  it("rejects a non-JSON token endpoint response", async () => {
    const fixture = await startFixture((_body, response) => {
      response.writeHead(200, { "Content-Type": "text/html" });
      response.end("<html>not json</html>");
    });
    server = fixture.server;

    await expect(exchangeAuthorizationCode({
      provider: "microsoft",
      tokenEndpoint: fixture.endpoint,
      clientId: "client-1",
      code: "auth-code",
      redirectUri: "http://127.0.0.1:9/oauth/callback",
      codeVerifier: "verifier",
    })).rejects.toMatchObject({ code: "invalid-response" });
  });

  it("caps a lifetime the provider claims is longer than one day", async () => {
    const fixture = await startFixture((_body, response) => {
      jsonResponse(response, 200, { access_token: "a", refresh_token: "r", expires_in: 999_999 });
    });
    server = fixture.server;

    const result = await exchangeAuthorizationCode({
      provider: "microsoft",
      tokenEndpoint: fixture.endpoint,
      clientId: "client-1",
      code: "auth-code",
      redirectUri: "http://127.0.0.1:9/oauth/callback",
      codeVerifier: "verifier",
    });
    expect(result.expiresInSeconds).toBe(24 * 60 * 60);
  });
});
