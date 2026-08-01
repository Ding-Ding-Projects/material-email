# Mail features

| Article | Status | Purpose |
| --- | --- | --- |
| [Accounts and connectivity](accounts-and-connectivity.md) | Foundation | Manual IMAP/SMTP configuration and tests |
| [Synchronization and folders](synchronization-and-folders.md) | Foundation | Folder discovery, message summaries, flags, and moves |
| [Reading and message safety](reading-and-message-safety.md) | Parser verified; live UI open | MIME parsing and sanitized display data |
| [Compose, drafts, and sending](compose-drafts-and-sending.md) | Foundation | Local drafts and SMTP submission |

Advisory autoconfiguration, ordered queued mail actions/outbox replay, and attachment save/save-all now have foundations. Interactive OAuth, POP, user-facing conflict resolution, unified folders, threading, attachment scanning/quarantine, native notifications, cryptographic messaging, and public-provider verification remain open. Local contacts, calendars, tasks, and PIM transactions are documented separately under [`docs/pim/`](../pim/README.md); they are integrated with the renderer through typed preload/IPC operations but remain local-only and are not connected to mail-provider protocols.
