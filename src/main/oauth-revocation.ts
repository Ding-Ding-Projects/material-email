import type { OAuthProviderId } from "../shared/oauth.js";
import { OAuthProviderRevocationNotSupportedError, type OAuthProviderTokenRevoker } from "./oauth-token-vault.js";

/**
 * Real provider revocation clients for {@link OAuthProviderTokenRevoker}, the seam
 * `WindowsSafeStorageOAuthTokenVault.revokeAndClear` already calls per provider. Neither factory
 * here does anything unless the caller (`src/main/index.ts`) actually registers its result with the
 * vault alongside that provider's own client-ID registration — exactly the same environment-gated
 * pattern Microsoft's token exchange already uses. Registering nothing, as today's shipped build
 * does before this module exists, leaves `revokeAndClear` reporting `"not-available"`, which stays
 * true and honest for any provider that genuinely has no revoker registered.
 *
 * Google publishes one documented token-revocation endpoint that accepts either an access or
 * refresh token: https://developers.google.com/identity/protocols/oauth2/web-server#tokenrevoke.
 * Microsoft's v2.0 endpoint publishes no equivalent per-token revoke endpoint the way Google does —
 * https://learn.microsoft.com/entra/identity-platform/v2-oauth2-auth-code-flow documents sign-out
 * and consent-revocation only through the account portal/admin consent UI, never a token-bearing
 * HTTPS call this app could make on the user's behalf. Inventing one would silently claim a
 * provider guarantee that does not exist, so Microsoft's client below never attempts a network call
 * at all: it always throws {@link OAuthProviderRevocationNotSupportedError}, which the vault reports
 * as the distinct `"not-supported"` outcome rather than conflating it with a genuine `"failed"`
 * network attempt.
 */

export interface OAuthRevocationLimits {
  requestTimeoutMs: number;
  responseBytes: number;
}

export const OAUTH_REVOCATION_LIMITS: Readonly<OAuthRevocationLimits> = Object.freeze({
  requestTimeoutMs: 10_000,
  responseBytes: 4 * 1024,
});

export class OAuthRevocationError extends Error {
  readonly code: "network" | "http-error" | "response-too-large";

  constructor(code: OAuthRevocationError["code"], message: string) {
    super(message);
    this.name = "OAuthRevocationError";
    this.code = code;
  }
}

export const GOOGLE_REVOCATION_ENDPOINT = "https://oauth2.googleapis.com/revoke";

/** Bare IP-literal loopback only — never the "localhost" name, which DNS resolution can redirect. */
const loopbackHosts = new Set(["127.0.0.1", "[::1]"]);

/**
 * A real revocation endpoint is always HTTPS; plaintext HTTP is refused before any request is made.
 * The one exception is a literal loopback IP, which exists solely so this module's own tests can run
 * a real local fixture server without a certificate — the same boundary this codebase already draws
 * for its development renderer URL and for the token-exchange module this one mirrors.
 */
const requireHttpsEndpoint = (value: string): URL => {
  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch {
    throw new OAuthRevocationError("http-error", "The revocation endpoint is not a valid URL.");
  }
  if (endpoint.protocol === "https:") return endpoint;
  if (endpoint.protocol === "http:" && loopbackHosts.has(endpoint.hostname)) return endpoint;
  throw new OAuthRevocationError("http-error", "The revocation endpoint must use HTTPS.");
};

/**
 * Reads a response body up to a byte ceiling, discarding it rather than logging or returning it — a
 * revocation response carries nothing this app needs, and nothing from it is ever surfaced to a
 * caller or an error message.
 */
const drainBoundedBody = async (response: Response, limitBytes: number): Promise<void> => {
  const reader = response.body?.getReader();
  if (!reader) return;
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limitBytes) throw new OAuthRevocationError("response-too-large", "The revocation endpoint response exceeded the bounded size.");
    }
  } finally {
    reader.releaseLock();
  }
};

export interface GoogleOAuthRevokerOptions {
  /** Override for tests only — production always uses {@link GOOGLE_REVOCATION_ENDPOINT}. */
  revocationEndpoint?: string;
  limits?: OAuthRevocationLimits;
}

/**
 * Google's real token-revocation client. Revokes the refresh token, which per Google's documented
 * behavior invalidates the entire grant — every access token issued under it — matching the scope a
 * user-initiated "Revoke and clear" action implies, not just the one access token currently cached.
 * Never logs or throws the token itself; error messages name only the endpoint and HTTP status.
 */
export const createGoogleOAuthRevoker = (options: GoogleOAuthRevokerOptions = {}): OAuthProviderTokenRevoker => {
  const endpoint = requireHttpsEndpoint(options.revocationEndpoint ?? GOOGLE_REVOCATION_ENDPOINT);
  const limits = options.limits ?? OAUTH_REVOCATION_LIMITS;
  return {
    provider: "google",
    async revoke({ refreshToken }) {
      const body = new URLSearchParams({ token: refreshToken });
      let response: Response;
      try {
        response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body,
          redirect: "error",
          signal: AbortSignal.timeout(limits.requestTimeoutMs),
        });
      } catch (error) {
        throw new OAuthRevocationError("network", error instanceof Error && error.name === "TimeoutError"
          ? "Google's revocation endpoint did not respond in time."
          : "Google's revocation endpoint could not be reached.");
      }
      await drainBoundedBody(response, limits.responseBytes);
      if (!response.ok) {
        throw new OAuthRevocationError("http-error", `Google's revocation endpoint returned status ${response.status}.`);
      }
    },
  };
};

/**
 * Microsoft's honest client: it never makes a network call, because no public per-token revoke
 * endpoint exists to call — see this module's top comment. It exists so the vault can register a
 * real revoker for Microsoft and report the distinct, honest `"not-supported"` outcome instead of
 * either fabricating an HTTP call or leaving the gap indistinguishable from "nobody wired this yet".
 */
export const createMicrosoftOAuthRevoker = (): OAuthProviderTokenRevoker => ({
  provider: "microsoft",
  async revoke() {
    throw new OAuthProviderRevocationNotSupportedError("microsoft" satisfies OAuthProviderId);
  },
});
