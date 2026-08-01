# Mail features

| Article | Status | Purpose |
| --- | --- | --- |
| [Accounts and connectivity](accounts-and-connectivity.md) | Foundation | Manual IMAP/SMTP configuration and tests |
| [Synchronization and folders](synchronization-and-folders.md) | Foundation | Folder discovery, message summaries, flags, and moves |
| [Local unified folders](unified-folders.md) | Verified bounded slice | Cached cross-account Inbox, Starred, and Unread with account attribution |
| [Reading and message safety](reading-and-message-safety.md) | Bounded parser and per-message remote-image consent verified locally | MIME fetch/decode ceilings, sanitized display data, host summary, and default-deny image loading |
| [Compose, drafts, and sending](compose-drafts-and-sending.md) | Foundation | Local drafts and SMTP submission |

Advisory autoconfiguration, ordered queued mail actions/outbox replay, attachment save/save-all, persisted local quarantine with explicit release/delete, and cached local unified folders now have foundations. Interactive OAuth, POP, server-complete cross-account synchronization, threading, antivirus/content scanning, cryptographic messaging, and public-provider verification remain open. Local contacts, calendars, tasks, and PIM transactions are documented separately under [`docs/pim/`](../pim/README.md); they are integrated with the renderer through typed preload/IPC operations but remain local-only and are not connected to mail-provider protocols.
