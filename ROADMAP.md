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
- [x] IMAP folder/message listing, message retrieval, flags, and moves
- [x] SMTP sending and local draft persistence
- [x] MIME parsing and conservative HTML sanitization
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
- [x] Add focused regression coverage for process/IPC trust, mail failure semantics, account cleanup, compose/PIM dirty baselines, discard focus, PIM load retry, bilingual semantics, and revision-aware no-op saves
- [x] Run the consolidated type, unit, integration, build, and real-Electron E2E verification (`npm run check`: 30 files / 143 tests on the current tree; the previously recorded Electron suite passed 15 / 15 scenarios)
- [ ] Exercise every user-visible path in a packaged Electron session
- [ ] Run keyboard, screen-reader, focus, contrast, reduced-motion, narrow-width, and 100/125/150/200% scaling checks
- [ ] Verify all language modes and every English/Cantonese humor level without changing factual content
- [ ] Verify plain-text and regex search from every search surface, including invalid, Unicode, multiline, capture, zero-width, and adversarial cases
- [ ] Test a real IMAP/SMTP account without exposing credentials or private messages in evidence
- [x] Add focused sandbox/CSP, navigation, HTML-sanitization, and IPC-surface boundary tests
- [ ] Expand adversarial IPC payload, malformed MIME, and phishing test matrices
- [x] Prove a strict local NSIS baseline-to-candidate upgrade with both artifact hashes, installed smoke versions, same-directory replacement, uninstall, and unchanged isolated user-data hash
- [ ] Prove clean-machine/default-profile install, interactive first launch, upgrade, uninstall, retained data, signature posture, and artifact integrity for the exact release candidate

## Mail capabilities open

- [ ] Interactive OAuth authorization flow and token lifecycle
- [ ] POP support
- [x] User-facing retry ceilings and conflict resolution for queued mail operations
- [ ] Unified folders and cross-account views
- [ ] Conversation threading and complete search indexing
- [x] Attachment risk classification and review-before-save warnings
- [ ] Attachment quarantine/scanner integration
- [x] Native Windows notifications with privacy controls (opt-in generic summaries)
- [x] Renderer/preload/IPC integration for contacts, mailing lists, calendars, tasks, vCard actions, and transaction recovery
- [ ] CardDAV/CalDAV/ICS/task-provider synchronization and broad interoperability
- [ ] OpenPGP and S/MIME signing/encryption with clear trust UX
- [x] Pure external-link risk assessment (HTTP, credentials, host and Unicode deception signals)
- [x] Phishing review dialog with normalized destination, risk reasons, one-time expiry, and trusted renderer confirmation
- [ ] Certificate diagnostics and opt-in remote-content controls

## Data and platform open

- [ ] Replace or complement JSON with a migration-tested indexed store such as SQLite
- [ ] Complete Git-backed history diff, retention, pruning, labeling, and every-record restore UI
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
