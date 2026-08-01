# Bounded cached-mail search index

## Current status

**Verified bounded slice.** The mail search field queries an ephemeral in-memory index over coherent cached summaries and already-cached body snippets across accounts and folders. Plain and JavaScript-regex modes use the shared builder validation. This is not SQLite, persistent full-text search, a server search API, or a scalable whole-mailbox index.

## Behavior and configuration

Each valid query rebuilds at most 2,000 coherent cached documents. Fields include subject, addresses, preview, up to 4,096 cached body characters, account, folder, and local conversation subject. Plain search normalizes Unicode and whitespace; regex uses the shared ES2023 engine, `i/m/s/u` flags, a 2,048-character pattern ceiling, and conservative rejection for nested quantifiers, adjacent overlapping unbounded repetitions, and simple prefix-overlapping repeated alternatives. Results sort newest first, report the bounded total, and return at most 200 hits (the renderer requests 100). Every hit includes a 500-character snippet plus account, folder, conversation, and matched-field attribution. There is no database file, crawler, background indexer, or server setting.

The count beside the message-list heading identifies a complete result count or a localized “showing N of M” cap in English, Hong Kong Cantonese, and bilingual mode. It is a polite live status. Arrow Down from the mail search field moves keyboard focus into non-empty results. Invalid, no-match, and failed states keep the empty list out of the tab order and provide an explicit keyboard-reachable edit or retry action.

The mail field persists only its validated `plain` or `regex` mode in renderer-local storage. Search text, regex samples, results, and failure details do not survive restart. A failed request leaves the query and cache unchanged, shows stable localized non-blocking copy without echoing raw IPC detail, and offers one explicit retry that issues one new bounded local request.

## Failure modes and limits

- Rows beyond 2,000 are absent and trigger a visible warning.
- Only already-opened cached bodies contribute body text; other rows use summaries/previews.
- Result totals can exceed the displayed cap.
- This query-time rebuild does not provide ranking, stemming, fuzzy search, incremental indexing, or large-store performance.
- Regex rejection is heuristic rather than a hard-timeout sandbox; adversarial forms outside the documented repetition families may remain.
- Server-only mail, attachments, provider thread IDs, and remote content are not indexed.
- Browser-storage denial leaves search usable but resets the mode to plain text at the next renderer start.
- A retry repeats the same local query once; it does not contact a provider or widen the indexed cache.

## Security considerations

Indexing stays in the main process. Strict IPC caps patterns, flags, and result counts. Queries, samples, cached text, hits, and raw search failures are not logged, persisted, transmitted, or added to history. Only the plain/regex mode is persisted. The renderer receives only capped existing metadata and snippets.

## Verification

`tests/cached-mail-index.test.ts` and `tests/renderer/regex.test.ts` pass 2 files / 9 tests covering normalized plain/body search, attribution, Unicode/multiline and zero-width behavior, pre-execution rejection for four demonstrated adversarial repetition families, sample/match/result/document ceilings, orphan rejection, and safe command-style alternation. `tests/ipc-validation.test.ts` covers request bounds. `tests/renderer/cached-mail-search.test.ts` covers validated mode persistence plus singular, empty, capped, localized, and malformed service counts. `tests/e2e/unified-folders.spec.ts` passes 3 / 3 real-Electron scenarios, including the dedicated plain-text-default, rejected-pattern disclosure/disabled execution, astral zero-width, multiline cached-result, and actionable zero-width no-match coverage alongside the existing attribution/retry/restart checks.

## Suggested articles

- [Search and regex builder](../experience/search-and-regex-builder.md)
- [Cached conversation grouping](conversation-grouping.md)
- [Local unified folders](unified-folders.md)
- [Reading and message safety](reading-and-message-safety.md)
