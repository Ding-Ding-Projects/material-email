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
- [x] Strict POP3 account-test schema, POP3-aware port diagnostics, and a user-initiated bounded implicit-TLS/required-STARTTLS test with CAPA, USER/PASS, STAT, UIDL/LIST, cancellation, redaction, and no retrieval/deletion/persistence; deterministic servers are test-only
- [x] Ephemeral main-process OAuth authorization-code/PKCE state machine with no local network listener at all — the browser redirects to Microsoft's own native-client sentinel (or an operator-configured HTTPS URL) and the user pastes the resulting address back for validated matching — plus timeout/cancel/error cleanup and status-only IPC; the class itself still performs no exchange, persistence, or logging, and optionally hands a captured code to a caller-supplied callback rather than doing anything with it itself
- [x] Provider-gated Windows `safeStorage` OAuth vault with bounded encrypted access/refresh records, atomic rotation generations, metadata-only IPC, per-account and whole-provider clear, injectable revoke-and-clear, and accessible bilingual Settings controls; Microsoft registration is read from the environment when present, Google's revoker list remains empty
- [x] Mock-only local OAuth exchange/expiry/refresh/revoke state machine with ephemeral AES-256-GCM ciphertext and an explicit demo factory isolated from production
- [x] Bounded local certificate/hostname preflight with conventional TLS/STARTTLS port diagnostics, bilingual accessible errors, and a main-process no-connection guard
- [x] IMAP folder/message listing, message retrieval, flags, and moves
- [x] SMTP sending and local draft persistence
- [x] MIME parsing and conservative HTML sanitization
- [x] Bounded MIME fetch/parsing with raw-source, header, decoded-body, attachment-count, per-attachment, and combined-attachment ceilings plus stable retry-safe failures
- [x] Default-deny per-message remote-image consent with persisted allow/revoke, exact source summary, and scoped reader CSP
- [x] Bounded metadata-only OpenPGP/S/MIME top-level container assessment, strict public identity metadata, explicit unsigned/unverified/unsupported states, and bilingual accessible reader/compose indicators; no cryptographic operation or key persistence
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
- [x] Bounded local CardDAV/CalDAV/ICS profile validation, deterministic capability/state reporting, and vCard/iCalendar interchange limits with explicit no-network/no-credential facts
- [x] Atomic local iCalendar VEVENT/VTODO import with explicit duplicate handling and selected/all normalized CRLF export through native dialogs
- [x] Generation-based PIM persistence with validated recovery copies and cross-instance/process locking
- [x] Task refresh ordering that rejects stale or edit-overwriting results
- [x] Windows x64 NSIS packaging configuration

## Integration and verification now

