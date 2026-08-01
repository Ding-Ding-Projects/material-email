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
