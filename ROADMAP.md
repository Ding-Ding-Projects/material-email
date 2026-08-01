# Material Email roadmap

This roadmap separates code that exists from behavior that has been verified. Ordering may change as evidence is collected.

## Foundation present

- [x] Windows-only Electron shell and typed preload contract
- [x] Renderer sandbox, context isolation, navigation denial, and permission denial
- [x] Packaged renderer isolation from `MATERIAL_EMAIL_DEV_URL` and strict unpackaged HTTP loopback URL validation
- [x] Development renderer redirect denial and trusted-location gating for unsolicited mailto delivery
- [x] Per-channel IPC sender authentication for the current main `WebContents`, top frame, and exact trusted renderer location
- [x] Windows-backed `safeStorage` encryption for persisted account secrets
- [x] Manual IMAP/SMTP account schema and connection tests
- [x] Ephemeral main-process OAuth authorization-code/PKCE state machine with exact loopback callback validation, timeout/cancel/error cleanup, status-only IPC, and no token exchange/persistence/logging
- [x] Bounded local certificate/hostname preflight with conventional TLS/STARTTLS port diagnostics, bilingual accessible errors, and a main-process no-connection guard
- [x] IMAP folder/message listing, message retrieval, flags, and moves
- [x] SMTP sending and local draft persistence
- [x] MIME parsing and conservative HTML sanitization
- [x] Bounded MIME fetch/parsing with raw-source, header, decoded-body, attachment-count, per-attachment, and combined-attachment ceilings plus stable retry-safe failures
- [x] Default-deny per-message remote-image consent with persisted allow/revoke, exact source summary, and scoped reader CSP
- [x] Demo account and fixture mail
- [x] Serialized atomic JSON persistence
- [x] Notification and history records
- [x] External-editor detection/opening foundation
- [x] Bounded JavaScript regex helper and focused tests
- [x] Advisory account autoconfiguration with manual fallback
- [x] Ordered pending mail operations and local outbox replay foundation
- [x] Fail-closed IMAP mutation/MOVE handling with destination UID/UIDVALIDITY remapping
- [x] Permanent all-recipient SMTP rejection accounting that retains the draft and exact rejected recipients
- [x] Account removal cleanup for live drafts, outbox entries, pending operations, and cache while preserving append-only history
- [x] Account-removal race protection for draft, send, synchronization, and cache completions
- [x] UIDVALIDITY-bound detail, attachment, flag, MOVE, and queued-operation handling
- [x] Compare-and-swap preservation for concurrent draft save and send completion
- [x] Attachment save/save-all with normalized collision-safe filenames
- [x] Persisted local quarantine for caution/dangerous attachments with randomized payload names, provenance, integrity metadata, and explicit release/delete
- [x] Isolated whole-state Git snapshot repository foundation
- [x] Contact and mailing-list CRUD with stable UIDs and append-only restore
- [x] Bounded conservative vCard 3.0/4.0 import and deterministic export
- [x] Local Home calendar, events, recurrence metadata, attendees, alarms, and tasks
- [x] Generation-based PIM persistence with validated recovery copies and cross-instance/process locking
- [x] Task refresh ordering that rejects stale or edit-overwriting results
- [x] Windows x64 NSIS packaging configuration

## Integration and verification now

- [x] Integrate the mail/settings/history/notifications/changelog/tools renderer with the preload API
- [x] Integrate Contacts, Mailing Lists, Calendar, Tasks, and PIM transaction history with typed preload/IPC operations
- [x] Give command-palette search its own plain-text-first model, adjacent anchored regex builder, invalid-pattern execution guard, and focused real-Electron proof
- [x] Add focused regression coverage for process/IPC trust, mail failure semantics, account cleanup, compose/PIM dirty baselines, discard focus, PIM load retry, bilingual semantics, and revision-aware no-op saves
- [x] Keep workspace-tab Arrow/Home/End navigation inside the semantic tablist with one roving tab stop and a non-clipped visible focus indicator, covered in real Electron
- [x] Run the consolidated type, unit, integration, and build verification (`npm run check`: 42 files / 207 tests on the current tree; the previously recorded Electron suite passed 15 / 15 scenarios, focused remote-content/bilingual passed 2 / 2, focused command-palette search passed 1 / 1, focused local connection preflight passed 1 / 1, focused explicit live TLS inspection passed 1 / 1, and focused history retention/deletion evidence passed 1 / 1)
- [ ] Exercise every user-visible path in a packaged Electron session
- [ ] Run the full keyboard, native screen-reader, focus, contrast, reduced-motion, narrow-width, and 100/125/150/200% scaling matrices (the primary workspace-tab Arrow/Home/End slice alone is verified)
- [ ] Verify all language modes and every English/Cantonese humor level without changing factual content
- [ ] Verify plain-text and regex search from every search surface, including invalid, Unicode, multiline, capture, zero-width, and adversarial cases (the command-palette literal/invalid/activation slice is verified)
- [ ] Test a real IMAP/SMTP account without exposing credentials or private messages in evidence
- [x] Add focused sandbox/CSP, navigation, HTML-sanitization, and IPC-surface boundary tests
- [ ] Expand adversarial IPC payload, malformed MIME, and phishing test matrices (focused oversized source/header/body, NUL-header, attachment-fan-out, decoded-attachment, and unterminated-multipart cases are verified; broad corpora and hard parser wall-time isolation remain open)
- [x] Prove a strict local NSIS baseline-to-candidate upgrade with both artifact hashes, installed smoke versions, same-directory replacement, uninstall, and unchanged isolated user-data hash
- [ ] Prove clean-machine/default-profile install, interactive first launch, upgrade, uninstall, retained data, signature posture, and artifact integrity for the exact release candidate

