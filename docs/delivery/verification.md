# Verification matrix

## Status

This matrix records evidence for the current development tree and names the provenance of every row: re-run in this pass, or last recorded and not re-run. It is not release certification. The working tree carries uncommitted implementation work, so any figure not re-run here describes an earlier tree.

| Area | Evidence | Current result | Remaining proof |
| --- | --- | --- | --- |
| Dependencies | `npm ci` | Last recorded local install; not re-run | Reproduce in CI; no hosted run is recorded |
| Types | `npm run typecheck` | Re-run in this pass against the current tree: passed | Repeat in CI |
| Unit tests | `npm test` (Vitest over `tests/**/*.test.ts`) | Re-run in this pass against the current tree: 73 files / 522 tests passed. The count moves as files are added. | Re-run the full suite against the current tree and in CI |
| Electron end-to-end | `npm run test:e2e` (Playwright over `tests/e2e`) | 28 spec files are present. The last recorded figure was a 15-scenario suite; neither it nor the current set was run in this pass, and the release workflow never invokes this suite. | Run the full suite locally and in CI; clean VM, screen reader, and full display-scale matrix |
| Bundled images | `npm run verify:assets` | Re-run in this pass: 10 unique 1254 × 1254 catalogued PNGs decode and match their hashes | Repeat in CI and the release workflow |
| Source policy | `npm run verify:source-policy` | Re-run in this pass: the scan of 221 publishable text files passed, and that count moves as source files are added | Repeat in CI |
| Documentation site | `npm run verify:site` | Re-run in this pass: source, development, published, and catalog-exhausted bundles pass, including 32 feature articles and every assembled Markdown link | Run `node scripts/verify-site-runtime.mjs` again; Pages deployment and live base-path proof |
| Dependency audit | `npm audit` | Last recorded scan reported 0 known vulnerabilities; not re-run | Continuous scan; an audit is not a security review |
| Build | `npm run build` | Re-run in this pass: passed. Older records disagree on the renderer module count, so no module figure is claimed here. | Repeat the exact source in CI |
| Message safety | Last recorded MIME/sanitizer, persistence/IPC, and real-Electron consent tests | Raw/header/body/attachment ceilings, bounded IMAP reads, stable cache-safe failures, malformed fallback, default-deny image removal, exact-origin summary, persisted allow/revoke, scoped image CSP, focus return, restart, and bilingual semantics passed in that run | Broad malformed corpus, parser wall-time isolation, live provider/image servers, certificate UX, full reader accessibility matrix |
| Persistence | Last recorded JSON/history recovery, cleanup tests, and restart E2E | Account removal purged live cache/drafts/outbox/pending operations while append-only history remained; two Electron restart paths passed | disk-full, real power-loss, antivirus-lock timing, migration, DPAPI |
| IPC and local files | Last recorded sender-authentication, strict-schema, path-authorization, and Electron coverage | Every channel authenticated the current main `WebContents`, top frame, and exact trusted renderer location; a second real `WebContents` and a loopback redirect were denied, mailto delivery remained trust-gated, and same-file fragment navigation remained trusted | packaged native-dialog matrix and adversarial IPC fuzzing |
| Account discovery | Last recorded parser tests | Pass reported | live provider discovery and consent/error UX |
| Mail protocols | Last recorded local socket integration and exact-outcome regressions | False mutations fail; MOVE fails closed without capability and consumes destination UID/UIDVALIDITY; every UID action verifies the live generation; permanent all-recipient 5xx retains the draft and exact rejects; newer concurrent drafts survive send completion | live provider, provider MOVE variants, certificate, and offline matrix |
| Renderer | Last recorded typed integration plus state/accessibility Electron regressions | Compose/PIM baselines, replacement/unload protection, concurrent draft/send preservation, monotonic mail-view ownership, PIM save ownership and refresh retry, discard focus return/trap, semantic bilingual spans at 760 × 560, and revision-aware no-op copy passed | complete keyboard/screen-reader matrix, visuals at 100/125/150/200%, all humor levels |
| Installer | `npm run dist:win`, `npm run verify:package`, `npm run verify:installer` | Neither package verifier can run in this checkout: `release/` does not exist, so no artifact is present. Re-run in this pass: the focused delivery contracts in `tests/installer-upgrade.test.ts` and `tests/release-contract.test.ts`, 2 files / 10 tests passed. The published `0.19.1` → disposable `0.999.1` artifact evidence remains historical. | Build the artifact, then run both verifiers in hosted CI and on a clean VM with the default Windows profile; interactive first launch, approved icon, and Authenticode checks |
| CI and release | Source audit of `.github/workflows/windows-release.yml` | `push` to `main` and `workflow_dispatch` triggers, a non-cancelling release concurrency group, the `RELEASE_TOKEN`/`ORG_TOKEN`/`GITHUB_TOKEN` fallback, catalog-photo selection, baseline resolution, lifecycle-report gating, post-publication asset re-download, and a dependent Pages job are all configured. No hosted run, published release, or Pages deployment is recorded. | A passing run, a tag resolving to the built commit, and downloaded installer/photo proof |

## Configuration

Use `npm run check` for the local code gate — `typecheck`, `test`, `verify:assets`, `verify:site`, `verify:source-policy`, `build` — then `npm run dist:win`, `npm run verify:package`, and `npm run verify:installer` for local packaging proof. Add `-- --baseline <prior-installer.exe>` to prove a strict baseline-to-candidate upgrade; the verifier rejects equal versions and downgrades. Its absent isolated profile is deterministic local evidence only: the report is required to keep clean machine, default Windows profile, interactive first launch, and Authenticode checking false. Run `npm run test:e2e` separately for the Playwright Electron suite, and `node scripts/verify-site-runtime.mjs` for the real-browser site harness, which serves assembled bundles over loopback and writes screenshots into `test-results/site-runtime`. Release certification still requires a clean disposable Windows environment rather than only the development host.

## Failure modes

- Test counts change while another implementation task is active, so a figure is only meaningful with the commit it was measured at.
- Source inspection can confirm a boundary exists but not that every runtime path honors it.
- The release workflow runs `npm test` but never the Playwright Electron suite, so a regression that only that suite covers can reach a release.
- A green CI run can publish the wrong artifact if provenance is not checked.
- Screenshots from development mode do not prove the packaged build.
- A successful absent isolated-profile probe does not replace default Windows-profile install and uninstall testing on a disposable Windows account.

## Security considerations

Keep test fixtures synthetic. Never use a real account, token, private message, or personal attachment in logs or screenshots. Record exact commands, commit IDs, artifact hashes, and run URLs only after they exist.

## Verification procedure

1. Record `git status` and preserve unrelated work.
2. Run `npm ci`, then the six `npm run check` steps, then `npm audit`.
3. Run `npm run test:e2e` and `node scripts/verify-site-runtime.mjs`.
4. Exercise every renderer panel with keyboard, screen reader, reduced motion, narrow width, and 100/125/150/200% scale.
5. Test live mail through secure credential intake with synthetic messages.
6. Run `npm run dist:win`, `npm run verify:package`, and `npm run verify:installer`, then exercise the NSIS installer on a clean Windows machine under the default user profile.
7. Verify the exact remote CI run, the tag's commit, and the downloaded release assets before changing status to released.

## Suggested articles

- [Development and packaging](development-and-packaging.md)
- [Security boundaries](../architecture/security-boundaries.md)
- [Roadmap](../../ROADMAP.md)
