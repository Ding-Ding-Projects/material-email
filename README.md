# Material Email

Material Email is an early-stage, Windows-only Electron email client that pairs a Material Design 3 interface with a local-first application boundary. The current tree contains a working application foundation; it is **not a released product**, and no installer containing the current corrections or hosted documentation site has been verified yet.

```text
Status: development foundation
Platform: Windows x64
Runtime: Electron 43 / Node.js 22 target
License: MPL-2.0
```

Install dependencies with `npm ci`, then use `npm run dev` for development. The complete local documentation site is available at [`site/index.html`](site/index.html). Hosted site placeholder: **not published yet**.

## Contents

- [Documentation index](docs/README.md)
- [LibreOffice source-reference map](docs/architecture/libreoffice-source-map.md)
- [Roadmap](ROADMAP.md)
- [Current handoff](HANDOFF.md)
- [Contributing guidance](CONTRIBUTING.md)
- [Agent and automation guidance](AGENTS.md)
- [Security policy](SECURITY.md)
- [Code of conduct](CODE_OF_CONDUCT.md)
- [License](LICENSE)

<details>
<summary><strong>What is implemented now?</strong></summary>

The current foundation provides:

- a sandboxed Electron renderer with context isolation, disabled Node integration, denied permission requests, blocked in-app navigation, and a narrow preload API whose handlers authenticate the current main window, top frame, and exact trusted renderer location;
- manual IMAP and SMTP settings, connection tests, account persistence, folder/message synchronization, message reading, read/star flags, moving, sending, and local draft storage;
- MIME parsing and a conservative HTML sanitizer that removes active and remotely loaded content;
- Windows-backed credential encryption through Electron `safeStorage` before account secrets reach the JSON state file;
- serialized, temporary-file-backed JSON state writes; demo mail data; notification history; append-only-style history records; export hooks; and external-editor discovery;
- a bounded JavaScript regular-expression engine helper with plain-text mode, syntax validation, match limits, capture groups, zero-width handling, and basic risky-pattern rejection;
- an integrated local organizer for structured contacts, mailing lists, bounded vCard import/export, a Home calendar, events, tasks, append-only transaction recovery, cross-process-safe atomic persistence, and stale-refresh protection;
- an NSIS x64 packaging configuration with a recorded local lifecycle proof for an earlier tree; the current corrections still require a rebuilt installer and clean-machine verification.

The renderer is integrated with the typed mail and local-organizer preload surface. The current tree passes `npm run check` with 22 unit/integration files and 96 tests, all bundled-asset/site/source-policy checks, and a production build; the real Electron suite passes 15 of 15 scenarios, including restart, redirect/IPC trust, async mail-view ownership, compose and PIM concurrency, dirty-state/focus, bilingual narrow-layout, and PIM failure/retry paths. This is local development evidence, not release certification. Rebuilt-installer and clean-machine proof, the full screen-reader/display-scale matrix, remote PIM synchronization, and live public-provider verification are still incomplete. See [Roadmap](ROADMAP.md) for the explicit gaps.

</details>

<details>
<summary><strong>Develop, test, and package</strong></summary>

### Prerequisites

- Windows 10 or Windows 11 on x64
- Node.js 22 and npm
- Git

### Commands

```powershell
npm ci
npm run dev
```

```powershell
npm run typecheck
npm test
npm run build
npm run check
```

The package configuration also defines these Windows packaging commands:

```powershell
npm run dist:win
npm run verify:package
```

`dist:win` is a build command, not evidence that an installer exists. Before distributing anything, verify the generated executable, install, first launch, upgrade behavior, uninstall behavior, retained-data policy, signing posture, and malware-scanner results on a clean Windows machine.

Serve the documentation site locally so its module and content-security policy run under browser-equivalent conditions:

```powershell
npx vite --host 127.0.0.1 site
```

</details>

<details>
<summary><strong>Architecture and security boundary</strong></summary>

