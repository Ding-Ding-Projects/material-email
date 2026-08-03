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

/**
 * Microsoft's own documented redirect for a native/public client that captures the result by
 * having the user copy the resulting URL rather than running a listener. It needs no local port, no
 * listener, and nothing registered beyond this one exact string, which is why it is the default:
 * zero extra setup, and nothing about it can go stale or need re-registering.
 */
export const MICROSOFT_NATIVE_CLIENT_REDIRECT_URI = "https://login.microsoftonline.com/common/oauth2/nativeclient";

export interface MicrosoftOAuthConfig {
  provider: "microsoft";
  clientId: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  scopes: readonly string[];
  redirectUri: string;
}

const CLIENT_ID_LIMIT = 512;
const REDIRECT_URI_LIMIT = 2_048;

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
 * A redirect URI the user is asked to register in Azure exactly once, then never touch again.
 * Anything the user actually controls and can register works here — the Microsoft sentinel above,
 * a static page they host, or a stable tunnel URL (a Cloudflare named tunnel bound to their own
 * domain, for example) — as long as it does not change between sign-ins, since Azure AD matches a
 * registered redirect URI exactly and will refuse a value that no longer matches. A tunnel whose URL
 * changes on every run (a free "quick tunnel" with no fixed hostname) does not satisfy that and
 * would need re-registering before every sign-in, which defeats the point of registering it once.
 */
const requireCleanHttpsUrl = (value: string, limit: number, label: string): string => {
  if (!value || value.length > limit) throw new OAuthProviderConfigError(label + " must be a bounded HTTPS URL.");
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new OAuthProviderConfigError(label + " must be a valid URL.");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new OAuthProviderConfigError(label + " must be a clean HTTPS URL with no credentials, query, or fragment.");
  }
  return parsed.toString();
};

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
  const rawRedirectUri = env.MATERIAL_EMAIL_MICROSOFT_REDIRECT_URI;
  const redirectUri = rawRedirectUri && rawRedirectUri.trim()
    ? requireCleanHttpsUrl(rawRedirectUri.trim(), REDIRECT_URI_LIMIT, "MATERIAL_EMAIL_MICROSOFT_REDIRECT_URI")
    : MICROSOFT_NATIVE_CLIENT_REDIRECT_URI;
  return {
    provider: "microsoft",
    clientId,
    authorizationEndpoint: "https://login.microsoftonline.com/" + tenant + "/oauth2/v2.0/authorize",
    tokenEndpoint: "https://login.microsoftonline.com/" + tenant + "/oauth2/v2.0/token",
    scopes: MICROSOFT_OAUTH_SCOPES,
    redirectUri,
  };
};
