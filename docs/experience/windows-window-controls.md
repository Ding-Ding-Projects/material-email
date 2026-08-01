# Windows window controls

## Status

**Focused implementation and real-Electron verification complete.** App-owned caption buttons now delegate to the native Electron window, synchronize maximize/restore state, persist validated normal bounds and maximized state, and review unsaved work before close. Native screen-reader output, Windows high contrast, multiple physical monitors, and the 100/125/150/200% display-scale matrix remain open.

## Behavior

The custom title bar exposes a named **Window controls** group with separate Minimize, Maximize/Restore, and Close buttons. Each control is an ordinary keyboard-reachable button with a 48 × 48 CSS-pixel target and a tested 3 px inset focus indicator. Maximize changes to Restore when Electron reports a maximized window, including changes initiated outside the renderer. Labels and tooltips use English, playful Hong Kong Cantonese, or bilingual copy and select the two persisted humor levels independently without hiding the action.

The main process stores only the normal window rectangle and maximized flag in `window-state.json` below Electron's user-data directory. Startup validates the versioned bounded document, chooses a current display, clamps oversized bounds, and recentres a placement that no longer intersects a connected display. Minimized state is deliberately not restored, so the application never starts hidden. Writes are serialized through a same-directory temporary file and rename; malformed input falls back to safe defaults and is preserved with an `.invalid` suffix before a later valid save replaces it.

Close remains a decision only when a composer or local-record editor has unsaved changes. The existing blocking alert dialog names what will be discarded and what saved data remains unchanged. Cancel keeps the application open, retains the edits, and returns focus to the app-owned Close button. Confirm sets a one-shot close approval before invoking the main-process close path. An Alt+F4 or other native `BrowserWindow.close()` request reaches the same unload guard and decision instead of silently losing the form.

## Configuration

- Default normal size: 1500 × 940 CSS pixels
- Minimum size: 760 × 560 CSS pixels
- Persisted fields: schema version, normal `x`/`y`/`width`/`height`, maximized flag
- Non-persisted fields: minimized state, focus target, message or editor content
- Renderer bridge: authenticated `window:state`, `window:minimize`, `window:maximize`, and `window:close` calls plus a state-change event

There is no separate user setting for placement. Moving, resizing, maximizing, or restoring updates the local main-process record automatically.

## Failure modes

- A damaged or oversized state file falls back to default placement; its invalid primary is retained when a valid state is next saved.
- Disconnecting a monitor can make old coordinates unusable; startup recentres them on the primary work area.
- A write failure does not block the active window action, so the next launch can use an older placement.
- A renderer/main contract mismatch can leave an app-owned button unable to invoke its native action.
- The focused hidden-window harness does not certify physical taskbar animation, native assistive technology, high contrast, or display scaling.

## Security considerations

The renderer never receives filesystem access or an unrestricted Electron object. Window operations cross the authenticated current-window, top-frame, exact-renderer IPC boundary. The placement file contains geometry and one Boolean only; it carries no account, message, credential, editor content, command, or path supplied by the renderer. Close approval is renderer-session-only and cannot persist across a restart.

## Verification

Focused unit coverage validates the schema, coordinate pairing, supported bounds, multi-display fallback, oversized clamping, serialized restart persistence, and corrupt-primary preservation. Renderer localization coverage exercises all four actions and inverse bilingual humor levels. The focused real-Electron suite passes 3 / 3 scenarios for accessible names, sequential Tab reachability, the computed focus indicator, minimize IPC routing, native maximize/restore synchronization, normal-bounds and maximized-state restoration after a full restart, bilingual English-level-1/Cantonese-level-5 copy, dirty-close cancellation with focus/data preservation, and a native `BrowserWindow.close()` request that cannot bypass the reviewed decision.

This is scoped evidence, not packaged Windows accessibility certification.

## Suggested articles

- [Material interface and accessibility](material-interface-and-accessibility.md)
- [Language and humor controls](language-and-humor.md)
- [Windows Electron foundation](../architecture/windows-electron-foundation.md)
