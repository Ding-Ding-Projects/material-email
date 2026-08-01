import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  WindowsSafeStorageOAuthTokenVault,
  type OAuthTokenMaterial,
  type WindowsSafeStorageBoundary,
} from "../src/main/oauth-token-vault.js";

class FakeWindowsSafeStorage implements WindowsSafeStorageBoundary {
  available = true;
  readonly encryptString = vi.fn((plaintext: string): Buffer =>
    Buffer.from(`fixture:${Buffer.from(plaintext, "utf8").toString("base64")}`, "utf8"));
  readonly decryptString = vi.fn((ciphertext: Buffer): string => {
    const encoded = ciphertext.toString("utf8");
    if (!encoded.startsWith("fixture:")) throw new Error("fixture ciphertext rejected");
    return Buffer.from(encoded.slice("fixture:".length), "base64").toString("utf8");
  });
  isEncryptionAvailable(): boolean {
    return this.available;
  }
}

class MockProviderTokenSource {
  readonly revoke = vi.fn(async (_input: { accessToken: string; refreshToken: string }): Promise<void> => undefined);

  initial(): OAuthTokenMaterial {
    return { accessToken: "fixture-access-one", refreshToken: "fixture-refresh-one", expiresInSeconds: 60, scopes: ["mail.read", "mail.send"] };
  }

  rotation(refreshToken?: string) {
    return { accessToken: "fixture-access-two", ...(refreshToken ? { refreshToken } : {}), expiresInSeconds: 120, scopes: ["mail.read"] };
  }
}

const directories: string[] = [];
const registration = {
  provider: "google" as const,
  clientId: "reviewed-fixture-client",
  tokenEndpoint: "https://oauth.example.test/token",
  revocationEndpoint: "https://oauth.example.test/revoke",
};

const createHarness = async (options: { registered?: boolean; revoker?: MockProviderTokenSource; available?: boolean } = {}) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "material-email-oauth-vault-"));
  directories.push(directory);
  const safeStorage = new FakeWindowsSafeStorage();
  safeStorage.available = options.available ?? true;
  const filePath = path.join(directory, "oauth-token-vault.json");
  const vault = new WindowsSafeStorageOAuthTokenVault({
    filePath,
    safeStorage,
    platform: "win32",
    now: () => Date.parse("2026-08-01T12:00:00.000Z"),
    registrations: options.registered === false ? [] : [registration],
    ...(options.revoker ? { revokers: [{ provider: "google", revoke: options.revoker.revoke }] } : {}),
  });
  return { vault, safeStorage, filePath };
};

afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

