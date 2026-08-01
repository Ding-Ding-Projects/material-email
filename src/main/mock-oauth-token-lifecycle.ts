import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { OAUTH_PROVIDER_IDS, type OAuthProviderId } from "../shared/oauth.js";

const MOCK_ACCESS_TOKEN_LIMIT = 8_192;
const MOCK_REFRESH_TOKEN_LIMIT = 8_192;
const MOCK_SCOPE_LIMIT = 50;
const MOCK_TOKEN_LIFETIME_MAX_SECONDS = 24 * 60 * 60;
const STORAGE_RECORD_VERSION = 1;
const AES_KEY_BYTES = 32;
const AES_IV_BYTES = 12;
const AES_TAG_BYTES = 16;

export type MockOAuthTokenPhase =
  | "idle"
  | "exchanging"
  | "active"
  | "refreshing"
  | "expired"
  | "revoking"
  | "revoked"
  | "error";

export type MockOAuthTokenFailure =
  | "invalid-transition"
  | "invalid-input"
  | "exchange-failed"
  | "refresh-failed"
  | "revocation-failed"
  | "storage-failed";

export type ProductionOAuthTokenRefusal =
  | "provider-registration-required"
  | "production-storage-adapter-required";

export interface MockOAuthTokenSnapshot {
  mockOnly: true;
  phase: MockOAuthTokenPhase;
  expiresAt: string | null;
  scopeCount: number;
  generation: number;
  failure: MockOAuthTokenFailure | null;
}

export interface MockOAuthTokenSet {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
  scopes: string[];
}

export interface MockOAuthTokenEndpoint {
  readonly kind: "local-mock";
  exchange(input: { authorizationCode: string; pkceVerifier: string }): Promise<MockOAuthTokenSet>;
  refresh(input: { refreshToken: string }): Promise<MockOAuthTokenSet>;
  revoke(input: { accessToken: string; refreshToken: string }): Promise<void>;
}

export interface EncryptedOAuthTokenStorage {
  readonly protection: "encrypted-at-rest";
  readonly storageClass: "ephemeral-mock" | "production-stub";
  save(storageKey: string, tokens: MockOAuthTokenSet): Promise<void>;
  load(storageKey: string): Promise<MockOAuthTokenSet | null>;
  remove(storageKey: string): Promise<void>;
  dispose?(): Promise<void>;
}

export interface OAuthProviderRegistration {
  provider: OAuthProviderId;
  clientId: string;
  tokenEndpoint: string;
}

export class ProductionOAuthTokenStorageRefusal extends Error {
  readonly code: ProductionOAuthTokenRefusal;

  constructor(code: ProductionOAuthTokenRefusal) {
    super(code === "provider-registration-required"
      ? "Production OAuth token storage requires a reviewed provider registration."
      : "Production OAuth token storage requires a reviewed Windows encrypted-storage adapter.");
    this.name = "ProductionOAuthTokenStorageRefusal";
    this.code = code;
  }
}

export class MockOAuthTokenLifecycleError extends Error {
  readonly code: MockOAuthTokenFailure;

  constructor(code: MockOAuthTokenFailure) {
    super(`Local mock OAuth token lifecycle stopped: ${code}.`);
    this.name = "MockOAuthTokenLifecycleError";
    this.code = code;
  }
}

const hasControlCharacters = (value: string): boolean => /[\u0000-\u001f\u007f]/u.test(value);

const validateStorageKey = (value: string): string => {
  if (!value || value.length > 256 || hasControlCharacters(value)) throw new MockOAuthTokenLifecycleError("storage-failed");
  return value;
};

const validateProviderRegistration = (registration: OAuthProviderRegistration): OAuthProviderRegistration => {
  if (
    !OAUTH_PROVIDER_IDS.includes(registration.provider)
    || !registration.clientId
    || registration.clientId.length > 512
    || hasControlCharacters(registration.clientId)
  ) {
    throw new ProductionOAuthTokenStorageRefusal("provider-registration-required");
  }
  let endpoint: URL;
  try {
    endpoint = new URL(registration.tokenEndpoint);
  } catch {
    throw new ProductionOAuthTokenStorageRefusal("provider-registration-required");
  }
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new ProductionOAuthTokenStorageRefusal("provider-registration-required");
  }
  return { ...registration };
};

