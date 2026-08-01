/**
 * Metadata-only message-cryptography foundation.
 *
 * This module intentionally performs no cryptographic operation. It recognizes a
 * small set of top-level MIME container labels and validates public identity
 * metadata. It never accepts key material, passphrases, provider handles, or a
 * claim that a signature was verified.
 */

export const MESSAGE_CRYPTO_LIMITS = Object.freeze({
  headerBytes: 64 * 1024,
  identityCount: 16,
  identityIdCharacters: 128,
  displayNameCharacters: 120,
  emailCharacters: 320,
  fingerprintInputCharacters: 191,
});

export type MessageCryptoProtocol = "openpgp" | "smime";
export type MessageCryptoTrustState = "unsigned" | "unverified" | "unsupported";
export type MessageCryptoContainer = "none" | "signed" | "encrypted" | "unknown";
export type MessageCryptoAssessmentReason =
  | "no-cryptographic-container"
  | "openpgp-signed-container"
  | "smime-signed-container"
  | "openpgp-encrypted-container"
  | "smime-encrypted-container"
  | "unknown-cryptographic-container";

export interface MessageCryptoCapability {
  protocol: MessageCryptoProtocol;
  containerDetection: "available";
  identityMetadata: "validated-only";
  signing: "unsupported";
  encryption: "unsupported";
  verification: "unsupported";
  decryption: "unsupported";
}

export const MESSAGE_CRYPTO_CAPABILITIES: readonly MessageCryptoCapability[] = Object.freeze([
  Object.freeze({
    protocol: "openpgp",
    containerDetection: "available",
    identityMetadata: "validated-only",
    signing: "unsupported",
    encryption: "unsupported",
    verification: "unsupported",
    decryption: "unsupported",
  }),
  Object.freeze({
    protocol: "smime",
    containerDetection: "available",
    identityMetadata: "validated-only",
    signing: "unsupported",
    encryption: "unsupported",
    verification: "unsupported",
    decryption: "unsupported",
  }),
]);

export interface MessageCryptoIdentityMetadata {
  id: string;
  protocol: MessageCryptoProtocol;
  email: string;
  displayName: string;
  fingerprint: string;
  expiresAt?: string;
  trust: "unverified";
  source: "local-metadata";
  secretStorage: "none";
}

export interface MessageCryptoProfile {
  schemaVersion: 1;
  identities: MessageCryptoIdentityMetadata[];
}

export interface MessageCryptographyAssessment {
  protocol: MessageCryptoProtocol | null;
  container: MessageCryptoContainer;
  state: MessageCryptoTrustState;
  reason: MessageCryptoAssessmentReason;
  signatureVerification: "not-performed";
  contentDecryption: "not-performed";
}

type PlainRecord = Record<string, unknown>;

const plainRecord = (value: unknown, label: string): PlainRecord => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a plain metadata object.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`${label} must be a plain metadata object.`);
  }
  return value as PlainRecord;
};

const exactKeys = (record: PlainRecord, keys: readonly string[], label: string): void => {
  const allowed = new Set(keys);
  if (Object.keys(record).some(key => !allowed.has(key))) {
    throw new Error(`${label} contains an unsupported field; cryptographic key material and secrets are never accepted.`);
  }
};

const boundedText = (value: unknown, maximum: number, label: string): string => {
  if (typeof value !== "string") throw new Error(`${label} must be text.`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new Error(`${label} is empty, too long, or contains a control character.`);
  }
  return normalized;
};

const protocolValue = (value: unknown): MessageCryptoProtocol => {
  if (value !== "openpgp" && value !== "smime") throw new Error("The identity protocol must be OpenPGP or S/MIME.");
  return value;
};

const normalizedEmail = (value: unknown): string => {
  const email = boundedText(value, MESSAGE_CRYPTO_LIMITS.emailCharacters, "Identity email").toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) throw new Error("Identity email metadata is not a bounded email address.");
  return email;
};

