import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import {
  OAUTH_PROVIDER_IDS,
  type OAuthProviderId,
  type OAuthTokenVaultActionResult,
  type OAuthTokenVaultFailure,
  type OAuthTokenVaultProviderSnapshot,
  type OAuthTokenVaultSnapshot,
} from "../shared/oauth.js";

const VAULT_SCHEMA_VERSION = 1;
const VAULT_FILE_LIMIT = 1024 * 1024;
const VAULT_RECORD_LIMIT = 64;
const ACCOUNT_KEY_LIMIT = 256;
const TOKEN_LIMIT = 8_192;
const CIPHERTEXT_LIMIT = 128 * 1024;
const SCOPE_LIMIT = 50;
const SCOPE_TEXT_LIMIT = 256;
const TOKEN_LIFETIME_MAX_SECONDS = 24 * 60 * 60;

const providerNames: Record<OAuthProviderId, string> = {
  google: "Google",
  microsoft: "Microsoft",
};

export type OAuthTokenVaultErrorCode =
  | "provider-registration-required"
  | "windows-safe-storage-unavailable"
  | "invalid-input"
  | "record-already-exists"
  | "record-not-found"
  | "storage-failed";

export class OAuthTokenVaultError extends Error {
  readonly code: OAuthTokenVaultErrorCode;

  constructor(code: OAuthTokenVaultErrorCode) {
    super(`OAuth token vault stopped: ${code}.`);
    this.name = "OAuthTokenVaultError";
    this.code = code;
  }
}

/** The narrow Electron safeStorage surface used by this adapter. */
export interface WindowsSafeStorageBoundary {
  isEncryptionAvailable(): boolean;
  encryptString(plaintext: string): Buffer;
  decryptString(ciphertext: Buffer): string;
}

export interface OAuthVaultProviderRegistration {
  provider: OAuthProviderId;
  clientId: string;
  tokenEndpoint: string;
  revocationEndpoint?: string;
}

export interface OAuthTokenMaterial {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
  scopes: readonly string[];
}

export interface OAuthTokenRotation {
  accessToken: string;
  refreshToken?: string;
  expiresInSeconds: number;
  scopes: readonly string[];
}

export interface OAuthProviderTokenRevoker {
  readonly provider: OAuthProviderId;
  revoke(input: { accessToken: string; refreshToken: string }): Promise<void>;
}

/**
 * A registered revoker throws this, instead of any other error, to mean one specific thing: this
 * provider has no public per-token revocation endpoint at all, so no network call was even
 * attempted — not that a real call was attempted and failed. {@link WindowsSafeStorageOAuthTokenVault.revokeAndClear}
 * reports that distinctly as `"not-supported"` rather than lumping it in with `"failed"`, so the
 * user is told the true reason local-only clearing happened instead of an implied network failure.
 * See `src/main/oauth-revocation.ts` for the concrete revoker that throws this today (Microsoft).
 */
export class OAuthProviderRevocationNotSupportedError extends Error {
  constructor(provider: OAuthProviderId) {
    super(`OAuth provider "${provider}" does not offer a public per-token revocation endpoint.`);
    this.name = "OAuthProviderRevocationNotSupportedError";
  }
}

export interface WindowsSafeStorageOAuthTokenVaultOptions {
  filePath: string;
  safeStorage: WindowsSafeStorageBoundary;
  registrations?: readonly OAuthVaultProviderRegistration[];
  revokers?: readonly OAuthProviderTokenRevoker[];
  now?: () => number;
  platform?: NodeJS.Platform;
}

interface StoredOAuthTokenRecord {
  provider: OAuthProviderId;
  accountKey: string;
  accessTokenCiphertext: string;
  refreshTokenCiphertext: string;
  expiresAt: string;
  scopes: string[];
  generation: number;
  createdAt: string;
  updatedAt: string;
}

interface OAuthTokenVaultDocument {
  schemaVersion: 1;
  records: StoredOAuthTokenRecord[];
}

const emptyDocument = (): OAuthTokenVaultDocument => ({ schemaVersion: VAULT_SCHEMA_VERSION, records: [] });

