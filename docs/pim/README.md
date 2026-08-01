# Personal information management

| Article | Status | Purpose |
| --- | --- | --- |
| [Contacts, mailing lists, and vCard](contacts-mailing-lists-and-vcard.md) | Renderer/preload/IPC integrated; live-provider sync open | Structured people data, lists, import, and export |
| [Calendars and events](calendars-and-events.md) | Renderer/preload/IPC integrated; remote sync open | Home calendar, recurrence data, attendees, and alarms |
| [Tasks and refresh ordering](tasks-and-refresh-ordering.md) | Renderer/preload/IPC integrated; remote sync open | Task lifecycle and stale refresh protection |
| [PIM persistence and transaction history](persistence-and-transactions.md) | Renderer/preload/IPC integrated; current-tree checks pass | Atomic generations, recovery, transactions, and restore |
| [CardDAV, CalDAV, and ICS provider foundation](carddav-caldav-ics-provider-foundation.md) | Bounded local validation only; live providers open | HTTPS/auth-mode rules, deterministic capabilities, and local interchange limits |
| [Local iCalendar import and export](icalendar-import-export.md) | Renderer/preload/IPC integrated; local files only | Atomic VEVENT/VTODO import, duplicate policy, and selected/all CRLF export |

The PIM service is integrated with Material renderer pages through typed preload and authenticated IPC operations. Editors compare their forms with loaded/saved dirty baselines, guard replacement and whole-window unload, expose an accessible discard decision with focus return, and use returned revisions to distinguish a real save from a no-op. Save completion is bound to the originating editor; a different editor remains intact, and a post-save refresh failure keeps the saved record plus an explicit retry state. A separate provider foundation now validates CardDAV/CalDAV HTTPS profiles and local ICS file URLs, models capabilities deterministically, and bounds local vCard/iCalendar envelopes without networking, secrets, persistence, sync, or recurrence expansion. Its focused evidence is 8 unit tests plus 1 real-Electron Settings scenario. Live CardDAV/CalDAV/ICS synchronization, shared calendars, invitation transport, free/busy lookup, provider authentication, broad interoperability, and cross-device conflict resolution remain open.
