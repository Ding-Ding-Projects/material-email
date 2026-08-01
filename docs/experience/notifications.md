# Notifications

## Status

**Service and renderer foundation with reviewable actions.** In-app records, non-blocking toasts, persisted read/dismiss state, history actions, and opt-in native Windows summaries exist.

## Behavior

Mail sync, account changes, drafts, queued operations, sends, moves, attachment saves, restores, and other application events can append notification records. Records have info, success, warning, or error severity; an account, mail, delivery, security, history, or app category; a title; body; timestamp; read state; dismissed state; and optional structured action metadata. The store keeps the newest 500. Older version-1 records receive the factual App category and a non-dismissed state when loaded.

The renderer presents non-decision feedback as corner toasts with accessible dismiss controls and a separate Notifications page. Warnings and errors remain until dismissed; ordinary status may auto-dismiss. A stored card exposes independently persisted read/unread and dismissed/restored state without removing the record from review. Clearing the whole history remains a deliberate blocking decision.

In forced-colors mode, every card action receives a system-color border and explicit 3 px keyboard focus indicator. Read cards return to full opacity, dismissed cards retain a dashed `GrayText` boundary, and pressed read/dismiss controls use paired `Highlight`/`HighlightText` colors so state is not conveyed by author color or opacity alone.

Stored actions are a closed, schema-validated union rather than executable command strings. The centre can open an existing app destination or draft, retry an exact account synchronization/queued operation/Outbox delivery, or undo a settings restore through the existing append-only History restore path. Action buttons name both the operation and notification for assistive technology. Stale targets fail through the existing factual non-blocking error path; they are never converted into arbitrary renderer commands.

The Notifications page's supporting copy, severity badges, and renderer-created toast copy follow English, Hong Kong Cantonese, or semantic bilingual mode. Toast bodies retain the original event facts and select five levels of surrounding voice independently for English and Cantonese. Persisted service-record titles and bodies remain the factual text recorded when the event occurred; the renderer does not rewrite stored history when a preference changes.

Transport exceptions are not notification facts. Before a synchronization or queued-mail failure is stored or displayed, the shared redaction boundary converts it to an actionable failure category and removes host paths, raw URLs/query parameters, private search text, stack locations, and provider-library detail. Existing mail/delivery notification bodies receive the same projection-time treatment when read after an upgrade. Language mode and the two humor levels still style the surrounding voice; they never reintroduce removed raw detail.

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

Do not put secrets, access tokens, full message bodies, attachment contents, raw endpoints, local host paths, search queries, or unnecessary private sender/subject data in notification text. Action payloads accept only bounded identifiers and enumerated local destinations; legacy label/command pairs are discarded during migration. Native notifications must respect Windows privacy, focus-assist, and lock-screen settings.

## Verification

Existing notification/action coverage remains, and the focused redaction slice passes 3 files / 19 unit/service/history tests plus 1 / 1 real-Electron restart scenario. The Electron fixture restores a legacy Outbox error containing a Windows path, tokenized URL, private query, and transport-library name; none renders, while the localized actionable connection category and recovery controls remain. Live retry failure/success against real providers, native Windows High Contrast and screen-reader output, timing/stacking, deduplication, stale-action scale, and packaged lock-screen behavior remain open.

## Suggested articles

- [Language and humor controls](language-and-humor.md)
- [Local state and history](../data/local-state-and-history.md)
- [Material interface and accessibility](material-interface-and-accessibility.md)