## Mail capabilities open

- [ ] Register and verify live OAuth providers, then implement reviewed token exchange, encrypted token storage/refresh rotation, revocation, scope/consent handling, account connection, and public-provider interoperability
- [ ] POP support
- [x] User-facing retry ceilings and conflict resolution for queued mail operations
- [x] Local cached Unified Inbox, Starred, and Unread views with account attribution, shared regex search, and stable composite selection
- [x] Bounded in-memory conversation grouping by normalized subject and cached message references
- [x] Ephemeral cached-mail plain/regex index with bounded results and account/folder/conversation attribution
- [ ] Server-complete all-account synchronization/threading and persistent scalable mail indexing
- [ ] Conversation threading and complete search indexing
- [x] Attachment risk classification and review-before-save warnings
- [x] Local attachment quarantine with reviewed batch routing and accessible bilingual release/delete decisions
- [ ] Antivirus or malware-content scanner integration and provider-backed reputation checks
- [x] Native Windows notifications with privacy controls (opt-in generic summaries)
- [x] Renderer/preload/IPC integration for contacts, mailing lists, calendars, tasks, vCard actions, and transaction recovery
- [ ] CardDAV/CalDAV/ICS/task-provider synchronization and broad interoperability
- [ ] OpenPGP and S/MIME signing/encryption with clear trust UX
- [x] Pure external-link risk assessment (HTTP, credentials, host and Unicode deception signals)
- [x] Phishing review dialog with normalized destination, risk reasons, one-time expiry, and trusted renderer confirmation
- [x] Bounded local certificate-reference-name and TLS/port diagnostics before connection
- [x] Explicit user-initiated TLS certificate-chain inspection with credential-free IMAP/SMTP STARTTLS, five-second timeout, redacted metadata, and no-network plain/default behavior
- [ ] Live-provider interoperability plus OCSP/CRL revocation, certificate transparency, interception/pinning, proxy, and IPv6-connectivity matrices

## Data and platform open

- [ ] Replace or complement JSON with a migration-tested indexed store such as SQLite
- [x] Add searchable Git-backed revision diff previews, local labels, and reviewed whole-state restore UI
- [x] Add persisted bounded Git-backed retention, exact dry-run preview, app-owned pruning, labeled/current protection, and semantic prune records
- [x] Add read-only deletion-policy evidence for active revisions, labels, reflog-only commits, and Git object inventory with explicit non-erasure guarantees
- [ ] Complete every-record restore, cryptographic-erasure research, crash-injection proof, and an opt-in Git object-reclamation policy
- [x] Add searchable semantic history action counts, date ranges, and export foundation
- [x] Add a persisted global appearance reset for the live theme controls
- [x] Complete a validated per-workspace-tab appearance slice with anchored context/keyboard access, restart persistence, per-property reset, and focus return
- [ ] Complete appearance editing for every element, including picker self-customization and import/export
- [x] Add persisted tab pinning, fixed grouping, overflow, reviewed bulk close, and four independent discovery searches
- [x] Expand the factual in-app changelog to every audited published version (eleven versions through `v0.45.1` on 2026-08-01)
- [x] Add the off-by-default serialized TTS narrator foundation
- [ ] Prove narrator coexistence with screen readers, quiet settings, and natural Hong Kong Cantonese voices
- [x] Add the 1% startup dim-sum draw using a bundled verified local catalog
- [ ] Capture and accessibility-test the startup surprise in the packaged app

## Delivery open

- [ ] Add push and manual-dispatch CI that tests before publishing
- [ ] Produce a real, uniquely tagged GitHub release with a verified Windows installer
- [ ] Publish and verify the documentation site and configure the repository homepage
- [ ] Create and synchronize the project wiki and GitHub Pages source
- [x] Add `SECURITY.md`, `CONTRIBUTING.md`, and `CODE_OF_CONDUCT.md`
- [ ] Capture genuine issue-specific screenshots for visible fixes
