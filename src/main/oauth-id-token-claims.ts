/**
 * Decodes exactly the two non-secret claims this app uses to prefill the Add Account form's email
 * and display-name fields from a Microsoft ID token (a JWT) - nothing more.
 *
 * This is a prefill convenience only, NOT an authentication or identity assertion. The token's
 * signature is never checked here: this module reads the payload segment's JSON and nothing else,
 * so a misbehaving or hostile token endpoint could in principle put any string in these fields. The
 * mail account itself is still proven only by an actual IMAP/SMTP login using the separately
 * obtained access token, exactly as before this module existed. Nothing here should ever be used
 * to decide who is signed in, to authorize an action, or to skip a real credential check.
 *
 * The raw ID token string is read once, right here, to reach these two fields. It is never
 * returned, logged, or persisted by this module or its caller - only the two bounded, plain-text
 * claim values below leave this function, and every other claim in the token is discarded with it.
 */

export interface OAuthIdTokenAccountHint {
  email: string | null;
  displayName: string | null;
}

/** A real ID token is a compact JWT; this is generous enough for one while refusing to parse arbitrary input. */
const MAX_ID_TOKEN_LENGTH = 16_384;
/** Bounds a single decoded claim value - an email address or display name never legitimately exceeds this. */
const MAX_CLAIM_LENGTH = 320;

interface RawIdTokenClaims {
  email?: unknown;
  preferred_username?: unknown;
  name?: unknown;
}

/** A plain, printable, single-line string, or null - refuses anything that could smuggle control characters into a form field. */
const boundedClaimString = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_CLAIM_LENGTH) return null;
  for (const char of trimmed) {
    const code = char.codePointAt(0) ?? 0;
    if (code <= 0x1f || code === 0x7f) return null;
  }
  return trimmed;
};

/**
 * Extracts `email` (falling back to `preferred_username`, Microsoft's own alternative for accounts
 * without a verified `email` claim) and `name` from a JWT's payload segment, without verifying its
 * signature. Returns null for anything missing, oversized, malformed, or unparseable rather than
 * throwing - a decode failure here must never block or fail the sign-in it merely decorates.
 */
export const decodeOAuthIdTokenAccountHint = (idToken: string): OAuthIdTokenAccountHint | null => {
  if (typeof idToken !== "string" || !idToken || idToken.length > MAX_ID_TOKEN_LENGTH) return null;
  const segments = idToken.split(".");
  if (segments.length !== 3) return null;
  const payloadSegment = segments[1];
  if (!payloadSegment) return null;
  let claims: RawIdTokenClaims;
  try {
    const json = Buffer.from(payloadSegment, "base64url").toString("utf8");
    const parsed: unknown = JSON.parse(json);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    claims = parsed as RawIdTokenClaims;
  } catch {
    return null;
  }
  const email = boundedClaimString(claims.email) ?? boundedClaimString(claims.preferred_username);
  const displayName = boundedClaimString(claims.name);
  if (!email && !displayName) return null;
  return { email, displayName };
};