const validateTokenSet = (tokens: MockOAuthTokenSet): MockOAuthTokenSet => {
  if (
    !tokens.accessToken
    || tokens.accessToken.length > MOCK_ACCESS_TOKEN_LIMIT
    || hasControlCharacters(tokens.accessToken)
    || !tokens.refreshToken
    || tokens.refreshToken.length > MOCK_REFRESH_TOKEN_LIMIT
    || hasControlCharacters(tokens.refreshToken)
    || !Number.isInteger(tokens.expiresInSeconds)
    || tokens.expiresInSeconds < 1
    || tokens.expiresInSeconds > MOCK_TOKEN_LIFETIME_MAX_SECONDS
    || tokens.scopes.length < 1
    || tokens.scopes.length > MOCK_SCOPE_LIMIT
    || tokens.scopes.some(scope => !scope || scope.length > 256 || /\s/u.test(scope) || hasControlCharacters(scope))
  ) throw new MockOAuthTokenLifecycleError("storage-failed");
  return { ...tokens, scopes: [...tokens.scopes] };
};

const parseStoredTokenSet = (value: unknown): MockOAuthTokenSet => {
  if (!value || typeof value !== "object") throw new MockOAuthTokenLifecycleError("storage-failed");
  const candidate = value as Partial<MockOAuthTokenSet>;
  if (
    typeof candidate.accessToken !== "string"
    || typeof candidate.refreshToken !== "string"
    || typeof candidate.expiresInSeconds !== "number"
    || !Array.isArray(candidate.scopes)
    || !candidate.scopes.every(scope => typeof scope === "string")
  ) throw new MockOAuthTokenLifecycleError("storage-failed");
  return validateTokenSet({
    accessToken: candidate.accessToken,
    refreshToken: candidate.refreshToken,
    expiresInSeconds: candidate.expiresInSeconds,
    scopes: candidate.scopes,
  });
};

/**
 * Demo/test-only AES-GCM vault. It stores ciphertext in memory and destroys its
 * process-local key on dispose. It is not durable Windows credential storage.
 */
export class EphemeralAesGcmOAuthTokenStorage implements EncryptedOAuthTokenStorage {
  readonly protection = "encrypted-at-rest" as const;
  readonly storageClass = "ephemeral-mock" as const;
  readonly #key: Buffer;
  readonly #records = new Map<string, Buffer>();
  #disposed = false;

