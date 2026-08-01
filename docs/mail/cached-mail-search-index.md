# Bounded cached-mail search index

## Current status

**Verified bounded slice.** The mail search field queries an ephemeral in-memory index over coherent cached summaries and already-cached body snippets across accounts and folders. Plain and JavaScript-regex modes use the shared builder validation. This is not SQLite, persistent full-text search, a server search API, or a scalable whole-mailbox index.

## Behavior and configuration

Each valid query rebuilds at most 2,000 coherent cached documents. Fields include subject, addresses, preview, up to 4,096 cached body characters, account, folder, and local conversation subject. Plain search normalizes Unicode and whitespace; regex uses the shared ES2023 engine, `i/m/s/u` flags, 2,048-character pattern ceiling, and nested-quantifier rejection. Results sort newest first, report the bounded total, and return at most 200 hits (the renderer requests 100). Every hit includes a 500-character snippet plus account, folder, conversation, and matched-field attribution. There is no database file, crawler, background indexer, or server setting.

## Failure modes and limits

- Rows beyond 2,000 are absent and trigger a visible warning.
- Only already-opened cached bodies contribute body text; other rows use summaries/previews.
- Result totals can exceed the displayed cap.
- This query-time rebuild does not provide ranking, stemming, fuzzy search, incremental indexing, or large-store performance.
- Regex rejection is heuristic rather than a hard-timeout sandbox.
- Server-only mail, attachments, provider thread IDs, and remote content are not indexed.

## Security considerations

Indexing stays in the main process. Strict IPC caps patterns, flags, and result counts. Queries, cached text, and hits are not logged, persisted, transmitted, or added to history. The renderer receives only capped existing metadata and snippets.

## Verification

`tests/cached-mail-index.test.ts` covers normalized plain/body search, attribution, shared regex safety, result caps, orphan rejection, and the 2,000-document ceiling. `tests/ipc-validation.test.ts` covers request bounds. `tests/renderer/regex.test.ts` covers the shared matcher compatibility export. `tests/e2e/unified-folders.spec.ts` covers real Electron account search and regex body-snippet search with visible account/folder/conversation attribution.

## Suggested articles

- [Search and regex builder](../experience/search-and-regex-builder.md)
- [Cached conversation grouping](conversation-grouping.md)
- [Local unified folders](unified-folders.md)
- [Reading and message safety](reading-and-message-safety.md)
