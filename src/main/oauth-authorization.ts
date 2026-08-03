import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  OAUTH_PROVIDER_IDS,
  type OAuthAuthorizationFailure,
  type OAuthAuthorizationPhase,
  type OAuthAuthorizationSnapshot,
  type OAuthProviderAvailability,
  type OAuthProviderId,
} from "../shared/oauth.js";

const PASTED_REDIRECT_URL_LIMIT = 8_192;
const AUTHORIZATION_CODE_LIMIT = 8_192;
const OAUTH_STATE_BYTES = 32;
const PKCE_VERIFIER_BYTES = 64;
const DEFAULT_AUTHORIZATION_TIMEOUT_MS = 5 * 60_000;
const MAX_INVALID_REDIRECT_PASTES = 8;

const providerNames: Record<OAuthProviderId, string> = {
  google: "Google",
  microsoft: "Microsoft",
};

const allowedTransitions: Record<OAuthAuthorizationPhase, ReadonlySet<OAuthAuthorizationPhase>> = {
  idle: new Set(["preparing", "error"]),
  preparing: new Set(["opening-browser", "cancelled", "timed-out", "error"]),
  "opening-browser": new Set(["awaiting-redirect-paste", "authorization-received", "cancelled", "timed-out", "error"]),
  "awaiting-redirect-paste": new Set(["authorization-received", "cancelled", "timed-out", "error"]),
  "authorization-received": new Set(["preparing", "error"]),
  cancelled: new Set(["preparing", "error"]),
  "timed-out": new Set(["preparing", "error"]),
  error: new Set(["preparing", "error"]),
};

/**
 * Every field here is provider-supplied configuration, including the redirect URI: this class does
 * not construct one itself (it no longer opens any local listener), so the exact value a provider
 * has been told to accept must be handed in by the caller who registered it.
 */
export interface OAuthProviderConfiguration {
  provider: OAuthProviderId;
  authorizationEndpoint: string;
  clientId: string;
  scopes: readonly string[];
  redirectUri: string;
}

export interface OAuthAuthorizationCodeGrant {
  provider: OAuthProviderId;
  code: string;
  codeVerifier: string;
  redirectUri: string;
}

export interface OAuthAuthorizationServiceOptions {
  configurations?: readonly OAuthProviderConfiguration[];
  openExternal: (url: string) => Promise<void>;
  timeoutMs?: number;
  now?: () => number;
  /**
   * Called exactly once per successfully parsed redirect, synchronously from inside
   * submitRedirectUrl, with the code this foundation would otherwise discard. Never invoked over
   * IPC and never given to the renderer — this is the one seam where a caller can turn a completed
   * browser round trip into an actual token exchange, which this class still does not do itself.
   */
  onAuthorizationCode?: (grant: OAuthAuthorizationCodeGrant) => void;
}

export interface PkcePair {
  verifier: string;
  challenge: string;
}

export type PastedRedirectRejectionReason =
  | "too-long"
  | "unparseable"
  | "wrong-redirect"
  | "state"
  | "unexpected-token"
  | "ambiguous-result"
  | "missing-result";

export type PastedRedirectValidation =
  | { kind: "authorization"; code: string }
  | { kind: "provider-error"; error: string }
  | { kind: "rejected"; reason: PastedRedirectRejectionReason };

export interface PastedRedirectExpectation {
  redirectUri: string;
  state: string;
}

interface ActiveAuthorization {
  provider: OAuthProviderId;
  redirectUri: string;
  stateBytes: Buffer;
  verifierBytes: Buffer;
  timeout: NodeJS.Timeout | null;
  invalidPastes: number;
}

const base64Url = (value: Buffer): string => value.toString("base64url");

export const createPkcePair = (source: (size: number) => Buffer = randomBytes): PkcePair => {
  const verifierBytes = source(PKCE_VERIFIER_BYTES);
  if (verifierBytes.length !== PKCE_VERIFIER_BYTES) throw new Error("PKCE entropy source returned the wrong byte count.");
  const verifier = base64Url(verifierBytes);
  return {
    verifier,
    challenge: createHash("sha256").update(verifier, "ascii").digest("base64url"),
  };
};

const safeTextEqual = (left: string, right: string): boolean => {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
};

const hasControlCharacters = (value: string): boolean => {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
};

/**
 * Parses and validates the full URL a user pasted back from their browser's address bar after
 * completing sign-in. There is no local listener to trust the transport of, so this checks the
 * things a request-level validator used to: the URL actually is the exact registered redirect (not
 * some other page the user happened to copy), the state matches this session's own, and the result
 * carries exactly one code or one provider error and nothing that looks like a token.
 */
