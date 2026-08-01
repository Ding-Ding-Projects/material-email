# Local iCalendar import and export

## Current status

Material Email imports and exports real local `.ics` files through authenticated IPC and native Windows file dialogs. This is local interchange for Home calendar events and tasks, not CalDAV synchronization, scheduling, or provider-interoperability evidence.

## Behavior and configuration

- Import accepts one UTF-8 iCalendar 2.0 `VCALENDAR` with 1–5,000 uniquely identified `VEVENT`/`VTODO` records within 1 MiB and 20,000 physical lines.
- Supported event data includes summary, description, location, date/time bounds, status, transparency, categories, organizer, attendees, recurrence metadata, and display/audio alarms. Supported task data includes summary, description, status, entry/due dates, priority, completion, categories, recurrence, and source revision metadata.
- UTC, numeric-offset, floating Windows-local, and IANA `TZID` date-times are supported. Recurrence is preserved, never expanded.
- **Skip safely** leaves matching, historical, and cross-type UIDs untouched. **Update matching type** updates only an active record of the same type; a historical/cross-type collision refuses the whole import.
- Calendar and Tasks provide bilingual import, checkbox selection, export-selected, and export-all controls. Export is normalized iCalendar 2.0 with CRLF and one final CRLF.

Open **Calendar** or **Tasks**, choose the duplicate policy, then use **Import ICS**. For export, select cards or choose **Export all** for the current record type.

## Failure modes

Cancelled dialogs change nothing. Invalid UTF-8, empty/oversized input, links, UNC/network paths, malformed nesting, duplicate document UIDs, unsupported recurrence, missing required fields, scheduling `METHOD`, and attachments fail closed. Imports parse first and commit through one atomic PIM mutation, so a late conflict leaves no partial records. Export refuses empty/unknown selections or an unsafe destination.

## Security and privacy

Only the trusted main window, top frame, and exact renderer URL can use the strict IPC channels. IPC carries a duplicate policy or bounded UID list, never a file path/content. The main process owns dialogs, fatal UTF-8 decoding, local-file checks, and same-directory temporary-file rename. No network request, credential, remote image, script, scheduling method, or attachment is processed.

## Verification

- `npx vitest run tests/pim/icalendar.test.ts tests/pim/provider-foundation.test.ts tests/ipc-validation.test.ts`: the focused slice passed; the final consolidated gate included the added IPC cases.
- Coverage includes field mapping, TZID conversion, recurrence preservation, CRLF round-trip, duplicate skip/update, late-conflict rollback, scheduling refusal, required fields, and strict IPC shapes.
- `npm run check`: passed with 51 unit/integration files and 268 tests, asset/site/source-policy checks, and the production build.
- `npx playwright test tests/e2e/icalendar-controls.spec.ts --reporter=line`: 1/1 real-Electron scenario passed for bilingual copy, duplicate-policy persistence, selected/all controls, and 760 × 560 overflow.

## Suggested articles

- [Calendars and events](calendars-and-events.md)
- [Tasks and refresh ordering](tasks-and-refresh-ordering.md)
- [PIM persistence and transaction history](persistence-and-transactions.md)
- [CardDAV, CalDAV, and ICS provider foundation](carddav-caldav-ics-provider-foundation.md)
