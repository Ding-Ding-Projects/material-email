# Development and packaging

## Status

**The local gate, the packaging path, and the release workflow are implemented; none of them is currently proved.** This checkout has no `release/` output, so neither package verifier can run against an artifact here, and no hosted workflow run is recorded anywhere in the repository. The installer lifecycle evidence below is historical and predates the current tree. Do not present a download or installer link.

## Behavior

`npm run dev` bundles the Electron main and preload processes with esbuild, starts Vite bound to `127.0.0.1`, waits for `http://127.0.0.1:5173`, then launches Electron with `MATERIAL_EMAIL_DEV_URL` set to that address. Only an unpackaged process honors the variable, and then only for HTTP at the exact host `127.0.0.1` or `[::1]`. Packaged processes ignore it and load the exact bundled renderer file.

`npm run build` clears `dist/`, bundles `src/main/index.ts` to `dist/main/index.cjs` and `src/preload/index.ts` to `dist/main/preload.cjs` with source maps, runs the Vite renderer build, copies `src/renderer/assets` into `dist/renderer/assets`, and writes `dist/release-metadata.json` from the release environment variables.

`npm run check` is the local gate and runs six steps in order: `typecheck`, `test`, `verify:assets`, `verify:site`, `verify:source-policy`, `build`. `npm test` is Vitest over `tests/**/*.test.ts` in a Node environment; it never starts Electron. The Playwright Electron suite under `tests/e2e` runs only through `npm run test:e2e`, which builds first and then runs Playwright with one worker and no retries. Nothing in the release workflow invokes it.

`npm run dist:win` runs the full `check` chain and then `electron-builder --win nsis --x64`. The configured installer is assisted rather than one-click, permits install-directory choice, creates desktop and Start-menu shortcuts, and intentionally retains application data on uninstall.

### What each verification script proves

`npm run verify:assets` reads `src/renderer/assets/dim-sum/release-catalog.json` and requires every record to carry an id, both names, a filename, a hash, and a catalog commit; rejects duplicate ids, filenames, or image hashes; rejects a path-bearing or non-PNG filename; and requires each file to start with the PNG signature and `IHDR`, to be at least 1024 × 1024, and to match its recorded SHA-256.

`npm run verify:site` assembles the Pages bundle three times in a temporary directory — development, published, and published-after-catalog-exhaustion — and checks the source site plus every assembled artifact: local content-security policy, tab semantics and live tabpanel relationships, the three language modes, independent humor controls, the bounded regex builder, theme and density controls, reduced motion, visible focus, absence of remote assets and analytics, repository-subpath-safe routing, one permitted absolute source URL, that every documentation link and all ten dim-sum references resolve inside the bundle, that release decoration stays all-or-none, that the Pages job assembles rather than uploading `site/` raw, and that every article outside a category index ends with a suggested-articles section. Assembly itself resolves every Markdown link in the bundle and fails on one that is broken or escapes the artifact.

`npm run verify:source-policy` scans the publishable text files under `src`, `tests`, `docs`, `site`, and `.github` plus the seven root Markdown documents for a forbidden external product name and for `blob`/`tree` source links to any repository other than `LibreOffice/core`.

`npm run verify:package` requires the packaging configuration to declare output directory `release`, the artifact pattern `Material-Email-${version}-Windows-${arch}.${ext}`, exactly one NSIS x64 target, and `deleteAppDataOnUninstall: false`; then requires exactly one top-level `.exe` in `release/` named for the current `package.json` version, at least 20,000,000 bytes, with a valid DOS header and PE signature; then reports the SHA-256. It inspects only the top level of `release/`, and DOS/PE structure is not an Authenticode check. It never installs or launches anything.

`npm run verify:installer` refuses to run off Windows. It reads `dist/release-metadata.json` by default and requires that metadata to match the installer version, the `MATERIAL_EMAIL_*` release variables when they are set, the all-or-none decoration rule, the dish/asset/commit formats, and a real UTC release date. It then installs the artifact silently into a temporary directory, requires the installed executable and exactly one uninstaller, and launches the packaged executable through `--ci-smoke` with `MATERIAL_EMAIL_USER_DATA_DIR` pointed at an isolated profile that must not already exist. That first smoke must report success, the expected version, code name, and release date, the `isolated-user-data` profile boundary, first-run state, and preferences and window state exactly equal to the deterministic default fixture.

The same run then writes a random retention probe, patches the deterministic retained settings fixture and a window-state file into that isolated profile, launches the candidate again, and rejects any difference from the retained fixture. It hashes the settings and window-state files, uninstalls silently, requires the executable to disappear, and requires the probe plus both state files to be unchanged afterwards. Every report records `cleanMachine`, `defaultWindowsProfile`, `interactiveFirstLaunch`, and `authenticodeSignatureChecked` as `false` and `authenticode.status` as `not-verified`; the harness has no way to promote isolated-temporary-profile evidence into those stronger claims.

