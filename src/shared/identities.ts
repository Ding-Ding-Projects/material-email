import type { Address, ComposeDraft } from "./contracts.js";

export const IDENTITY_LIMIT_PER_ACCOUNT = 20;
export const IDENTITY_NAME_LIMIT = 120;
export const IDENTITY_SIGNATURE_LIMIT = 8_192;
export const IDENTITY_ORGANIZATION_LIMIT = 200;

/** The separator RFC 3676 gives for a signature block, so quoting clients can strip it. */
export const SIGNATURE_SEPARATOR = "-- ";

export type SignaturePlacement = "below-body" | "below-quote";

export interface MailIdentity {
  id: string;
  accountId: string;
  displayName: string;
  email: string;
  replyTo: string;
  organization: string;
  signature: string;
  signaturePlacement: SignaturePlacement;
  isDefault: boolean;
  ordinal: number;
}

export interface MailIdentityInput {
  id?: string;
  accountId: string;
  displayName: string;
  email: string;
  replyTo?: string;
  organization?: string;
  signature?: string;
  signaturePlacement?: SignaturePlacement;
  isDefault?: boolean;
}

export class MailIdentityError extends Error {
  readonly code:
    | "IDENTITY_NAME_REQUIRED"
    | "IDENTITY_EMAIL_INVALID"
    | "IDENTITY_REPLY_TO_INVALID"
    | "IDENTITY_LIMIT_REACHED"
    | "IDENTITY_NOT_FOUND"
    | "IDENTITY_LAST_DEFAULT";

  constructor(code: MailIdentityError["code"], message: string) {
    super(message);
    this.name = "MailIdentityError";
    this.code = code;
  }
}

/**
 * Deliberately conservative: one `@`, a non-empty local part, and a dotted domain with no
 * whitespace or angle brackets. A stricter grammar would reject addresses real servers accept.
 */
const ADDRESS_PATTERN = /^[^\s@<>,;]+@[^\s@<>,;.]+(?:\.[^\s@<>,;.]+)+$/u;

export const isMailAddress = (value: string): boolean => {
  const candidate = value.trim();
  return candidate.length > 0 && candidate.length <= 320 && ADDRESS_PATTERN.test(candidate);
};

/** Strips control characters other than the newline that a signature legitimately contains. */
const CONTROL_CHARACTERS = new RegExp("[\\x00-\\x08\\x0b-\\x1f\\x7f]", "gu");

export const normalizeIdentityText = (value: string, limit: number): string =>
  value.normalize("NFKC").replace(new RegExp("\\r\\n?", "gu"), "\n").replace(CONTROL_CHARACTERS, "").slice(0, limit).trim();

/**
 * The display name and organization become header values, so they keep no newline at all — only a
 * signature has a reason to contain one. Folding the newline to a space keeps the name readable
 * rather than silently joining two words.
 */
export const normalizeIdentityLine = (value: string, limit: number): string =>
  normalizeIdentityText(value, limit).replace(new RegExp("\\s*\\n\\s*", "gu"), " ").slice(0, limit).trim();

export const sortIdentities = (identities: readonly MailIdentity[]): MailIdentity[] =>
  [...identities].sort((left, right) =>
    Number(right.isDefault) - Number(left.isDefault)
    || left.ordinal - right.ordinal
    || left.displayName.localeCompare(right.displayName)
    || left.id.localeCompare(right.id),
  );

export const identitiesForAccount = (identities: readonly MailIdentity[], accountId: string): MailIdentity[] =>
  sortIdentities(identities.filter(identity => identity.accountId === accountId));

export const defaultIdentityFor = (identities: readonly MailIdentity[], accountId: string): MailIdentity | null =>
  identitiesForAccount(identities, accountId)[0] ?? null;

export const validateIdentityInput = (input: MailIdentityInput): void => {
  if (!normalizeIdentityLine(input.displayName, IDENTITY_NAME_LIMIT)) {
    throw new MailIdentityError("IDENTITY_NAME_REQUIRED", "An identity needs a display name.");
  }
  if (!isMailAddress(input.email)) {
    throw new MailIdentityError("IDENTITY_EMAIL_INVALID", "An identity needs a valid email address.");
  }
  const replyTo = input.replyTo?.trim() ?? "";
  if (replyTo && !isMailAddress(replyTo)) {
    throw new MailIdentityError("IDENTITY_REPLY_TO_INVALID", "The reply-to address is not a valid email address.");
  }
};