const normalizedFingerprint = (value: unknown, protocol: MessageCryptoProtocol): string => {
  const input = boundedText(value, MESSAGE_CRYPTO_LIMITS.fingerprintInputCharacters, "Identity fingerprint");
  const fingerprint = input.replace(/[\s:]/gu, "").toUpperCase();
  const allowedLengths = protocol === "openpgp" ? [40, 64] : [64];
  if (!/^[A-F0-9]+$/u.test(fingerprint) || !allowedLengths.includes(fingerprint.length)) {
    throw new Error(protocol === "openpgp"
      ? "OpenPGP fingerprint metadata must contain 40 or 64 hexadecimal characters."
      : "S/MIME fingerprint metadata must contain a 64-character SHA-256 hexadecimal value.");
  }
  return fingerprint;
};

const normalizedExpiry = (value: unknown): string | undefined => {
  if (value === undefined) return undefined;
  const input = boundedText(value, 64, "Identity expiry");
  const timestamp = Date.parse(input);
  if (!Number.isFinite(timestamp)) throw new Error("Identity expiry metadata must be an ISO-compatible timestamp.");
  return new Date(timestamp).toISOString();
};

export const parseMessageCryptoIdentityMetadata = (value: unknown): MessageCryptoIdentityMetadata => {
  const record = plainRecord(value, "Message cryptography identity");
  exactKeys(record, ["id", "protocol", "email", "displayName", "fingerprint", "expiresAt", "trust", "source", "secretStorage"], "Message cryptography identity");
  const protocol = protocolValue(record.protocol);
  if (record.trust !== "unverified") throw new Error("Identity metadata cannot claim cryptographic verification.");
  if (record.source !== "local-metadata") throw new Error("Identity metadata must use the local metadata source.");
  if (record.secretStorage !== "none") throw new Error("Identity metadata cannot store or reference secret key material.");
  const id = boundedText(record.id, MESSAGE_CRYPTO_LIMITS.identityIdCharacters, "Identity identifier");
  if (!/^[A-Za-z0-9._:-]+$/u.test(id)) throw new Error("Identity identifiers may contain only letters, digits, dot, underscore, colon, and hyphen.");
  const expiresAt = normalizedExpiry(record.expiresAt);
  return {
    id,
    protocol,
    email: normalizedEmail(record.email),
    displayName: boundedText(record.displayName, MESSAGE_CRYPTO_LIMITS.displayNameCharacters, "Identity display name"),
    fingerprint: normalizedFingerprint(record.fingerprint, protocol),
    ...(expiresAt ? { expiresAt } : {}),
    trust: "unverified",
    source: "local-metadata",
    secretStorage: "none",
  };
};

export const emptyMessageCryptoProfile = (): MessageCryptoProfile => ({ schemaVersion: 1, identities: [] });

export const parseMessageCryptoProfile = (value: unknown): MessageCryptoProfile => {
  const record = plainRecord(value, "Message cryptography profile");
  exactKeys(record, ["schemaVersion", "identities"], "Message cryptography profile");
  if (record.schemaVersion !== 1) throw new Error("Message cryptography profile version is unsupported.");
  if (!Array.isArray(record.identities) || record.identities.length > MESSAGE_CRYPTO_LIMITS.identityCount) {
    throw new Error(`Message cryptography profiles may contain at most ${MESSAGE_CRYPTO_LIMITS.identityCount} identities.`);
  }
  const identities = record.identities.map(parseMessageCryptoIdentityMetadata);
  const identifiers = new Set<string>();
  const fingerprints = new Set<string>();
  for (const identity of identities) {
    if (identifiers.has(identity.id)) throw new Error("Message cryptography identity identifiers must be unique.");
    const fingerprintKey = `${identity.protocol}:${identity.fingerprint}`;
    if (fingerprints.has(fingerprintKey)) throw new Error("Message cryptography fingerprints must be unique within a protocol.");
    identifiers.add(identity.id);
    fingerprints.add(fingerprintKey);
  }
  return { schemaVersion: 1, identities };
};

const assessmentForReason = (reason: MessageCryptoAssessmentReason): MessageCryptographyAssessment => {
  const common = { signatureVerification: "not-performed", contentDecryption: "not-performed" } as const;
  switch (reason) {
    case "no-cryptographic-container":
      return { protocol: null, container: "none", state: "unsigned", reason, ...common };
    case "openpgp-signed-container":
      return { protocol: "openpgp", container: "signed", state: "unverified", reason, ...common };
    case "smime-signed-container":
      return { protocol: "smime", container: "signed", state: "unverified", reason, ...common };
    case "openpgp-encrypted-container":
      return { protocol: "openpgp", container: "encrypted", state: "unsupported", reason, ...common };
    case "smime-encrypted-container":
      return { protocol: "smime", container: "encrypted", state: "unsupported", reason, ...common };
    case "unknown-cryptographic-container":
      return { protocol: null, container: "unknown", state: "unsupported", reason, ...common };
  }
};

