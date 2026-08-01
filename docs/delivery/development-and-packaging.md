# Development and packaging

## Status

**The local Windows installer lifecycle is verified; distribution remains unverified.** Do not present a download or installer link.

## Behavior

`npm run dev` bundles the Electron main/preload processes, launches Vite on loopback, waits for it, then starts Electron. Only an unpackaged process can honor `MATERIAL_EMAIL_DEV_URL`, and then only for HTTP at the exact host `127.0.0.1` or `[::1]`. Packaged processes ignore the variable and load the exact bundled renderer file. `npm run build` bundles main and preload with esbuild and builds renderer assets with Vite. `npm run check` runs type checking, tests, and a production build.

`npm run dist:win` runs the full check and invokes electron-builder for an x64 NSIS package. The configured installer is assisted rather than one-click, permits install-directory choice, creates desktop and Start-menu shortcuts, and intentionally retains application data on uninstall.

`npm run verify:package` requires exactly one top-level x64 NSIS installer with the versioned artifact name, a minimum size, valid DOS and PE signatures, and the explicit retained-data policy; it reports the SHA-256 digest. `npm run verify:installer` silently installs that exact file into a temporary directory, launches the installed executable through `--ci-smoke`, compares its version, code name, and release date with the built metadata, silently uninstalls it, proves the executable is gone and an isolated user-data probe survived, and then removes the synthetic test data.

Passing `--baseline <prior-installer.exe>` changes the verifier into a strict upgrade run. It validates and hashes both PE files, refuses an equal-version reinstall or downgrade, installs and launches the baseline, creates a synthetic probe in an isolated user-data directory, installs the candidate into the same isolated install directory, launches and version-checks the candidate, and requires the probe SHA-256 to remain identical after both upgrade and uninstall. `--candidate` and `--metadata` permit an explicitly built candidate outside the repository output directory. The JSON report identifies both artifact hashes, both smoke-reported versions, installed-executable hashes, the Windows version, and the limits of the evidence (`cleanMachine: false`, `defaultWindowsProfile: false`).

## Configuration

- Product version: development `0.1.0`
- Artifact pattern: `Material-Email-${version}-Windows-${arch}.${ext}`
- Output directory: `release/`
- Application archive: ASAR enabled
- Installer target: NSIS x64
- Development metadata date: empty, because a source build is not a release
- Release metadata date: `MATERIAL_EMAIL_RELEASE_DATE`, validated as an actual UTC `YYYY-MM-DD` date
- Release decoration: code name, dish ID, PNG asset, and catalog commit are all present together or all empty; a dated release with an exhausted catalog never falls back to the development dish
- Workflow version: unique `0.<run number>.<run attempt>` with a matching immutable `v<version>` tag

## Failure modes

- A local lifecycle pass does not prove a clean-machine install, interactive first-run flow, public-provider mail behavior, or enterprise-policy compatibility. An explicit baseline run does prove the isolated in-place upgrade it records, not every upgrade path or machine policy.
- PE structure and SHA-256 establish artifact identity, not publisher authenticity; the current installer is unsigned.
- Missing `LICENSE` breaks the configured package file set.
- Absolute asset paths or an incorrect Vite base can work in development and fail after packaging.
- A non-HTTP, credential-bearing, non-loopback, or look-alike development URL is rejected rather than loaded.
- Antivirus, Windows SmartScreen, long paths, non-ASCII user profiles, and restricted enterprise policies can change behavior.
- An exhausted catalog can leave blank photo paths in notes or verification unless the installer-only one-asset contract is selected explicitly.
- Electron Builder currently uses its default application icon because the repository has no approved Windows icon asset.

## Security considerations

Never embed credentials, source maps containing secrets, development URLs, or writable code outside ASAR. Keep the packaged environment-variable bypass closed and retain exact renderer-path plus current-window/top-frame authentication on every IPC handler. Establish code signing and provenance before public distribution. The lifecycle harness uses only synthetic, isolated data and confirms both the `deleteAppDataOnUninstall: false` configuration and retention of its probe; default-profile retention still needs a clean disposable Windows account. Release only from a test-gated workflow and attach the exact installer produced by that run.

## Verification

At the recorded 2026-08-01 UTC packaging checkpoint, `npm run dist:win` passed type checking, 12 test files / 43 tests, verification of 10 unique catalogued dim-sum PNGs, site and source-policy checks, and the 7-module renderer production build. The resulting `Material-Email-0.1.0-Windows-x64.exe` was 126,143,280 bytes with SHA-256 `e112c454e582e025be807c451026ab834e7b3b8aeb5876928e03145d5d9d803d`. Both package verifiers passed: the installed app reported `0.1.0`, `Classic Har Gow · 蝦餃`, and `2026-08-01`; uninstall removed the executable, process, shortcuts, and uninstall registration while the isolated retention probe remained until QA cleanup. Windows reported Authenticode status `NotSigned`.

The new upgrade path was exercised locally on Windows 10.0.26200 using published baseline `0.19.1` and a disposable `0.999.1` candidate built from source commit `22129fc`. The verifier recorded baseline installer SHA-256 `22588b7f326a0fe0d4e9542f99debdf927bcd7764186752d80ac5472836cae06`, candidate SHA-256 `afae75f001fdbacc3a6b4f87a60408939fbdd3dc7b82014dd15f0e30ee3d08a6`, correct baseline and candidate smoke versions, same-directory replacement, candidate removal on uninstall, and the unchanged probe SHA-256 `3b22cb8daa3037fd87493b3e4fe24a1e0669ad71194115c87547583fc834d3de` after upgrade and uninstall. This is genuine local upgrade evidence, but the candidate is not a published release and the host was neither clean nor a default-profile disposable VM. The current `npm run check` passes 36 test files / 182 tests and the 15-module renderer production build.

The release workflow now resolves exactly one Windows installer from the latest prior release, retries its download, verifies the API-reported size, and requires the baseline-to-candidate versions, hashes, same-directory upgrade, and retained-probe evidence before publishing. Its first-release path remains explicitly labeled as a single-installer lifecycle rather than an upgrade. A hosted run of this new gate, clean-machine/default-profile test, signing, approved application icon, and Pages deployment remain unverified.

## Suggested articles

- [Verification matrix](verification.md)
- [Windows Electron foundation](../architecture/windows-electron-foundation.md)
- [Current handoff](../../HANDOFF.md)
