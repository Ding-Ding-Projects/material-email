# Mail features

| Article | Status | Purpose |
| --- | --- | --- |
| [Accounts and connectivity](accounts-and-connectivity.md) | Verified bounded account test | Manual IMAP/SMTP, a live POP3 Test/Cancel path over TLS or STARTTLS, local/TLS diagnostics, ephemeral OAuth PKCE/callback states, a provider-gated Windows safeStorage vault, and a mock-only exchange/refresh/revoke harness |
| [Synchronization and folders](synchronization-and-folders.md) | Foundation | Folder discovery, message summaries, flags, and moves |
| [Local unified folders](unified-folders.md) | Verified bounded slice | Cached cross-account Inbox, Starred, and Unread with account attribution |
| [Cached conversation grouping](conversation-grouping.md) | Verified bounded slice | Local subject/reference grouping over visible cached summaries |
| [Bounded cached-mail search index](cached-mail-search-index.md) | Verified bounded slice | Cross-cache plain/regex search with account, folder, and conversation attribution |
| [Reading and message safety](reading-and-message-safety.md) | Bounded parser and per-message remote-image consent verified locally | MIME fetch/decode ceilings, sanitized display data, host summary, and default-deny image loading |
| [Message cryptography trust states](message-cryptography-trust-states.md) | Verified bounded metadata-only foundation | OpenPGP/S/MIME container labels, strict public identity metadata, and honest unsigned/unverified/unsupported UI |
| [Compose, drafts, and sending](compose-drafts-and-sending.md) | Verified bounded recovery slice | Local drafts, SMTP submission, persisted Outbox retry state, and accessible recovery actions |
| [Tags, filter rules, junk, and folder administration](tags-filters-and-junk.md) | Verified local slice with live folder administration | Colour-coded message tags, quick filter, ordered filter rules with previewed runs, a local junk classifier, and folder create/rename/remove/mark-read |
| [Identities and signatures](identities-and-signatures.md) | Verified local model with local SMTP header evidence | Per-account identities with exactly one default, seeding and upgrade backfill, a composer From picker, signatures above or below quoted material, and From/Reply-To header rules no mail server verifies |

Advisory autoconfiguration, queued mail actions/outbox replay, attachment handling, cached local views, an OAuth callback foundation, a provider-gated Windows token vault, a mock-only token lifecycle, and a bounded live POP3 account test now exist. Production provider registration, exchange, refresh/revocation clients, connected OAuth accounts, and interoperability remain open. POP3 has no shipped demo or fixture surface: deterministic servers exist only in tests. The live test provides no deletion, retrieval, persistence, polling, folders, outgoing integration, or synchronization. Per-account identities now choose the From address and an optional Reply-To for outgoing mail, but no mail server verifies an identity and no live submission from a non-default identity has been exercised. Local PIM features remain documented separately.
