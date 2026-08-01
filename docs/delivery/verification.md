# Verification matrix

## Status

This matrix records evidence for the current development tree. It is not release certification.

| Area | Evidence | Current result | Remaining proof |
| --- | --- | --- | --- |
| Dependencies | `npm ci` | Reported pass | Reproduce in CI |
| Electron runtime | Playwright Electron E2E | Previously recorded suite: 15 / 15; this change's focused consent/restart and bilingual scenarios: 2 / 2. The expanded full suite was not rerun in this pass. | Run the expanded full suite in CI; clean VM, screen reader, and full display-scale matrix |
| Types | `npm run typecheck` | Passed in the final local `npm run check` gate | Repeat in CI |
| Tests | `npm test` | 36 files / 182 tests passed in the final local gate, including bounded MIME, remote-content sanitizer, history retention, persistence, IPC, and CSP assertions | Repeat in CI |
| Bundled images | `npm run verify:assets` | 10 unique 1254 × 1254 PNGs decode and match the catalog | Repeat in CI and release workflow |
| Dependency audit | `npm audit` | 0 known vulnerabilities reported at scan time | Continuous scan; audit is not a security review |
| Build | `npm run build` | Passed; Vite transformed 8 renderer modules | Repeat exact source in CI |
| Message safety | MIME/sanitizer, persistence/IPC, and real-Electron consent tests | Raw/header/body/attachment ceilings, bounded IMAP reads, stable cache-safe failures, malformed fallback, default-deny image removal, exact-origin summary, persisted allow/revoke, scoped image CSP, focus return, restart, and bilingual semantics passed locally | Broad malformed corpus, parser wall-time isolation, live provider/image servers, certificate UX, full reader accessibility matrix |
| Persistence | JSON/history recovery, cleanup tests, and restart E2E | Account removal purges live cache/drafts/outbox/pending operations while append-only history remains; two Electron restart paths passed | disk-full, real power-loss, antivirus-lock timing, migration, DPAPI |
| IPC and local files | sender-authentication, strict-schema, path-authorization, and Electron coverage | Every channel authenticates current main `WebContents`, top frame, and exact trusted renderer location; a second real `WebContents` and a loopback redirect were denied, mailto delivery remained trust-gated, and same-file fragment navigation remained trusted | packaged native-dialog matrix and adversarial IPC fuzzing |
| Account discovery | parser tests | Pass reported | live provider discovery and consent/error UX |
| Mail protocols | local socket integration and exact-outcome regressions | False mutations fail; MOVE fails closed without capability and consumes destination UID/UIDVALIDITY; every UID action verifies the live generation; permanent all-recipient 5xx retains the draft and exact rejects; newer concurrent drafts survive send completion | live provider, provider MOVE variants, certificate, and offline matrix |
| Renderer | typed integration plus state/accessibility Electron regressions | Compose/PIM baselines, replacement/unload protection, concurrent draft/send preservation, monotonic mail-view ownership, PIM save ownership and refresh retry, discard focus return/trap, semantic bilingual spans at 760 × 560, and revision-aware no-op copy passed | complete keyboard/screen-reader matrix, visuals at 100/125/150/200%, all humor levels |
| Installer | `dist:win`, `verify:package`, `verify:installer` | Exact x64 NSIS artifacts are PE/hash checked; published `0.19.1` → disposable `0.999.1` was installed and smoke-versioned in one isolated directory, with an unchanged user-data hash through upgrade and uninstall | Repeat the new gate in hosted CI; clean VM/default profile, approved icon, code signing |
| CI/release | Workflow audit | Trigger, queued concurrency, version/tag, token fallback, photo, release and Pages dependency configured; no hosted run | Passing run, immutable tag, downloaded installer/photo proof |
| Documentation site | `npm run verify:site` plus the real-browser site harness | Local structural/bundle verification and 13 development/published browser checks passed | Pages deployment and live base-path proof |

## Configuration

Use `npm run check` for the local code gate, then `npm run dist:win`, `npm run verify:package`, and `npm run verify:installer` for local packaging proof. Add `-- --baseline <prior-installer.exe>` to prove a strict baseline-to-candidate upgrade; the verifier rejects equal versions and downgrades. Verify the site separately with a browser or headless DOM-capable harness. Release certification still requires a clean disposable Windows environment rather than only the development host.

## Failure modes

- Test counts can change while another implementation task is active.
- Source inspection can confirm a boundary exists but not that every runtime path honors it.
- A green CI run can publish the wrong artifact if provenance is not checked.
- Screenshots from development mode do not prove the packaged build.
- A successful isolated user-data probe does not replace default-profile uninstall testing on a disposable Windows account.

## Security considerations

Keep test fixtures synthetic. Never use a real account, token, private message, or personal attachment in logs or screenshots. Record exact commands, commit IDs, artifact hashes, and run URLs only after they exist.

## Verification procedure

1. Record `git status` and preserve unrelated work.
2. Run `npm ci`, `npm run typecheck`, `npm test`, `npm run build`, and `npm audit`.
3. Exercise every renderer panel with keyboard, screen reader, reduced motion, narrow width, and 100/125/150/200% scale.
4. Test live mail through secure credential intake with synthetic messages.
5. Build and exercise the NSIS installer on a clean Windows machine.
6. Verify the exact remote CI run and release assets before changing status to released.

## Suggested articles

- [Development and packaging](development-and-packaging.md)
- [Security boundaries](../architecture/security-boundaries.md)
- [Roadmap](../../ROADMAP.md)
