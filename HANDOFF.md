# Material Email handoff

## Current state

Material Email is an unreleased Windows-only Electron foundation. Main-process and preload services exist for IMAP/SMTP accounts, advisory autoconfiguration, queued offline changes and an outbox, attachment saving, demo data, local drafts, notifications, history, exports, native custom-editor approval, and window controls. MIME parsing, conservative message-HTML sanitization, and an isolated reader boundary are present. Packaged builds ignore `MATERIAL_EMAIL_DEV_URL`; unpackaged development accepts only strict HTTP loopback URLs at `127.0.0.1` or `[::1]`. Every IPC handler authenticates the current main window's `WebContents`, its top frame, and the exact trusted renderer URL/path. The renderer now contains Mail, Contacts, Mailing Lists, Calendar, Tasks, PIM Transaction History, Settings, Changelog, History, Notifications, and Tools/About panels plus first-run setup, non-modal compose, and structured local-organizer editors. History now has an independently searchable whole-workspace revision list, bounded parent diff previews, local Git-note labels, and reviewed whole-state restore. Retention, pruning, and every-record restore are not complete. Workspace tabs have a focused per-element appearance slice: validated local overrides for color, type size/weight, and radius; context-menu and direct keyboard entry; independent property reset; restart persistence; and exact focus return. Their primary tab strip also keeps focus on the selected tab during Arrow/Home/End navigation, exposes one roving tab stop with reciprocal tab/tabpanel IDs, and renders a tested inset keyboard focus indicator. This does not claim the broader Word-depth every-element editor, native screen-reader certification, or the full display-scale matrix. Packaged visual/accessibility proof remains incomplete.

The command palette now uses the same independent plain-text-first search model and adjacent bounded JavaScript-regex builder as the audited Settings, semantic and whole-workspace History, Notifications, and Tab Manager fields. It matches the visible English and Cantonese command labels, exposes invalid regex state, returns no executable result for invalid or risky patterns, and limits <kbd>Enter</kbd> activation to its search input. <kbd>Escape</kbd> closes the nested builder before dismissing the palette. This focused slice does not close the broader every-surface, Unicode, multiline, adversarial-timeout, assistive-technology, or display-scale matrices.

Raw MIME now passes through one main-process safety policy before detail or attachment parsing. A new parse with a known server size above 32 MiB is refused before the mail service runs; IMAP source requests cap the returned range at 32 MiB plus one detection byte. The parser also rejects header blocks above 64 KiB, physical header lines above 8 KiB, header NUL bytes, decoded text above 2 MiB, decoded HTML above 4 MiB, more than 100 attachments, one decoded attachment above 20 MiB, or decoded attachments above 24 MiB combined. CID links are kept as links and synthesized text-to-HTML output is disabled to avoid needless in-memory amplification. Stable failures omit parser internals, leave the cache and message unchanged, and flow through the existing non-modal reader error with safe retry guidance. This is a local bounded-parser slice, not live-provider interoperability, a comprehensive malformed corpus, a parser hard timeout, or antivirus analysis.

A PIM service under `src/main/pim/` covers contacts, mailing lists, bounded vCard import/export, a local Home calendar, events, tasks, append-only transactions, generation recovery, cross-instance/process locking, and stale-refresh protection. It is integrated through typed preload/IPC operations and Material renderer pages. It remains local-only: no CardDAV, CalDAV, ICS, invitation, alarm-delivery, or task-provider integration is claimed.

Mail mutation handling now treats false IMAP results as failures, refuses unsafe copy/delete fallback on servers without MOVE, adopts the server-returned destination UID and UIDVALIDITY without recycling the source UID, and waits for refresh when an offline or unmapped destination cannot be updated authoritatively. A permanent all-recipient SMTP 5xx returns the exact rejected recipients and keeps the draft rather than entering an outbox retry. Removing an account purges its live cache, drafts, outbox entries, and pending operations while append-only history remains available.

External message links now use a deny-by-default review flow. Electron denies every popup, the main process keeps only a short-lived single-use opaque request, and the trusted renderer shows a bilingual confirmation with the normalized URL, hostname, risk, and factual warning reasons. Confirmation revalidates expiry and HTTP(S) protocol before `shell.openExternal`; cancellation, expiry, duplicate use, and browser-launch failures do not open the link.