export const validatePastedRedirect = (
  pastedUrl: string,
  expectation: PastedRedirectExpectation,
): PastedRedirectValidation => {
  if (!pastedUrl || pastedUrl.length > PASTED_REDIRECT_URL_LIMIT) return { kind: "rejected", reason: "too-long" };

  let pasted: URL;
  let expected: URL;
  try {
    pasted = new URL(pastedUrl.trim());
    expected = new URL(expectation.redirectUri);
  } catch {
    return { kind: "rejected", reason: "unparseable" };
  }
  if (pasted.origin !== expected.origin || pasted.pathname !== expected.pathname) {
    return { kind: "rejected", reason: "wrong-redirect" };
  }

  const states = pasted.searchParams.getAll("state");
  if (states.length !== 1 || states[0]!.length > 256 || !safeTextEqual(states[0]!, expectation.state)) {
    return { kind: "rejected", reason: "state" };
  }
  if (["access_token", "refresh_token", "id_token"].some(parameter => pasted.searchParams.has(parameter))) {
    return { kind: "rejected", reason: "unexpected-token" };
  }

  const codes = pasted.searchParams.getAll("code");
  const errors = pasted.searchParams.getAll("error");
  if (codes.length > 1 || errors.length > 1 || (codes.length === 1 && errors.length === 1)) {
    return { kind: "rejected", reason: "ambiguous-result" };
  }
  if (errors.length === 1) {
    const error = errors[0] ?? "";
    if (!error || error.length > 128 || hasControlCharacters(error)) {
      return { kind: "rejected", reason: "ambiguous-result" };
    }
    return { kind: "provider-error", error };
  }
  if (codes.length === 1) {
    const code = codes[0] ?? "";
    if (!code || code.length > AUTHORIZATION_CODE_LIMIT || hasControlCharacters(code)) {
      return { kind: "rejected", reason: "ambiguous-result" };
    }
    return { kind: "authorization", code };
  }
  return { kind: "rejected", reason: "missing-result" };
};

const validateConfiguration = (configuration: OAuthProviderConfiguration): OAuthProviderConfiguration => {
  if (!OAUTH_PROVIDER_IDS.includes(configuration.provider)) throw new Error("Unsupported OAuth provider configuration.");
  const endpoint = new URL(configuration.authorizationEndpoint);
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new Error("OAuth authorization endpoints must be clean HTTPS URLs.");
  }
  const redirect = new URL(configuration.redirectUri);
  if (redirect.protocol !== "https:" || redirect.username || redirect.password || redirect.search || redirect.hash) {
    throw new Error("OAuth redirect URIs must be clean HTTPS URLs.");
  }
  if (!configuration.clientId || configuration.clientId.length > 512 || hasControlCharacters(configuration.clientId)) {
    throw new Error("OAuth client identifiers must be bounded text.");
  }
  if (
    configuration.scopes.length === 0
    || configuration.scopes.length > 50
    || configuration.scopes.some(scope => !scope || scope.length > 256 || /\s/u.test(scope) || hasControlCharacters(scope))
  ) throw new Error("OAuth scopes must be bounded, non-empty tokens.");
  return { ...configuration, scopes: [...configuration.scopes] };
};