The main process owns mail networking, disk writes, credentials, file dialogs, exports, external-process launch, and window control. The renderer sees only the typed operations exposed through the preload bridge. Every IPC handler authenticates the current main window's `WebContents`, requires its top frame, and checks the exact trusted renderer URL/path before processing an argument. Packaged builds always load their bundled renderer and ignore `MATERIAL_EMAIL_DEV_URL`; unpackaged development accepts only HTTP URLs whose host is exactly `127.0.0.1` or `[::1]`. Account secrets are removed from renderer-facing summaries and encrypted with Windows-backed `safeStorage` before persistence.

Message HTML is treated as untrusted input. The current sanitizer keeps a small structural subset, strips scripts, styles, images, event attributes, and unsafe URL schemes, and therefore blocks remote tracking pixels by removal. The renderer then places the result in a sandboxed iframe with a restrictive internal content-security policy. Ordinary attachment saves use native dialogs and collision-safe normalized filenames; caution/dangerous attachments first enter persisted local quarantine with explicit release/delete and SHA-256 integrity checks. These are useful boundaries, not a complete message-security review: antivirus/content scanning, certificate UX, OpenPGP/S/MIME, and adversarial live-account testing remain open.

Read [Security boundaries](docs/architecture/security-boundaries.md) for the threat model and verification limits.

</details>

<details>
<summary><strong>Source-reference policy</strong></summary>

Material Email is an original Electron implementation. LibreOffice is the only external product source code permitted as a narrow desktop-behavior reference; no source was copied, and no compatibility or parity is claimed. Exact permitted paths and the inspected immutable commit are recorded in the [source-reference map](docs/architecture/libreoffice-source-map.md). Mail behavior comes from public protocol specifications, dependency APIs, and this repository's tests rather than another email client's code.

</details>

<details>
<summary><strong>Sanitized shared-instructions mirror</strong></summary>

> This is a public, project-scoped mirror of shared contributor rules. It contains only portable, public-safe requirements. Update the canonical instructions first, then refresh this mirror and [`AGENTS.md`](AGENTS.md).

- Preserve unrelated work, read local documentation before editing, and make reversible, auditable changes.
- Use the `git` CLI for Git and the `gh` CLI for GitHub. Never force-push without explicit approval.
- Keep claims evidence-based: distinguish implemented code, locally verified behavior, remotely verified behavior, and open work.
- Keep documentation, roadmap, handoff, landing site, wiki, and Pages material aligned with each behavior change. Never present unreleased work as shipped.
- Keep secrets out of chat, files, command arguments, logs, screenshots, issues, and history. Use secure, ephemeral intake when a secret is genuinely required.
- Treat accessibility, visible focus, keyboard operation, contrast, reduced motion, clipping, and scaling defects as completion blockers.
- User-facing surfaces use Material Design 3, English/Cantonese/bilingual modes, independently persisted humor levels, non-blocking notifications, browser-style tabs, searchable settings, and a bounded local regex builder.
- Bundle user-facing assets locally. Do not add analytics, tracking, CDN dependencies, generated placeholder imagery, or unverified third-party artwork.
- Preserve local user data safely. History is append-only, restores create new revisions, and sensitive data must remain encrypted in snapshots.
- Tests, documentation, installer verification, CI evidence, release assets, and deployment evidence are all required before a release claim.

The complete operational mirror is in [`AGENTS.md`](AGENTS.md).

</details>

<details>
<summary><strong>Project limitations</strong></summary>

The following remain explicitly **open or not fully verified**: interactive OAuth, POP, unified folders, conversation threading, native Windows notifications, SQLite mail indexing, remote CardDAV/CalDAV/task-provider synchronization, broad vCard/ICS interoperability, recurrence expansion and alarm delivery, cryptographic message features, antivirus/content scanning, clean-machine installer proof, CI releases, GitHub Pages, and live-site publication. Autoconfiguration, queued mail actions/outbox, attachment saving/quarantine, Git-backed snapshots, and the local organizer pass the current local check and Electron suites; their documented live-provider, scale, screen-reader, and packaging matrices remain open.

</details>
