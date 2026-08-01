# Material Email handoff

## Current state

Material Email is an unreleased Windows-only Electron foundation. Main-process and preload services exist for IMAP/SMTP accounts, advisory autoconfiguration, queued offline changes and an outbox, attachment saving, demo data, local drafts, notifications, history, exports, native custom-editor approval, and window controls. MIME parsing, conservative message-HTML sanitization, and an isolated reader boundary are present. Packaged builds ignore `MATERIAL_EMAIL_DEV_URL`; unpackaged development accepts only strict HTTP loopback URLs at `127.0.0.1` or `[::1]`. Every IPC handler authenticates the current main window's `WebContents`, its top frame, and the exact trusted renderer URL/path. The renderer now contains Mail, Contacts, Mailing Lists, Calendar, Tasks, PIM Transaction History, Settings, Changelog, History, Notifications, and Tools/About panels plus first-run setup, non-modal compose, and structured local-organizer editors. Workspace tabs have a focused per-element appearance slice: validated local overrides for color, type size/weight, and radius; context-menu and direct keyboard entry; independent property reset; restart persistence; and exact focus return. This does not claim the broader Word-depth every-element editor. Packaged visual/accessibility proof remains incomplete.

A PIM service under `src/main/pim/` covers contacts, mailing lists, bounded vCard import/export, a local Home calendar, events, tasks, append-only transactions, generation recovery, cross-instance/process locking, and stale-refresh protection. It is integrated through typed preload/IPC operations and Material renderer pages. It remains local-only: no CardDAV, CalDAV, ICS, invitation, alarm-delivery, or task-provider integration is claimed.

Mail mutation handling now treats false IMAP results as failures, refuses unsafe copy/delete fallback on servers without MOVE, adopts the server-returned destination UID and UIDVALIDITY without recycling the source UID, and waits for refresh when an offline or unmapped destination cannot be updated authoritatively. A permanent all-recipient SMTP 5xx returns the exact rejected recipients and keeps the draft rather than entering an outbox retry. Removing an account purges its live cache, drafts, outbox entries, and pending operations while append-only history remains available.

External message links now use a deny-by-default review flow. Electron denies every popup, the main process keeps only a short-lived single-use opaque request, and the trusted renderer shows a bilingual confirmation with the normalized URL, hostname, risk, and factual warning reasons. Confirmation revalidates expiry and HTTP(S) protocol before `shell.openExternal`; cancellation, expiry, duplicate use, and browser-launch failures do not open the link.

Compose and PIM editors use saved/loaded dirty baselines. Their discard decision is accessible and restores focus, replacement attempts are guarded, and the unload guard covers either dirty editor so a whole-window close cannot silently discard the form. Send/Save operations are mutually exclusive; edits made during an in-flight operation remain visible and unsaved, while the main process preserves newer same-ID draft versions. PIM saves are bound to their originating editor and keep a retryable, factual state if post-save refresh fails. Mail account/folder/message requests use monotonic ownership so late results cannot overwrite the current view.

No hosted documentation site or clean-machine installation proof exists at this handoff. Published installers exist, and a new local verifier now proves a strict prior-release-to-candidate upgrade without confusing that evidence with clean-machine certification. The release workflow is wired to download the latest prior installer and require the same upgrade evidence before its next publication; that updated hosted gate has not run yet.

## Verification evidence

The consolidated current-tree gates pass locally. This evidence covers the source tree on this workstation; it does not certify a clean machine, hosted CI, a release, or public-provider interoperability.

| Check | Result |
| --- | --- |
| Focused regression coverage | Process/IPC trust, mail mutation and SMTP outcomes, account cleanup, renderer dirty/load state, bilingual semantics, and keyboard focus |
| `npm run check` | Passed: typecheck; 30 files / 143 tests; 10 bundled-image checks; site/source-policy checks; production build with 12 renderer modules |
| Local NSIS upgrade | Published `0.19.1` → disposable `0.999.1` passed in one isolated install directory; both smoke versions matched; candidate uninstall removed the executable; probe SHA-256 stayed unchanged through upgrade and uninstall |
| Focused external-link tests | Passed: 4 existing safety tests plus 5 queue tests and IPC validation; 22 tests across 4 files |
| Focused tab-appearance tests | Passed: 4 pure normalization/reset cases plus 1 real-Electron workflow covering context-menu/direct keyboard access, persistence, both reset scopes, and focus return |
| `npm run test:e2e` | Passed: 15 / 15 real-Electron scenarios in one worker, including two restart paths and four deterministic concurrency cases |
| Clean-machine and assistive-technology matrices | Not completed |

The coverage targets JSON/persistence behavior, process and IPC trust boundaries, MIME/HTML, regex behavior, exact mail mutation and recipient outcomes, account cleanup, PIM save/load state, bilingual semantics, and discard handling. Public-provider interoperability, clean-machine packaged behavior, the full screen-reader/scaling matrix, remote PIM synchronization, and release delivery remain unproved.

## Security facts

- Renderer sandboxing, context isolation, disabled Node integration, navigation denial, and permission denial are configured.
- Message popups are denied; external HTTP(S) links require a trusted-renderer confirmation request with bounded opaque IDs, 60-second expiry, single-use consumption, and protocol revalidation before browser launch.
- Packaged renderer startup ignores the development URL environment variable; unpackaged development permits only exact HTTP loopback hosts.
- Every IPC operation authenticates the current main `WebContents`, top frame, and exact trusted renderer URL/path before validating its bounded payload.
- Account secrets are encrypted through Electron `safeStorage` before JSON persistence and omitted from public account summaries.
- Message HTML is allowlisted and removes scripts, styles, images, event attributes, and unsafe schemes.
- State writes use a same-directory temporary file and rename and serialize concurrent updates.

Open security work includes broader IPC payload testing, certificate diagnostics and safe-link preview, attachment scanning/quarantine, OAuth browser flow review, cryptographic messaging, migration testing, and PIM at-rest encryption decisions.

## Documentation delivered in this pass

- Compact root README and public contributor rules
- Categorized per-feature documentation with explicit status and gaps
- LibreOffice-only source-reference policy pinned to inspected official desktop-behavior paths
- Self-contained local Material Design 3 documentation site
- Roadmap, handoff, and MPL-2.0 license

## Next verification sequence

1. Repeat `npm run check` and the 15-scenario Electron suite in hosted CI against the exact committed tree.
2. Exercise demo account, settings, every search/regex surface, history, notifications, compose, local-organizer pages, attachment saving, and export using full keyboard-only and screen-reader workflows.
3. Test real IMAP/SMTP behavior through secure credential intake without recording private data.
4. Perform adversarial message, attachment, regex, IPC, and persistence tests.
5. Let the new hosted prior-release upgrade gate exercise the exact candidate, then repeat install, interactive first launch, upgrade, uninstall, and retained-data checks on a clean disposable Windows environment.
6. Verify CI/release automation, then publish only after the exact run and artifact are verified.
7. Deploy the documentation site, verify its base path and assets, and only then set the repository homepage.

## Known open product gaps

Browser OAuth, POP, unified folders, threading, SQLite mail indexing, complete history diff/retention UI, CardDAV/CalDAV/ICS/task providers, broad vCard interoperability, recurrence expansion, alarm delivery, PIM at-rest encryption, message cryptography, attachment scanning/quarantine, clean-machine lifecycle proof, hosted verification of the new upgrade gate, wiki synchronization, and Pages deployment remain open. Native Windows notifications, attachment risk warnings, the factual in-app changelog, and a locally exercised strict NSIS upgrade verifier are implemented.
