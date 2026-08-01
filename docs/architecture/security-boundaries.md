# Security boundaries

## Status

**Partly verified.** Focused regression coverage includes message sanitization, IPC sender and payload boundaries, local-file authorization, transport cleanup, and persistence recovery behavior. Final consolidated verification and a complete Electron, mail-protocol, attachment-content, and cryptographic review remain open.

## Behavior

The application divides trust into four layers:

1. The renderer presents data but cannot call Node.js directly.
2. The preload exposes a fixed typed API.
3. Every IPC operation first authenticates the current main window's `WebContents`, requires its top frame, and matches its exact trusted renderer URL/path. The main process then validates every non-PIM IPC argument with strict, bounded schemas, performs network and file operations, and strips secrets from public account summaries. PIM calls use the same sender gate before continuing through the PIM service's own strict schemas.
4. Remote mail servers, messages, attachments, configuration XML, links, filenames, and imported/exported content are untrusted inputs.

Account secrets are encrypted with Electron `safeStorage` before the JSON state file is written. Message MIME is parsed in the main process behind fixed raw-source, header, decoded-body, attachment-count, per-attachment, and combined-attachment ceilings; IMAP requests at most the raw ceiling plus one detection byte. Oversized/malformed failures expose stable retry-safe copy and do not mutate the detail cache. HTML bodies are then reduced to a default image-free allowlist plus a separately sanitized HTTP(S)-image variant with normalized origin metadata. The reader builds an opaque sandboxed document with a restrictive content-security policy. Remote images remain absent until the user stores an explicit decision for that message; then only its listed image origins enter `img-src`, while scripts, forms, frames, objects, media, connections, base URLs, referrers, and same-origin access remain denied.

Attachment paths are capabilities, not renderer assertions. A path can enter a new compose draft only after the native file picker approves it. A saved draft may continue using its own previously approved attachment paths after restart, but changing the draft identifier does not transfer that approval. Sending also verifies that each authorized path still names a regular file.

External editor launch accepts only a real Windows `.exe` with an executable signature that either appears in the finite Windows detection pass or was explicitly selected in a native picker. Custom approvals are stored outside renderer-facing preferences. Launch uses an argument array with shell execution disabled.

## Configuration

- TLS and STARTTLS are supported for mail transports; a `plain` mode exists for explicit manual configurations.
- Renderer permissions are denied globally.
- In-app navigation and HTTP redirects are prevented. Unsolicited main-to-renderer mailto delivery is sent only while the top-level page still matches the trusted renderer location.
- External HTTP(S) links are handed to Windows.
- State and local revision data stay below Electron's per-user application-data directory.

## Failure modes

- `safeStorage` may be unavailable; account creation and secret decryption then fail closed.
- A corrupted or incompatible state file fails closed. A valid backup or interrupted-rename copy is promoted when available, while the corrupt original is quarantined; defaults are created only when no state or recovery material exists.
- Sanitization can remove legitimate message formatting.
- Local MIME ceilings can reject a server-valid message, and the bounded parser still lacks worker/process wall-time isolation.
- Loading a consented remote image can disclose network address and open timing. An HTTP warning is not certificate diagnostics, and certificate UX remains unimplemented.
- Keeping HTTP(S) links does not make their destinations trustworthy.
- Attachment contents can still be malicious even when filenames are normalized.
- Regex risk detection is heuristic and not a hard execution timeout.
- OAuth account setup no longer accepts a pasted token. An ephemeral main-process authorization-code/PKCE state machine validates an exact `127.0.0.1` callback and exposes status-only IPC, but production has no provider client registration or token exchange and cannot connect an OAuth account.
- A separate mock-only token lifecycle models exchange, expiry, refresh rotation, and revocation for tests/demo harnesses. Its AES-256-GCM vault is ephemeral and non-durable; production main, preload, IPC, and `AppService` do not import it. Its production storage stub refuses without provider registration and continues refusing until a reviewed Windows adapter exists.
- A stale window, child frame, or unexpected renderer location cannot invoke a handler; replacing the main window also invalidates the old sender.

## Security considerations

Do not enable plaintext transport by default. Add clear warnings before allowing it. Attachment quarantine now supplies risky-extension and MIME/extension classification, randomized local payload names, provenance, integrity checking, and explicit release/delete; antivirus/content scanning and external reputation remain open. Message links need phishing and look-alike-domain treatment. The OAuth authorization foundation uses a system-browser opener, PKCE S256, timing-safe state comparison, exact loopback redirect handling, bounded terminal cleanup, and no persistence/logging. The mock lifecycle proves state and encryption-contract behavior only. Provider registration, nonce/consent policy where applicable, real code exchange, scoped Windows-encrypted tokens, refresh rotation, revocation, and provider interoperability still require dedicated review.

The local Git history validates snapshots before commit and accepts restores only from commits in the current append-only lineage. Credentials remain ciphertext, but access permissions, stable encryption identifiers, restore migrations, and repository-retention behavior require continuing review.

## Verification

The final local test gate passed 36 files / 183 tests. Coverage includes bounded MIME fetches and parser output, malformed-header and unterminated-multipart cases, active HTML removal, default-deny and exact-origin remote-image handling, persisted allow/revoke state, authentication of every IPC channel's sender/frame/location, trusted-location gating for mailto delivery, bounded runtime payload validation, attachment/editor path authorization, serialized state writes, corruption recovery, snapshot validation, guarded local-revision retention, and read-only deletion evidence. Focused real-Electron consent/restart and bilingual scenarios previously passed 2 / 2; focused history retention and evidence passed 1 / 1. No penetration test, broad malformed-message or parser wall-time matrix, malicious attachment-content matrix, live image-server or certificate-failure matrix, OAuth audit, OpenPGP/S/MIME review, cryptographic-erasure proof, or clean-machine privacy audit has been completed.

## Suggested articles

- [Reading and message safety](../mail/reading-and-message-safety.md)
- [Accounts and connectivity](../mail/accounts-and-connectivity.md)
- [Local state and history](../data/local-state-and-history.md)
