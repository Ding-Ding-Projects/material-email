/**
 * Reads real OAuth provider registration from the environment rather than ever hardcoding a client
 * ID in source. A public client ID is not confidential, but this project's source is public, and an
 * ID baked into it would be tied to whichever build published it forever with no way to rotate it.
 *
 * Only Microsoft is resolved here. Google's authorization request would additionally need
 * access_type=offline (and often prompt=consent) to receive a refresh token at all, a
 * provider-specific quirk this module does not yet handle, so registering a Google client ID today
 * would silently produce a client that can sign in but can never stay connected. Google stays
 * unconfigured until that is built and tested.
 */

export const MICROSOFT_OAUTH_SCOPES = Object.freeze([
  "https://outlook.office.com/IMAP.AccessAsUser.All",
  "https://outlook.office.com/SMTP.Send",
  "offline_access",
]);

export interface MicrosoftOAuthConfig {
  provider: "microsoft";
  clientId: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  scopes: readonly string[];
}

const CLIENT_ID_LIMIT = 512;

/** True when every character is printable ASCII/Unicode with no whitespace and no control character. */
const isBoundedSingleLine = (value: string, limit: number): boolean => {
  if (value.length === 0 || value.length > limit) return false;
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code <= 0x20 || code === 0x7f) return false;
  }
  return true;
};

/** Microsoft tenant is "common", "organizations", "consumers", or a GUID/verified domain, never free text. */
const isPlainTenant = (value: string): boolean => /^[A-Za-z0-9][A-Za-z0-9.-]{0,98}[A-Za-z0-9]$/.test(value);

export class OAuthProviderConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OAuthProviderConfigError";
  }
}

/**
 * Returns null when no client ID is configured (the default: OAuth stays a disabled foundation).
 * Throws only when a value IS present but malformed, so a typo in an environment variable fails
 * loudly at startup rather than silently leaving sign-in disabled with no explanation.
 */
export const resolveMicrosoftOAuthConfig = (env: Readonly<Record<string, string | undefined>>): MicrosoftOAuthConfig | null => {
  const rawClientId = env.MATERIAL_EMAIL_MICROSOFT_CLIENT_ID;
  const clientId = rawClientId ? rawClientId.trim() : "";
  if (!clientId) return null;
  if (!isBoundedSingleLine(clientId, CLIENT_ID_LIMIT)) {
    throw new OAuthProviderConfigError("MATERIAL_EMAIL_MICROSOFT_CLIENT_ID must be a single bounded line with no whitespace or control characters.");
  }
  const rawTenant = env.MATERIAL_EMAIL_MICROSOFT_TENANT;
  const tenant = (rawTenant ? rawTenant.trim() : "") || "common";
  if (!isPlainTenant(tenant)) {
    throw new OAuthProviderConfigError('MATERIAL_EMAIL_MICROSOFT_TENANT must be "common", "organizations", "consumers", or a plain tenant ID/domain.');
  }
  return {
    provider: "microsoft",
    clientId,
    authorizationEndpoint: "https://login.microsoftonline.com/" + tenant + "/oauth2/v2.0/authorize",
    tokenEndpoint: "https://login.microsoftonline.com/" + tenant + "/oauth2/v2.0/token",
    scopes: MICROSOFT_OAUTH_SCOPES,
  };
};
