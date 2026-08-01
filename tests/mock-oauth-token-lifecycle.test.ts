import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EphemeralAesGcmOAuthTokenStorage,
  LocalMockOAuthTokenEndpoint,
  LocalMockOAuthTokenLifecycle,
  ProductionEncryptedOAuthTokenStorageStub,
  createDemoOAuthTokenLifecycle,
  type MockOAuthTokenEndpoint,
  type MockOAuthTokenSet,
} from "../src/main/mock-oauth-token-lifecycle.js";

const VERIFIER = "v".repeat(64);
const STORAGE_KEY = "fixture:mock-oauth";

class FixtureEndpoint implements MockOAuthTokenEndpoint {
  readonly kind = "local-mock" as const;
  readonly exchange = vi.fn(async (): Promise<MockOAuthTokenSet> => ({
    accessToken: "fixture-access-one",
    refreshToken: "fixture-refresh-one",
    expiresInSeconds: 60,
    scopes: ["mail.read", "mail.send"],
  }));
  readonly refresh = vi.fn(async (): Promise<MockOAuthTokenSet> => ({
    accessToken: "fixture-access-two",
    refreshToken: "fixture-refresh-two",
    expiresInSeconds: 120,
    scopes: ["mail.read"],
  }));
  readonly revoke = vi.fn(async (): Promise<void> => undefined);
}

const lifecycles: LocalMockOAuthTokenLifecycle[] = [];

const harness = (options: { now?: () => number; endpoint?: FixtureEndpoint } = {}) => {
  const storage = new EphemeralAesGcmOAuthTokenStorage(() => Buffer.alloc(32, 0x5a));
  const endpoint = options.endpoint ?? new FixtureEndpoint();
  const lifecycle = new LocalMockOAuthTokenLifecycle({
    mode: "test",
    endpoint,
    storage,
    storageKey: STORAGE_KEY,
    ...(options.now ? { now: options.now } : {}),
  });
  lifecycles.push(lifecycle);
  return { lifecycle, endpoint, storage };
};

afterEach(async () => {
  await Promise.all(lifecycles.splice(0).map(lifecycle => lifecycle.dispose()));
});