const errorCode = (error: unknown): string | undefined =>
  error instanceof Error && "code" in error ? (error as NodeJS.ErrnoException).code : undefined;

const hasControlCharacters = (value: string): boolean => /[\u0000-\u001f\u007f]/u.test(value);

const isPlainBoundedText = (value: unknown, maximum: number): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= maximum && !hasControlCharacters(value);

const requireKnownProvider = (value: unknown): OAuthProviderId => {
  if (typeof value !== "string" || !OAUTH_PROVIDER_IDS.includes(value as OAuthProviderId)) {
    throw new OAuthTokenVaultError("invalid-input");
  }
  return value as OAuthProviderId;
};

const requireAccountKey = (value: unknown): string => {
  if (!isPlainBoundedText(value, ACCOUNT_KEY_LIMIT)) throw new OAuthTokenVaultError("invalid-input");
  return value;
};

/** Bare IP-literal loopback only — never the "localhost" name, which DNS resolution can redirect. */
const registrationLoopbackHosts = new Set(["127.0.0.1", "[::1]"]);

/**
 * A real provider endpoint is always HTTPS; the one exception is a literal loopback IP, which exists
 * solely so this module's own tests can register a real local fixture server without a certificate —
 * the same boundary this codebase already draws for its development renderer URL and for the token
 * exchange module that actually calls these endpoints.
 */
const requireCleanHttpsEndpoint = (value: unknown): string => {
  if (typeof value !== "string" || value.length > 2_048) throw new OAuthTokenVaultError("provider-registration-required");
  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch {
    throw new OAuthTokenVaultError("provider-registration-required");
  }
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new OAuthTokenVaultError("provider-registration-required");
  }
  const isLoopback = endpoint.protocol === "http:" && registrationLoopbackHosts.has(endpoint.hostname);
  if (endpoint.protocol !== "https:" && !isLoopback) throw new OAuthTokenVaultError("provider-registration-required");
  return endpoint.toString();
};

const validateRegistration = (value: OAuthVaultProviderRegistration): OAuthVaultProviderRegistration => {
  const provider = requireKnownProvider(value.provider);
  if (!isPlainBoundedText(value.clientId, 512)) throw new OAuthTokenVaultError("provider-registration-required");
  return {
    provider,
    clientId: value.clientId,
    tokenEndpoint: requireCleanHttpsEndpoint(value.tokenEndpoint),
    ...(value.revocationEndpoint ? { revocationEndpoint: requireCleanHttpsEndpoint(value.revocationEndpoint) } : {}),
  };
};

const validateScopes = (value: readonly string[]): string[] => {
  if (
    value.length < 1
    || value.length > SCOPE_LIMIT
    || value.some(scope => !isPlainBoundedText(scope, SCOPE_TEXT_LIMIT) || /\s/u.test(scope))
    || new Set(value).size !== value.length
  ) throw new OAuthTokenVaultError("invalid-input");
  return [...value];
};

const validateTokenLifetime = (value: number): number => {
  if (!Number.isInteger(value) || value < 1 || value > TOKEN_LIFETIME_MAX_SECONDS) {
    throw new OAuthTokenVaultError("invalid-input");
  }
  return value;
};

const validateTokenText = (value: unknown): string => {
  if (!isPlainBoundedText(value, TOKEN_LIMIT)) throw new OAuthTokenVaultError("invalid-input");
  return value;
};

const validateTimestamp = (value: unknown): string => {
  if (typeof value !== "string" || value.length > 64 || !Number.isFinite(Date.parse(value))) {
    throw new OAuthTokenVaultError("storage-failed");
  }
  return value;
};

const validateCiphertext = (value: unknown): string => {
  if (typeof value !== "string" || value.length < 4 || value.length > CIPHERTEXT_LIMIT || !/^[A-Za-z0-9+/]+={0,2}$/u.test(value)) {
    throw new OAuthTokenVaultError("storage-failed");
  }
  const decoded = Buffer.from(value, "base64");
  try {
    if (!decoded.length || decoded.toString("base64") !== value) throw new OAuthTokenVaultError("storage-failed");
  } finally {
    decoded.fill(0);
  }
  return value;
};

const hasExactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  const actual = Object.keys(value).toSorted();
  const expected = [...keys].toSorted();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
};

const parseRecord = (value: unknown): StoredOAuthTokenRecord => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new OAuthTokenVaultError("storage-failed");
  const candidate = value as Record<string, unknown>;
  if (!hasExactKeys(candidate, [
    "provider",
    "accountKey",
    "accessTokenCiphertext",
    "refreshTokenCiphertext",
    "expiresAt",
    "scopes",
    "generation",
    "createdAt",
    "updatedAt",
  ])) throw new OAuthTokenVaultError("storage-failed");
  if (!Array.isArray(candidate.scopes) || !candidate.scopes.every(scope => typeof scope === "string")) {
    throw new OAuthTokenVaultError("storage-failed");
  }
  const scopes = validateScopes(candidate.scopes);
  if (!Number.isSafeInteger(candidate.generation) || (candidate.generation as number) < 1) {
    throw new OAuthTokenVaultError("storage-failed");
  }
  try {
    return {
      provider: requireKnownProvider(candidate.provider),
      accountKey: requireAccountKey(candidate.accountKey),
      accessTokenCiphertext: validateCiphertext(candidate.accessTokenCiphertext),
      refreshTokenCiphertext: validateCiphertext(candidate.refreshTokenCiphertext),
      expiresAt: validateTimestamp(candidate.expiresAt),
      scopes,
      generation: candidate.generation as number,
      createdAt: validateTimestamp(candidate.createdAt),
      updatedAt: validateTimestamp(candidate.updatedAt),
    };
  } catch (error) {
    if (error instanceof OAuthTokenVaultError && error.code === "storage-failed") throw error;
    throw new OAuthTokenVaultError("storage-failed");
  }
};

const parseDocument = (value: unknown): OAuthTokenVaultDocument => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new OAuthTokenVaultError("storage-failed");
  const candidate = value as Record<string, unknown>;
  if (!hasExactKeys(candidate, ["schemaVersion", "records"]) || candidate.schemaVersion !== VAULT_SCHEMA_VERSION) {
    throw new OAuthTokenVaultError("storage-failed");
  }
  if (!Array.isArray(candidate.records) || candidate.records.length > VAULT_RECORD_LIMIT) {
    throw new OAuthTokenVaultError("storage-failed");
  }
  const records = candidate.records.map(parseRecord);
  const keys = records.map(record => `${record.provider}\u0000${record.accountKey}`);
  if (new Set(keys).size !== keys.length) throw new OAuthTokenVaultError("storage-failed");
  return { schemaVersion: VAULT_SCHEMA_VERSION, records };
};

/**
 * Durable Windows OAuth token vault. The shipped app passes Electron's
 * safeStorage object at the main-process boundary. No method in this class is
 * exposed directly to the renderer.
 */
export class WindowsSafeStorageOAuthTokenVault {
  readonly #filePath: string;
  readonly #previousPath: string;
  readonly #safeStorage: WindowsSafeStorageBoundary;
  readonly #registrations = new Map<OAuthProviderId, OAuthVaultProviderRegistration>();
  readonly #revokers = new Map<OAuthProviderId, OAuthProviderTokenRevoker>();
  readonly #now: () => number;
  readonly #platform: NodeJS.Platform;
  #queue: Promise<void> = Promise.resolve();