  constructor(entropy: (size: number) => Buffer = randomBytes) {
    this.#key = entropy(AES_KEY_BYTES);
    if (this.#key.length !== AES_KEY_BYTES) throw new MockOAuthTokenLifecycleError("storage-failed");
  }

  async save(storageKey: string, tokens: MockOAuthTokenSet): Promise<void> {
    this.#assertAvailable();
    const recordKey = validateStorageKey(storageKey);
    const validated = validateTokenSet(tokens);
    const plaintext = Buffer.from(JSON.stringify(validated), "utf8");
    const iv = randomBytes(AES_IV_BYTES);
    try {
      const cipher = createCipheriv("aes-256-gcm", this.#key, iv, { authTagLength: AES_TAG_BYTES });
      cipher.setAAD(Buffer.from(recordKey, "utf8"));
      const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      const blob = Buffer.concat([Buffer.from([STORAGE_RECORD_VERSION]), iv, cipher.getAuthTag(), encrypted]);
      const previous = this.#records.get(recordKey);
      previous?.fill(0);
      this.#records.set(recordKey, blob);
    } finally {
      plaintext.fill(0);
    }
  }

  async load(storageKey: string): Promise<MockOAuthTokenSet | null> {
    this.#assertAvailable();
    const recordKey = validateStorageKey(storageKey);
    const blob = this.#records.get(recordKey);
    if (!blob) return null;
    if (blob.length <= 1 + AES_IV_BYTES + AES_TAG_BYTES || blob[0] !== STORAGE_RECORD_VERSION) {
      throw new MockOAuthTokenLifecycleError("storage-failed");
    }
    const iv = blob.subarray(1, 1 + AES_IV_BYTES);
    const tag = blob.subarray(1 + AES_IV_BYTES, 1 + AES_IV_BYTES + AES_TAG_BYTES);
    const encrypted = blob.subarray(1 + AES_IV_BYTES + AES_TAG_BYTES);
    let plaintext: Buffer | null = null;
    try {
      const decipher = createDecipheriv("aes-256-gcm", this.#key, iv, { authTagLength: AES_TAG_BYTES });
      decipher.setAAD(Buffer.from(recordKey, "utf8"));
      decipher.setAuthTag(tag);
      plaintext = Buffer.concat([decipher.update(encrypted), decipher.final()]);
      return parseStoredTokenSet(JSON.parse(plaintext.toString("utf8")) as unknown);
    } catch (error) {
      if (error instanceof MockOAuthTokenLifecycleError) throw error;
      throw new MockOAuthTokenLifecycleError("storage-failed");
    } finally {
      plaintext?.fill(0);
    }
  }

  async remove(storageKey: string): Promise<void> {
    this.#assertAvailable();
    const recordKey = validateStorageKey(storageKey);
    const blob = this.#records.get(recordKey);
    blob?.fill(0);
    this.#records.delete(recordKey);
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    for (const blob of this.#records.values()) blob.fill(0);
    this.#records.clear();
    this.#key.fill(0);
    this.#disposed = true;
  }

  ciphertextForTests(storageKey: string): Buffer | null {
    this.#assertAvailable();
    const blob = this.#records.get(validateStorageKey(storageKey));
    return blob ? Buffer.from(blob) : null;
  }

  #assertAvailable(): void {
    if (this.#disposed) throw new MockOAuthTokenLifecycleError("storage-failed");
  }
}

/**
 * Production-facing contract stub. It never stores tokens. Missing provider
 * registration is rejected first; a registered caller is then told that the
 * reviewed Windows encrypted-storage adapter has not been implemented.
 */
export class ProductionEncryptedOAuthTokenStorageStub implements EncryptedOAuthTokenStorage {
  readonly protection = "encrypted-at-rest" as const;
  readonly storageClass = "production-stub" as const;
  readonly #registration: OAuthProviderRegistration | null;

  constructor(registration: OAuthProviderRegistration | null = null) {
    this.#registration = registration ? validateProviderRegistration(registration) : null;
  }

  async save(_storageKey: string, _tokens: MockOAuthTokenSet): Promise<void> {
    this.#refuse();
  }

  async load(_storageKey: string): Promise<MockOAuthTokenSet | null> {
    this.#refuse();
  }

  async remove(_storageKey: string): Promise<void> {
    this.#refuse();
  }

  #refuse(): never {
    throw new ProductionOAuthTokenStorageRefusal(
      this.#registration ? "production-storage-adapter-required" : "provider-registration-required",
    );
  }
}

const createMockToken = (prefix: "access" | "refresh"): string =>
  `mock-${prefix}-${randomBytes(24).toString("base64url")}`;

export class LocalMockOAuthTokenEndpoint implements MockOAuthTokenEndpoint {
  readonly kind = "local-mock" as const;
  readonly #scopes: string[];
  readonly #expiresInSeconds: number;

  constructor(options: { scopes?: string[]; expiresInSeconds?: number } = {}) {
    this.#scopes = options.scopes ?? ["mail.read", "mail.send"];
    this.#expiresInSeconds = options.expiresInSeconds ?? 3_600;
    validateTokenSet({
      accessToken: "mock-validation-access",
      refreshToken: "mock-validation-refresh",
      expiresInSeconds: this.#expiresInSeconds,
      scopes: this.#scopes,
    });
  }

  async exchange(_input: { authorizationCode: string; pkceVerifier: string }): Promise<MockOAuthTokenSet> {
    return this.#tokens();
  }

  async refresh(_input: { refreshToken: string }): Promise<MockOAuthTokenSet> {
    return this.#tokens();
  }

  async revoke(_input: { accessToken: string; refreshToken: string }): Promise<void> {
    return undefined;
  }

  #tokens(): MockOAuthTokenSet {
    return {
      accessToken: createMockToken("access"),
      refreshToken: createMockToken("refresh"),
      expiresInSeconds: this.#expiresInSeconds,
      scopes: [...this.#scopes],
    };
  }
}

const allowedTransitions: Record<MockOAuthTokenPhase, ReadonlySet<MockOAuthTokenPhase>> = {
  idle: new Set(["exchanging", "error"]),
  exchanging: new Set(["active", "error"]),
  active: new Set(["refreshing", "expired", "revoking", "error"]),
  refreshing: new Set(["active", "error"]),
  expired: new Set(["refreshing", "revoking", "error"]),
  revoking: new Set(["revoked", "error"]),
  revoked: new Set(["exchanging", "error"]),
  error: new Set(["exchanging", "revoking", "error"]),
};

export interface LocalMockOAuthTokenLifecycleOptions {
  mode: "test" | "demo";
  endpoint: MockOAuthTokenEndpoint;
  storage: EncryptedOAuthTokenStorage;
  storageKey?: string;
  now?: () => number;
}

export class LocalMockOAuthTokenLifecycle {
  readonly #endpoint: MockOAuthTokenEndpoint;
  readonly #storage: EncryptedOAuthTokenStorage;
  readonly #storageKey: string;
  readonly #now: () => number;
  #snapshot: Omit<MockOAuthTokenSnapshot, "mockOnly"> = {
    phase: "idle",
    expiresAt: null,
    scopeCount: 0,
    generation: 0,
    failure: null,
  };

  constructor(options: LocalMockOAuthTokenLifecycleOptions) {
    if (options.mode !== "test" && options.mode !== "demo") throw new MockOAuthTokenLifecycleError("invalid-input");
    if (options.endpoint.kind !== "local-mock" || options.storage.storageClass !== "ephemeral-mock") {
      throw new MockOAuthTokenLifecycleError("invalid-input");
    }
    this.#endpoint = options.endpoint;
    this.#storage = options.storage;
    this.#storageKey = validateStorageKey(options.storageKey ?? `material-email:${options.mode}:mock-oauth`);
    this.#now = options.now ?? Date.now;
  }

  status(): MockOAuthTokenSnapshot {
    if (this.#snapshot.phase === "active" && this.#snapshot.expiresAt) {
      const expiry = Date.parse(this.#snapshot.expiresAt);
      if (Number.isFinite(expiry) && this.#now() >= expiry) {
        this.#transition("expired", this.#snapshot.expiresAt, this.#snapshot.scopeCount, this.#snapshot.generation, null);
      }
    }
    return { mockOnly: true, ...this.#snapshot };
  }

  async exchange(input: { authorizationCode: string; pkceVerifier: string }): Promise<MockOAuthTokenSnapshot> {
    if (!this.#canTransition("exchanging")) return this.#fail("invalid-transition");
    if (
      !input.authorizationCode
      || input.authorizationCode.length > 8_192
      || hasControlCharacters(input.authorizationCode)
      || !/^[A-Za-z0-9_-]{43,128}$/u.test(input.pkceVerifier)
    ) return this.#fail("invalid-input");
    this.#transition("exchanging", null, 0, this.#snapshot.generation, null);
    try {
      if (this.#snapshot.generation > 0) await this.#storage.remove(this.#storageKey);
      const tokens = validateTokenSet(await this.#endpoint.exchange({ ...input }));
      await this.#storage.save(this.#storageKey, tokens);
      const generation = this.#snapshot.generation + 1;
      this.#transition(
        "active",
        new Date(this.#now() + tokens.expiresInSeconds * 1_000).toISOString(),
        tokens.scopes.length,
        generation,
        null,
      );
    } catch (error) {
      this.#transition("error", null, 0, this.#snapshot.generation, this.#operationFailure(error, "exchange-failed"));
    }
    return this.status();
  }

  async refresh(): Promise<MockOAuthTokenSnapshot> {
    this.status();
    if (!this.#canTransition("refreshing")) return this.#fail("invalid-transition");
    this.#transition("refreshing", this.#snapshot.expiresAt, this.#snapshot.scopeCount, this.#snapshot.generation, null);
    try {
      const current = await this.#storage.load(this.#storageKey);
      if (!current) throw new MockOAuthTokenLifecycleError("storage-failed");
      const tokens = validateTokenSet(await this.#endpoint.refresh({ refreshToken: current.refreshToken }));
      await this.#storage.save(this.#storageKey, tokens);
      this.#transition(
        "active",
        new Date(this.#now() + tokens.expiresInSeconds * 1_000).toISOString(),
        tokens.scopes.length,
        this.#snapshot.generation + 1,
        null,
      );
    } catch (error) {
      this.#transition("error", null, 0, this.#snapshot.generation, this.#operationFailure(error, "refresh-failed"));
    }
    return this.status();
  }

  async revoke(): Promise<MockOAuthTokenSnapshot> {
    this.status();
    if (!this.#canTransition("revoking")) return this.#fail("invalid-transition");
    this.#transition("revoking", this.#snapshot.expiresAt, this.#snapshot.scopeCount, this.#snapshot.generation, null);
    let failure: MockOAuthTokenFailure | null = null;
    try {
      const current = await this.#storage.load(this.#storageKey);
      if (!current) throw new MockOAuthTokenLifecycleError("storage-failed");
      await this.#endpoint.revoke({ accessToken: current.accessToken, refreshToken: current.refreshToken });
    } catch (error) {
      failure = this.#operationFailure(error, "revocation-failed");
    }
    try {
      await this.#storage.remove(this.#storageKey);
    } catch {
      failure = "storage-failed";
    }
    this.#transition(failure ? "error" : "revoked", null, 0, this.#snapshot.generation, failure);
    return this.status();
  }

  async dispose(): Promise<void> {
    try {
      await this.#storage.remove(this.#storageKey);
    } finally {
      await this.#storage.dispose?.();
    }
  }

  #canTransition(next: MockOAuthTokenPhase): boolean {
    return allowedTransitions[this.#snapshot.phase].has(next);
  }

  #transition(
    phase: MockOAuthTokenPhase,
    expiresAt: string | null,
    scopeCount: number,
    generation: number,
    failure: MockOAuthTokenFailure | null,
  ): void {
    if (!this.#canTransition(phase)) throw new MockOAuthTokenLifecycleError("invalid-transition");
    this.#snapshot = { phase, expiresAt, scopeCount, generation, failure };
  }

  #fail(failure: MockOAuthTokenFailure): MockOAuthTokenSnapshot {
    this.#transition("error", null, 0, this.#snapshot.generation, failure);
    return this.status();
  }

  #operationFailure(error: unknown, fallback: MockOAuthTokenFailure): MockOAuthTokenFailure {
    return error instanceof MockOAuthTokenLifecycleError && error.code === "storage-failed" ? "storage-failed" : fallback;
  }
}

export const createDemoOAuthTokenLifecycle = (options: { now?: () => number } = {}): LocalMockOAuthTokenLifecycle =>
  new LocalMockOAuthTokenLifecycle({
    mode: "demo",
    endpoint: new LocalMockOAuthTokenEndpoint(),
    storage: new EphemeralAesGcmOAuthTokenStorage(),
    storageKey: "material-email:demo:mock-oauth",
    ...(options.now ? { now: options.now } : {}),
  });
