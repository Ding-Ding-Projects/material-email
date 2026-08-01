# Notifications

## Status

**Service and renderer foundation.** In-app records, toasts, unread state, history, and opt-in native Windows summaries exist.

## Behavior

Mail sync, account changes, drafts, queued operations, sends, moves, attachment saves, restores, and other application events can append notification records. Records have info, success, warning, or error severity, a title, body, timestamp, read state, and optional action metadata. The store keeps the newest 500.

The renderer presents non-decision feedback as corner toasts with dismiss controls and a separate Notifications page. Warnings and errors should remain until dismissed; ordinary status may auto-dismiss. Clearing the history is a deliberate action.

The Notifications page's supporting copy, severity badges, and renderer-created toast copy follow English, Hong Kong Cantonese, or semantic bilingual mode. Toast bodies retain the original event facts and select five levels of surrounding voice independently for English and Cantonese. Persisted service-record titles and bodies remain the factual text recorded when the event occurred; the renderer does not rewrite stored history when a preference changes.

## Configuration

Notification language and tone follow the global language and independent humor settings. Narration, if enabled, is separate and off by default. Native Windows summaries are separately opt-in and never include subject, sender, recipient, message, attachment, credential, or account-identifying details.

Native Windows notifications are off by default and can be enabled in Settings. They emit only a generic severity summary; message bodies, subjects, recipients, attachment names, credentials, and account identifiers never cross the native-notification IPC boundary.

## Failure modes

- A notification can be persisted but never announced if renderer state is stale.
- Repeated sync errors can flood history without deduplication.
- Auto-dismiss can remove content before assistive technology finishes announcing it.
- Optional actions can become stale after the underlying record changes.
- Clearing history currently removes records without a documented undo path.

## Security considerations

Do not put secrets, access tokens, full message bodies, attachment contents, or unnecessary private sender/subject data in notification text. Native notifications must respect Windows privacy, focus-assist, and lock-screen settings.

## Verification

Source inspection confirms record creation, the 500-record cap, read/clear operations, toasts, live regions, a Notifications tab, authenticated native-notification IPC, opt-in persistence, and generic summaries. Focused renderer tests verify three-mode severity labels, factual toast preservation, independent inverse humor levels, and fallback behavior. A real-Electron matrix verifies all three language modes, both inverse bilingual level combinations, and a live bilingual toast. Timing, stacking, persistent warning/error behavior, screen-reader announcements, action validity, deduplication, stored-record translation, and packaged lock-screen behavior remain open.

## Suggested articles

- [Language and humor controls](language-and-humor.md)
- [Local state and history](../data/local-state-and-history.md)
- [Material interface and accessibility](material-interface-and-accessibility.md)
