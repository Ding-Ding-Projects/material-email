# Cached conversation grouping

## Current status

**Verified bounded slice.** Material Email groups the currently visible cached message summaries into local conversation sections using normalized subjects and explicit message-reference links. This is a presentation-time helper, not a scalable index, RFC-complete threading engine, or server conversation API.

## Behavior

- Repeated `Re:`, `Fw:`, and `Fwd:` prefixes (including bounded numeric counters such as `Re[2]:`) are removed after Unicode normalization and whitespace folding.
- Cached `Message-ID`, `In-Reply-To`, and up to 100 `References` identifiers per message are normalized case-insensitively for local matching.
- Messages sharing a normalized non-empty subject form a group. Reference chains can join messages whose subjects changed, and siblings can join through the same missing parent identifier even when that parent is not cached.
- `(No subject)` rows remain separate unless an explicit reference connects them, reducing one especially broad false-positive case.
- Groups and their messages sort newest first with composite message identity as a deterministic tie-break. Existing message selection, account attribution, actions, keyboard traversal, and mail search operate on the individual rows inside each group.
- One-message results remain ordinary rows. Multi-message results get an accessible group header with message, unread, and multi-account counts.

## Configuration

There is no background index or user-managed thread database. Grouping runs automatically over the messages that survive the current folder and mail-search filter. Opening a full message can add bounded `In-Reply-To`/`References` metadata to its cached summary; the IMAP envelope supplies `In-Reply-To` when available before that.

## Failure modes and limits

- Grouping is disabled above 2,000 visible cached rows. Every message then remains available as an individual row and the UI states the limit.
- At most 100 cached reference identifiers per message participate. Identifiers over 4,096 characters, whitespace-bearing invalid tokens, and empty values are ignored.
- Subject matching is heuristic and can combine unrelated mail with the same subject. Missing/rewritten reference headers can also split a real conversation.
- Only cached/displayed summaries participate; mail outside the cache, messages removed by search, and server-only labels are invisible.
- Grouping does not infer quoted-text relationships, participant graphs, mailing-list semantics, duplicate delivery, or provider-specific thread IDs.

## Security and privacy

The algorithm runs locally in memory and makes no network request. It uses metadata already exposed in secret-free message summaries, bounds message/reference/subject work, and emits escaped labels through the existing renderer. Message identifiers are not added to search, logs, exports, or user-facing headings.

## Verification

- `tests/conversation-grouping.test.ts` covers prefix/reference normalization, changed-subject chains, missing-root siblings, no-subject isolation, account/unread counts, deterministic ordering, and the 2,000-row fail-open limit.
- `tests/mail-parser.test.ts` verifies bounded `In-Reply-To` and `References` extraction from full MIME.
- `tests/e2e/unified-folders.spec.ts` verifies a real Electron conversation group inside a two-account unified view while preserving attribution, regex search, and stable selection.

## Suggested articles

- [Local unified folders](unified-folders.md)
- [Synchronization and folders](synchronization-and-folders.md)
- [Reading and message safety](reading-and-message-safety.md)
- [Search and regex builder](../experience/search-and-regex-builder.md)
