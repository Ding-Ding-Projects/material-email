# Mail features

| Article | Status | Purpose |
| --- | --- | --- |
| [Accounts and connectivity](accounts-and-connectivity.md) | Verified bounded foundation | Manual IMAP/SMTP, local/TLS diagnostics, ephemeral OAuth PKCE/callback states, and a mock-only encrypted exchange/refresh/revoke harness |
| [Synchronization and folders](synchronization-and-folders.md) | Foundation | Folder discovery, message summaries, flags, and moves |
| [Local unified folders](unified-folders.md) | Verified bounded slice | Cached cross-account Inbox, Starred, and Unread with account attribution |
| [Cached conversation grouping](conversation-grouping.md) | Verified bounded slice | Local subject/reference grouping over visible cached summaries |
| [Bounded cached-mail search index](cached-mail-search-index.md) | Verified bounded slice | Cross-cache plain/regex search with account, folder, and conversation attribution |
| [Reading and message safety](reading-and-message-safety.md) | Bounded parser and per-message remote-image consent verified locally | MIME fetch/decode ceilings, sanitized display data, host summary, and default-deny image loading |
| [Compose, drafts, and sending](compose-drafts-and-sending.md) | Foundation | Local drafts and SMTP submission |

Advisory autoconfiguration, ordered queued mail actions/outbox replay, attachment save/save-all, persisted local quarantine with explicit release/delete, cached local unified folders, bounded cached conversation grouping, an ephemeral OAuth authorization-code/PKCE callback foundation, and a separate mock-only token lifecycle now exist. The mock lifecycle is test/demo code with process-local AES-GCM ciphertext, no production imports, and no provider evidence. OAuth provider client registration, real token exchange/storage/refresh/revocation, connected OAuth accounts, POP, server-complete cross-account synchronization/threading, scalable mail indexing, antivirus/content scanning, cryptographic messaging, and public-provider verification remain open. Local contacts, calendars, tasks, and PIM transactions are documented separately under [`docs/pim/`](../pim/README.md); they are integrated with the renderer through typed preload/IPC operations but remain local-only and are not connected to mail-provider protocols.