describe("local mock OAuth token lifecycle", () => {
  it("exchanges only mock inputs and stores token material as AES-GCM ciphertext", async () => {
    const now = Date.parse("2026-08-01T12:00:00.000Z");
    const { lifecycle, endpoint, storage } = harness({ now: () => now });
    const status = await lifecycle.exchange({ authorizationCode: "fixture-code", pkceVerifier: VERIFIER });

    expect(status).toEqual({
      mockOnly: true,
      phase: "active",
      expiresAt: "2026-08-01T12:01:00.000Z",
      scopeCount: 2,
      generation: 1,
      failure: null,
    });
    expect(endpoint.exchange).toHaveBeenCalledWith({ authorizationCode: "fixture-code", pkceVerifier: VERIFIER });
    const ciphertext = storage.ciphertextForTests(STORAGE_KEY);
    expect(ciphertext).not.toBeNull();
    expect(ciphertext!.toString("utf8")).not.toContain("fixture-access-one");
    expect(ciphertext!.toString("utf8")).not.toContain("fixture-refresh-one");
    expect(JSON.stringify(status)).not.toMatch(/fixture-(?:access|refresh|code)/u);
    await expect(storage.load(STORAGE_KEY)).resolves.toEqual({
      accessToken: "fixture-access-one",
      refreshToken: "fixture-refresh-one",
      expiresInSeconds: 60,
      scopes: ["mail.read", "mail.send"],
    });
  });

  it("moves through expiry and refresh with token rotation and a new generation", async () => {
    let now = Date.parse("2026-08-01T12:00:00.000Z");
    const { lifecycle, endpoint, storage } = harness({ now: () => now });
    await lifecycle.exchange({ authorizationCode: "fixture-code", pkceVerifier: VERIFIER });
    now += 60_000;

    expect(lifecycle.status()).toMatchObject({ phase: "expired", generation: 1 });
    const refreshed = await lifecycle.refresh();
    expect(endpoint.refresh).toHaveBeenCalledWith({ refreshToken: "fixture-refresh-one" });
    expect(refreshed).toEqual({
      mockOnly: true,
      phase: "active",
      expiresAt: "2026-08-01T12:03:00.000Z",
      scopeCount: 1,
      generation: 2,
      failure: null,
    });
    await expect(storage.load(STORAGE_KEY)).resolves.toMatchObject({
      accessToken: "fixture-access-two",
      refreshToken: "fixture-refresh-two",
    });
  });

  it("revokes the mock provider record and always clears local ciphertext", async () => {
    const { lifecycle, endpoint, storage } = harness();
    await lifecycle.exchange({ authorizationCode: "fixture-code", pkceVerifier: VERIFIER });
    const revoked = await lifecycle.revoke();

    expect(endpoint.revoke).toHaveBeenCalledWith({
      accessToken: "fixture-access-one",
      refreshToken: "fixture-refresh-one",
    });
    expect(revoked).toMatchObject({ mockOnly: true, phase: "revoked", failure: null, scopeCount: 0 });
    await expect(storage.load(STORAGE_KEY)).resolves.toBeNull();
  });

  it("reports a mock revocation failure but still deletes the encrypted local record", async () => {
    const endpoint = new FixtureEndpoint();
    endpoint.revoke.mockRejectedValueOnce(new Error("fixture provider detail must stay private"));
    const { lifecycle, storage } = harness({ endpoint });
    await lifecycle.exchange({ authorizationCode: "fixture-code", pkceVerifier: VERIFIER });

    const failed = await lifecycle.revoke();
    expect(failed).toMatchObject({ mockOnly: true, phase: "error", failure: "revocation-failed" });
    expect(JSON.stringify(failed)).not.toContain("fixture provider detail");
    await expect(storage.load(STORAGE_KEY)).resolves.toBeNull();
  });

  it("rejects invalid transitions and unbounded exchange inputs without minting tokens", async () => {
    const first = harness();
    expect(await first.lifecycle.refresh()).toMatchObject({ phase: "error", failure: "invalid-transition" });
    expect(first.endpoint.refresh).not.toHaveBeenCalled();

    const second = harness();
    expect(await second.lifecycle.exchange({ authorizationCode: "", pkceVerifier: "short" })).toMatchObject({
      phase: "error",
      failure: "invalid-input",
    });
    expect(second.endpoint.exchange).not.toHaveBeenCalled();
    await expect(second.storage.load(STORAGE_KEY)).resolves.toBeNull();
  });

  it("keeps production storage closed before registration and after registration until a reviewed adapter exists", async () => {
    const tokens: MockOAuthTokenSet = {
      accessToken: "must-not-store",
      refreshToken: "must-not-store-either",
      expiresInSeconds: 60,
      scopes: ["mail.read"],
    };
    const unregistered = new ProductionEncryptedOAuthTokenStorageStub();
    await expect(unregistered.save("account", tokens)).rejects.toMatchObject({ code: "provider-registration-required" });
    await expect(unregistered.load("account")).rejects.toMatchObject({ code: "provider-registration-required" });
    await expect(unregistered.remove("account")).rejects.toMatchObject({ code: "provider-registration-required" });

    const registered = new ProductionEncryptedOAuthTokenStorageStub({
      provider: "google",
      clientId: "reviewed-public-client-id",
      tokenEndpoint: "https://oauth.example.test/token",
    });
    await expect(registered.save("account", tokens)).rejects.toMatchObject({ code: "production-storage-adapter-required" });
    expect(() => new LocalMockOAuthTokenLifecycle({
      mode: "demo",
      endpoint: new LocalMockOAuthTokenEndpoint(),
      storage: registered,
    })).toThrow(/mock OAuth token lifecycle stopped: invalid-input/i);
  });

  it("provides an explicit demo factory that completes a mock-only exchange, refresh, and revoke sequence", async () => {
    const lifecycle = createDemoOAuthTokenLifecycle();
    lifecycles.push(lifecycle);
    expect(await lifecycle.exchange({ authorizationCode: "demo-code", pkceVerifier: VERIFIER })).toMatchObject({
      mockOnly: true,
      phase: "active",
      generation: 1,
    });
    expect(await lifecycle.refresh()).toMatchObject({ mockOnly: true, phase: "active", generation: 2 });
    expect(await lifecycle.revoke()).toMatchObject({ mockOnly: true, phase: "revoked", failure: null });
  });
});
