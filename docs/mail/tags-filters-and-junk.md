# Message tags, filter rules, junk classification, and folder administration

## Current status

**Verified local slice with live folder administration and server-side tag keywords.** Material Email can label cached messages with colour-coded tags, narrow a folder with a quick filter, evaluate ordered filter rules and carry out their actions, learn a local junk classifier from explicit corrections, and create/rename/remove folders and mark a folder read on the server. Tagging a message on a real account now also asks the server to keep the same names as IMAP keywords, fail-closed: a rejected or unconfirmed server change throws before the local tag change is applied, so local state never claims a server sync that did not happen. Filters and junk training remain purely local. Filter rules are edited from Settings and run automatically over messages that arrive during a synchronization, as well as on demand. They evaluate cached rows only; server-side filtering is not implemented, and no schedule runs them outside a synchronization.

## Behavior

### Tags

- Five built-in tags ship with the app: Important, Work, Personal, To Do, and Later. They can be renamed and recoloured but not removed.
- Custom tags are created with a name and a six-digit hexadecimal colour, up to 64 tags in total and 20 tags on one message. Three-digit colours are expanded; anything else is rejected with a stated reason.
- A tag is stored against the account, folder path, mailbox generation (`UIDVALIDITY`), and UID that identified the message when it was tagged. Two messages that share a UID across mailbox generations therefore never share tags.
- A move carries a message's tags to the identity the server reported for the destination. When the server confirms a move but does not attribute a destination UID, the tags are dropped rather than applied to whichever message later takes that UID.
- Removing an account or a folder forgets exactly that account's or folder's assignments and leaves the catalogue intact.
- Deleting a tag removes it from the catalogue and from every message in one operation. A stored assignment whose tag no longer exists is discarded when state is loaded, so a blank chip cannot appear.
- On a real account, tagging or untagging a message asks the server to keep the resulting tag names as IMAP keywords before the local change is applied. Each name becomes a lowercase `mtag-` atom (RFC 3501-safe characters kept as-is, everything else escaped as `_` plus two hex digits) so case differences and unusual characters cannot collide or corrupt another client's keyword. Only atoms carrying that prefix are added or removed; a keyword another client wrote is left exactly as it was. The server call is fail-closed: a rejection, an unsupported mailbox, or a store the server did not actually keep throws before any local tag state changes, so the local catalogue never claims a server sync that did not happen. The demonstration account has no server, so its tagging stays entirely local, as it always has.

### Quick filter

- The quick filter narrows the visible message list without contacting a server. Facets are Unread, Starred, Attachments, and Tagged, and they combine conjunctively.
- Selected tags match any one of them by default, or all of them in `all` mode.
- The text field defaults to plain text and ignores case unless **Match case** is chosen. An adjacent regular-expression mode accepts the project's JavaScript dialect with `imsu` flags, and regex mode uses the builder's flags rather than the case switch.
- An invalid or unsafe expression is reported in place and hides nothing; the list is not silently emptied. Patterns with nested or overlapping repetition are refused before they run.
- Turning the filter on without choosing anything is reported as inert and shows the full list rather than an empty one.

### Filter rules

- A rule has a name, an enabled switch, an account scope, `all`/`any` matching, an ordered condition list, and an ordered action list. Up to 200 rules are kept, each with up to 20 conditions and 20 actions.
- Conditions read sender, recipients, subject, body, account, folder, applied tag, size, age in days, attachment presence, read state, and star state. Text conditions support contains/is/starts-with/ends-with and their negations plus regular expressions; numeric conditions support greater-than/less-than/is/is-not; boolean and tag conditions support is/is-not.
- Body conditions read a cached body when one has been fetched and fall back to the cached preview when one has not.
- Actions are mark read/unread, star/unstar, add/remove tag, move, archive, move to trash, mark junk/not junk, and stop.
- Rules run in ordinal order. A `stop` action ends evaluation for that message and is never itself carried out.
- Matched actions are collapsed before anything is applied: the last decision wins for contradictory pairs, only one destination-changing action survives, and a tag added and later removed does not churn the message.
- A run applies tags, then junk training, then flags, and performs any move last, because a move changes the UID the earlier steps addressed.
- **Run filters** previews the plan first and states exactly how many cached messages would change before asking for confirmation. The preview and the run are produced by the same planner, so they agree.
- A message that fails leaves the rest of the run alone; each failure is listed with its subject.