Remote HTML images now use a separate default-deny, per-message consent flow. The main-process sanitizer keeps the ordinary reader HTML image-free and builds a second bounded variant containing only normalized absolute HTTP(S) images plus their origin/host/protocol summary. The reader lists those exact origins in accessible English, Hong Kong Cantonese, or bilingual copy before loading anything. Consent is persisted on the cached message, survives restart, can be revoked, and resets when a new mailbox generation replaces the cached detail. The application CSP is unchanged; a consented opaque message frame adds only those origins to `img-src` while scripts, forms, frames, objects, media, connections, referrers, and same-origin access stay denied. HTTP receives a transport warning, not a certificate diagnostic.

Caution and dangerous received attachments now enter local quarantine before any user-selected save destination. The main process stores bytes under randomized `.quarantine` names and persists original metadata, source UID/UIDVALIDITY provenance, risk reasons, byte size, timestamp, and SHA-256 integrity. The Tools panel provides keyboard-accessible English, playful Hong Kong-style Cantonese, and bilingual Release/Delete decisions. Release rechecks size/hash and uses a native destination dialog; delete never releases a copy. Ordinary batch members still use the native folder chooser. This is not antivirus scanning, and no malware-clean verdict is produced.

Compose and PIM editors use saved/loaded dirty baselines. Their discard decision is accessible and restores focus, replacement attempts are guarded, and the unload guard covers either dirty editor so a whole-window close cannot silently discard the form. Send/Save operations are mutually exclusive; edits made during an in-flight operation remain visible and unsaved, while the main process preserves newer same-ID draft versions. PIM saves are bound to their originating editor and keep a retryable, factual state if post-save refresh fails. Mail account/folder/message requests use monotonic ownership so late results cannot overwrite the current view.

No hosted documentation site or clean-machine installation proof exists at this handoff. Published installers exist, and a new local verifier now proves a strict prior-release-to-candidate upgrade without confusing that evidence with clean-machine certification. The release workflow is wired to download the latest prior installer and require the same upgrade evidence before its next publication; that updated hosted gate has not run yet.

## Verification evidence

The consolidated current-tree gates pass locally. This evidence covers the source tree on this workstation; it does not certify a clean machine, hosted CI, a release, or public-provider interoperability.

| Check | Result |
| --- | --- |
| Focused regression coverage | Process/IPC trust, mail mutation and SMTP outcomes, account cleanup, renderer dirty/load state, bilingual semantics, and keyboard focus |
| `npm run check` | Passed: typecheck; 36 files / 178 tests; 10 bundled-image checks; site/source-policy checks; production build |
| Focused MIME safety | Passed: 4 files / 32 tests covering bounded IMAP ranges, known-size preflight, raw/header/text/HTML ceilings, NUL headers, attachment count/bytes, stable errors, cache preservation, unterminated multipart, and unchanged sanitization |
| Local NSIS upgrade | Published `0.19.1` → disposable `0.999.1` passed in one isolated install directory; both smoke versions matched; candidate uninstall removed the executable; probe SHA-256 stayed unchanged through upgrade and uninstall |
| Focused external-link tests | Passed: 4 existing safety tests plus 5 queue tests and IPC validation; 22 tests across 4 files |
| Focused remote-content tests | Passed: sanitizer/default-deny, strict IPC, cache migration, persisted allow/revoke, reader CSP, focus, restart, and bilingual semantics; real Electron consent and bilingual scenarios passed 2 / 2 |
| Focused tab-appearance tests | Passed: 4 pure normalization/reset cases plus 1 real-Electron workflow covering context-menu/direct keyboard access, persistence, both reset scopes, and focus return |
| Focused workspace-tab accessibility | Passed: 1 / 1 real-Electron scenario covering ArrowRight/Home/End focus retention, one roving tab stop, reciprocal tab/tabpanel semantics, and the computed 3 px inset focus indicator |
| Focused command-palette search | Passed: 8 / 8 matcher and command-filter assertions plus 1 / 1 real-Electron scenario covering literal default search, physical builder anchoring, invalid execution guards, nested Escape, regex narrowing, and Enter activation |
| Focused local-history tests | Repository/model/IPC cases cover labels, parent diff, redaction, search, and bilingual semantics; one real-Electron workflow covers diff expansion, label save, search, and restore review |
| Real-Electron coverage | Previously recorded full suite: 15 / 15; focused remote-content consent/restart and bilingual scenarios: 2 / 2; focused workspace-tab accessibility scenario: 1 / 1; focused command-palette search scenario: 1 / 1. The expanded full suite was not rerun in this pass. |
| Clean-machine and assistive-technology matrices | Not completed |

