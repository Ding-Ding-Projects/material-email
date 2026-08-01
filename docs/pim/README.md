# Personal information management

| Article | Status | Purpose |
| --- | --- | --- |
| [Contacts, mailing lists, and vCard](contacts-mailing-lists-and-vcard.md) | Renderer/preload/IPC integrated; live-provider sync open | Structured people data, lists, import, and export |
| [Calendars and events](calendars-and-events.md) | Renderer/preload/IPC integrated; remote sync open | Home calendar, recurrence data, attendees, and alarms |
| [Tasks and refresh ordering](tasks-and-refresh-ordering.md) | Renderer/preload/IPC integrated; remote sync open | Task lifecycle and stale refresh protection |
| [PIM persistence and transaction history](persistence-and-transactions.md) | Renderer/preload/IPC integrated; current-tree checks pass | Atomic generations, recovery, transactions, and restore |

The PIM service is integrated with Material renderer pages through typed preload and authenticated IPC operations. Editors compare their forms with loaded/saved dirty baselines, guard replacement and whole-window unload, expose an accessible discard decision with focus return, and use returned revisions to distinguish a real save from a no-op. Save completion is bound to the originating editor; a different editor remains intact, and a post-save refresh failure keeps the saved record plus an explicit retry state. The consolidated current-tree check passes 22 test files / 96 tests, and the real-Electron suite passes all 15 scenarios, including restart, dirty-edit, unload, exact focus, save ownership, no-op saves, and load-error retry. The service remains local-only: CardDAV, CalDAV, provider synchronization, shared calendars, invitation transport, free/busy lookup, live-provider testing, and cross-device conflict resolution remain open.