### The filter editor

- Filters are created and edited from the **Message filters** card in Settings. A rule carries a name, an enabled state, all/any matching, a per-account or all-account scope, its condition rows, its action rows, and whether it runs after synchronization.
- Rows are added and removed individually. Choosing a condition's field narrows the comparisons offered to those the field supports, and choosing an action kind decides whether that row needs a value at all.
- A filter can be duplicated, enabled or disabled without editing it, reordered, and deleted. Deletion goes through the application's ordinary confirmation dialog, because a rule cannot be recovered from the editor once removed.
- The card carries its own search field with the project's regular-expression builder beside it. Plain text is the default and an invalid pattern is refused rather than executed.

### Running after synchronization

- A filter marked **run after synchronization** is evaluated when a synchronization brings new messages into that account, without the user asking.
- Only messages that actually arrived in that synchronization are considered. The arrival set is computed against the persisted cache, so a restart does not make already-processed messages look new, and an in-memory ledger stops two concurrent synchronizations acting on the same message.
- A UIDVALIDITY reset clears the folder's cache, so that generation's messages are deliberately treated as new.
- One post-synchronization run examines at most 5,000 messages and says so when it stops at that ceiling.
- The run reports what it changed as a non-blocking notification and a local-history record. A filter failure never fails the synchronization that triggered it.

### Junk classification

- The classifier is a local token model trained only by explicit **It is junk** and **Not junk** corrections. Tokens keep their source (sender, sender domain, subject, body), so a word in an address is weighed separately from the same word in a body.
- Until at least five junk and five wanted messages have been marked, the app reports the filter as untrained rather than guessing.
- Scoring combines the most informative tokens in log space and reports a verdict of junk, not junk, uncertain, or untrained, together with the score and the threshold used.
- Training is bounded: at most 200 tokens per message and 20,000 tokens in the model, with the least-informative tokens pruned first.
- Marking junk trains the model. It does not move the message on its own; a filter rule with a `mark-junk` action is what routes a message to the Junk folder.
- Training can be cleared, which forgets everything the model learned on this computer.

### Folder administration

- New folders are created on the server and the folder list is refetched rather than patched locally.
- Renaming keeps the parent path and replaces the leaf name. Because a server may move an entire subtree, every cached collection and message detail beneath the old path is discarded and the folder list is refetched.
- Only folders whose discovered role is `other` can be removed, so Inbox, Sent, Drafts, Archive, Junk, and Trash are protected.
- **Mark all read** searches the folder for unseen messages and applies `\Seen` in one round trip, then reports how many messages actually changed. It requires a known mailbox generation and refuses to run without one.
- The demonstration account has a fixed folder set; its folder-administration controls are disabled with a stated reason, and marking read is applied to its local cache only.

## Configuration

Tags, filters, and junk training live in the existing local application state file and are covered by the ordinary atomic write, validation, recovery, and local-history snapshot paths. There is no separate setting to enable them. Tag and filter changes are recorded in local history like other settings changes.

## Failure modes and limits

- Filter rules see only messages already cached on this computer. A message that has never been synchronized cannot match.
- One run examines at most 5,000 cached messages and reports when it stopped at that ceiling. The same ceiling applies to a run after synchronization.
- Tagging and junk training require the message's own account folder. In a unified view or a search result the controls are disabled with an explanation, because those views do not carry a single mailbox generation.
- A mailbox that does not advertise keyword support (no `PERMANENTFLAGS`, or one that omits the requested atoms without the `\*` wildcard) refuses the tag change outright rather than silently keeping it local only; tagging that message is unavailable until the account or folder supports keywords. This is proven against a mocked IMAP client; no public IMAP provider's real keyword support has been exercised.
- Tag keywords travel with a message only as far as the account's own IMAP server sees it; nothing here claims cross-provider or cross-client keyword interoperability beyond what RFC 3501 keywords already guarantee.
- Junk classification never moves, deletes, or reports a message on its own.
- A folder rename or removal that the server rejects leaves local state untouched; the failure is surfaced with its category preserved and without raw host paths.
- Marking a folder read is bounded to 50,000 unseen messages in one operation.

