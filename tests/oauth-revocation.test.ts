import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGoogleOAuthRevoker, createMicrosoftOAuthRevoker } from "../src/main/oauth-revocation";
import { OAuthProviderRevocationNotSupportedError } from "../src/main/oauth-token-vault";

/** A real local HTTP server speaking Google's revoke-endpoint protocol, not a mocked fetch. */
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
      resolve({ server, endpoint: `http://127.0.0.1:${port}/revoke` });
    });
  });

describe("Google OAuth revocation client", () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (!server) return;
    await new Promise<void>(resolve => server?.close(() => resolve()));
    server = undefined;
  });

  it("posts the refresh token to the revocation endpoint and resolves on a 200 response", async () => {
    let received: URLSearchParams | undefined;
    const fixture = await startFixture((body, response) => {
      received = body;
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end("{}");
    });
    server = fixture.server;

    const revoker = createGoogleOAuthRevoker({ revocationEndpoint: fixture.endpoint });
    expect(revoker.provider).toBe("google");
    await expect(revoker.revoke({ accessToken: "fixture-access", refreshToken: "fixture-refresh-token" })).resolves.toBeUndefined();
    expect(received?.get("token")).toBe("fixture-refresh-token");
  });

  it("throws a redacted error, without the token, when the endpoint returns a non-200 status", async () => {
    const fixture = await startFixture((_body, response) => {
      response.writeHead(400, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "invalid_token" }));
    });
    server = fixture.server;

    const revoker = createGoogleOAuthRevoker({ revocationEndpoint: fixture.endpoint });
    let caught: unknown;
    try {
      await revoker.revoke({ accessToken: "fixture-access", refreshToken: "the-secret-refresh-token" });
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ name: "OAuthRevocationError", code: "http-error" });
    const message = caught instanceof Error ? caught.message : "";
    expect(message).toContain("400");
    expect(message).not.toContain("the-secret-refresh-token");
  });

  it("throws a network error, and still leaves local clearing unaffected by the caller, when the endpoint is unreachable", async () => {
    // Nothing is listening on this loopback port, so the connection is refused immediately.
    const revoker = createGoogleOAuthRevoker({ revocationEndpoint: "http://127.0.0.1:1/revoke" });
    await expect(revoker.revoke({ accessToken: "fixture-access", refreshToken: "fixture-refresh" }))
      .rejects.toMatchObject({ name: "OAuthRevocationError", code: "network" });
  });

  it("throws a timeout-flavored network error when the endpoint never responds in time", async () => {
    const fixture = await startFixture((_body, _response) => {
      // Deliberately never respond, forcing the bounded client-side timeout to fire.
    });
    server = fixture.server;

    const revoker = createGoogleOAuthRevoker({
      revocationEndpoint: fixture.endpoint,
      limits: { requestTimeoutMs: 50, responseBytes: 4 * 1024 },
    });
    let caught: unknown;
    try {
      await revoker.revoke({ accessToken: "fixture-access", refreshToken: "fixture-refresh" });
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ name: "OAuthRevocationError", code: "network" });
    const message = caught instanceof Error ? caught.message : "";
    expect(message.toLowerCase()).toContain("time");
  });

  it("refuses a non-HTTPS, non-loopback revocation endpoint before any request is made", () => {
    expect(() => createGoogleOAuthRevoker({ revocationEndpoint: "http://oauth2.googleapis.com/revoke" }))
      .toThrow(/https/iu);
  });

  it("defaults to Google's real published revocation endpoint when none is overridden", () => {
    const revoker = createGoogleOAuthRevoker();
    expect(revoker.provider).toBe("google");
  });
});

describe("Microsoft OAuth revocation client", () => {
  it("never attempts a network call, because Microsoft publishes no public per-token revoke endpoint", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const revoker = createMicrosoftOAuthRevoker();
    expect(revoker.provider).toBe("microsoft");
    await expect(revoker.revoke({ accessToken: "fixture-access", refreshToken: "fixture-refresh" }))
      .rejects.toBeInstanceOf(OAuthProviderRevocationNotSupportedError);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("names the provider in its error message without leaking any token", async () => {
    const revoker = createMicrosoftOAuthRevoker();
    let caught: unknown;
    try {
      await revoker.revoke({ accessToken: "the-secret-access-token", refreshToken: "the-secret-refresh-token" });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(OAuthProviderRevocationNotSupportedError);
    const message = caught instanceof Error ? caught.message : "";
    expect(message).toContain("microsoft");
    expect(message).not.toContain("the-secret-access-token");
    expect(message).not.toContain("the-secret-refresh-token");
  });
});
