# Windows Electron foundation

## Status

**Hardened foundation verified in the current local tree.** The process configuration, renderer-location policy, and authenticated preload/IPC contract pass focused unit and real-Electron coverage. Clean-machine and hosted-CI proof remain pending.

## Behavior

Material Email creates one Windows desktop window. The Electron main process owns privileged operations: mail connections, local storage, credential encryption, file dialogs, exports, editor launch, and window controls. A preload bridge exposes a typed set of application operations to the renderer. The renderer has no direct Node.js access. App-owned caption buttons delegate minimize, maximize/restore, and close to that authenticated bridge; Electron state-change events keep the maximize/restore label synchronized.

Normal bounds and maximized state are stored in a bounded version-1 main-process document. Startup clamps the rectangle to a current display and recentres an off-screen placement. Minimized state is never restored. A dirty composer or local-record editor converts Close—including a native `BrowserWindow.close()` request—into the renderer's accessible reviewed decision before any unsaved content can be discarded.

The window denies permission requests, prevents in-place navigation and redirects, and sends user-initiated HTTP(S) links to the operating system's external browser. Packaged builds always load the exact bundled renderer file and ignore `MATERIAL_EMAIL_DEV_URL`. Only unpackaged development can use that variable, and its parsed URL must use HTTP with a hostname exactly equal to `127.0.0.1` or `[::1]` before Electron loads it. Main-to-renderer mailto activation is withheld whenever the current top-level location is not the trusted renderer.

Every IPC handler authenticates its sender before handling data: the event must come from the current main window's `WebContents`, from its top frame, and from the exact renderer URL/path trusted for that window. Argument schemas remain an additional boundary, not a substitute for sender authentication.

## Configuration

- Product identifier: `com.dingdingprojects.materialemail`
- Initial window: 1500 × 940; minimum 760 × 560
- Saved window placement: validated normal bounds plus maximized state; minimized state excluded
- Renderer: sandbox enabled, context isolation enabled, Node integration disabled
- Development URL: unpackaged-only HTTP Vite URL with exact host `127.0.0.1` or `[::1]`, selected through `MATERIAL_EMAIL_DEV_URL`
- Packaged renderer: exact bundled renderer path; the development URL environment variable is ignored
- Platform target: Windows x64

## Failure modes

- A preload/main contract mismatch causes renderer calls to reject.
- Missing renderer build output prevents packaged startup.
- Development startup fails if Vite never becomes reachable on loopback.
- An unpackaged URL using HTTPS, credentials, a non-loopback host, or a hostname that only resembles loopback is rejected before navigation.
- An IPC call from a stale/replaced window, child frame, or unexpected renderer location is rejected.
- External links can fail if Windows has no handler for the URL scheme.
- A minimum window size does not by itself prevent localized text clipping or high-scale layout defects.
- A failed placement write leaves the active window usable but can restore older geometry on the next launch.

## Security considerations

Keep privileged work in the main process. Every new IPC operation needs an explicit handler, current-window/top-frame/exact-location authentication, narrow inputs, runtime validation, and a safe error path. Never expose `ipcRenderer`, filesystem primitives, shell commands, or raw credentials directly to renderer code. Keep the renderer-location, navigation, and permission-denial hooks intact.

## Verification

Focused tests cover packaged-versus-unpackaged URL handling, IPC sender/frame/location authentication, versioned window-state validation/persistence, off-screen placement recovery, and caption localization. A dedicated 3 / 3 real-Electron suite proves keyboard-reachable named controls, maximize/restore synchronization, restart persistence, and a reviewed dirty native close. The previously recorded 15-scenario Electron suite proves that a second `WebContents` is denied, a loopback HTTP redirect cannot commit its target, and same-file skip-link fragment navigation stays trusted. Clean-machine packaged launch, external-link behavior, native screen-reader accessibility, physical multiple-display placement, high-DPI scaling, crash recovery, and Windows policy environments remain unverified.

## Suggested articles

- [Security boundaries](security-boundaries.md)
- [Development and packaging](../delivery/development-and-packaging.md)
- [Material interface and accessibility](../experience/material-interface-and-accessibility.md)
- [Windows window controls](../experience/windows-window-controls.md)
