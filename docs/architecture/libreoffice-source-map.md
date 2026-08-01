# LibreOffice source-reference map

## Status

**Verified permitted reference.** The paths below were checked against the official read-only [`LibreOffice/core`](https://github.com/LibreOffice/core) mirror at immutable commit [`b9141dee2805a5551d112ecc4fcc6a7db7b41cd9`](https://github.com/LibreOffice/core/tree/b9141dee2805a5551d112ecc4fcc6a7db7b41cd9) on 2026-07-31.

Material Email is an original Electron application. LibreOffice is the only external product source code permitted as a reference; no source was copied. These references are limited to general Windows desktop behavior. Mail protocols and data formats are implemented from their public specifications and the documented APIs of this project's dependencies, not from another email client's code.

## Reference paths

| Product concern | Official LibreOffice path | Narrow behavior studied | Material Email boundary |
| --- | --- | --- | --- |
| Application lifecycle | [`vcl/source/app/svapp.cxx`](https://github.com/LibreOffice/core/blob/b9141dee2805a5551d112ecc4fcc6a7db7b41cd9/vcl/source/app/svapp.cxx) | Distinct initialization, main, exit-query, shutdown, and deinitialization phases | Electron owns the lifecycle; only the separation of responsibilities is referenced |
| Desktop tabs | [`vcl/source/control/tabctrl.cxx`](https://github.com/LibreOffice/core/blob/b9141dee2805a5551d112ecc4fcc6a7db7b41cd9/vcl/source/control/tabctrl.cxx) | Tab sizing, selection, accessible names/descriptions, and style-setting response | Material Email uses semantic HTML tabs and original TypeScript state |
| Appearance and locale settings | [`vcl/source/app/settings.cxx`](https://github.com/LibreOffice/core/blob/b9141dee2805a5551d112ecc4fcc6a7db7b41cd9/vcl/source/app/settings.cxx) | Central style, locale, accessibility, and icon-theme settings | Material Email persists its own M3 tokens and language preferences |
| Windows platform integration | [`vcl/win/app/salinst.cxx`](https://github.com/LibreOffice/core/blob/b9141dee2805a5551d112ecc4fcc6a7db7b41cd9/vcl/win/app/salinst.cxx) | Windows-specific startup and operating-system theme integration | Material Email uses Electron's Windows APIs and does not reuse VCL code |
| Structured preferences | [`officecfg/registry/schema/org/openoffice/Office/Common.xcs`](https://github.com/LibreOffice/core/blob/b9141dee2805a5551d112ecc4fcc6a7db7b41cd9/officecfg/registry/schema/org/openoffice/Office/Common.xcs) | Explicitly modeled common application preferences | Material Email validates and persists a separate versioned schema |

## Behavior

The map records only an exact upstream path, immutable revision, and narrow desktop concept. It does not create a compatibility target, inheritance relationship, or parity claim. Email discovery, IMAP, SMTP, MIME, contacts, calendars, tasks, local history, notifications, and search are independently designed and verified inside this repository.

## Configuration

When an allowed reference is updated, record the new immutable commit and re-check every listed path. Do not link a moving branch as verification evidence. Do not add another product's source tree to this map.

## Failure modes

- LibreOffice uses VCL and UNO, while Material Email uses Electron, Chromium, and Node.js; platform assumptions do not transfer automatically.
- A source file can move or change meaning after the pinned commit.
- A general desktop pattern can be unsuitable for untrusted email content or asynchronous mail protocols.
- A reference path can be mistaken for copied code unless the implementation and tests remain visibly independent.

## Security considerations

Source research does not replace Material Email's Electron threat model. Credentials, renderer isolation, message content, attachments, IPC, networking, and persistence require independent controls and tests against the actual implementation.

## Verification

The official repository identity, default branch, commit, and five paths were checked with the GitHub CLI. No LibreOffice source file is vendored, compiled, or imported by Material Email.

## Suggested articles

- [Windows Electron foundation](windows-electron-foundation.md)
- [Security boundaries](security-boundaries.md)
- [Material interface and accessibility](../experience/material-interface-and-accessibility.md)
