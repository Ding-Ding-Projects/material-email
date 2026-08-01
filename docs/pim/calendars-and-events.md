# Calendars and events

## Status

**Integrated local feature with current-tree checks passing.** A typed preload/IPC bridge and Material renderer page provide structured local event CRUD, search, deletion, and append-only restore. Focused regression and real-Electron coverage pass; recurrence expansion, invitation transport, ICS, and CalDAV are not present.

## Behavior

The PIM store creates one writable local calendar named `Home` with UID `home`. Events have stable UIDs, title, description, location, date or date-time start/end values, recurrence metadata, organizer, attendees with roles/participation/RSVP, relative or absolute display/audio alarms, categories, status, and opaque/transparent availability. CRUD and append-only restore retain monotonically increasing revisions.

The renderer exposes title, local start/end, location, status, and description fields. It preserves recurrence metadata already on a record, but deliberately does not generate occurrences or edit detached overrides. Its form uses the loaded/saved event as a dirty baseline, uses returned revision changes to distinguish updates from no-op saves, exposes an accessible discard decision with focus return, and renders load failures with retry. Calendar search defaults to plain text, has its own adjacent bounded regex builder, and restores only its own bounded mode, pattern, and normalized JavaScript flags across restart. Its sample/open state remains ephemeral; exact localized result counts, a named invalid alert, a valid no-match status, and edit/<kbd>Escape</kbd> focus return do not alter event data.

## Configuration

Recurrence stores daily/weekly/monthly/yearly frequency, interval, count or until, weekdays, month days, week start, additional dates, and exception dates. Count and until are mutually exclusive. Attendee emails and alarm UIDs must be unique. Start/end use the same temporal representation and end must be later.

## Failure modes

- Recurrence storage is not occurrence expansion; DST, time zones, exceptions, and per-occurrence edits need a dedicated engine/matrix.
- The single Home calendar does not prove multiple calendars, sharing, subscriptions, invitations, alarms, or free/busy.
- No ICS import/export, CalDAV synchronization, or remote conflict resolution exists.

## Security considerations

Titles, locations, attendees, and alarms can reveal sensitive schedules. Data remains local plaintext without logs or remote content. Future synchronization or invitation transmission requires explicit consent, authenticated least-privileged connections, and conflict-safe semantics.

## Verification

The focused PIM-search helper passes 1 renderer file / 5 tests, and its dedicated 1 / 1 real-Electron scenario proves Calendar search restoration, exact bilingual count facts, and semantic result state across restart. Existing PIM coverage also exercises calendar/event persistence, dirty/no-op editor state, save ownership, discard focus return, load-error retry, automatic Home calendar creation, recurrence/attendee/alarm preservation, updates, deletion, and append-only restoration. Remote transport, alarm delivery, recurrence expansion, DST matrices, clean-machine behavior, and screen-reader proof remain open.

## Suggested articles

- [Tasks and refresh ordering](tasks-and-refresh-ordering.md)
- [PIM persistence and transaction history](persistence-and-transactions.md)
- [Notifications](../experience/notifications.md)
