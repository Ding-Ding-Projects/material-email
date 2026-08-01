# Mail features

| Article | Status | Purpose |
| --- | --- | --- |
| [Accounts and connectivity](accounts-and-connectivity.md) | Verified bounded foundation | Manual IMAP/SMTP configuration, local/TLS diagnostics, and ephemeral OAuth PKCE/callback states without token exchange |
| [Synchronization and folders](synchronization-and-folders.md) | Foundation | Folder discovery, message summaries, flags, and moves |
| [Local unified folders](unified-folders.md) | Verified bounded slice | Cached cross-account Inbox, Starred, and Unread with account attribution |
| [Cached conversation grouping](conversation-grouping.md) | Verified bounded slice | Local subject/reference grouping over visible cached summaries |
| [Bounded cached-mail search index](cached-mail-search-index.md) | Verified bounded slice | Cross-cache plain/regex search with account, folder, and conversation attribution |
| [Reading and message safety](reading-and-message-safety.md) | Bounded parser and per-message remote-image consent verified locally | MIME fetch/decode ceilings, sanitized display data, host summary, and default-deny image loading |
| [Compose, drafts, and sending](compose-drafts-and-sending.md) | Foundation | Local drafts and SMTP submission |

Advisory autoconfiguration, ordered queued mail actions/outbox replay, attachment save/save-all, persisted local quarantine with explicit release/delete, cached local unified folders, bounded cached conversation grouping, and an ephemeral OAuth authorization-code/PKCE callback foundation now exist. OAuth provider client registration, token exchange/storage/refresh/revocation, connected OAuth accounts, POP, server-complete cross-account synchronization/threading, scalable mail indexing, antivirus/content scanning, cryptographic messaging, and public-provider verification remain open. Local contacts, calendars, tasks, and PIM transactions are documented separately under [`docs/pim/`](../pim/README.md); they are integrated with the renderer through typed preload/IPC operations but remain local-only and are not connected to mail-provider protocols.
