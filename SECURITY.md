# Security policy

## Reporting a vulnerability

Please use the repository’s private security-advisory reporting channel. Do not put credentials, private mail, tokens, server names, exploit details, or personal data in a public issue or Discussion.

Include the affected version, the smallest safe reproduction, expected impact, and any mitigation you already tested. Maintainers will acknowledge the report, reproduce it in an isolated environment, and publish a correction only after the fix and release evidence are ready.

## Product boundaries

- Account secrets are encrypted through Windows-backed Electron `safeStorage` before persistence.
- Protocol sockets, files, dialogs, and credentials stay in the main process.
- Message HTML renders in a scriptless opaque-origin sandbox with remote content blocked.
- The renderer receives only narrow typed commands through the preload bridge.
- The first public installers are unsigned; verify the published SHA-256 digest if Windows SmartScreen warns about an unknown publisher.

Security support currently follows the latest published release. Older builds should be upgraded before reporting a defect that is already corrected in the current version.