- [x] Integrate the mail/settings/history/notifications/changelog/tools renderer with the preload API
- [x] Integrate Contacts, Mailing Lists, Calendar, Tasks, and PIM transaction history with typed preload/IPC operations
- [x] Give command-palette search its own plain-text-first model, adjacent anchored regex builder, invalid-pattern execution guard, and focused real-Electron proof
- [x] Persist the global Settings mode/pattern/normalized flags locally, keep samples ephemeral, and expose an independently humor-levelled semantic no-match state with keyboard focus recovery and focused real-Electron restart proof
- [x] Persist the Notification Centre mode/query-pattern/normalized flags independently, keep samples ephemeral, separate invalid regex from localized humor-aware no-match/count states, and preserve read/dismiss/action behavior with focused renderer and real-Electron restart proof
- [x] Persist independent Contacts, Mailing Lists, Calendar Events, Tasks, PIM Transaction History, and mailing-list member-picker mode/query-pattern/normalized-flag models, keep samples ephemeral, separate invalid regex from localized humor-aware no-match/count states, and prove editor-contained pointer access plus keyboard focus recovery across restart in real Electron
- [x] Persist all four Tab Manager discovery mode/pattern/normalized-flag models independently, keep samples ephemeral, separate invalid regex from localized semantic no-match states, and prove unclipped builder controls plus close-button/Escape focus return across restart in real Electron
- [x] Add focused regression coverage for process/IPC trust, mail failure semantics, account cleanup, compose/PIM dirty baselines, discard focus, PIM load retry, bilingual semantics, and revision-aware no-op saves
- [x] Keep workspace-tab Arrow/Home/End navigation inside the semantic tablist with one roving tab stop and a non-clipped visible focus indicator, covered in real Electron
- [x] Keep the expanded tab appearance editor and History/Changelog date pickers collision-contained with preserved focus and reduced-motion timing at 760 × 560 plus smaller effective CSS viewport stress sizes, covered by 2 / 2 real-Electron scenarios; native Windows display scaling remains open
- [x] Wire English, Hong Kong Cantonese, and semantic bilingual modes plus inverse independent humor levels through the appearance editor, History/Changelog date pickers, notification centre, and renderer toasts with fallback-safe renderer tests and a focused real-Electron matrix
- [x] Persist notification read/dismiss state and expose localized category, severity, accessible dismiss/restore, and schema-bounded open/retry/undo actions with focused unit and restart-level real-Electron proof
- [x] Persist Outbox attempt/error state across restart and expose subject-specific, humor-aware retry-once, undo-to-Drafts, and queue-ID History actions with offline service and real-Electron proof
- [x] Redact raw host paths, URLs/query parameters, private search text, stack locations, and provider implementation detail from renderer errors, synchronization notifications, and queued-mail status while preserving actionable failure categories and bilingual/humor rendering
- [x] Add keyboard-reachable localized Windows caption controls, synchronized maximize/restore state, validated normal-bounds/maximized persistence, off-screen recovery, and a reviewed native dirty-close path with focused unit and 3 / 3 real-Electron proof
- [x] Add explicit system-color borders, state cues, and keyboard focus indicators for caption controls, notification actions, appearance presets, and both advanced date pickers, covered by 2 renderer cases and 2 / 2 real-Electron Chromium forced-colors scenarios without claiming native Windows High Contrast certification
- [x] Run the consolidated type, unit, integration, and build verification (`npm run check`: 63 files / 342 tests on the current tree; focused PIM search passed 1 / 1 real-Electron restart scenario, Notification Centre search/action passed 2 / 2, Tab Manager discovery and Settings search each passed 1 / 1, cached-mail search passed 3 / 3, forced-colors/focus passed 2 / 2, focused Outbox redaction/recovery passed 1 / 1, responsive/accessibility passed 2 / 2, Windows window controls passed 3 / 3, and broader evidence remains listed in `HANDOFF.md`)
- [ ] Exercise every user-visible path in a packaged Electron session
- [ ] Run the full keyboard, native screen-reader, native High Contrast, focus, contrast, reduced-motion, narrow-width, and 100/125/150/200% native Windows scaling matrices (workspace-tab navigation, app-owned caption controls, the focused appearance/date-picker effective-viewport slice, and Chromium forced-colors coverage for four recent surfaces are verified)
- [ ] Verify all language modes and every English/Cantonese humor level without changing factual content across every remaining app surface (the focused appearance/date-picker/notification matrix is verified)
- [ ] Verify plain-text and regex search from every search surface, including nested settings/adjustment surfaces and invalid, Unicode, multiline, capture, zero-width, and adversarial cases (global Settings, Notification Centre, all six PIM fields, and four Tab Manager discovery persistence/no-match/focus slices plus command-palette and cached-mail/Unified Inbox adversarial, Unicode-zero-width, multiline, and no-match slices are verified)
- [ ] Test a real IMAP/SMTP account without exposing credentials or private messages in evidence
- [x] Add focused sandbox/CSP, navigation, HTML-sanitization, and IPC-surface boundary tests
- [ ] Expand adversarial IPC payload, malformed MIME, and phishing test matrices (focused oversized source/header/body, NUL-header, attachment-fan-out, decoded-attachment, and unterminated-multipart cases are verified; broad corpora and hard parser wall-time isolation remain open)
- [x] Prove a strict local NSIS baseline-to-candidate upgrade with both artifact hashes, installed smoke versions, same-directory replacement, uninstall, and unchanged isolated user-data hash
- [x] Guard an absent isolated-profile packaged launch with exact default settings/window state and deterministic retained settings/window evidence across candidate launch, optional upgrade, and uninstall; keep stronger environment/signature claims explicitly false
- [ ] Prove clean-machine/default Windows-profile install, interactive first launch, upgrade, uninstall, retained data, Authenticode posture, and artifact integrity for the exact release candidate

