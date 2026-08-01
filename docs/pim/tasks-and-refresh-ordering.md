# Tasks and refresh ordering

## Status

**Integrated local feature with current-tree checks passing.** Typed preload/IPC operations and a Material renderer page provide local task CRUD, search, completion, deletion, and append-only restore. Focused lifecycle, race, renderer-state, and real-Electron coverage pass. No provider implementation is present.

## Behavior

Tasks use stable UIDs and the Home calendar. They record title, description, needs-action/in-progress/completed/cancelled status, entry and due date/date-time, priority 0–9, completion percentage/timestamp, categories, recurrence metadata, and an optional source revision. CRUD, query ordering, refresh merge, and append-only restore are implemented; completion fields normalize consistently.

The renderer exposes practical title, due date, status, priority, completion, and description controls. It preserves recurrence metadata without expanding instances. The form compares against its loaded/saved dirty baseline, uses returned revision changes for update-versus-no-op copy, provides an accessible discard decision with focus return, and shows a retryable error when loading fails. Task search defaults to plain text, owns an adjacent bounded regex builder, and restores its independent bounded mode, pattern, and normalized JavaScript flags across restart while leaving sample/open state ephemeral. Exact localized result counts, a named invalid alert, a valid no-match status, and edit/<kbd>Escape</kbd> focus return do not change task data.

Refresh accepts a caller-supplied provider-agnostic async snapshot loader. Monotonic in-process request IDs make the newest request authoritative. A persisted task mutation version rejects results when local CRUD/restore occurred in flight. Stale payloads are discarded before validation or mutation, duplicate refreshed UIDs are rejected, omission never silently deletes local tasks, and explicit `null` clears supported optional snapshot fields.

## Configuration

Completion is bounded 0–100 and priority 0–9. Due cannot precede entry when both share a temporal representation. All refresh data and patches pass strict runtime schemas.

## Failure modes

- Refresh request ordering is process-local and is not a remote conflict resolver; persistence itself is protected by the separate cross-instance/process lock described in the persistence article.
- Repeating-task occurrence generation and per-occurrence completion are not implemented.
- Background retry, provider rate limits, shared tasks, and cross-device merge remain open.

## Security considerations

Task text and dates are private local plaintext. Future providers must not log payloads and must use authenticated least-privileged transport. Stable UIDs, request IDs, and mutation versions prevent stale data from silently replacing current state.

## Verification

The focused PIM-search helper passes 1 renderer file / 5 tests, and its dedicated 1 / 1 real-Electron scenario proves invalid-regex separation and Task search restoration across restart. Existing PIM coverage also exercises task persistence, dirty/no-op editor state, save ownership, discard focus return, load-error retry, lifecycle fields, action filters, older-overlap rejection, local-edit protection during refresh, duplicate/refused state behavior, and append-only restoration. Remote transport, recurrence instances, scale, clean-machine behavior, and screen-reader proof remain open.

## Suggested articles

- [Calendars and events](calendars-and-events.md)
- [PIM persistence and transaction history](persistence-and-transactions.md)
- [Notifications](../experience/notifications.md)
