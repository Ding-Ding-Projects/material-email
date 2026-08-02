import type { OAuthProviderId } from "../shared/oauth.js";

/**
 * Bounds for the two HTTPS calls this module ever makes: exchanging an authorization code for
 * tokens, and refreshing an access token. Both are single bounded request/response round trips to
 * a provider's own token endpoint — never anything else, never retried automatically.
 */
export interface OAuthTokenExchangeLimits {
  requestTimeoutMs: number;
  responseBytes: number;
}

export const OAUTH_TOKEN_EXCHANGE_LIMITS: Readonly<OAuthTokenExchangeLimits> = Object.freeze({
  requestTimeoutMs: 10_000,
  responseBytes: 32 * 1024,
});

export class OAuthTokenExchangeError extends Error {
  readonly code: "network" | "http-error" | "invalid-response" | "response-too-large";

  constructor(code: OAuthTokenExchangeError["code"], message: string) {
    super(message);
    this.name = "OAuthTokenExchangeError";
    this.code = code;
  }
}

export interface OAuthTokenExchangeResult {
  accessToken: string;
  /** Absent when the provider's refresh did not rotate it; the caller keeps the one it already has. */
  refreshToken: string | null;
  expiresInSeconds: number;
  scopes: string[];
}

export interface AuthorizationCodeExchangeInput {
  provider: OAuthProviderId;
  tokenEndpoint: string;
  clientId: string;
  code: string;
  redirectUri: string;
  codeVerifier: string;
}

export interface RefreshTokenExchangeInput {
  provider: OAuthProviderId;
  tokenEndpoint: string;
  clientId: string;
  refreshToken: string;
  scopes: readonly string[];
}

/** Bare IP-literal loopback only — never the "localhost" name, which DNS resolution can redirect. */
const loopbackHosts = new Set(["127.0.0.1", "[::1]"]);

/**
 * A real token endpoint is always HTTPS; plaintext HTTP is refused before any request is made, so a
 * credential can never leave this process unencrypted. The one exception is a literal loopback IP,
 * which exists solely so this module's own tests can run a real local fixture server without a
 * certificate — the same boundary this codebase already draws for its development renderer URL.
 */
const requireHttpsEndpoint = (value: string): URL => {
  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch {
    throw new OAuthTokenExchangeError("invalid-response", "The token endpoint is not a valid URL.");
  }
  if (endpoint.protocol === "https:") return endpoint;
  if (endpoint.protocol === "http:" && loopbackHosts.has(endpoint.hostname)) return endpoint;
  throw new OAuthTokenExchangeError("invalid-response", "The token endpoint must use HTTPS.");
};

/**
 * Reads a response body up to a byte ceiling, throwing rather than buffering an unbounded stream.
 * A token endpoint has no legitimate reason to return more than a few hundred bytes of JSON.
 */
const readBoundedBody = async (response: Response, limitBytes: number): Promise<string> => {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limitBytes) throw new OAuthTokenExchangeError("response-too-large", "The token endpoint response exceeded the bounded size.");
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map(chunk => Buffer.from(chunk))).toString("utf8");
};

interface RawTokenResponse {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  scope?: unknown;
  token_type?: unknown;
  error?: unknown;
  error_description?: unknown;
}

const parseTokenResponse = (body: string): RawTokenResponse => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new OAuthTokenExchangeError("invalid-response", "The token endpoint did not return valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new OAuthTokenExchangeError("invalid-response", "The token endpoint response was not a JSON object.");
  }
  return parsed as RawTokenResponse;
};

/**
 * A provider error response never carries a token, only a stated reason; the reason is safe to
 * surface because it never contains the code, verifier, or a token — the provider only ever names
 * itself here, not a secret. still bounded and stripped of anything unusually long.
 */
const providerErrorMessage = (raw: RawTokenResponse): string => {
  const reason = typeof raw.error === "string" ? raw.error.slice(0, 120) : "unknown_error";
  const description = typeof raw.error_description === "string" ? raw.error_description.slice(0, 200) : "";
  return description ? `${reason}: ${description}` : reason;
};

const toResult = (raw: RawTokenResponse): OAuthTokenExchangeResult => {
  if (typeof raw.error === "string") throw new OAuthTokenExchangeError("http-error", `The provider refused the request (${providerErrorMessage(raw)}).`);
  if (typeof raw.access_token !== "string" || !raw.access_token) {
    throw new OAuthTokenExchangeError("invalid-response", "The token endpoint response had no access token.");
  }
  if (typeof raw.expires_in !== "number" || !Number.isFinite(raw.expires_in) || raw.expires_in <= 0) {
    throw new OAuthTokenExchangeError("invalid-response", "The token endpoint response had no valid lifetime.");
  }
  const scopes = typeof raw.scope === "string" ? raw.scope.split(/\s+/u).filter(Boolean) : [];
  return {
    accessToken: raw.access_token,
    refreshToken: typeof raw.refresh_token === "string" && raw.refresh_token ? raw.refresh_token : null,
    // Providers cap lifetimes at their own discretion, but this app never trusts a value that would
    // outlive a reasonable session; the vault separately bounds what it will store.
    expiresInSeconds: Math.min(raw.expires_in, 24 * 60 * 60),
    scopes,
  };
};

const postForm = async (tokenEndpoint: string, body: URLSearchParams): Promise<RawTokenResponse> => {
  const endpoint = requireHttpsEndpoint(tokenEndpoint);
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body,
      redirect: "error",
      signal: AbortSignal.timeout(OAUTH_TOKEN_EXCHANGE_LIMITS.requestTimeoutMs),
    });
  } catch (error) {
    throw new OAuthTokenExchangeError("network", error instanceof Error && error.name === "TimeoutError"
      ? "The token endpoint did not respond in time."
      : "The token endpoint could not be reached.");
  }
  const text = await readBoundedBody(response, OAUTH_TOKEN_EXCHANGE_LIMITS.responseBytes);
  const raw = parseTokenResponse(text);
  if (!response.ok && typeof raw.error !== "string") {
    throw new OAuthTokenExchangeError("http-error", `The token endpoint returned status ${response.status}.`);
  }
  return raw;
};

/**
 * Exchanges an authorization code for tokens. Public-client PKCE only: no client secret is ever
 * sent, because a desktop application cannot keep one confidential.
 */
export const exchangeAuthorizationCode = async (input: AuthorizationCodeExchangeInput): Promise<OAuthTokenExchangeResult> => {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: input.clientId,
    code: input.code,
    redirect_uri: input.redirectUri,
    code_verifier: input.codeVerifier,
  });
  const raw = await postForm(input.tokenEndpoint, body);
  const result = toResult(raw);
  if (!result.refreshToken) {
    // This app always requests offline_access; a provider that honours the scope but returns no
    // refresh token has not actually granted one, and treating the access token alone as durable
    // would leave the account silently unable to reconnect once it expires.
    throw new OAuthTokenExchangeError("invalid-response", "The provider did not return a refresh token.");
  }
  return result;
};

export const refreshAccessToken = async (input: RefreshTokenExchangeInput): Promise<OAuthTokenExchangeResult> => {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: input.clientId,
    refresh_token: input.refreshToken,
    scope: input.scopes.join(" "),
  });
  const raw = await postForm(input.tokenEndpoint, body);
  return toResult(raw);
};
