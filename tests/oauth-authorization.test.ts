import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  OAuthAuthorizationService,
  createPkcePair,
  validatePastedRedirect,
  type OAuthAuthorizationCodeGrant,
  type OAuthProviderConfiguration,
} from "../src/main/oauth-authorization.js";

const fixtureConfiguration: OAuthProviderConfiguration = {
  provider: "google",
  authorizationEndpoint: "https://accounts.example.test/oauth/authorize",
  clientId: "public-desktop-fixture-client",
  scopes: ["openid", "email", "mail.read"],
  redirectUri: "https://accounts.example.test/oauth/nativeclient",
};

const services: OAuthAuthorizationService[] = [];

const createService = (
  openExternal: (url: string) => Promise<void>,
  options: { configured?: boolean; timeoutMs?: number; onAuthorizationCode?: (grant: OAuthAuthorizationCodeGrant) => void } = {},
): OAuthAuthorizationService => {
  const service = new OAuthAuthorizationService({
    configurations: options.configured === false ? [] : [fixtureConfiguration],
    openExternal,
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    ...(options.onAuthorizationCode ? { onAuthorizationCode: options.onAuthorizationCode } : {}),
  });
  services.push(service);
  return service;
};

const authorizationDetails = (openedUrl: string): { authorization: URL; state: string } => {
  const authorization = new URL(openedUrl);
  const state = authorization.searchParams.get("state") ?? "";
  return { authorization, state };
};