## Security and privacy

Every operation in this article runs in the main process over validated local state. Tag identifiers, colours, filter fields, operators, action kinds, and junk labels are constrained by strict IPC schemas before they reach the service, and the mailbox-generation-bound storage key never leaves the main process — the renderer works in message identifiers only. Regular expressions in filter conditions and in the quick filter go through the project's bounded matcher, which refuses nested and overlapping repetition before evaluation. The junk model stores token counts, not message text, and no tag, rule, or training decision is transmitted anywhere.

## Verification

- `tests/message-tags.test.ts` covers the built-in catalogue, name/colour normalization, identifier uniqueness, catalogue and per-message ceilings, built-in deletion refusal, move carry-through, dropped attribution, account pruning, usage counts, and mailbox-generation separation.
- `tests/message-filters.test.ts` covers field/operator pairing, every condition kind, case sensitivity, body fallback, match-all/any, account scoping, unsafe-pattern refusal, validation failures, ordinal ordering, stop handling, action collapsing, and repeatable run planning.
- `tests/junk-classifier.test.ts` covers tokenization and its bounds, the untrained state, junk and wanted verdicts, the uncertain state, threshold clamping, long-message stability, correction, exact untraining, and model pruning.
- `tests/quick-filter.test.ts` covers the inactive and inert states, each facet, facet conjunction, tag any/all matching, tag ceilings, scoped plain and regular-expression text, default case-insensitivity, invalid and unsafe patterns, and combined filtering.
- `tests/mail-organization.test.ts` covers state migration, orphaned-assignment pruning, cached-message reads, every tag operation over persisted state, filter create/update/remove/reorder with dense ordinals, subject construction, run planning and summarizing, and junk training over persisted state.
- `tests/message-filter-editor.test.ts` covers filter creation, editing, ordinal assignment, reordering with a partial identifier list, renumbering after a delete, the model's rejection reasons, the post-synchronization run, disabled and manual-only rules staying out of it, no reprocessing on a later synchronization or after a restart, the run ceiling, and a failing action leaving the synchronization successful.
- `tests/imap-keyword-persistence.test.ts` covers the keyword encoding round trip, refusal of a tag name that cannot be encoded, the unsupported-server refusal, foreign keywords surviving, and the UIDVALIDITY guard. It runs against a mocked IMAP client, not a socket.
- `tests/app-service-message-tags.test.ts` covers the application-level wiring: a real account's tag change calls `setMessageKeywords` with the exact resolved tag names and mailbox generation before applying anything locally; a server rejection or an unconfirmed store leaves the local tag catalogue exactly as it was (fail-closed) instead of applying the change anyway; and the demonstration account never calls the mail service and applies its tag purely locally.
- `npm run check` runs the type, unit, asset, site, source-policy, and build verification on this tree.
- `tests/e2e/packaged-build-tour.spec.ts` now exercises the message-filter editor and its own search/regex builder in a real, genuinely *packaged* Electron session (`electron-builder --linux dir`, `app.isPackaged === true`, not the dev-mode source-tree launch other specs use): it opens the real editor, creates a filter with a condition value, saves it, then drives the filter search/regex builder through nested-quantifier and overlapping-alternation rejection, invalid syntax, a Unicode zero-width match advanced by code point, multiline anchors with a capture group, and a real plain-text no-match query against the live filter list. A second scenario in the same file proves the search-status line's filter count stays identical across English, Cantonese, and bilingual English-1/Cantonese-5 (and reversed) extremes while only its voice changes.
- Not verified: the filter editor's full field set (operators, actions, tag/account scoping) exercised interactively rather than through service-level tests; folder administration against a live third-party IMAP server; the accessibility and full display-scale matrix for the new controls; and keyword persistence against any real IMAP server (only a mocked client has been exercised).

## Suggested articles

- [Synchronization and folders](synchronization-and-folders.md)
- [Local unified folders](unified-folders.md)
- [Cached mail search index](cached-mail-search-index.md)
- [Search and regex builder](../experience/search-and-regex-builder.md)
- [Local state and history](../data/local-state-and-history.md)