export const buildIdentity = (
  existing: readonly MailIdentity[],
  input: MailIdentityInput,
  newId: () => string,
): MailIdentity[] => {
  validateIdentityInput(input);
  const forAccount = identitiesForAccount(existing, input.accountId);
  const current = input.id ? existing.find(identity => identity.id === input.id) : undefined;
  if (input.id && !current) throw new MailIdentityError("IDENTITY_NOT_FOUND", "That identity no longer exists.");
  if (!current && forAccount.length >= IDENTITY_LIMIT_PER_ACCOUNT) {
    throw new MailIdentityError("IDENTITY_LIMIT_REACHED", `An account keeps at most ${IDENTITY_LIMIT_PER_ACCOUNT} identities.`);
  }

  // The first identity on an account is always the default; there is no "no identity" state.
  const isDefault = input.isDefault ?? current?.isDefault ?? forAccount.length === 0;
  const identity: MailIdentity = {
    id: current?.id ?? newId(),
    accountId: input.accountId,
    displayName: normalizeIdentityLine(input.displayName, IDENTITY_NAME_LIMIT),
    email: input.email.trim(),
    replyTo: input.replyTo?.trim() ?? "",
    organization: normalizeIdentityLine(input.organization ?? "", IDENTITY_ORGANIZATION_LIMIT),
    signature: normalizeIdentityText(input.signature ?? "", IDENTITY_SIGNATURE_LIMIT),
    signaturePlacement: input.signaturePlacement ?? current?.signaturePlacement ?? "below-body",
    isDefault: forAccount.length === 0 ? true : isDefault,
    ordinal: current?.ordinal ?? forAccount.reduce((highest, item) => Math.max(highest, item.ordinal), -1) + 1,
  };

  const others = existing.filter(item => item.id !== identity.id);
  // Exactly one default per account.
  const normalized = identity.isDefault
    ? others.map(item => (item.accountId === identity.accountId ? { ...item, isDefault: false } : item))
    : others;
  const next = [...normalized, identity];
  const accountIdentities = next.filter(item => item.accountId === identity.accountId);
  if (!accountIdentities.some(item => item.isDefault)) {
    const first = sortIdentities(accountIdentities)[0];
    if (first) return next.map(item => (item.id === first.id ? { ...item, isDefault: true } : item));
  }
  return next;
};

export const removeIdentity = (existing: readonly MailIdentity[], id: string): MailIdentity[] => {
  const identity = existing.find(candidate => candidate.id === id);
  if (!identity) throw new MailIdentityError("IDENTITY_NOT_FOUND", "That identity no longer exists.");
  const remaining = existing.filter(candidate => candidate.id !== id);
  const siblings = remaining.filter(candidate => candidate.accountId === identity.accountId);
  if (identity.isDefault && siblings.length === 0) {
    throw new MailIdentityError("IDENTITY_LAST_DEFAULT", "An account keeps at least one identity.");
  }
  if (!identity.isDefault || !siblings.length) return remaining;
  const promoted = sortIdentities(siblings)[0];
  return remaining.map(candidate => (candidate.id === promoted?.id ? { ...candidate, isDefault: true } : candidate));
};

const addressSet = (addresses: readonly Address[]): Set<string> =>
  new Set(addresses.map(entry => entry.address.trim().toLocaleLowerCase("en-US")).filter(Boolean));

/**
 * Picks the identity a reply should come from: the one the message was actually addressed to,
 * checking To before Cc, and falling back to the account default.
 */
export const identityForReply = (
  identities: readonly MailIdentity[],
  accountId: string,
  message: { to: readonly Address[]; cc: readonly Address[]; replyTo?: readonly Address[] } | null,
): MailIdentity | null => {
  const candidates = identitiesForAccount(identities, accountId);
  if (!candidates.length) return null;
  if (!message) return candidates[0] ?? null;
  for (const bucket of [message.to, message.cc]) {
    const addresses = addressSet(bucket);
    const matched = candidates.find(identity => addresses.has(identity.email.toLocaleLowerCase("en-US")));
    if (matched) return matched;
  }
  return defaultIdentityFor(identities, accountId);
};

/**
 * Resolves the identity a draft should send from. An identity id that belongs to another account
 * is ignored rather than honoured, so a stale draft cannot send From an unrelated account.
 */
export const resolveIdentity = (
  identities: readonly MailIdentity[],
  accountId: string,
  identityId: string | undefined,
): MailIdentity | null => {
  const candidates = identitiesForAccount(identities, accountId);
  if (!candidates.length) return null;
  const requested = identityId ? candidates.find(identity => identity.id === identityId) : undefined;
  return requested ?? defaultIdentityFor(identities, accountId);
};

export const identitySender = (identity: MailIdentity): Address => ({ name: identity.displayName, address: identity.email });

/** The Reply-To header is only worth writing when it actually differs from the From address. */
export const identityReplyTo = (identity: MailIdentity): Address | null => {
  const replyTo = identity.replyTo.trim();
  if (!replyTo || replyTo.toLocaleLowerCase("en-US") === identity.email.trim().toLocaleLowerCase("en-US")) return null;
  return { name: identity.displayName, address: replyTo };
};