  constructor(options: WindowsSafeStorageOAuthTokenVaultOptions) {
    if (!path.isAbsolute(options.filePath)) throw new OAuthTokenVaultError("invalid-input");
    this.#filePath = options.filePath;
    this.#previousPath = `${options.filePath}.previous`;
    this.#safeStorage = options.safeStorage;
    this.#now = options.now ?? Date.now;
    this.#platform = options.platform ?? process.platform;
    for (const candidate of options.registrations ?? []) {
      const registration = validateRegistration(candidate);
      if (this.#registrations.has(registration.provider)) throw new OAuthTokenVaultError("provider-registration-required");
      this.#registrations.set(registration.provider, registration);
    }
    for (const revoker of options.revokers ?? []) {
      const provider = requireKnownProvider(revoker.provider);
      if (!this.#registrations.has(provider) || this.#revokers.has(provider)) {
        throw new OAuthTokenVaultError("provider-registration-required");
      }
      this.#revokers.set(provider, revoker);
    }
  }

  /**
   * Returns a provider's registered client ID and token endpoint, or null if unregistered. Neither
   * value is confidential — a public client ID is meant to be visible, and a token endpoint is a
   * published URL — so this is safe for the main process to read when it needs to refresh a token
   * itself, outside of any vault write.
   */
  registration(providerValue: OAuthProviderId): OAuthVaultProviderRegistration | null {
    const provider = requireKnownProvider(providerValue);
    const registration = this.#registrations.get(provider);
    return registration ? { ...registration } : null;
  }

  async status(): Promise<OAuthTokenVaultSnapshot> {
    return this.#run(async () => {
      const availabilityFailure = this.#availabilityFailure();
      try {
        return this.#snapshot(await this.#readDocument(), availabilityFailure);
      } catch {
        return this.#snapshot(emptyDocument(), "storage-failed");
      }
    });
  }

  async saveInitial(providerValue: OAuthProviderId, accountKeyValue: string, materialValue: OAuthTokenMaterial): Promise<OAuthTokenVaultSnapshot> {
    const provider = requireKnownProvider(providerValue);
    const accountKey = requireAccountKey(accountKeyValue);
    this.#requireRegistration(provider);
    this.#requireProtection();
    const material = this.#validateMaterial(materialValue);
    return this.#run(async () => {
      const document = await this.#readDocument();
      if (document.records.some(record => record.provider === provider && record.accountKey === accountKey)) {
        throw new OAuthTokenVaultError("record-already-exists");
      }
      if (document.records.length >= VAULT_RECORD_LIMIT) throw new OAuthTokenVaultError("storage-failed");
      const timestamp = this.#timestamp();
      document.records.push({
        provider,
        accountKey,
        accessTokenCiphertext: this.#protect(material.accessToken),
        refreshTokenCiphertext: this.#protect(material.refreshToken),
        expiresAt: new Date(Date.parse(timestamp) + material.expiresInSeconds * 1_000).toISOString(),
        scopes: material.scopes,
        generation: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      await this.#writeDocument(document);
      return this.#snapshot(document, null);
    });
  }

  async rotate(providerValue: OAuthProviderId, accountKeyValue: string, rotationValue: OAuthTokenRotation): Promise<OAuthTokenVaultSnapshot> {
    const provider = requireKnownProvider(providerValue);
    const accountKey = requireAccountKey(accountKeyValue);
    this.#requireRegistration(provider);
    this.#requireProtection();
    const accessToken = validateTokenText(rotationValue.accessToken);
    const refreshToken = rotationValue.refreshToken === undefined ? undefined : validateTokenText(rotationValue.refreshToken);
    const expiresInSeconds = validateTokenLifetime(rotationValue.expiresInSeconds);
    const scopes = validateScopes(rotationValue.scopes);
    return this.#run(async () => {
      const document = await this.#readDocument();
      const record = document.records.find(candidate => candidate.provider === provider && candidate.accountKey === accountKey);
      if (!record) throw new OAuthTokenVaultError("record-not-found");
      const timestamp = this.#timestamp();
      record.accessTokenCiphertext = this.#protect(accessToken);
      if (refreshToken !== undefined) record.refreshTokenCiphertext = this.#protect(refreshToken);
      record.expiresAt = new Date(Date.parse(timestamp) + expiresInSeconds * 1_000).toISOString();
      record.scopes = scopes;
      record.generation += 1;
      record.updatedAt = timestamp;
      await this.#writeDocument(document);
      return this.#snapshot(document, null);
    });
  }

  /**
   * Returns plaintext token material for exactly one account, or null when no record exists. This
   * is deliberately never wired to IPC — it exists only for the main process to authenticate a
   * connected account's own mail connection, the same boundary a decrypted account password
   * already crosses only inside the main process and never over IPC.
   */
  async read(providerValue: OAuthProviderId, accountKeyValue: string): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresAt: string;
    scopes: string[];
  } | null> {
    const provider = requireKnownProvider(providerValue);
    const accountKey = requireAccountKey(accountKeyValue);
    this.#requireProtection();
    return this.#run(async () => {
      const document = await this.#readDocument();
      const record = document.records.find(candidate => candidate.provider === provider && candidate.accountKey === accountKey);
      if (!record) return null;
      return {
        accessToken: this.#unprotect(record.accessTokenCiphertext),
        refreshToken: this.#unprotect(record.refreshTokenCiphertext),
        expiresAt: record.expiresAt,
        scopes: [...record.scopes],
      };
    });
  }

  /**
   * Removes exactly one account's record, unlike {@link clear} which drops every record for a
   * provider. Used when a single connected account is removed, so removing one Microsoft account
   * never touches another Microsoft account's tokens.
   */
  async forgetAccount(providerValue: OAuthProviderId, accountKeyValue: string): Promise<void> {
    const provider = requireKnownProvider(providerValue);
    const accountKey = requireAccountKey(accountKeyValue);
    return this.#run(async () => {
      const document = await this.#readDocument();
      const remaining = document.records.filter(record => !(record.provider === provider && record.accountKey === accountKey));
      if (remaining.length === document.records.length) return;
      document.records = remaining;
      await this.#writeDocument(document);
    });
  }

  async clear(providerValue: OAuthProviderId): Promise<OAuthTokenVaultActionResult> {
    const provider = requireKnownProvider(providerValue);
    return this.#run(async () => {
      const document = await this.#readDocument();
      const localRecordsCleared = document.records.filter(record => record.provider === provider).length;
      if (localRecordsCleared) {
        document.records = document.records.filter(record => record.provider !== provider);
        await this.#writeDocument(document);
      }
      return {
        provider,
        localRecordsCleared,
        remoteRevocation: "not-needed",
        snapshot: this.#snapshot(document, this.#availabilityFailure()),
      };
    });
  }

  async revokeAndClear(providerValue: OAuthProviderId): Promise<OAuthTokenVaultActionResult> {
    const provider = requireKnownProvider(providerValue);
    return this.#run(async () => {
      const document = await this.#readDocument();
      const records = document.records.filter(record => record.provider === provider);
      let remoteRevocation: OAuthTokenVaultActionResult["remoteRevocation"] = records.length ? "not-available" : "not-needed";
      const revoker = this.#revokers.get(provider);
      if (records.length && this.#registrations.has(provider) && revoker && this.#availabilityFailure() === null) {
        remoteRevocation = "succeeded";
        for (const record of records) {
          try {
            await revoker.revoke({
              accessToken: this.#unprotect(record.accessTokenCiphertext),
              refreshToken: this.#unprotect(record.refreshTokenCiphertext),
            });
          } catch (error) {
            // A "not supported" revoker never attempted a network call, so it must not read as a
            // failed one — see OAuthProviderRevocationNotSupportedError. Once any record reports
            // "failed" it stays "failed"; a later "not-supported" record must not paper over that.
            if (error instanceof OAuthProviderRevocationNotSupportedError) {
              if (remoteRevocation === "succeeded") remoteRevocation = "not-supported";
            } else {
              remoteRevocation = "failed";
            }
          }
        }
      }
      if (records.length) {
        document.records = document.records.filter(record => record.provider !== provider);
        await this.#writeDocument(document);
      }
      return {
        provider,
        localRecordsCleared: records.length,
        remoteRevocation,
        snapshot: this.#snapshot(document, this.#availabilityFailure()),
      };
    });
  }

  #validateMaterial(value: OAuthTokenMaterial): { accessToken: string; refreshToken: string; expiresInSeconds: number; scopes: string[] } {
    return {
      accessToken: validateTokenText(value.accessToken),
      refreshToken: validateTokenText(value.refreshToken),
      expiresInSeconds: validateTokenLifetime(value.expiresInSeconds),
      scopes: validateScopes(value.scopes),
    };
  }

  #requireRegistration(provider: OAuthProviderId): void {
    if (!this.#registrations.has(provider)) throw new OAuthTokenVaultError("provider-registration-required");
  }

  #availabilityFailure(): OAuthTokenVaultFailure | null {
    if (this.#platform !== "win32") return "windows-only";
    try {
      return this.#safeStorage.isEncryptionAvailable() ? null : "encryption-unavailable";
    } catch {
      return "encryption-unavailable";
    }
  }

  #requireProtection(): void {
    if (this.#availabilityFailure() !== null) throw new OAuthTokenVaultError("windows-safe-storage-unavailable");
  }

  #timestamp(): string {
    const now = this.#now();
    if (!Number.isFinite(now) || now < 0) throw new OAuthTokenVaultError("storage-failed");
    return new Date(now).toISOString();
  }

  #protect(plaintext: string): string {
    let ciphertext: Buffer | null = null;
    try {
      ciphertext = this.#safeStorage.encryptString(plaintext);
      if (!Buffer.isBuffer(ciphertext) || !ciphertext.length || ciphertext.length > CIPHERTEXT_LIMIT) {
        throw new OAuthTokenVaultError("storage-failed");
      }
      return ciphertext.toString("base64");
    } catch (error) {
      if (error instanceof OAuthTokenVaultError) throw error;
      throw new OAuthTokenVaultError("storage-failed");
    } finally {
      ciphertext?.fill(0);
    }
  }

  #unprotect(encoded: string): string {
    const ciphertext = Buffer.from(validateCiphertext(encoded), "base64");
    try {
      const plaintext = this.#safeStorage.decryptString(ciphertext);
      return validateTokenText(plaintext);
    } catch (error) {
      if (error instanceof OAuthTokenVaultError) throw error;
      throw new OAuthTokenVaultError("storage-failed");
    } finally {
      ciphertext.fill(0);
    }
  }

  #snapshot(document: OAuthTokenVaultDocument, failure: OAuthTokenVaultFailure | null): OAuthTokenVaultSnapshot {
    const now = this.#now();
    const providers: OAuthTokenVaultProviderSnapshot[] = OAUTH_PROVIDER_IDS.map(id => {
      const records = document.records.filter(record => record.provider === id);
      const latest = records.toSorted((left, right) => right.generation - left.generation || right.updatedAt.localeCompare(left.updatedAt))[0];
      const registered = this.#registrations.has(id);
      const state = failure
        ? "unavailable"
        : !registered
          ? "not-registered"
          : !records.length
            ? "empty"
            : records.some(record => Date.parse(record.expiresAt) > now)
              ? "active"
              : "expired";
      return {
        id,
        name: providerNames[id],
        registered,
        state,
        recordCount: records.length,
        generation: latest?.generation ?? 0,
        expiresAt: latest?.expiresAt ?? null,
        canClear: records.length > 0,
        canRevoke: failure === null && registered && this.#revokers.has(id) && records.length > 0,
      };
    });
    return { protection: "windows-safe-storage", available: failure === null, failure, providers };
  }

  async #readDocument(): Promise<OAuthTokenVaultDocument> {
    await mkdir(path.dirname(this.#filePath), { recursive: true });
    try {
      const document = await this.#readCandidate(this.#filePath);
      await this.#cleanupDebris();
      return document;
    } catch (error) {
      if (errorCode(error) !== "ENOENT") throw error instanceof OAuthTokenVaultError ? error : new OAuthTokenVaultError("storage-failed");
    }
    try {
      const recovered = await this.#readCandidate(this.#previousPath);
      await rename(this.#previousPath, this.#filePath);
      await this.#syncDirectory();
      await this.#cleanupDebris();
      return recovered;
    } catch (error) {
      if (errorCode(error) !== "ENOENT") throw error instanceof OAuthTokenVaultError ? error : new OAuthTokenVaultError("storage-failed");
    }
    await this.#cleanupDebris();
    return emptyDocument();
  }

  async #readCandidate(candidatePath: string): Promise<OAuthTokenVaultDocument> {
    const information = await stat(candidatePath);
    if (!information.isFile() || information.size > VAULT_FILE_LIMIT) throw new OAuthTokenVaultError("storage-failed");
    const serialized = await readFile(candidatePath, "utf8");
    if (Buffer.byteLength(serialized, "utf8") > VAULT_FILE_LIMIT) throw new OAuthTokenVaultError("storage-failed");
    try {
      return parseDocument(JSON.parse(serialized) as unknown);
    } catch (error) {
      if (error instanceof OAuthTokenVaultError) throw error;
      throw new OAuthTokenVaultError("storage-failed");
    }
  }

  async #writeDocument(document: OAuthTokenVaultDocument): Promise<void> {
    const validated = parseDocument(document);
    const serialized = `${JSON.stringify(validated, null, 2)}\n`;
    if (Buffer.byteLength(serialized, "utf8") > VAULT_FILE_LIMIT) throw new OAuthTokenVaultError("storage-failed");
    const temporaryPath = `${this.#filePath}.${process.pid}.${randomUUID()}.tmp`;
    const handle = await open(temporaryPath, "wx", 0o600).catch(() => {
      throw new OAuthTokenVaultError("storage-failed");
    });
    try {
      await handle.writeFile(serialized, "utf8");
      await handle.sync();
    } catch {
      throw new OAuthTokenVaultError("storage-failed");
    } finally {
      await handle.close().catch(() => undefined);
    }
    try {
      await rename(temporaryPath, this.#filePath);
      await this.#syncDirectory();
      await this.#readCandidate(this.#filePath);
      return;
    } catch (error) {
      if (!new Set(["EEXIST", "EPERM"]).has(errorCode(error) ?? "")) {
        await rm(temporaryPath, { force: true }).catch(() => undefined);
        throw error instanceof OAuthTokenVaultError ? error : new OAuthTokenVaultError("storage-failed");
      }
    }
    await rm(this.#previousPath, { force: true }).catch(() => undefined);
    try {
      await rename(this.#filePath, this.#previousPath);
      try {
        await rename(temporaryPath, this.#filePath);
        await this.#syncDirectory();
        await this.#readCandidate(this.#filePath);
      } catch {
        await rm(this.#filePath, { force: true }).catch(() => undefined);
        await rename(this.#previousPath, this.#filePath).catch(() => undefined);
        throw new OAuthTokenVaultError("storage-failed");
      }
      await rm(this.#previousPath, { force: true });
      await this.#syncDirectory();
    } catch (error) {
      throw error instanceof OAuthTokenVaultError ? error : new OAuthTokenVaultError("storage-failed");
    } finally {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  }

  async #cleanupDebris(): Promise<void> {
    const directory = path.dirname(this.#filePath);
    const basename = path.basename(this.#filePath);
    let names: string[];
    try {
      names = await readdir(directory);
    } catch {
      return;
    }
    await Promise.all(names
      .filter(name => name === `${basename}.previous` || (name.startsWith(`${basename}.`) && name.endsWith(".tmp")))
      .map(name => rm(path.join(directory, name), { force: true }).catch(() => undefined)));
  }

  async #syncDirectory(): Promise<void> {
    try {
      const directory = await open(path.dirname(this.#filePath), "r");
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    } catch (error) {
      if (!new Set(["EACCES", "EBADF", "EINVAL", "EISDIR", "ENOTSUP", "EPERM"]).has(errorCode(error) ?? "")) {
        throw new OAuthTokenVaultError("storage-failed");
      }
    }
  }

  #run<T>(operation: () => Promise<T>): Promise<T> {
    const queued = this.#queue.then(operation, operation);
    this.#queue = queued.then(() => undefined, () => undefined);
    return queued;
  }
}