/** Builds the URL the browser would land on after a successful/errored/mismatched redirect. */
const redirectResult = (query: Record<string, string>): string => {
  const url = new URL(fixtureConfiguration.redirectUri);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return url.toString();
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

describe("OAuth pasted-redirect validation", () => {
  const expectation = { redirectUri: "https://example.test/oauth/nativeclient", state: "expected-state" };
  const url = (query: string) => `https://example.test/oauth/nativeclient${query}`;

  it("accepts one exact state and one bounded authorization code", () => {
    expect(validatePastedRedirect(url("?state=expected-state&code=opaque-code"), expectation)).toEqual({
      kind: "authorization",
      code: "opaque-code",
    });
  });

  it("rejects an unparseable, oversized, wrong-origin, wrong-path, wrong-state, token-carrying, or ambiguous result", () => {
    expect(validatePastedRedirect("not a url at all", expectation)).toMatchObject({ reason: "unparseable" });
    expect(validatePastedRedirect("a".repeat(9_000), expectation)).toMatchObject({ reason: "too-long" });
    expect(validatePastedRedirect("", expectation)).toMatchObject({ reason: "too-long" });
    expect(validatePastedRedirect("https://evil.example.test/oauth/nativeclient?state=expected-state&code=a", expectation)).toMatchObject({ reason: "wrong-redirect" });
    expect(validatePastedRedirect("https://example.test/other?state=expected-state&code=a", expectation)).toMatchObject({ reason: "wrong-redirect" });
    expect(validatePastedRedirect(url("?state=wrong&code=a"), expectation)).toMatchObject({ reason: "state" });
    expect(validatePastedRedirect(url("?state=expected-state"), expectation)).toMatchObject({ reason: "missing-result" });
    expect(validatePastedRedirect(url("?state=expected-state&access_token=never"), expectation)).toMatchObject({ reason: "unexpected-token" });
    expect(validatePastedRedirect(url("?state=expected-state&code=a&code=b"), expectation)).toMatchObject({ reason: "ambiguous-result" });
    expect(validatePastedRedirect(url("?state=expected-state&code=a&error=access_denied"), expectation)).toMatchObject({ reason: "ambiguous-result" });
  });

  it("tolerates surrounding whitespace from a pasted value, since a user's paste often carries it", () => {
    expect(validatePastedRedirect(`  ${url("?state=expected-state&code=opaque-code")}  `, expectation)).toEqual({
      kind: "authorization",
      code: "opaque-code",
    });
  });

  it("extracts a provider error distinctly from an authorization code", () => {
    expect(validatePastedRedirect(url("?state=expected-state&error=access_denied"), expectation)).toEqual({
      kind: "provider-error",
      error: "access_denied",
    });
  });
});

describe("OAuth authorization state machine", () => {
  it("opens only an authorization-code PKCE URL naming the exact registered redirect, with no verifier in it", async () => {
    let openedUrl = "";
    const service = createService(async url => { openedUrl = url; });
    const waiting = await service.start("google");
    const { authorization, state } = authorizationDetails(openedUrl);

    expect(waiting).toMatchObject({ phase: "awaiting-redirect-paste", provider: "google", failure: null });
    expect(authorization.origin).toBe("https://accounts.example.test");
    expect(authorization.searchParams.get("redirect_uri")).toBe(fixtureConfiguration.redirectUri);
    expect(authorization.searchParams.get("response_type")).toBe("code");
    expect(authorization.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorization.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(authorization.searchParams.has("code_verifier")).toBe(false);
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/u);

    const publicState = JSON.stringify(service.status());
    expect(publicState).not.toContain(state);
    expect(publicState).not.toContain(authorization.searchParams.get("code_challenge")!);
  });

  it("hands the code, verifier, and redirect URI to onAuthorizationCode exactly once on a matching paste", async () => {
    let openedUrl = "";
    let received: OAuthAuthorizationCodeGrant | null = null;
    const service = createService(async url => { openedUrl = url; }, { onAuthorizationCode: grant => { received = grant; } });
    await service.start("google");
    const { authorization, state } = authorizationDetails(openedUrl);
    const challenge = authorization.searchParams.get("code_challenge")!;

    const finished = service.submitRedirectUrl(redirectResult({ state, code: "fixture-authorization-code" }));

    expect(finished).toMatchObject({ phase: "authorization-received", provider: "google", expiresAt: null, failure: null });
    expect(received).not.toBeNull();
    expect(received).toEqual({
      provider: "google",
      code: "fixture-authorization-code",
      codeVerifier: expect.stringMatching(/^[A-Za-z0-9_-]{43,86}$/u) as unknown as string,
      redirectUri: fixtureConfiguration.redirectUri,
    });
    // The handed-off verifier must be the one whose S256 hash produced the challenge actually sent,
    // or a real exchange against a real provider would fail with a PKCE mismatch.
    const recomputedChallenge = createHash("sha256").update(received!.codeVerifier, "ascii").digest("base64url");
    expect(recomputedChallenge).toBe(challenge);

    const sensitiveCode = "fixture-authorization-code";
    const publicState = JSON.stringify(finished);
    expect(publicState).not.toContain(sensitiveCode);
    expect(publicState).not.toContain(state);
  });

  it("never calls onAuthorizationCode when the provider denies the request", async () => {
    let openedUrl = "";
    const onAuthorizationCode = vi.fn();
    const service = createService(async url => { openedUrl = url; }, { onAuthorizationCode });
    await service.start("google");
    const { state } = authorizationDetails(openedUrl);

    service.submitRedirectUrl(redirectResult({ state, error: "access_denied" }));
    expect(onAuthorizationCode).not.toHaveBeenCalled();
    expect(service.status()).toMatchObject({ phase: "error", failure: "provider-denied" });
  });

  it("never calls onAuthorizationCode for a paste with the wrong state", async () => {
    let openedUrl = "";
    const onAuthorizationCode = vi.fn();
    const service = createService(async url => { openedUrl = url; }, { onAuthorizationCode });
    await service.start("google");
    void authorizationDetails(openedUrl);

    const result = service.submitRedirectUrl(redirectResult({ state: "wrong-state-entirely", code: "fixture-code" }));
    expect(result.phase).toBe("awaiting-redirect-paste");
    expect(onAuthorizationCode).not.toHaveBeenCalled();
  });

  it("keeps waiting after non-matching pastes, then accepts the exact one", async () => {
    let openedUrl = "";
    const service = createService(async url => { openedUrl = url; });
    await service.start("google");
    const { state } = authorizationDetails(openedUrl);

    expect(service.submitRedirectUrl(redirectResult({ state: "wrong-state", code: "wrong-code" })).phase).toBe("awaiting-redirect-paste");
    expect(service.submitRedirectUrl("not a url at all").phase).toBe("awaiting-redirect-paste");
    expect(service.submitRedirectUrl(redirectResult({ state, code: "the-real-code" })).phase).toBe("authorization-received");
  });

  it("terminates as an error after enough non-matching pastes, rather than allowing indefinite retries", async () => {
    let openedUrl = "";
    const service = createService(async url => { openedUrl = url; });
    await service.start("google");
    void authorizationDetails(openedUrl);

    let last = service.status();
    for (let attempt = 0; attempt < 20 && last.phase === "awaiting-redirect-paste"; attempt += 1) {
      last = service.submitRedirectUrl(redirectResult({ state: "wrong-state", code: "wrong-code" }));
    }
    expect(last).toMatchObject({ phase: "error", failure: "redirect-invalid" });
  });

  it("ignores a paste submitted with no active session", () => {
    const service = createService(async () => undefined);
    expect(service.submitRedirectUrl(redirectResult({ state: "x", code: "y" }))).toMatchObject({ phase: "idle" });
  });

  it("maps provider denial to a sanitized terminal error", async () => {
    let openedUrl = "";
    const service = createService(async url => { openedUrl = url; });
    await service.start("google");
    const { state } = authorizationDetails(openedUrl);

    const finished = service.submitRedirectUrl(redirectResult({ state, error: "access_denied", error_description: "sensitive provider prose" }));
    expect(JSON.stringify(finished)).not.toContain("sensitive provider prose");
    expect(finished).toMatchObject({ phase: "error", failure: "provider-denied", expiresAt: null });
  });

  it("supports explicit cancellation and bounded timeout cleanup", async () => {
    const cancelled = createService(async () => undefined);
    await cancelled.start("google");
    expect(await cancelled.cancel()).toMatchObject({ phase: "cancelled", failure: null, expiresAt: null });
    expect(cancelled.submitRedirectUrl(redirectResult({ state: "x", code: "y" }))).toMatchObject({ phase: "cancelled" });

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
