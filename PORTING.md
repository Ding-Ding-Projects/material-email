# Porting ledger

> Regenerate with `node scripts/port-ledger.mjs`. Every count below is measured from the working tree at generation time.

## The requirement on record

The project owner has directed that the vendored upstream desktop mail source tree at
`vendor/thunderbird-desktop` be transliterated 1:1 into this Electron application, and that this
requirement be recorded in the repository. This file is that record.

## Measured scope

- Upstream source files in scope: **22,565**
- Upstream source lines in scope: **8,863,523**
- Files with a line-for-line counterpart in `src/`: **0** (0.00%)
- Lines with a line-for-line counterpart in `src/`: **0** (0.00%)
- This application's own source: **65** files, **26,554** lines

Counted extensions: .c, .cc, .cpp, .css, .h, .hh, .hpp, .html, .js, .jsm, .mjs, .mm, .py, .rs, .sys.mjs, .ts, .xhtml, .xul.

## Why the completion figure is what it is

These are properties of the upstream tree, not scheduling estimates:

1. **Runtime.** The upstream tree is a Gecko application. Its C++ components are XPCOM classes
   registered through `.manifest`/`components.conf` and reached over XPIDL interfaces; its front end
   is XUL/XHTML driven by `.sys.mjs` modules loaded by the Gecko module loader. Electron supplies
   Chromium and Node, not XPCOM, XPIDL, XUL, `nsIMsgFolder`, `nsIMsgDBHdr`, the MDB/Panorama message
   store, or the preferences service. A line-for-line counterpart of those files has nothing to bind to.
2. **Missing platform.** The vendored tree is the `comm` half only. It builds against a
   `mozilla-central` checkout that is not present here and is far larger than the tree that is.
3. **Repository policy.** `scripts/verify-source-policy.mjs`, run as part of `npm run check`, fails the
   build when publishable text under `src`, `tests`, `docs`, `site`, or `.github` names the upstream
   product or links to a non-LibreOffice source tree. `AGENTS.md` further states that mail behaviour is
   to be designed independently. Landing transliterated upstream source under `src/` fails the
   repository's own gate until that policy is changed by the project owner.

No part of this file asks for the requirement to be withdrawn. It records what a 1:1 transliteration
would require so the gap is auditable rather than implied.

## What is actually being delivered

Behaviour parity, written natively for the Electron/TypeScript stack: the desktop mail feature set is
reimplemented area by area against the same observable behaviour, with tests, and the ledger below
records each module honestly as `Independent foundation only` rather than as transliterated.

## Module ledger

| Upstream module | Files | Lines | Status | Notes |
| --- | ---: | ---: | --- | --- |
| `build` | 3 | 173 | Not started | Upstream mozbuild/mach build system; the Electron app builds with esbuild, Vite, and electron-builder. |
| `calendar` | 457 | 144,969 | Independent foundation only | Local events, tasks, recurrence metadata, and bounded iCalendar interchange exist in src/main/pim. Upstream providers, the timezone database, and the alarm service are not transliterated. |
| `chat` | 460 | 130,939 | Not started | No instant-messaging protocol, account, or conversation code exists in src/. |
| `docs` | 7 | 876 | Not started | Upstream contributor documentation; this repository maintains its own docs/ tree. |
| `mail` | 2,103 | 731,182 | Independent foundation only | Front end. Material Email implements its own Electron renderer, compose, folder pane, tags, quick filter, filters, and junk surfaces. No upstream XUL, .sys.mjs module, or C++ component has been transliterated. |
| `mailnews` | 1,608 | 508,399 | Independent foundation only | Protocol and store core. Material Email uses imapflow/nodemailer/mailparser plus its own POP3 test transport, filter engine, and junk classifier instead of the upstream C++ nsMsg* stack, MDB/Panorama store, and NNTP/RSS implementations. |
| `python` | 162 | 13,400 | Not started | Upstream Python support code for mach; not transliterated. |
| `rust` | 159 | 24,272 | Not started | No Rust crate has a counterpart; the Electron app has no Rust toolchain. |
| `suite` | 1,095 | 270,853 | Not started | Out of product scope: this is the SeaMonkey suite tree, not the mail client. |
| `taskcluster` | 55 | 5,719 | Not started | Upstream CI graph; not applicable to this repository's GitHub Actions. |
| `testing` | 13 | 1,266 | Not started | Upstream xpcshell/mochitest harnesses; this repository uses Vitest and Playwright. |
| `third_party` | 16,440 | 7,031,198 | Not started | Vendored upstream third-party code; not transliterated. |
| `tools` | 3 | 277 | Not started | Upstream developer tooling; not transliterated. |

## Status vocabulary

| Status | Meaning |
| --- | --- |
| Not started | Nothing of this module exists in `src/`. |
| Independent foundation only | An independently written subset of the behaviour exists. The upstream code is not transliterated. |
| Partially transliterated | A meaningful share of the module's upstream behaviour is reachable in the app. |
| Transliterated | Every upstream file in the module has a line-for-line counterpart in `src/`. |

A module may not be recorded as `Transliterated` while its counterpart file count is below its upstream
file count. The generator enforces the arithmetic; it cannot enforce honesty about `state`, so treat any
change to the status map in `scripts/port-ledger.mjs` as a reviewable claim.
