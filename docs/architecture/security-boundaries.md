# Security boundaries

## Status

**Partly verified.** Focused regression coverage includes message sanitization, IPC sender and payload boundaries, local-file authorization, transport cleanup, and persistence recovery behavior. Final consolidated verification and a complete Electron, mail-protocol, attachment-content, and cryptographic review remain open.

## Behavior

The application divides trust into four layers:

1. The renderer presents data but cannot call Node.js directly.
2. The preload exposes a fixed typed API.
3. Every IPC operation first authenticates the current main window's `WebContents`, requires its top frame, and matches its exact trusted renderer URL/path. The main process then validates every non-PIM IPC argument with strict, bounded schemas, performs network and file operations, and strips secrets from public account summaries. PIM calls use the same sender gate before continuing through the PIM service's own strict schemas.
4. Remote mail servers, messages, attachments, configuration XML, links, filenames, and imported/exported content are untrusted inputs.

Account secrets are encrypted with Electron `safeStorage` before the JSON state file is written. Message MIME is parsed in the main process. HTML bodies are reduced to an allowlist; scripts, styles, images, event handlers, frames, forms, and unsafe schemes are removed. The reader builds a separate document with a restrictive content-security policy.

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
- Keeping HTTP(S) links does not make their destinations trustworthy.
- Attachment contents can still be malicious even when filenames are normalized.
- Regex risk detection is heuristic and not a hard execution timeout.
- OAuth-labeled credentials are currently token inputs, not a verified browser authorization lifecycle.
- A stale window, child frame, or unexpected renderer location cannot invoke a handler; replacing the main window also invalidates the old sender.

## Security considerations

Do not enable plaintext transport by default. Add clear warnings before allowing it. Attachment saving needs scanner/quarantine integration, risky-extension warnings, MIME-versus-extension checks, and provenance. Message links need phishing and look-alike-domain treatment. Future OAuth must use a system-browser flow, PKCE where applicable, state/nonce validation, strict redirect handling, scoped tokens, rotation, and revocation.

The local Git history validates snapshots before commit and accepts restores only from commits in the current append-only lineage. Credentials remain ciphertext, but access permissions, stable encryption identifiers, restore migrations, and repository-retention behavior require continuing review.

## Verification

The final local gate passed 22 files / 96 tests. Coverage includes active/remote HTML removal, MIME metadata, authentication of every IPC channel's sender/frame/location, denial of a real second `WebContents`, denial of a cross-origin development redirect, trusted-location gating for mailto delivery, bounded runtime payload validation, attachment/editor path authorization, serialized state writes, corruption recovery, snapshot validation, and local-revision identifiers. No penetration test, malicious attachment-content matrix, live certificate failure matrix, OAuth audit, OpenPGP/S/MIME review, or clean-machine privacy audit has been completed.

## Suggested articles

- [Reading and message safety](../mail/reading-and-message-safety.md)
- [Accounts and connectivity](../mail/accounts-and-connectivity.md)
- [Local state and history](../data/local-state-and-history.md)
