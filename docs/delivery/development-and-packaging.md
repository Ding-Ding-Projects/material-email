# Development and packaging

## Status

**The local Windows installer lifecycle is verified; distribution remains unverified.** Do not present a download or installer link.

## Behavior

`npm run dev` bundles the Electron main/preload processes, launches Vite on loopback, waits for it, then starts Electron. Only an unpackaged process can honor `MATERIAL_EMAIL_DEV_URL`, and then only for HTTP at the exact host `127.0.0.1` or `[::1]`. Packaged processes ignore the variable and load the exact bundled renderer file. `npm run build` bundles main and preload with esbuild and builds renderer assets with Vite. `npm run check` runs type checking, tests, and a production build.

`npm run dist:win` runs the full check and invokes electron-builder for an x64 NSIS package. The configured installer is assisted rather than one-click, permits install-directory choice, creates desktop and Start-menu shortcuts, and intentionally retains application data on uninstall.

`npm run verify:package` requires exactly one top-level x64 NSIS installer with the versioned artifact name, a minimum size, valid DOS and PE signatures, and the explicit retained-data policy; it reports the SHA-256 digest. `npm run verify:installer` silently installs that exact file into a temporary directory, launches the installed executable through `--ci-smoke`, compares its version, code name, and release date with the built metadata, silently uninstalls it, proves the executable is gone and an isolated user-data probe survived, and then removes the synthetic test data.

## Configuration

- Product version: development `0.1.0`
- Artifact pattern: `Material-Email-${version}-Windows-${arch}.${ext}`
- Output directory: `release/`
- Application archive: ASAR enabled
- Installer target: NSIS x64
- Development metadata date: empty, because a source build is not a release
- Release metadata date: `MATERIAL_EMAIL_RELEASE_DATE`, validated as an actual UTC `YYYY-MM-DD` date
- Workflow version: unique `0.<run number>.<run attempt>` with a matching immutable `v<version>` tag

## Failure modes

- A local lifecycle pass does not prove a clean-machine install, upgrade, interactive first-run flow, public-provider mail behavior, or enterprise-policy compatibility.
- PE structure and SHA-256 establish artifact identity, not publisher authenticity; the current installer is unsigned.
- Missing `LICENSE` breaks the configured package file set.
- Absolute asset paths or an incorrect Vite base can work in development and fail after packaging.
- A non-HTTP, credential-bearing, non-loopback, or look-alike development URL is rejected rather than loaded.
- Antivirus, Windows SmartScreen, long paths, non-ASCII user profiles, and restricted enterprise policies can change behavior.
- Electron Builder currently uses its default application icon because the repository has no approved Windows icon asset.

## Security considerations

Never embed credentials, source maps containing secrets, development URLs, or writable code outside ASAR. Keep the packaged environment-variable bypass closed and retain exact renderer-path plus current-window/top-frame authentication on every IPC handler. Establish code signing and provenance before public distribution. The lifecycle harness uses only synthetic, isolated data and confirms both the `deleteAppDataOnUninstall: false` configuration and retention of its probe; default-profile retention still needs a clean disposable Windows account. Release only from a test-gated workflow and attach the exact installer produced by that run.

## Verification

At the recorded 2026-08-01 UTC packaging checkpoint, `npm run dist:win` passed type checking, 12 test files / 43 tests, verification of 10 unique catalogued dim-sum PNGs, site and source-policy checks, and the 7-module renderer production build. The resulting `Material-Email-0.1.0-Windows-x64.exe` was 126,143,280 bytes with SHA-256 `e112c454e582e025be807c451026ab834e7b3b8aeb5876928e03145d5d9d803d`. Both package verifiers passed: the installed app reported `0.1.0`, `Classic Har Gow · 蝦餃`, and `2026-08-01`; uninstall removed the executable, process, shortcuts, and uninstall registration while the isolated retention probe remained until QA cleanup. Windows reported Authenticode status `NotSigned`. That installer checkpoint predates the current corrections. On the current working tree, `npm run check` passes 22 test files / 96 tests and the production build, while `npm run test:e2e` passes all 15 real-Electron scenarios. The installer must still be rebuilt and its lifecycle reverified before it can carry these corrections.

The release workflow is configured and its action references exist. Current GitHub Actions syntax supports its `concurrency.queue: max` setting; `actionlint` 1.7.12 reports that one new key as unknown but reports no other problem. A hosted CI run, release attachment, clean-machine/default-profile test, upgrade, signing, approved application icon, and Pages deployment remain unverified.

## Suggested articles

- [Verification matrix](verification.md)
- [Windows Electron foundation](../architecture/windows-electron-foundation.md)
- [Current handoff](../../HANDOFF.md)
