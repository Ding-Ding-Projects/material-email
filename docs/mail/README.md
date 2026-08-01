# Mail features

| Article | Status | Purpose |
| --- | --- | --- |
| [Accounts and connectivity](accounts-and-connectivity.md) | Verified bounded foundation | Manual IMAP/SMTP, local-only deterministic POP3 fixtures/state, local/TLS diagnostics, ephemeral OAuth PKCE/callback states, and a mock-only encrypted exchange/refresh/revoke harness |
| [Synchronization and folders](synchronization-and-folders.md) | Foundation | Folder discovery, message summaries, flags, and moves |
| [Local unified folders](unified-folders.md) | Verified bounded slice | Cached cross-account Inbox, Starred, and Unread with account attribution |
| [Cached conversation grouping](conversation-grouping.md) | Verified bounded slice | Local subject/reference grouping over visible cached summaries |
| [Bounded cached-mail search index](cached-mail-search-index.md) | Verified bounded slice | Cross-cache plain/regex search with account, folder, and conversation attribution |
| [Reading and message safety](reading-and-message-safety.md) | Bounded parser and per-message remote-image consent verified locally | MIME fetch/decode ceilings, sanitized display data, host summary, and default-deny image loading |
| [Compose, drafts, and sending](compose-drafts-and-sending.md) | Foundation | Local drafts and SMTP submission |

Advisory autoconfiguration, queued mail actions/outbox replay, attachment handling, cached local views, an OAuth callback foundation, a mock-only token lifecycle, and a deterministic local-only POP3 fixture/state machine now exist. The POP3 runner opens no network path and provides no deletion, persistence, polling, provider login, or full synchronization. Live POP3 interoperability and provider-backed OAuth remain open. Local PIM features remain documented separately.
