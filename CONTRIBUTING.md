# Contributing to Material Email

Material Email is a Windows-only Electron application. Contributions must be original work. LibreOffice is the only permitted external product source-code reference, limited to the exact desktop-behavior paths in [`docs/architecture/libreoffice-source-map.md`](docs/architecture/libreoffice-source-map.md); never transplant source or infer email behavior from another client.

## Development loop

1. Install the Node version in `.node-version`.
2. Run `npm ci`.
3. Keep the renderer sandboxed and the preload API narrow and typed.
4. Add or update focused Vitest coverage.
5. Run `npm run check` and `npm run test:e2e` before opening a change.

Do not add remote fonts, CDN assets, analytics, plaintext credentials, unbounded regular expressions, or privileged APIs to the renderer. User-facing controls must be keyboard accessible, localized in all three language modes, and truthful about whether an operation reached a server or remains queued.

Long explanations belong in the categorized `docs/` articles. Keep README sections compact and collapsible.