`--baseline <prior-installer.exe>` turns the run into a strict upgrade. It validates and hashes both PE files, refuses an equal-version reinstall or a downgrade, installs and launches the baseline, seeds the probe and fixture, installs the candidate into the same isolated install directory, and requires the seeded hashes to be unchanged before the candidate launches. The candidate is launched once against a separate absent profile to check current defaults and once against the retained profile to check the seeded values. `--candidate`, `--metadata`, and `--report` accept an explicitly built artifact, a metadata file, and a report path; each flag may appear only once. Spawned executables get 120 seconds, and the uninstalled executable gets 30 seconds to disappear.

`scripts/verify-site-artifact.mjs` and `scripts/verify-site-runtime.mjs` have no npm script. The first is imported by `verify:site` and invoked directly by the Pages job; the second is a standalone Playwright Chromium harness that serves assembled bundles over loopback, exercises the published and development routes, and writes screenshots into `test-results/site-runtime`.

## Release workflow

`.github/workflows/windows-release.yml` triggers on `push` to `main` and on `workflow_dispatch`. There is no tag, pull-request, or schedule trigger. The file declares read-only default permissions, raises `contents: write` on the release job only, and holds a `material-email-release` concurrency group that does not cancel a run in progress and additionally declares `queue: max`. `GH_TOKEN` resolves as `RELEASE_TOKEN || ORG_TOKEN || GITHUB_TOKEN`, and `CSC_IDENTITY_AUTO_DISCOVERY` is disabled because nothing is signed.

The `windows-release` job runs on `windows-latest` with a 60-minute timeout: full-depth checkout, Node from `.node-version`, then `node scripts/count-lines.mjs --rev <built commit>` before `npm ci`, so that counter must stay dependency-free. The run fails if the counter errors or produces no project and grand total, and the publish step fails again if the saved table is missing or incomplete, so no release ships without its line-count table. The job then picks the first catalog dish whose filename is not already a published release asset — retrying the releases API three times and failing rather than guessing if the API never answers — and verifies that photo's existence, SHA-256, and 1024 × 1024 minimum before use. An exhausted catalog produces empty decoration outputs instead of a reused dish. The version is `0.<run number>.<run attempt>` with both components bounded to 65535, and the release date is the UTC day of the run.

Before publishing, the job resolves the newest non-draft, non-prerelease release, requires exactly one asset matching the versioned Windows x64 installer name, downloads it with retries, and compares the downloaded size to the size the API reported. It then runs `npm test`, `npm run dist:win` (which re-runs the whole local gate), `npm run verify:package`, and `npm run verify:installer` with the resolved baseline when one exists. It parses the lifecycle report and fails unless the run reported success, executable removal, retained user data, an absent candidate profile, a verified clean isolated launch, verified default and retained settings and window state, and retained settings and window state after uninstall. It also fails if the report claims a clean machine, a default Windows profile, an interactive first launch, or any Authenticode check. With a baseline it additionally requires the upgrade, the reused install directory, the retained probe and state after upgrade, a baseline version matching the resolved one, and consistent hashes; without a baseline it fails if the report claims an upgrade at all.

Publication is a single `gh release create` at the built commit carrying the installer and, when one was assigned, the catalog photo, with notes stating the version, code name, UTC date, source commit, lifecycle summary, asset sizes and SHA-256 digests, catalog commit, the line-count table, and an unsigned-build warning. A following step re-fetches the tag, requires it to resolve to the built commit, requires the release to be neither draft nor prerelease, requires exactly one asset without a photo or two with one, downloads each published asset, and compares its SHA-256 against the digest computed before upload.

A second job, `pages`, depends on the release job and runs on `ubuntu-latest`. It checks out the source, sets up Node, and runs `node scripts/verify-site-artifact.mjs --output "$RUNNER_TEMP/material-email-pages" --published` with the release job's version, date, code name, photo, tag, and release URL, then uses `configure-pages`, `upload-pages-artifact`, and `deploy-pages` against the `github-pages` environment. It never runs `npm ci`, so the artifact assembler must stay free of runtime dependencies. No deployment from this job is recorded.

## Configuration

- Product version: development `0.1.0`
- Node.js: `.node-version` pins `26.4.0`, and CI installs from that file
- Artifact pattern: `Material-Email-${version}-Windows-${arch}.${ext}`
- Output directory: `release/`
- Application archive: ASAR enabled; packaged file set is `dist/**/*`, `package.json`, and `LICENSE`
- Installer target: exactly one NSIS x64 target
- Application icon: none configured, so electron-builder uses its default icon
- Code signing: none configured, and the workflow disables signing-identity discovery
- Development metadata date: empty, because a source build is not a release
- Release metadata date: `MATERIAL_EMAIL_RELEASE_DATE`, validated as an actual UTC `YYYY-MM-DD` date
- Release decoration: code name, dish ID, PNG asset, and catalog commit are all present together or all empty; a dated release with an exhausted catalog never falls back to the development dish
- Workflow version: `0.<run number>.<run attempt>` with a `v<version>` tag created at the built commit and re-resolved against that commit after publication

