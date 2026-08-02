# Contributor and agent guidance

## Sanitized shared-instructions mirror

This file is a public, project-scoped mirror of the shared working agreement. It deliberately contains only portable, public-safe guidance. Change the canonical instructions first, then update this file and the condensed mirror in `README.md`; do not assume edits here propagate elsewhere.

## Scope and product truth

- Material Email is a Windows-only Electron application. Do not broaden work into a fork, TUI, other desktop operating systems, or hosted service unless the current task explicitly changes scope.
- LibreOffice's official `LibreOffice/core` repository is the only external product source-code reference permitted. Keep any reference narrow, record exact upstream paths and an inspected immutable commit in `docs/architecture/libreoffice-source-map.md`, and never copy source or claim compatibility. Design mail behavior independently from public protocol specifications and the project's dependency APIs.
- Never describe a configured, mocked, or partially integrated feature as released or end-to-end verified. State the evidence and open gaps.
- Preserve unrelated and uncommitted work. Read relevant feature documentation before editing. Keep changes small, reversible, and auditable.

## Repository commands

```powershell
npm ci
npm run dev
npm run typecheck
npm test
npm run build
npm run check
npm run dist:win
npm run verify:package
```

Use dependency versions and lockfiles declared by the repository. Prefer project-local tooling. Do not commit installed dependencies, incidental lockfile churn, build output, credentials, or absolute machine paths.

## Security and privacy

- Never place secrets in source, documentation, chat, command arguments, logs, screenshots, issues, or Git history. Use a purpose-built secure, ephemeral intake flow when credentials are unavoidable.
- Keep the renderer sandboxed with context isolation enabled and Node integration disabled. Expose only typed, narrow preload operations and validate untrusted input in the main process.
- Keep account secrets out of renderer-facing models and persist them only through operating-system-backed encryption. Never weaken encrypted storage silently.
- Treat messages, headers, addresses, links, attachments, filenames, server responses, regex patterns, imported themes, and exported files as untrusted.
- Block active message content and remote tracking by default. Do not enable remote images, scripts, forms, frames, redirects, arbitrary schemes, or implicit file access.
- Launch external editors through argument-safe process APIs after validating executable paths. Never concatenate shell commands.
- Avoid telemetry, analytics, third-party assets, and runtime CDN requests unless a future task explicitly establishes an informed-consent design.

## User experience requirements

- Use Material Design 3 tokens, component anatomy, typography, shape, elevation, and motion. Support light/dark/system themes, density, accent, font family, scale, and weight with persisted live preview.
- Provide English, playful Hong Kong-style Cantonese, and bilingual modes. Persist independent English and Cantonese humor levels from 1 through 5; humor changes tone, never facts.
- Accessibility is required: semantic roles and names, keyboard reachability, visible focus, correct state announcements, sufficient contrast, reduced-motion support, screen-reader order, and usable layouts at 100/125/150/200% scaling and narrow widths.
- Informational, success, progress, and non-decision errors use accessible corner notifications and a reviewable history. Reserve blocking dialogs for decisions that must precede progress.
- Use browser-style tabs with overflow, reorder, pinning, grouping, persistence, keyboard behavior, and the required current-strip, per-group, group-name, and all-window searches.
- Every search surface defaults to plain text and has an adjacent, field-bound full regex builder. The builder uses the project's JavaScript regex dialect, validates input, bounds work, handles zero-width matches, exposes captures and flags, and never runs an empty or invalid destructive query.
- Settings, history, changelog, tab lists, and appearance editors each have their own search field and builder state. Do not share hidden query state across unrelated fields.
- Appearance editing is per element, persisted, resettable, exportable, and accessible. Unsupported styling values remain visible with a capability explanation rather than being discarded.
- A startup dim-sum surprise draws on one launch in ten and carries no off switch. It is local-only, non-blocking, focus-neutral, reduced-motion aware, suppressed during first run/errors/updates, and based only on verified repository-catalog assets. Do not generate or download substitute images.
- External-editor integration detects installed editors, permits a user choice, persists it, and fails with a clear non-blocking message.

## Local data and history

- Persist data atomically and serialize concurrent writes. An unchanged state creates no history record.
- Every user-managed record and setting belongs in local history. Restores append a new revision; they never rewrite or delete prior history.
- History search, derived action filters, and typed/calendar date ranges compose. Export output must match the visible filters.
- Encryption metadata must use stable identifiers that survive delete and restore. Sensitive snapshot data must not become less protected than live data.
- A history-write failure must not corrupt the primary operation; surface it honestly and preserve recoverable state.

## Documentation and site

- Each feature has a Markdown article under a categorized `docs/` folder. Every article covers behavior, configuration, failure modes, security considerations, verification, current status, and suggested related articles.
- Category folders have `README.md` indices. Keep `README.md`, `ROADMAP.md`, `HANDOFF.md`, the landing site, and affected articles current in the same task as a behavior change.
- The landing/docs site is local and self-contained: no CDN scripts, web fonts, remote images, analytics, or tracking. It must list every current feature, label gaps, expose language/humor/theme/density controls, use accessible browser-style tabs, and provide bounded plain/regex documentation search.
- Keep the root README compact: project description, install line, documentation link, short contents, and collapsible reference sections.
- Do not invent a hosted URL, release, installer, version history, CI result, screenshot, or support policy.

## Git and GitHub

- Use `git` for local version control and `gh` for GitHub operations. Do not substitute browser automation, plugins, connectors, or raw clients.
- Inspect status and diff before recording changes. Preserve unrelated work and do not use destructive reset or checkout commands.
- Commit messages use a concise English subject and an English plus playful Hong Kong-style Cantonese body. Humor may roast code behavior, never people, and must not obscure facts.
- Do not force-push or rewrite published history without explicit approval.
- For a repository-changing task, scan open issues before completion and again at natural checkpoints. Handle actionable issues with traceable progress and verification; do not close unverified work.
- Keep one factual rolling progress discussion and, when a release genuinely exists, one changelog announcement per release. Do not create duplicates or imply green checks before they finish.
- Before completion, inspect branches, worktrees, and stashes; integrate completed work into the default branch, push it, and prove the intended commit is contained by the remote default branch. Never delete uncommitted, unmerged, or unpushed work.

## Build, release, and distribution

- CI must eventually run on every push and manual dispatch, test before publishing, and create no release on failure.
- A successful release uses a unique immutable tag and attaches a genuinely built Windows installer plus required local catalog assets. A configured packaging command is not release evidence.
- Prefer a GitHub-hosted Windows runner. Use self-hosted infrastructure only for a measured requirement and never expose it to untrusted pull-request code.
- Never spend private CI minutes or expose private source when the repository is private; use the approved encrypted public-builder workflow. Public repositories use ordinary hosted runners.
- Before calling an installer verified, test build, signature posture, clean install, launch, upgrade, uninstall, retained-data behavior, and artifact integrity on a clean Windows environment.
- Keep release notes, in-app changelog, About surface, documentation version, landing page, repository homepage, wiki, and Pages deployment synchronized only after the corresponding artifact exists.

## Completion standard

Run proportionate local tests and report exact commands and outcomes. A task is complete only when its requested behavior, documentation, tests, accessibility checks, integration, push, and relevant external verification are genuinely complete. If an external dependency remains, finish all unblocked work and record the exact blocker without predicting success.