## Mail capabilities open

- [x] Wire Microsoft code exchange, refresh, per-account vault storage/removal, and account connection end to end, environment-gated and tested against a real local HTTP fixture speaking the token-endpoint protocol; no live Microsoft tenant has exercised it yet
- [ ] Register a real Microsoft Entra ID app and verify sign-in, refresh, and IMAP/SMTP XOAUTH2 delivery against a live tenant; register Google (needs `access_type=offline` handling this build does not have yet) and verify it the same way
- [x] Auto-detect the signed-in Microsoft account's email/display name from the ID token's claims to prefill the Add Account form (needs `openid`/`profile`/`email` scopes and a non-secret claim surfaced on `OAuthSignInSnapshot`)
- [ ] Real Google and Microsoft revocation clients now exist (`src/main/oauth-revocation.ts`) and are tested against a real local fixture speaking Google's revoke protocol and Microsoft's documented absence of one; Microsoft's is registered into Revoke and clear whenever Microsoft is configured (honestly reporting "not supported by this provider" rather than fabricating a call), but Google's is not registered in production because Google has no client-ID registration path in this build yet — scope/consent UX beyond the bare authorization request, vault migration/recovery matrices, and public-provider interoperability remain open
- [x] Bounded live POP3 account-test transport and loopback interoperability for implicit TLS plus required STARTTLS; Test Settings only, leave-on-server command set, no account creation or sync
- [ ] Public-provider POP3 interoperability, additional authentication policies, POP3 account persistence, durable UIDL tracking, polling, message retrieval, retention/deletion semantics, outgoing delivery integration, folders, and synchronization (the account test is not completion evidence)
- [x] User-facing retry ceilings and conflict resolution for queued mail operations
- [x] Local cached Unified Inbox, Starred, and Unread views with account attribution, shared regex search, and stable composite selection
- [x] Bounded in-memory conversation grouping by normalized subject and cached message references
- [x] Ephemeral cached-mail plain/regex index with bounded results and account/folder/conversation attribution
- [x] Reject demonstrated nested, adjacent-overlap, wildcard-overlap, and prefix-alternative regex denial-of-service families before cached-mail IPC; advance `u`-mode zero-width sample matches by code point
- [x] Localized cached-search result counts, keyboard-actionable invalid/empty/error states, mode-only restart persistence, and redacted one-request retry handling with focused unit and 2 / 2 real-Electron proof
- [x] Colour-coded message tags bound to account/folder/mailbox-generation/UID, with a built-in catalogue, per-message and catalogue ceilings, move carry-through, dropped attribution when the server reports no destination UID, and account/folder pruning
- [x] Quick filter over the visible message list with unread/starred/attachment/tagged facets, any/all tag matching, plain-text-first search that ignores case by default, an adjacent regex mode, and an in-place invalid-pattern state that hides nothing
- [x] Ordered message filter rules with fourteen condition fields, nine operators, twelve actions, match-all/any, account scoping, stop handling, contradiction collapsing, a bounded run ceiling, and a previewed run that uses the same planner as the run it previews
- [x] Local junk classification trained only by explicit corrections, with source-prefixed tokens, an honest untrained state, bounded token counts, exact untraining, and no automatic move, deletion, or transmission
- [x] Folder create, rename, and removal against the server with special-folder protection, subtree cache invalidation, and a bounded single-round-trip mark-folder-read that reports what actually changed
- [x] Prove tagging, tag-narrowed quick filtering, mark-folder-read, restart persistence, and refused-pattern disclosure in 2 / 2 real-Electron scenarios
- [x] Add the per-account identity and signature model: conservative address validation, control-character stripping, exactly one default per account, sibling promotion on removal, reply-address identity selection, and signature placement above or below quoted material without stacking
- [x] Wire identities and signatures through persistence, IPC, a composer From picker, a Settings editor, and the SMTP From/Reply-To headers, with signature replacement that preserves quoted material and a body that carries someone else's separator
- [x] Add a filter editor surface with its own search and regex builder, and run `runOnSync` filters automatically over newly arrived messages without reprocessing across restarts
- [x] Persist tags as server-side IMAP keywords: `AppService.setMessageTags` now calls the bounded fail-closed encoder and `setMessageKeywords` for a real account before applying the change locally, fail-closed like folder administration and mark-folder-read (no real IMAP server has been exercised, only a mocked client)
- [ ] Verify IMAP keyword persistence against a real public-provider mailbox and other real clients (the encoder, `setMessageKeywords`, and its application wiring are proven only against a mocked IMAP client)
- [ ] Server-complete all-account synchronization/threading and persistent scalable mail indexing
- [ ] Conversation threading and complete search indexing
- [x] Attachment risk classification and review-before-save warnings
- [x] Local attachment quarantine with reviewed batch routing and accessible bilingual release/delete decisions
- [ ] Antivirus or malware-content scanner integration and provider-backed reputation checks
- [x] Native Windows notifications with privacy controls (opt-in generic summaries)
- [x] Renderer/preload/IPC integration for contacts, mailing lists, calendars, tasks, vCard/local-iCalendar actions, and transaction recovery
- [ ] Live CardDAV/CalDAV/ICS/task-provider discovery, authentication, credential storage, synchronization, conflicts, recurrence expansion, and broad interoperability (the local validation/interchange foundation is not provider proof)
- [ ] OpenPGP and S/MIME signing/encryption with clear trust UX
- [ ] Audited OpenPGP/S/MIME libraries, OS-backed key/certificate lifecycle, real signing/encryption/decryption/verification, revocation/expiry handling, and provider interoperability (the metadata-only trust-state foundation is not completion evidence)
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
- [x] Add searchable semantic history action counts plus an anchored advanced date-range picker with typed ISO/locale input, month/year navigation, named presets, keyboard range selection, composed regex filtering, and matching export
- [x] Add a persisted global appearance reset for the live theme controls
- [x] Complete a validated per-workspace-tab appearance slice with anchored context/keyboard access, restart persistence, per-property reset, and focus return
- [x] Deepen per-tab colors with persisted accent/background/text overrides, continuous native selection, synchronized HEX/HEX8/RGB/HSL entry, live preview, and contrast readouts
- [x] Add bilingual built-in and persisted user-named per-tab presets plus reviewed, versioned, strictly validated native-dialog JSON theme export/import
- [ ] Complete appearance editing for every element, including picker self-customization, Word-depth typography, complete color translation, and every-element preset/transfer coverage
- [x] Add persisted tab pinning, fixed grouping, overflow, four independent discovery searches, and reviewed bulk close with restart-persistent bounded matcher/options, semantic localized preview, pinned-policy disclosure, and focus return
- [x] Expand the factual in-app changelog to every audited published version (eleven versions through `v0.45.1` on 2026-08-01)
- [x] Add an anchored bilingual changelog calendar with typed locale dates, range selection, month/year navigation, named presets, keyboard focus, and composed search
- [x] Add the off-by-default serialized TTS narrator foundation
- [ ] Prove narrator coexistence with screen readers, quiet settings, and natural Hong Kong Cantonese voices
- [x] Draw the startup dim sum on one launch in ten from a bundled verified local catalog, with no off switch and a per-launch latch
- [ ] Capture and accessibility-test the startup surprise in the packaged app

## Delivery open

- [ ] Add push and manual-dispatch CI that tests before publishing
- [x] Count the lines each commit ships from a committed script and require that table in the release notes (never executed on a runner)
- [ ] Produce a real, uniquely tagged GitHub release with a verified Windows installer
- [ ] Publish and verify the documentation site and configure the repository homepage
- [ ] Create and synchronize the project wiki and GitHub Pages source
- [x] Add `SECURITY.md`, `CONTRIBUTING.md`, and `CODE_OF_CONDUCT.md`
- [ ] Capture genuine issue-specific screenshots for visible fixes