## Failure modes

- A local lifecycle pass does not prove a clean-machine install, the default Windows user-data profile, an interactive first-run flow, public-provider mail behavior, or enterprise-policy compatibility. An absent temporary directory is a clean isolated fixture, not a clean operating-system environment. An explicit baseline run proves only the isolated in-place upgrade it records.
- PE structure and SHA-256 establish artifact identity, not publisher authenticity; the current installer is unsigned.
- `verify:package` looks only at the top level of `release/`, so nested build output is neither counted nor inspected.
- `verify:installer` refuses to run off Windows and refuses a candidate that is not strictly newer than a supplied baseline.
- Missing `LICENSE` breaks the configured package file set.
- Absolute asset paths or an incorrect Vite base can work in development and fail after packaging.
- A non-HTTP, credential-bearing, non-loopback, or look-alike development URL is rejected rather than loaded.
- A prior release carrying zero or several matching installer assets stops the workflow before anything is built.
- A releases API that never answers stops the workflow rather than reusing a code name or skipping the baseline.
- Adding a runtime dependency to the site artifact assembler would break the Pages job, which installs nothing.
- No run has ever loaded this workflow file, so a schema error — an unrecognized key such as `concurrency.queue`, for example — would first appear as a refused run rather than as a failing step.
- Antivirus, Windows SmartScreen, long paths, non-ASCII user profiles, and restricted enterprise policies can change behavior.
- An exhausted catalog ships a release with no code name and one asset rather than reusing a dish.

## Security considerations

Never embed credentials, source maps containing secrets, development URLs, or writable code outside ASAR. Keep the packaged environment-variable bypass closed and retain exact renderer-path plus current-window/top-frame authentication on every IPC handler. Establish code signing and provenance before public distribution. The lifecycle harness uses only synthetic, isolated data and confirms both the `deleteAppDataOnUninstall: false` configuration and retention of its settings, window-state, and random probe files; default Windows-profile retention still needs a clean disposable Windows account. The release token is only ever passed through `GH_TOKEN` and is never printed. Release only from the test-gated workflow and attach the exact installer produced by that run.

## Verification

Run for this documentation pass, on Windows, against the working tree:

- `npx vitest run tests/installer-upgrade.test.ts tests/release-contract.test.ts` — 2 files / 10 tests passed, covering installer name and strict-upgrade rules, verifier argument parsing, PE inspection of an explicitly named installer, the retained-profile fixture patch, exact default/retained smoke acceptance, the refusal to make stronger Windows claims, and the catalog-exhausted build, release-asset, and Pages contracts.
- `node scripts/verify-source-policy.mjs` — passed; it scanned 216 publishable text files, a count that moves as source files are added.
- `node scripts/verify-dim-sum-assets.mjs` — 10 unique 1254 × 1254 catalogued PNGs passed.
- `npm run verify:site` — passed, including 31 feature articles and the Markdown-link resolution of every assembled bundle.

Not run here: `npm run typecheck`, `npm test`, `npm run build`, `npm run test:e2e`, `npm run dist:win`, `npm run verify:package`, `npm run verify:installer`, and `scripts/verify-site-runtime.mjs`. The last three need a built installer, and `release/` does not exist in this checkout.

Historical local records, none of them re-run and none matching the current working tree: a 2026-08-01 UTC packaging checkpoint in which `npm run dist:win` produced `Material-Email-0.1.0-Windows-x64.exe` at 126,143,280 bytes with SHA-256 `e112c454e582e025be807c451026ab834e7b3b8aeb5876928e03145d5d9d803d`, both package verifiers passed, the installed app reported `0.1.0`, `Classic Har Gow · 蝦餃`, and `2026-08-01`, uninstall removed the executable, process, shortcuts, and uninstall registration, and Windows reported Authenticode status `NotSigned`; and an upgrade run on Windows 10.0.26200 from published baseline `0.19.1` to a disposable `0.999.1` candidate built from commit `22129fc`, recording baseline SHA-256 `22588b7f326a0fe0d4e9542f99debdf927bcd7764186752d80ac5472836cae06`, candidate SHA-256 `afae75f001fdbacc3a6b4f87a60408939fbdd3dc7b82014dd15f0e30ee3d08a6`, same-directory replacement, candidate removal on uninstall, and probe SHA-256 `3b22cb8daa3037fd87493b3e4fe24a1e0669ad71194115c87547583fc834d3de` unchanged. That upgrade run predates the settings/window fixture, and its host was neither clean nor a default-profile disposable machine.

Never proved: a hosted workflow run of any kind, a published release, a Pages deployment, a clean-machine or default-Windows-profile install, an interactive first launch, an Authenticode check, and an approved application icon.

## Suggested articles

- [Verification matrix](verification.md)
- [Windows Electron foundation](../architecture/windows-electron-foundation.md)
- [Current handoff](../../HANDOFF.md)