const signatureBlock = (signature: string): string => `\n${SIGNATURE_SEPARATOR}\n${signature}`;

/**
 * Removes a signature already in the body.
 *
 * `previousSignature` is authoritative when the caller supplies it, including as an empty string,
 * which asserts that nothing was applied and therefore nothing may be cut. The exact block is the
 * only safe thing to remove: the separator marks where a signature starts and never where it ends,
 * so cutting from it to the end of the body takes whatever follows — quoted material, or a
 * forwarded message that carries its own separator — along with it.
 *
 * `undefined` means the caller genuinely does not know. Only then is the bare separator trusted,
 * and a caller in that position is accepting that a body containing someone else's separator will
 * be truncated. Every caller in this application supplies the value.
 */
const stripSignature = (body: string, previousSignature: string | undefined): string => {
  if (previousSignature !== undefined) {
    const previous = previousSignature.trim();
    if (!previous) return body;
    const block = signatureBlock(previous);
    const index = body.lastIndexOf(block);
    return index >= 0 ? `${body.slice(0, index)}${body.slice(index + block.length)}` : body;
  }
  const marker = `\n${SIGNATURE_SEPARATOR}\n`;
  const index = body.lastIndexOf(marker);
  return index >= 0 ? body.slice(0, index) : body;
};

export interface SignatureApplication {
  text: string;
  applied: boolean;
}

export interface RecoveredSignaturePlacement {
  /** The signature found in the body, or empty when none of these identities' signatures is there. */
  signature: string;
  /** The first line after the signature block, so a replacement lands where the old one sat. */
  quoteMarker: string | null;
}

/**
 * Works out which signature is already sitting in a body by matching the account's own identities
 * against it. A draft reopened from disk carries no record of what was applied, and the separator
 * alone cannot answer it — a body that merely quotes a signed message has one too.
 */
export const recoverSignaturePlacement = (
  body: string,
  identities: readonly MailIdentity[],
): RecoveredSignaturePlacement => {
  let found = { signature: "", index: -1 };
  for (const identity of identities) {
    const signature = identity.signature.trim();
    if (!signature) continue;
    const block = signatureBlock(signature);
    const index = body.indexOf(block);
    if (index < 0) continue;
    // A block appearing twice cannot be told apart from a copy inside quoted or forwarded material,
    // and cutting the wrong one edits someone else's message. Decline instead: the next signature
    // is appended rather than replaced, which is visible and recoverable, unlike a silent edit.
    if (body.indexOf(block, index + block.length) >= 0) return { signature: "", quoteMarker: null };
    // A longer match wins, because one signature can be a prefix of another.
    if (signature.length > found.signature.length) found = { signature, index };
  }
  if (found.index < 0) return { signature: "", quoteMarker: null };
  const after = body.slice(found.index + signatureBlock(found.signature).length);
  return { signature: found.signature, quoteMarker: after.split("\n").find(line => line.trim().length > 0) ?? null };
};

/**
 * Where quoted material starts. A number is an index into the body *after* the previous signature
 * has been removed; a string is the quote's first line, located after removal. Prefer the string:
 * an index measured before the strip is off by the length of whatever was cut, which lands the new
 * signature inside the quote.
 */
export type QuotePosition = number | string | null;

const quoteIndexIn = (stripped: string, quotedFrom: QuotePosition): number | null => {
  if (quotedFrom === null) return null;
  if (typeof quotedFrom === "number") return quotedFrom > stripped.length ? null : quotedFrom;
  const index = stripped.indexOf(quotedFrom);
  return index >= 0 ? index : null;
};

/**
 * Places the identity's signature in a compose body, replacing any signature already there so
 * switching identities does not stack two of them. `below-body` inserts before quoted material and
 * `below-quote` appends after everything.
 */
export const applySignature = (
  body: string,
  identity: MailIdentity | null,
  quotedFrom: QuotePosition = null,
  previousSignature?: string,
): SignatureApplication => {
  const stripped = stripSignature(body, previousSignature);
  const signature = identity?.signature.trim() ?? "";
  if (!signature) return { text: stripped, applied: false };
  const block = signatureBlock(signature);
  const quoteIndex = quoteIndexIn(stripped, quotedFrom);
  if (identity?.signaturePlacement === "below-quote" || quoteIndex === null) {
    return { text: `${stripped}${block}`, applied: true };
  }
  return { text: `${stripped.slice(0, quoteIndex).replace(/\s+$/u, "")}${block}\n\n${stripped.slice(quoteIndex)}`, applied: true };
};

export const applyIdentityToDraft = (
  draft: ComposeDraft,
  identity: MailIdentity | null,
  quotedFrom: QuotePosition = null,
  previousSignature?: string,
): ComposeDraft => {
  const signed = applySignature(draft.text, identity, quotedFrom, previousSignature);
  return { ...draft, text: signed.text };
};
