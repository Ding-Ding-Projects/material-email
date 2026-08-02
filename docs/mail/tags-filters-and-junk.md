# Message tags, filter rules, junk classification, and folder administration

## Current status

**Verified local slice with live folder administration.** Material Email can label cached messages with colour-coded tags, narrow a folder with a quick filter, evaluate ordered filter rules and carry out their actions, learn a local junk classifier from explicit corrections, and create/rename/remove folders and mark a folder read on the server. Tags, filters, and junk training are local and are never sent to a mail server. Filter rules evaluate cached rows only; server-side filtering, server-stored keywords, and scheduled background filtering are not implemented.

## Behavior

### Tags

- Five built-in tags ship with the app: Important, Work, Personal, To Do, and Later. They can be renamed and recoloured but not removed.
- Custom tags are created with a name and a six-digit hexadecimal colour, up to 64 tags in total and 20 tags on one message. Three-digit colours are expanded; anything else is rejected with a stated reason.
- A tag is stored against the account, folder path, mailbox generation (`UIDVALIDITY`), and UID that identified the message when it was tagged. Two messages that share a UID across mailbox generations therefore never share tags.
- A move carries a message's tags to the identity the server reported for the destination. When the server confirms a move but does not attribute a destination UID, the tags are dropped rather than applied to whichever message later takes that UID.
- Removing an account or a folder forgets exactly that account's or folder's assignments and leaves the catalogue intact.
- Deleting a tag removes it from the catalogue and from every message in one operation. A stored assignment whose tag no longer exists is discarded when state is loaded, so a blank chip cannot appear.

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
- One run examines at most 5,000 cached messages and reports when it stopped at that ceiling.
- Tagging and junk training require the message's own account folder. In a unified view or a search result the controls are disabled with an explanation, because those views do not carry a single mailbox generation.
- Tags are not written to the server as IMAP keywords, so they do not appear in other mail clients and do not survive reinstalling on another computer.
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
- `npm run check` runs the type, unit, asset, site, source-policy, and build verification on this tree.
- Not verified: a packaged Electron session exercising these surfaces, the accessibility and language matrices for the new controls, and folder administration against a live third-party IMAP server.

## Suggested articles

- [Synchronization and folders](synchronization-and-folders.md)
- [Local unified folders](unified-folders.md)
- [Cached mail search index](cached-mail-search-index.md)
- [Search and regex builder](../experience/search-and-regex-builder.md)
- [Local state and history](../data/local-state-and-history.md)
