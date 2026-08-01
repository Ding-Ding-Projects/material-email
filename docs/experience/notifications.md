# Notifications

## Status

**Service and renderer foundation with reviewable actions plus focused search persistence.** In-app records, non-blocking toasts, persisted read/dismiss state, history actions, an independently persisted bounded Notification Centre search, and opt-in native Windows summaries exist.

## Behavior

Mail sync, account changes, drafts, queued operations, sends, moves, attachment saves, restores, and other application events can append notification records. Records have info, success, warning, or error severity; an account, mail, delivery, security, history, or app category; a title; body; timestamp; read state; dismissed state; and optional structured action metadata. The store keeps the newest 500. Older version-1 records receive the factual App category and a non-dismissed state when loaded.

The renderer presents non-decision feedback as corner toasts with accessible dismiss controls and a separate Notifications page. Warnings and errors remain until dismissed; ordinary status may auto-dismiss. A stored card exposes independently persisted read/unread and dismissed/restored state without removing the record from review. Clearing the whole history remains a deliberate blocking decision.

Notification Centre search owns one field-bound plain-text/JavaScript-regex model. The search input and attached builder share the same query/pattern, mode, and `i`/`m`/`s`/`u` flags. Only the bounded mode, pattern, and normalized flags survive restart; builder sample text and whether the popover was open remain ephemeral. Matching covers stored title, body, severity, and category without modifying any record. A valid no-result query renders a named polite status and an edit action that returns keyboard focus to the originating field. Invalid regex renders a distinct named alert, leaves every notification action unchanged, and is never mislabeled as a no-match result. Closing the builder by its button or <kbd>Escape</kbd> also returns focus to the owning field.

In forced-colors mode, every card action receives a system-color border and explicit 3 px keyboard focus indicator. Read cards return to full opacity, dismissed cards retain a dashed `GrayText` boundary, and pressed read/dismiss controls use paired `Highlight`/`HighlightText` colors so state is not conveyed by author color or opacity alone.

Stored actions are a closed, schema-validated union rather than executable command strings. The centre can open an existing app destination or draft, retry an exact account synchronization/queued operation/Outbox delivery, or undo a settings restore through the existing append-only History restore path. Action buttons name both the operation and notification for assistive technology. Stale targets fail through the existing factual non-blocking error path; they are never converted into arbitrary renderer commands.

The Notifications page's supporting copy, severity badges, search count/status, no-match guidance, and renderer-created toast copy follow English, Hong Kong Cantonese, or semantic bilingual mode. The count always states matching, total, and matching-unread facts; five levels independently style the surrounding English and Cantonese voice without changing those numbers. Toast bodies retain the original event facts. Persisted service-record titles and bodies remain the factual text recorded when the event occurred; the renderer does not rewrite stored history when a preference changes.

Transport exceptions are not notification facts. Before a synchronization or queued-mail failure is stored or displayed, the shared redaction boundary converts it to an actionable failure category and removes host paths, raw URLs/query parameters, private search text, stack locations, and provider-library detail. Existing mail/delivery notification bodies receive the same projection-time treatment when read after an upgrade. Language mode and the two humor levels still style the surrounding voice; they never reintroduce removed raw detail.

## Configuration

Notification language and tone follow the global language and independent humor settings. Narration, if enabled, is separate and off by default. Native Windows summaries are separately opt-in and never include subject, sender, recipient, message, attachment, credential, or account-identifying details.

Notification search storage uses `material-email.notification-search.v1`. It contains only a mode, a pattern capped at the shared 2,048-character limit, and normalized supported flags. Corrupt or mistyped storage returns to an empty case-insensitive plain-text model. Storage failure leaves the current search usable for the session without claiming restart persistence.

Native Windows notifications are off by default and can be enabled in Settings. They emit only a generic severity summary; message bodies, subjects, recipients, attachment names, credentials, and account identifiers never cross the native-notification IPC boundary.

## Failure modes

- A notification can be persisted but never announced if renderer state is stale.
- Repeated sync errors can flood history without deduplication.
- Auto-dismiss can remove content before assistive technology finishes announcing it.
- Optional actions can become stale after the underlying draft, queue row, account, or history revision changes; invoking one then reports the existing factual error and changes no other target.
- Clearing history currently removes records without a documented undo path.
- If renderer local storage is unavailable, Notification Centre search remains usable but its mode, pattern, and flags cannot survive restart.

## Security considerations

Do not put secrets, access tokens, full message bodies, attachment contents, raw endpoints, local host paths, search queries, or unnecessary private sender/subject data in notification text. Action payloads accept only bounded identifiers and enumerated local destinations; legacy label/command pairs are discarded during migration. Native notifications must respect Windows privacy, focus-assist, and lock-screen settings.

## Verification

The focused Notification Centre search parser/localization slice passes 2 renderer files / 19 tests. It covers absent/corrupt storage, bounded patterns, strict field types, normalized JavaScript flags, omission of sample/open/unrelated state, all five English/Cantonese tones, bilingual independent levels, and factual count preservation. A dedicated 1 / 1 real-Electron restart scenario proves input/builder synchronization, independent storage, regex mode/pattern/`m`/`u` restoration, `i` removal, sample reset, named invalid and no-match semantics, bilingual count/guidance, and edit/<kbd>Escape</kbd> focus return. The existing notification action restart scenario still passes 1 / 1, preserving read/dismiss state, localized structured actions, and the polite toast region.

The focused redaction slice separately passes 3 files / 19 unit/service/history tests plus 1 / 1 real-Electron restart scenario. Its Electron fixture restores a legacy Outbox error containing a Windows path, tokenized URL, private query, and transport-library name; none renders, while the localized actionable connection category and recovery controls remain. Live retry failure/success against real providers, native Windows High Contrast and screen-reader output, timing/stacking, deduplication, stale-action scale, and packaged lock-screen behavior remain open.

## Suggested articles

- [Language and humor controls](language-and-humor.md)
- [Local state and history](../data/local-state-and-history.md)
- [Material interface and accessibility](material-interface-and-accessibility.md)