The coverage targets JSON/persistence behavior, process and IPC trust boundaries, bounded MIME/HTML behavior, regex behavior, exact mail mutation and recipient outcomes, account cleanup, PIM save/load state, bilingual semantics, and discard handling. Public-provider interoperability, a broad malformed-message corpus, parser wall-time isolation, clean-machine packaged behavior, the full screen-reader/scaling matrix, remote PIM synchronization, and release delivery remain unproved.

## Security facts

- Renderer sandboxing, context isolation, disabled Node integration, navigation denial, and permission denial are configured.
- Message popups are denied; external HTTP(S) links require a trusted-renderer confirmation request with bounded opaque IDs, 60-second expiry, single-use consumption, and protocol revalidation before browser launch.
- Packaged renderer startup ignores the development URL environment variable; unpackaged development permits only exact HTTP loopback hosts.
- Every IPC operation authenticates the current main `WebContents`, top frame, and exact trusted renderer URL/path before validating its bounded payload.
- Account secrets are encrypted through Electron `safeStorage` before JSON persistence and omitted from public account summaries.
- Message HTML is allowlisted. Its default document removes images; its separate consent variant retains only normalized HTTP(S) images and loads exact listed origins after a persisted per-message decision.
- Raw MIME reads and decoded parser output have fixed local safety ceilings; refusal leaves message/cache state unchanged and does not expose parser internals.
- State writes use a same-directory temporary file and rename and serialize concurrent updates.

Open security work includes broader IPC payload testing, certificate diagnostics and safe-link preview, live-server remote-image failure coverage, antivirus/content scanning and reputation integration, OAuth browser flow review, cryptographic messaging, migration testing, and PIM at-rest encryption decisions.

## Documentation delivered in this pass

- Compact root README and public contributor rules
- Categorized per-feature documentation with explicit status and gaps
- LibreOffice-only source-reference policy pinned to inspected official desktop-behavior paths
- Self-contained local Material Design 3 documentation site
- Roadmap, handoff, and MPL-2.0 license

## Next verification sequence

1. Repeat `npm run check` and the expanded Electron suite in hosted CI against the exact committed tree.
2. Exercise demo account, settings, every search/regex surface, history, notifications, compose, local-organizer pages, attachment saving, and export using full keyboard-only and screen-reader workflows.
3. Test real IMAP/SMTP behavior through secure credential intake without recording private data.
4. Expand the focused MIME safety cases into broad malformed-message, parser wall-time/isolation, attachment-content, regex, IPC, and persistence matrices.
5. Let the new hosted prior-release upgrade gate exercise the exact candidate, then repeat install, interactive first launch, upgrade, uninstall, and retained-data checks on a clean disposable Windows environment.
6. Verify CI/release automation, then publish only after the exact run and artifact are verified.
7. Deploy the documentation site, verify its base path and assets, and only then set the repository homepage.

## Known open product gaps

Browser OAuth, POP, unified folders, threading, SQLite mail indexing, history retention/pruning and every-record restore, CardDAV/CalDAV/ICS/task providers, broad vCard interoperability, recurrence expansion, alarm delivery, PIM at-rest encryption, message cryptography, antivirus/content scanning, clean-machine lifecycle proof, hosted verification of the new upgrade gate, wiki synchronization, and Pages deployment remain open. Native Windows notifications, attachment risk warnings, persisted local quarantine with explicit release/delete, the searchable local revision diff/label/restore slice, the factual in-app changelog, and a locally exercised strict NSIS upgrade verifier are implemented.
