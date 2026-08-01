import { describe, expect, it } from "vitest";
import {
  MESSAGE_CRYPTO_CAPABILITIES,
  MESSAGE_CRYPTO_LIMITS,
  assessMessageCryptography,
  parseMessageCryptoIdentityMetadata,
  parseMessageCryptoProfile,
  parseMessageCryptographyAssessment,
  unsignedMessageCryptography,
} from "../src/shared/message-cryptography";

const openPgpIdentity = (overrides: Record<string, unknown> = {}) => ({
  id: "openpgp-primary",
  protocol: "openpgp",
  email: "USER@Example.Test",
  displayName: "Local OpenPGP metadata",
  fingerprint: "0123 4567 89AB CDEF 0123 4567 89AB CDEF 0123 4567",
  expiresAt: "2028-01-02T03:04:05-05:00",
  trust: "unverified",
  source: "local-metadata",
  secretStorage: "none",
  ...overrides,
});

describe("bounded message cryptography metadata", () => {
  it("advertises container detection while every cryptographic operation remains unsupported", () => {
    expect(MESSAGE_CRYPTO_CAPABILITIES.map(item => item.protocol)).toEqual(["openpgp", "smime"]);
    for (const capability of MESSAGE_CRYPTO_CAPABILITIES) {
      expect(capability).toMatchObject({
        containerDetection: "available",
        identityMetadata: "validated-only",
        signing: "unsupported",
        encryption: "unsupported",
        verification: "unsupported",
        decryption: "unsupported",
      });
    }
  });

  it("normalizes bounded public OpenPGP and S/MIME identity metadata without adding secret storage", () => {
    const profile = parseMessageCryptoProfile({
      schemaVersion: 1,
      identities: [
        openPgpIdentity(),
        {
          id: "smime-primary",
          protocol: "smime",
          email: "certificate@example.test",
          displayName: "Local S/MIME metadata",
          fingerprint: "ab:".repeat(31) + "ab",
          trust: "unverified",
          source: "local-metadata",
          secretStorage: "none",
        },
      ],
    });

    expect(profile.identities[0]).toMatchObject({
      email: "user@example.test",
      fingerprint: "0123456789ABCDEF0123456789ABCDEF01234567",
      expiresAt: "2028-01-02T08:04:05.000Z",
      trust: "unverified",
      secretStorage: "none",
    });
    expect(profile.identities[1]?.fingerprint).toBe("AB".repeat(32));
  });

  it("rejects private material, plaintext secret claims, and verified identity claims", () => {
    expect(() => parseMessageCryptoIdentityMetadata(openPgpIdentity({ privateKey: "fixture-private-key" }))).toThrow(/unsupported field/i);
    expect(() => parseMessageCryptoIdentityMetadata(openPgpIdentity({ passphrase: "fixture-passphrase" }))).toThrow(/unsupported field/i);
    expect(() => parseMessageCryptoIdentityMetadata(openPgpIdentity({ secretStorage: "plaintext" }))).toThrow(/cannot store or reference/i);
    expect(() => parseMessageCryptoIdentityMetadata(openPgpIdentity({ trust: "verified" }))).toThrow(/cannot claim cryptographic verification/i);
  });

  it("bounds identity fan-out and requires unique identifiers and protocol fingerprints", () => {
    expect(() => parseMessageCryptoProfile({
      schemaVersion: 1,
      identities: Array.from({ length: MESSAGE_CRYPTO_LIMITS.identityCount + 1 }, (_, index) => openPgpIdentity({ id: `identity-${index}` })),
    })).toThrow(/at most 16 identities/i);
    expect(() => parseMessageCryptoProfile({ schemaVersion: 1, identities: [openPgpIdentity(), openPgpIdentity()] })).toThrow(/identifiers must be unique/i);
    expect(() => parseMessageCryptoProfile({
      schemaVersion: 1,
      identities: [openPgpIdentity(), openPgpIdentity({ id: "different-id", email: "other@example.test" })],
    })).toThrow(/fingerprints must be unique/i);
  });
});

describe("local MIME trust-state assessment", () => {
  it("marks ordinary mail unsigned and does not let an inner attachment label upgrade the top-level state", () => {
    expect(assessMessageCryptography("From: sender@example.test\r\nSubject: Ordinary\r\n\r\nHello")).toEqual(unsignedMessageCryptography());
    expect(assessMessageCryptography([
      "Content-Type: multipart/mixed; boundary=outer",
      "",
      "--outer",
      "Content-Type: application/pgp-signature",
      "",
      "not-a-signature",
      "--outer--",
    ].join("\r\n"))).toEqual(unsignedMessageCryptography());
  });

  it.each([
    {
      name: "OpenPGP",
      contentType: 'multipart/signed; protocol="application/pgp-signature"; boundary="signed"',
      protocol: "openpgp",
      reason: "openpgp-signed-container",
    },
    {
      name: "S/MIME",
      contentType: "application/pkcs7-mime; smime-type=signed-data; name=smime.p7m",
      protocol: "smime",
      reason: "smime-signed-container",
    },
  ])("marks a detected $name signature container unverified without claiming verification", ({ contentType, protocol, reason }) => {
    expect(assessMessageCryptography(`Content-Type: ${contentType}\r\n\r\nfixture`)).toEqual({
      protocol,
      container: "signed",
      state: "unverified",
      reason,
      signatureVerification: "not-performed",
      contentDecryption: "not-performed",
    });
  });

  it.each([
    {
      name: "OpenPGP",
      contentType: 'multipart/encrypted; protocol="application/pgp-encrypted"; boundary="encrypted"',
      protocol: "openpgp",
      reason: "openpgp-encrypted-container",
    },
    {
      name: "S/MIME",
      contentType: "application/pkcs7-mime; smime-type=enveloped-data; name=smime.p7m",
      protocol: "smime",
      reason: "smime-encrypted-container",
    },
  ])("marks a detected $name encrypted container unsupported without attempting decryption", ({ contentType, protocol, reason }) => {
    expect(assessMessageCryptography(`Content-Type: ${contentType}\r\n\r\nfixture`)).toEqual({
      protocol,
      container: "encrypted",
      state: "unsupported",
      reason,
      signatureVerification: "not-performed",
      contentDecryption: "not-performed",
    });
  });

  it("keeps unknown cryptographic containers unsupported instead of guessing trust", () => {
    expect(assessMessageCryptography("Content-Type: multipart/signed; protocol=application/vendor-signature\r\n\r\nfixture")).toMatchObject({
      protocol: null,
      container: "unknown",
      state: "unsupported",
      reason: "unknown-cryptographic-container",
    });
  });

  it("rejects persisted assessment objects that add fields or claim a verified result", () => {
    const unsigned = unsignedMessageCryptography();
    expect(parseMessageCryptographyAssessment(unsigned)).toEqual(unsigned);
    expect(() => parseMessageCryptographyAssessment({ ...unsigned, state: "verified" })).toThrow(/inconsistent or unverified trust claim/i);
    expect(() => parseMessageCryptographyAssessment({ ...unsigned, signer: "someone@example.test" })).toThrow(/unsupported field/i);
  });
});