describe("Windows safeStorage OAuth token vault", () => {
  it("requires explicit provider registration before any token is encrypted or written", async () => {
    const { vault, safeStorage } = await createHarness({ registered: false });
    await expect(vault.saveInitial("google", "account-1", new MockProviderTokenSource().initial())).rejects.toMatchObject({
      code: "provider-registration-required",
    });
    expect(safeStorage.encryptString).not.toHaveBeenCalled();
    const status = await vault.status();
    expect(status).toMatchObject({ protection: "windows-safe-storage", available: true });
    expect(status.providers[0]).toMatchObject({ id: "google", registered: false, state: "not-registered", recordCount: 0 });
  });

  it("stores only safeStorage ciphertext and rotates bounded access/refresh generations atomically", async () => {
    const source = new MockProviderTokenSource();
    const { vault, filePath } = await createHarness();
    const initial = await vault.saveInitial("google", "account-1", source.initial());
    expect(initial.providers[0]).toMatchObject({ state: "active", generation: 1, recordCount: 1, expiresAt: "2026-08-01T12:01:00.000Z" });
    const firstText = await readFile(filePath, "utf8");
    expect(firstText).not.toMatch(/fixture-(?:access|refresh)-(?:one|two)/u);
    const firstRecord = (JSON.parse(firstText) as { records: Array<{ accessTokenCiphertext: string; refreshTokenCiphertext: string }> }).records[0]!;

    const rotated = await vault.rotate("google", "account-1", source.rotation());
    expect(rotated.providers[0]).toMatchObject({ state: "active", generation: 2, expiresAt: "2026-08-01T12:02:00.000Z" });
    const secondText = await readFile(filePath, "utf8");
    const secondRecord = (JSON.parse(secondText) as { records: Array<{ accessTokenCiphertext: string; refreshTokenCiphertext: string }> }).records[0]!;
    expect(secondRecord.accessTokenCiphertext).not.toBe(firstRecord.accessTokenCiphertext);
    expect(secondRecord.refreshTokenCiphertext).toBe(firstRecord.refreshTokenCiphertext);

    await vault.rotate("google", "account-1", source.rotation("fixture-refresh-two"));
    const thirdText = await readFile(filePath, "utf8");
    const thirdRecord = (JSON.parse(thirdText) as { records: Array<{ refreshTokenCiphertext: string; generation: number }> }).records[0]!;
    expect(thirdRecord.refreshTokenCiphertext).not.toBe(firstRecord.refreshTokenCiphertext);
    expect(thirdRecord.generation).toBe(3);
    expect(thirdText).not.toContain("fixture-refresh-two");
  });

  it("revokes through a test-only provider source inside main-process code and clears local ciphertext", async () => {
    const source = new MockProviderTokenSource();
    const { vault, filePath } = await createHarness({ revoker: source });
    await vault.saveInitial("google", "account-1", source.initial());
    const result = await vault.revokeAndClear("google");

    expect(source.revoke).toHaveBeenCalledWith({ accessToken: "fixture-access-one", refreshToken: "fixture-refresh-one" });
    expect(result).toMatchObject({ provider: "google", localRecordsCleared: 1, remoteRevocation: "succeeded" });
    expect(JSON.stringify(result)).not.toMatch(/fixture-(?:access|refresh)/u);
    expect(await readFile(filePath, "utf8")).not.toMatch(/fixture-(?:access|refresh)/u);
    expect((await vault.status()).providers[0]).toMatchObject({ id: "google", state: "empty", recordCount: 0 });
  });

  it("still clears local ciphertext when the test-only provider revoker fails", async () => {
    const source = new MockProviderTokenSource();
    source.revoke.mockRejectedValueOnce(new Error("fixture provider detail must not escape"));
    const { vault } = await createHarness({ revoker: source });
    await vault.saveInitial("google", "account-1", source.initial());

    const result = await vault.revokeAndClear("google");
    expect(result).toMatchObject({ localRecordsCleared: 1, remoteRevocation: "failed" });
    expect(JSON.stringify(result)).not.toContain("fixture provider detail");
    expect(result.snapshot.providers[0]).toMatchObject({ recordCount: 0, state: "empty" });
  });

  it("clears orphaned local ciphertext without registration, decryption, or a provider call", async () => {
    const source = new MockProviderTokenSource();
    const { vault, safeStorage, filePath } = await createHarness();
    await vault.saveInitial("google", "account-1", source.initial());
    safeStorage.decryptString.mockClear();
    const unregistered = new WindowsSafeStorageOAuthTokenVault({
      filePath,
      safeStorage,
      platform: "win32",
      now: () => Date.parse("2026-08-01T12:00:00.000Z"),
      registrations: [],
      revokers: [],
    });
    expect((await unregistered.status()).providers[0]).toMatchObject({
      registered: false,
      state: "not-registered",
      recordCount: 1,
      canClear: true,
      canRevoke: false,
    });

    const result = await unregistered.clear("google");
    expect(result).toMatchObject({ localRecordsCleared: 1, remoteRevocation: "not-needed" });
    expect(safeStorage.decryptString).not.toHaveBeenCalled();
    expect((JSON.parse(await readFile(filePath, "utf8")) as { records: unknown[] }).records).toEqual([]);
  });

  it("reports unavailable Windows protection without attempting encryption", async () => {
    const { vault, safeStorage } = await createHarness({ available: false });
    await expect(vault.saveInitial("google", "account-1", new MockProviderTokenSource().initial())).rejects.toMatchObject({
      code: "windows-safe-storage-unavailable",
    });
    expect(safeStorage.encryptString).not.toHaveBeenCalled();
    await expect(vault.status()).resolves.toMatchObject({ available: false, failure: "encryption-unavailable" });
  });
});
