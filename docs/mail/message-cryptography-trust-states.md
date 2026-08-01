# Message cryptography trust states

## Status

**Verified bounded metadata-only foundation.** Material Email can validate a small public identity-metadata profile and classify supported top-level OpenPGP/S/MIME MIME container labels as **unsigned**, **unverified**, or **unsupported**. It does not sign, encrypt, decrypt, verify, import keys, use certificates, or prove provider interoperability.

## Behavior

- Both OpenPGP and S/MIME advertise bounded top-level container detection and validated-only identity metadata. Signing, encryption, signature verification, and decryption are explicitly `unsupported`.
- Ordinary messages receive an `unsigned` assessment. A supported signature container receives `unverified`; the assessment also records that signature verification and content decryption were not performed.
- Supported encrypted containers and unknown cryptographic containers receive `unsupported`. No fallback body is described as authenticated or decrypted.
- The reader exposes the state in an accessible English, playful Hong Kong-style Cantonese, or bilingual region. Copy distinguishes local header assessment from proof of sender identity or integrity.
- Compose always shows `unsigned` because the existing SMTP path does not apply OpenPGP or S/MIME. It offers no misleading sign/encrypt control.
- Stored identity metadata is limited to an identifier, protocol, email, display label, normalized public fingerprint, optional expiry, an `unverified` trust literal, a local-metadata source literal, and `secretStorage: "none"`.

Top-level detection is intentionally conservative. An inner signature attachment inside an ordinary multipart message does not upgrade the message trust state.

## Configuration

There is no key, certificate, provider, or identity-configuration UI in this foundation. Existing accounts migrate to a version-1 profile containing no identities. The validator accepts at most 16 records; OpenPGP fingerprints contain 40 or 64 hexadecimal characters and S/MIME fingerprints contain a 64-character SHA-256 hexadecimal value.

Unknown fields are rejected. In particular, private keys, passphrases, plaintext secrets, keyring objects, provider handles, and a `verified` trust claim are not accepted by the profile or persisted-state schema.

## Failure modes

- Malformed, oversized, duplicate, secret-bearing, or verified-claiming identity metadata is rejected before persistence.
- An inconsistent stored message assessment is rejected rather than rendered as a stronger state.
- An unknown cryptographic top-level MIME container is labelled `unsupported`; the app does not guess a protocol or signer.
- Header-only detection can identify a container label but cannot establish whether its bytes are genuine, intact, decryptable, or bound to the displayed sender.

## Security considerations

Container detection is not cryptographic verification. A malicious message can write a MIME label, so `unverified` is a warning rather than a trust endorsement. No new IPC operation exists, and no key or secret material crosses the preload bridge. The JSON schema accepts only bounded public metadata and literal `secretStorage: "none"`; existing account passwords remain separately protected by Windows-backed Electron `safeStorage`.

Real signing/encryption requires an audited cryptographic library, reviewed key lifecycle and OS-backed secret storage, revocation and expiry handling, canonicalization/interoperability tests, and explicit user decisions. None of those are implied by this foundation.

## Verification

- Focused unit/parser/persistence run: `npx vitest run tests/message-cryptography.test.ts tests/mail-parser.test.ts tests/persisted-state.test.ts` — 3 files / 29 tests passed.
- Focused real-Electron run: `npx playwright test tests/e2e/message-cryptography.spec.ts` after `npm run build` — 1 / 1 scenario passed. It covers all three states, bilingual reader/compose copy, absence of sign/encrypt controls, and absence of cryptographic-secret field names in the persisted demo state.
- TypeScript contract: `npm run typecheck` passed.

These are local development checks, not audited cryptography, provider interoperability, packaged accessibility certification, or clean-machine release proof.

## Suggested articles

- [Reading and message safety](reading-and-message-safety.md)
- [Compose, drafts, and sending](compose-drafts-and-sending.md)
- [Security boundaries](../architecture/security-boundaries.md)
- [Local state and history](../data/local-state-and-history.md)
