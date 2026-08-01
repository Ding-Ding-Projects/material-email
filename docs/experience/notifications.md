# Notifications

## Status

**Service and renderer foundation with reviewable actions.** In-app records, non-blocking toasts, persisted read/dismiss state, history actions, and opt-in native Windows summaries exist.

## Behavior

Mail sync, account changes, drafts, queued operations, sends, moves, attachment saves, restores, and other application events can append notification records. Records have info, success, warning, or error severity; an account, mail, delivery, security, history, or app category; a title; body; timestamp; read state; dismissed state; and optional structured action metadata. The store keeps the newest 500. Older version-1 records receive the factual App category and a non-dismissed state when loaded.

The renderer presents non-decision feedback as corner toasts with accessible dismiss controls and a separate Notifications page. Warnings and errors remain until dismissed; ordinary status may auto-dismiss. A stored card exposes independently persisted read/unread and dismissed/restored state without removing the record from review. Clearing the whole history remains a deliberate blocking decision.

Stored actions are a closed, schema-validated union rather than executable command strings. The centre can open an existing app destination or draft, retry an exact account synchronization/queued operation/Outbox delivery, or undo a settings restore through the existing append-only History restore path. Action buttons name both the operation and notification for assistive technology. Stale targets fail through the existing factual non-blocking error path; they are never converted into arbitrary renderer commands.

The Notifications page's supporting copy, severity badges, and renderer-created toast copy follow English, Hong Kong Cantonese, or semantic bilingual mode. Toast bodies retain the original event facts and select five levels of surrounding voice independently for English and Cantonese. Persisted service-record titles and bodies remain the factual text recorded when the event occurred; the renderer does not rewrite stored history when a preference changes.

## Configuration

Notification language and tone follow the global language and independent humor settings. Narration, if enabled, is separate and off by default. Native Windows summaries are separately opt-in and never include subject, sender, recipient, message, attachment, credential, or account-identifying details.

Native Windows notifications are off by default and can be enabled in Settings. They emit only a generic severity summary; message bodies, subjects, recipients, attachment names, credentials, and account identifiers never cross the native-notification IPC boundary.

## Failure modes

- A notification can be persisted but never announced if renderer state is stale.
- Repeated sync errors can flood history without deduplication.
- Auto-dismiss can remove content before assistive technology finishes announcing it.
- Optional actions can become stale after the underlying draft, queue row, account, or history revision changes; invoking one then reports the existing factual error and changes no other target.
- Clearing history currently removes records without a documented undo path.

## Security considerations

Do not put secrets, access tokens, full message bodies, attachment contents, or unnecessary private sender/subject data in notification text. Action payloads accept only bounded identifiers and enumerated local destinations; legacy label/command pairs are discarded during migration. Native notifications must respect Windows privacy, focus-assist, and lock-screen settings.

## Verification

Focused unit coverage passes 4 files / 34 tests for category/action localization, legacy command removal, structured-action retention, persisted state defaults, read/dismiss restart persistence, append-only settings-restore undo, and the authenticated IPC allow-list. A dedicated 1 / 1 real-Electron scenario verifies accessible category, severity, read, dismiss, restore, and Open Settings controls; read/dismiss persistence across a full restart; English and Cantonese labels; and the polite non-modal toast region. The earlier language/humor matrix continues to cover all three language modes, both inverse bilingual level combinations, and a live bilingual toast. Live retry failure/success against real providers, native screen-reader output, timing/stacking, deduplication, stale-action scale, and packaged lock-screen behavior remain open.

## Suggested articles

- [Language and humor controls](language-and-humor.md)
- [Local state and history](../data/local-state-and-history.md)
- [Material interface and accessibility](material-interface-and-accessibility.md)