export const unsignedMessageCryptography = (): MessageCryptographyAssessment =>
  assessmentForReason("no-cryptographic-container");

export const parseMessageCryptographyAssessment = (value: unknown): MessageCryptographyAssessment => {
  const record = plainRecord(value, "Message cryptography assessment");
  exactKeys(record, ["protocol", "container", "state", "reason", "signatureVerification", "contentDecryption"], "Message cryptography assessment");
  const reasons: readonly MessageCryptoAssessmentReason[] = [
    "no-cryptographic-container",
    "openpgp-signed-container",
    "smime-signed-container",
    "openpgp-encrypted-container",
    "smime-encrypted-container",
    "unknown-cryptographic-container",
  ];
  if (typeof record.reason !== "string" || !reasons.includes(record.reason as MessageCryptoAssessmentReason)) {
    throw new Error("Message cryptography assessment reason is unsupported.");
  }
  const expected = assessmentForReason(record.reason as MessageCryptoAssessmentReason);
  if (Object.entries(expected).some(([key, expectedValue]) => record[key] !== expectedValue)) {
    throw new Error("Message cryptography assessment contains an inconsistent or unverified trust claim.");
  }
  return expected;
};

const boundedHeaderText = (source: string | Uint8Array): string => {
  if (typeof source === "string") return source.slice(0, MESSAGE_CRYPTO_LIMITS.headerBytes);
  return new TextDecoder("latin1").decode(source.slice(0, MESSAGE_CRYPTO_LIMITS.headerBytes));
};

const topLevelContentType = (source: string | Uint8Array): string => {
  const bounded = boundedHeaderText(source);
  const headerEndings = [bounded.indexOf("\r\n\r\n"), bounded.indexOf("\n\n"), bounded.indexOf("\r\r")].filter(index => index >= 0);
  const headerBlock = bounded.slice(0, headerEndings.length ? Math.min(...headerEndings) : bounded.length);
  const unfolded = headerBlock.replace(/\r\n[ \t]+|\n[ \t]+|\r[ \t]+/gu, " ");
  return /^content-type\s*:\s*([^\r\n]*)$/imu.exec(unfolded)?.[1]?.trim().toLowerCase() ?? "";
};

export const assessMessageCryptography = (source: string | Uint8Array): MessageCryptographyAssessment => {
  const contentType = topLevelContentType(source);
  const openPgpSigned = contentType.includes("multipart/signed") && contentType.includes("application/pgp-signature");
  const openPgpEncrypted = (contentType.includes("multipart/encrypted") && contentType.includes("application/pgp-encrypted"))
    || contentType.startsWith("application/pgp-encrypted");
  const smimeType = contentType.includes("application/pkcs7-") || contentType.includes("application/x-pkcs7-");
  const smimeSigned = (contentType.includes("multipart/signed")
      && (contentType.includes("application/pkcs7-signature") || contentType.includes("application/x-pkcs7-signature")))
    || (smimeType && contentType.includes("smime-type=signed-data"));
  const smimeEncrypted = smimeType && contentType.includes("smime-type=enveloped-data");

  if (openPgpSigned) return assessmentForReason("openpgp-signed-container");
  if (smimeSigned) return assessmentForReason("smime-signed-container");
  if (openPgpEncrypted) return assessmentForReason("openpgp-encrypted-container");
  if (smimeEncrypted) return assessmentForReason("smime-encrypted-container");
  if (contentType.includes("multipart/signed")
    || contentType.includes("multipart/encrypted")
    || contentType.startsWith("application/pgp-")
    || smimeType) {
    return assessmentForReason("unknown-cryptographic-container");
  }
  return unsignedMessageCryptography();
};

export const formatMessageCryptoFingerprint = (fingerprint: string): string =>
  fingerprint.replace(/(.{4})(?=.)/gu, "$1 ");
