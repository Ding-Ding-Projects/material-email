import { createHash } from "node:crypto";
import { request } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  OAuthAuthorizationService,
  createPkcePair,
  validateLoopbackCallback,
  type OAuthProviderConfiguration,
} from "../src/main/oauth-authorization.js";

const fixtureConfiguration: OAuthProviderConfiguration = {
  provider: "google",
  authorizationEndpoint: "https://accounts.example.test/oauth/authorize",
  clientId: "public-desktop-fixture-client",
  scopes: ["openid", "email", "mail.read"],
};

const services: OAuthAuthorizationService[] = [];

const createService = (
  openExternal: (url: string) => Promise<void>,
  options: { configured?: boolean; timeoutMs?: number } = {},
): OAuthAuthorizationService => {
  const service = new OAuthAuthorizationService({
    configurations: options.configured === false ? [] : [fixtureConfiguration],
    openExternal,
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  });
  services.push(service);
  return service;
};

const loopbackRequest = (
  url: URL,
  options: { method?: string; host?: string } = {},
): Promise<{ status: number; body: string }> => new Promise((resolve, reject) => {
  const client = request(url, {
    method: options.method ?? "GET",
    ...(options.host ? { headers: { Host: options.host } } : {}),
  }, response => {
    const chunks: Buffer[] = [];
    response.on("data", chunk => chunks.push(Buffer.from(chunk)));
    response.once("end", () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
  });
  client.once("error", reject);
  client.end();
});

const authorizationDetails = (openedUrl: string): { authorization: URL; callback: URL; state: string } => {
  const authorization = new URL(openedUrl);
  const callback = new URL(authorization.searchParams.get("redirect_uri") ?? "");
  const state = authorization.searchParams.get("state") ?? "";
  return { authorization, callback, state };
};

afterEach(async () => {
  await Promise.all(services.splice(0).map(service => service.dispose()));
});

describe("OAuth PKCE", () => {
  it("creates a bounded base64url verifier and its exact S256 challenge", () => {
    const bytes = Buffer.from(Array.from({ length: 64 }, (_value, index) => index));
    const pair = createPkcePair(size => {
      expect(size).toBe(64);
      return Buffer.from(bytes);
    });

    expect(pair.verifier).toHaveLength(86);
    expect(pair.verifier).toMatch(/^[A-Za-z0-9_-]+$/u);
    expect(pair.challenge).toBe(createHash("sha256").update(pair.verifier, "ascii").digest("base64url"));
    expect(pair.challenge).toHaveLength(43);
  });
});

describe("OAuth loopback callback validation", () => {
  const expectation = { host: "127.0.0.1:43821", path: "/oauth/callback", state: "expected-state" };
  const claim = (requestTarget: string) => ({
    method: "GET",
    hostHeader: expectation.host,
    remoteAddress: "127.0.0.1",
    requestTarget,
  });

  it("accepts one exact state and one bounded authorization code", () => {
    expect(validateLoopbackCallback(claim("/oauth/callback?state=expected-state&code=opaque-code"), expectation)).toEqual({
      kind: "authorization",
      code: "opaque-code",
    });
  });

  it("rejects method, peer, host, path, state, token injection, and ambiguous results", () => {
    expect(validateLoopbackCallback({ ...claim("/oauth/callback?state=expected-state&code=a"), method: "POST" }, expectation)).toMatchObject({ reason: "method" });
    expect(validateLoopbackCallback({ ...claim("/oauth/callback?state=expected-state&code=a"), remoteAddress: "192.0.2.2" }, expectation)).toMatchObject({ reason: "remote-address" });
    expect(validateLoopbackCallback({ ...claim("/oauth/callback?state=expected-state&code=a"), hostHeader: "localhost:43821" }, expectation)).toMatchObject({ reason: "host" });
    expect(validateLoopbackCallback(claim("/other?state=expected-state&code=a"), expectation)).toMatchObject({ reason: "path" });
    expect(validateLoopbackCallback(claim("/oauth/callback?state=wrong&code=a"), expectation)).toMatchObject({ reason: "state" });
    expect(validateLoopbackCallback(claim("/oauth/callback?state=expected-state&access_token=never"), expectation)).toMatchObject({ reason: "unexpected-token" });
    expect(validateLoopbackCallback(claim("/oauth/callback?state=expected-state&code=a&code=b"), expectation)).toMatchObject({ reason: "ambiguous-result" });
    expect(validateLoopbackCallback(claim("/oauth/callback?state=expected-state&code=a&error=access_denied"), expectation)).toMatchObject({ reason: "ambiguous-result" });
  });
});

describe("OAuth authorization state machine", () => {
  it("opens only an authorization-code PKCE URL and discards the callback code without exposing it", async () => {
    let openedUrl = "";
    const service = createService(async url => { openedUrl = url; });
    const waiting = await service.start("google");
    const { authorization, callback, state } = authorizationDetails(openedUrl);

    expect(waiting).toMatchObject({ phase: "waiting-for-callback", provider: "google", failure: null });
    expect(authorization.origin).toBe("https://accounts.example.test");
    expect(authorization.searchParams.get("response_type")).toBe("code");
    expect(authorization.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorization.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(authorization.searchParams.has("code_verifier")).toBe(false);
    expect(callback.hostname).toBe("127.0.0.1");
    expect(callback.pathname).toBe("/oauth/callback");
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/u);

    const sensitiveCode = "fixture-authorization-code-never-returned";
    callback.searchParams.set("state", state);
    callback.searchParams.set("code", sensitiveCode);
    const response = await loopbackRequest(callback);

    expect(response.status).toBe(200);
    expect(response.body).not.toContain(sensitiveCode);
    const finished = service.status();
    expect(finished).toMatchObject({ phase: "authorization-received", provider: "google", expiresAt: null, failure: null });
    const publicState = JSON.stringify(finished);
    expect(publicState).not.toContain(sensitiveCode);
    expect(publicState).not.toContain(state);
    expect(publicState).not.toContain(authorization.searchParams.get("code_challenge")!);
  });

  it("keeps waiting after rejected loopback requests, then accepts the exact callback", async () => {
    let openedUrl = "";
    const service = createService(async url => { openedUrl = url; });
    await service.start("google");
    const { callback, state } = authorizationDetails(openedUrl);

    callback.searchParams.set("state", "wrong-state");
    callback.searchParams.set("code", "wrong-code");
    expect((await loopbackRequest(callback)).status).toBe(400);
    expect(service.status().phase).toBe("waiting-for-callback");

    callback.searchParams.set("state", state);
    expect((await loopbackRequest(callback, { method: "POST" })).status).toBe(405);
    expect(service.status().phase).toBe("waiting-for-callback");
    expect((await loopbackRequest(callback, { host: `localhost:${callback.port}` })).status).toBe(400);
    expect(service.status().phase).toBe("waiting-for-callback");

    expect((await loopbackRequest(callback)).status).toBe(200);
    expect(service.status().phase).toBe("authorization-received");
  });

  it("maps provider denial to a sanitized terminal error", async () => {
    let openedUrl = "";
    const service = createService(async url => { openedUrl = url; });
    await service.start("google");
    const { callback, state } = authorizationDetails(openedUrl);
    callback.searchParams.set("state", state);
    callback.searchParams.set("error", "access_denied");
    callback.searchParams.set("error_description", "sensitive provider prose");

    const response = await loopbackRequest(callback);
    expect(response.status).toBe(200);
    expect(response.body).not.toContain("sensitive provider prose");
    expect(service.status()).toMatchObject({ phase: "error", failure: "provider-denied", expiresAt: null });
  });

  it("supports explicit cancellation and bounded timeout cleanup", async () => {
    let cancelledUrl = "";
    const cancelled = createService(async url => { cancelledUrl = url; });
    await cancelled.start("google");
    expect(await cancelled.cancel()).toMatchObject({ phase: "cancelled", failure: null, expiresAt: null });
    const cancelledCallback = authorizationDetails(cancelledUrl).callback;
    await expect(loopbackRequest(cancelledCallback)).rejects.toThrow();

    const timedOut = createService(async () => undefined, { timeoutMs: 20 });
    await timedOut.start("google");
    await new Promise(resolve => setTimeout(resolve, 60));
    expect(timedOut.status()).toMatchObject({ phase: "timed-out", failure: null, expiresAt: null });
  });

  it("reports missing provider registration and browser-launch failure without starting a usable flow", async () => {
    const unopened = vi.fn(async () => undefined);
    const missing = createService(unopened, { configured: false });
    expect(await missing.start("google")).toMatchObject({ phase: "error", failure: "provider-not-configured" });
    expect(unopened).not.toHaveBeenCalled();

    const failing = createService(async () => { throw new Error("private shell detail"); });
    expect(await failing.start("google")).toMatchObject({ phase: "error", failure: "browser-open-failed", expiresAt: null });
    expect(JSON.stringify(failing.status())).not.toContain("private shell detail");
  });
});
