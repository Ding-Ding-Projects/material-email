# Bounded cached-mail search index

## Current status

**Verified bounded slice, now with an additive SQLite-backed cache.** The mail search field queries a bounded index over coherent cached summaries and already-cached body snippets across accounts and folders. Plain and JavaScript-regex modes use the shared builder validation, unchanged. `AppService.searchCachedMail` now tries a derived, on-disk `node:sqlite` cache of that same document set first — the same documents, the same matcher, the same limits — and transparently rebuilds it from the authoritative JSON-persisted mail cache whenever the file is missing, on an older/unrecognized schema, corrupt, or simply stale relative to current cached mail. Any SQLite failure this rebuild cannot repair falls back to the original fully in-memory computation with no user-visible difference. This is **not** persistent full-text search, a server search API, ranking/stemming/fuzzy matching, or a scalable whole-mailbox index — and it is not a new source of truth: the JSON-persisted mail cache remains authoritative, and the SQLite file can be deleted at any time with no data loss, only a rebuild on the next search.

## Behavior and configuration

Each valid query resolves at most 2,000 coherent cached documents, either freshly computed or read back from `<userData>/cached-mail-index-v1.sqlite`. Fields include subject, addresses, preview, up to 4,096 cached body characters, account, folder, and local conversation subject. Plain search normalizes Unicode and whitespace; regex uses the shared ES2023 engine, `i/m/s/u` flags, a 2,048-character pattern ceiling, and conservative rejection for nested quantifiers, adjacent overlapping unbounded repetitions, and simple prefix-overlapping repeated alternatives — identically whether documents came from SQLite or memory, because both paths call the same matcher on the same document shape. Results sort newest first, report the bounded total, and return at most 200 hits (the renderer requests 100). Every hit includes a 500-character snippet plus account, folder, conversation, and matched-field attribution. There is no crawler, background indexer, or server setting.

### The SQLite-backed derived cache

`src/main/cached-mail-sqlite-index.ts` stores each computed document verbatim (as JSON) in a `documents` table, plus a `schema_meta` table recording a schema-version integer and a content fingerprint (a hash of the exact account/folder/message/detail state the documents were built from). Before answering a query it checks that the file's schema version matches what this build understands and that the fingerprint still matches the current cached-mail state; either mismatch — or the file being entirely missing — triggers a clean rebuild from the JSON-persisted cache. A file that fails to open or read at all (corrupt bytes, not a database) is deleted and rebuilt once; if that single repair attempt also fails, the query answers itself purely in memory instead, exactly as it did before this cache existed. `node:sqlite` is loaded lazily and defensively: on a Node build where it is unavailable, every search silently uses the in-memory path, and nothing else in the app is affected.

The count beside the message-list heading identifies a complete result count or a localized “showing N of M” cap in English, Hong Kong Cantonese, and bilingual mode. It is a polite live status. Arrow Down from the mail search field moves keyboard focus into non-empty results. Invalid, no-match, and failed states keep the empty list out of the tab order and provide an explicit keyboard-reachable edit or retry action.

The mail field persists only its validated `plain` or `regex` mode in renderer-local storage. Search text, regex samples, results, and failure details do not survive restart. A failed request leaves the query and cache unchanged, shows stable localized non-blocking copy without echoing raw IPC detail or the query text into a separate error surface, and offers one explicit retry that issues one new bounded local request. The query remains visible only in its user-owned search field so it can be edited deliberately.

## Failure modes and limits

- Rows beyond 2,000 are absent and trigger a visible warning.
- Only already-opened cached bodies contribute body text; other rows use summaries/previews.
- Result totals can exceed the displayed cap.
- Neither the in-memory rebuild nor the SQLite-backed cache provides ranking, stemming, fuzzy search, or large-store performance beyond avoiding a redundant recompute when the cache is fresh.
- Regex rejection is heuristic rather than a hard-timeout sandbox; adversarial forms outside the documented repetition families may remain — identically on both paths, since both call the same rejection logic.
- Server-only mail, attachments, provider thread IDs, and remote content are not indexed.
- Browser-storage denial leaves search usable but resets the mode to plain text at the next renderer start.
- A retry repeats the same local query once; it does not contact a provider or widen the indexed cache.
- The SQLite fingerprint check hashes the exact source state on every query; on a very large cached-mail set this adds back cost that a narrower staleness check could avoid. It is not tuned for that scale yet.
- A single failed repair attempt (delete-and-rebuild) is not retried again within the same call; the next query tries again from scratch.

## Security considerations

Indexing stays in the main process. Strict IPC caps patterns, flags, and result counts. Queries, samples, cached text, hits, and raw search failures are not logged, persisted, transmitted, or added to history. Only the plain/regex mode is persisted. The renderer receives only capped existing metadata and snippets. The on-disk SQLite file lives under the same per-user application-data directory as the existing JSON mail cache, carries no additional secrets (message bodies it stores are already present, unencrypted, in the JSON cache it derives from), and is never reachable from the renderer or over IPC directly.

## Verification

`tests/cached-mail-index.test.ts` and `tests/renderer/regex.test.ts` pass 2 files / 9 tests covering normalized plain/body search, attribution, Unicode/multiline and zero-width behavior, pre-execution rejection for four demonstrated adversarial repetition families, sample/match/result/document ceilings, orphan rejection, and safe command-style alternation. `tests/ipc-validation.test.ts` covers request bounds. `tests/renderer/cached-mail-search.test.ts` covers validated mode persistence plus singular, empty, capped, localized, and malformed service counts. `tests/e2e/unified-folders.spec.ts` passes 3 / 3 real-Electron scenarios, including the dedicated plain-text-default, rejected-pattern disclosure/disabled execution, astral zero-width, multiline cached-result, and actionable zero-width no-match coverage alongside the existing attribution/retry/restart checks.

`tests/cached-mail-sqlite-index.test.ts` (11 tests) exercises the SQLite-backed cache directly: plain/regex results identical to the pure in-memory path on the same fixtures, propagation of the same rejected-pattern errors, a genuinely queryable on-disk file a fresh connection can read independently, reuse across a simulated restart, a stale fingerprint (changed cached mail) triggering a rebuild that never serves the old documents, an out-of-band schema-version downgrade triggering a clean rebuild, a corrupt (non-database) file triggering a clean rebuild, normal behavior when the file is entirely missing, and a fully unrecoverable path (an uncreatable parent directory) falling back to the in-memory answer without ever throwing. `tests/app-service-cached-mail-sqlite-wiring.test.ts` (3 tests) proves the same guarantees through the real integration point, `AppService.searchCachedMail`, against a seeded demo account: a search materializes a real on-disk index with the expected row count, a second `AppService` instance pointed at the same `userData` directory reuses it after a simulated restart, and corrupting the on-disk file out-of-band still yields the correct answer with no thrown error. Both new files are skipped automatically (`describe.skipIf`) on a Node build without `node:sqlite`, which this repository's pinned Node/Electron versions do not currently exercise.

## Suggested articles

- [Search and regex builder](../experience/search-and-regex-builder.md)
- [Cached conversation grouping](conversation-grouping.md)
- [Local unified folders](unified-folders.md)
- [Reading and message safety](reading-and-message-safety.md)
