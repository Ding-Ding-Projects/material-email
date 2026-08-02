export const OAUTH_PROVIDER_IDS = ["google", "microsoft"] as const;

export type OAuthProviderId = (typeof OAUTH_PROVIDER_IDS)[number];

export type OAuthAuthorizationPhase =
  | "idle"
  | "preparing"
  | "opening-browser"
  | "waiting-for-callback"
  | "authorization-received"
  | "cancelled"
  | "timed-out"
  | "error";

export type OAuthAuthorizationFailure =
  | "provider-not-configured"
  | "callback-listener-failed"
  | "browser-open-failed"
  | "provider-denied"
  | "provider-error"
  | "callback-invalid";

export interface OAuthProviderAvailability {
  id: OAuthProviderId;
  name: string;
  configured: boolean;
}

/**
 * Renderer-safe OAuth state. This deliberately has no authorization URL,
 * callback state, PKCE verifier, authorization code, access token, or refresh
 * token field.
 */
export interface OAuthAuthorizationSnapshot {
  phase: OAuthAuthorizationPhase;
  provider: OAuthProviderId | null;
  expiresAt: string | null;
  failure: OAuthAuthorizationFailure | null;
  providers: OAuthProviderAvailability[];
}

export type OAuthTokenVaultFailure = "windows-only" | "encryption-unavailable" | "storage-failed";

export type OAuthTokenVaultProviderState = "unavailable" | "not-registered" | "empty" | "active" | "expired";

/**
 * Renderer-safe summary of one provider's Windows token-vault state. Token
 * values, ciphertext, account keys, scopes, provider errors, and file paths are
 * deliberately absent.
 */
export interface OAuthTokenVaultProviderSnapshot {
  id: OAuthProviderId;
  name: string;
  registered: boolean;
  state: OAuthTokenVaultProviderState;
  recordCount: number;
  generation: number;
  expiresAt: string | null;
  canClear: boolean;
  canRevoke: boolean;
}

/** Renderer-safe Windows safeStorage vault state. */
export interface OAuthTokenVaultSnapshot {
  protection: "windows-safe-storage";
  available: boolean;
  failure: OAuthTokenVaultFailure | null;
  providers: OAuthTokenVaultProviderSnapshot[];
}

export type OAuthSignInPhase = "exchanging" | "ready" | "failed";

/**
 * State of the token exchange that follows a completed browser round trip, distinct from
 * {@link OAuthAuthorizationSnapshot}'s phase machine — that one only covers getting a code; this one
 * covers turning it into tokens. Deliberately carries no access token, refresh token, or code: the
 * renderer learns only whether a freshly authorized sign-in is ready to attach to an account.
 */
export interface OAuthSignInSnapshot {
  provider: OAuthProviderId;
  phase: OAuthSignInPhase;
  failure: string | null;
}

export type OAuthRemoteRevocationOutcome = "not-needed" | "not-available" | "succeeded" | "failed";

/** Result of a provider-level clear or revoke-and-clear request. */
export interface OAuthTokenVaultActionResult {
  provider: OAuthProviderId;
  localRecordsCleared: number;
  remoteRevocation: OAuthRemoteRevocationOutcome;
  snapshot: OAuthTokenVaultSnapshot;
}