export class OAuthAuthorizationService {
  readonly #configurations = new Map<OAuthProviderId, OAuthProviderConfiguration>();
  readonly #providers: OAuthProviderAvailability[];
  readonly #openExternal: (url: string) => Promise<void>;
  readonly #timeoutMs: number;
  readonly #now: () => number;
  readonly #onAuthorizationCode: ((grant: OAuthAuthorizationCodeGrant) => void) | undefined;
  #active: ActiveAuthorization | null = null;
  #snapshot: Omit<OAuthAuthorizationSnapshot, "providers"> = {
    phase: "idle",
    provider: null,
    expiresAt: null,
    failure: null,
  };

  constructor(options: OAuthAuthorizationServiceOptions) {
    this.#openExternal = options.openExternal;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_AUTHORIZATION_TIMEOUT_MS;
    this.#now = options.now ?? Date.now;
    this.#onAuthorizationCode = options.onAuthorizationCode;
    if (!Number.isInteger(this.#timeoutMs) || this.#timeoutMs < 10 || this.#timeoutMs > 10 * 60_000) {
      throw new Error("OAuth authorization timeout is outside the supported bound.");
    }
    for (const candidate of options.configurations ?? []) {
      const configuration = validateConfiguration(candidate);
      if (this.#configurations.has(configuration.provider)) throw new Error("OAuth provider configurations must be unique.");
      this.#configurations.set(configuration.provider, configuration);
    }
    this.#providers = OAUTH_PROVIDER_IDS.map(id => ({ id, name: providerNames[id], configured: this.#configurations.has(id) }));
  }

  status(): OAuthAuthorizationSnapshot {
    return { ...this.#snapshot, providers: this.#providers.map(provider => ({ ...provider })) };
  }

  async start(provider: OAuthProviderId): Promise<OAuthAuthorizationSnapshot> {
    if (this.#active) return this.status();
    const configuration = this.#configurations.get(provider);
    if (!configuration) {
      this.#transition("error", provider, null, "provider-not-configured");
      return this.status();
    }

    this.#transition("preparing", provider, null, null);
    const stateBytes = randomBytes(OAUTH_STATE_BYTES);
    const verifierBytes = randomBytes(PKCE_VERIFIER_BYTES);
    const verifier = base64Url(verifierBytes);
    const challenge = createHash("sha256").update(verifier, "ascii").digest("base64url");

    const expiresAtMs = this.#now() + this.#timeoutMs;
    const session: ActiveAuthorization = {
      provider,
      redirectUri: configuration.redirectUri,
      stateBytes,
      verifierBytes,
      timeout: null,
      invalidPastes: 0,
    };
    this.#active = session;
    session.timeout = setTimeout(() => {
      if (this.#active === session) this.#terminate(session, "timed-out", null);
    }, this.#timeoutMs);
    session.timeout.unref();

    const authorizationUrl = new URL(configuration.authorizationEndpoint);
    authorizationUrl.searchParams.set("client_id", configuration.clientId);
    authorizationUrl.searchParams.set("redirect_uri", configuration.redirectUri);
    authorizationUrl.searchParams.set("response_type", "code");
    authorizationUrl.searchParams.set("scope", configuration.scopes.join(" "));
    authorizationUrl.searchParams.set("state", base64Url(stateBytes));
    authorizationUrl.searchParams.set("code_challenge", challenge);
    authorizationUrl.searchParams.set("code_challenge_method", "S256");

    this.#transition("opening-browser", provider, new Date(expiresAtMs).toISOString(), null);
    try {
      await this.#openExternal(authorizationUrl.toString());
    } catch {
      if (this.#active === session) this.#terminate(session, "error", "browser-open-failed");
      return this.status();
    }
    if (this.#active === session && this.#snapshot.phase === "opening-browser") {
      this.#transition("awaiting-redirect-paste", provider, new Date(expiresAtMs).toISOString(), null);
    }
    return this.status();
  }

  /**
   * Consumes the URL the user copied from their browser after completing sign-in. Never called
   * more than once per successful attempt: a match terminates the session immediately, and a
   * bounded number of non-matches terminates it as an error rather than allowing indefinite retries.
   */
  submitRedirectUrl(pastedUrl: string): OAuthAuthorizationSnapshot {
    const session = this.#active;
    if (!session || this.#snapshot.phase !== "awaiting-redirect-paste") return this.status();

    const validation = validatePastedRedirect(pastedUrl, {
      redirectUri: session.redirectUri,
      state: base64Url(session.stateBytes),
    });
    if (validation.kind === "rejected") {
      session.invalidPastes += 1;
      if (session.invalidPastes >= MAX_INVALID_REDIRECT_PASTES) this.#terminate(session, "error", "redirect-invalid");
      return this.status();
    }
    if (validation.kind === "provider-error") {
      const failure = validation.error === "access_denied" ? "provider-denied" : "provider-error";
      this.#terminate(session, "error", failure);
      return this.status();
    }

    // The code and verifier are captured as values now, before #terminate zeroes the raw buffer
    // they came from. This class still performs no token exchange itself; the grant is handed to
    // the caller's callback so a real exchange can happen exactly once, outside of this file.
    if (this.#onAuthorizationCode) {
      this.#onAuthorizationCode({
        provider: session.provider,
        code: validation.code,
        codeVerifier: base64Url(session.verifierBytes),
        redirectUri: session.redirectUri,
      });
    }
    this.#terminate(session, "authorization-received", null);
    return this.status();
  }

  async cancel(): Promise<OAuthAuthorizationSnapshot> {
    const session = this.#active;
    if (session) this.#terminate(session, "cancelled", null);
    return this.status();
  }

  async dispose(): Promise<void> {
    const session = this.#active;
    if (session) this.#terminate(session, "cancelled", null);
  }

  #transition(
    phase: OAuthAuthorizationPhase,
    provider: OAuthProviderId | null,
    expiresAt: string | null,
    failure: OAuthAuthorizationFailure | null,
  ): void {
    if (!allowedTransitions[this.#snapshot.phase].has(phase)) throw new Error("Invalid OAuth authorization state transition.");
    this.#snapshot = { phase, provider, expiresAt, failure };
  }

  #terminate(
    session: ActiveAuthorization,
    phase: "authorization-received" | "cancelled" | "timed-out" | "error",
    failure: OAuthAuthorizationFailure | null,
  ): void {
    if (this.#active !== session) return;
    this.#active = null;
    if (session.timeout) clearTimeout(session.timeout);
    session.stateBytes.fill(0);
    session.verifierBytes.fill(0);
    this.#transition(phase, session.provider, null, failure);
  }
}
