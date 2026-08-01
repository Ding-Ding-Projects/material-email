# Contacts, mailing lists, and vCard

## Status

**Integrated local feature with current-tree checks passing.** Typed preload/IPC operations and Material renderer pages cover contacts, mailing lists, member lookup, local search, vCard actions, deletion, and append-only restore. Focused regression and real-Electron coverage pass, while broad external vCard interoperability and remote address-book synchronization remain open.

## Behavior

Contacts use stable UIDs and structured names, ordered typed email addresses, phone numbers, postal addresses, organization, title, nickname, and notes. One value per channel may be preferred. Mailing lists use stable UIDs and ordered unique contact UID membership. Missing members are rejected during ordinary writes; deleting a contact preserves list references so a later restore rehydrates membership. CRUD, accent-insensitive AND-token search across structured fields, real no-op suppression, and append-only restore are implemented.

The renderer provides independent People, Mailing Lists, and Transaction History tabs. Plain contact search uses the main-process local index, while optional regular-expression matching stays bounded in the sandboxed renderer. Structured forms edit practical primary fields and preserve additional imported email/phone values. Each editor snapshots its loaded/saved entity as the dirty baseline, presents an accessible discard decision with focus return, and reports a no-op when the returned revision does not advance. Load failures render an explicit error with retry instead of masquerading as an empty address book. Mailing-list membership comes from the real service rather than a renderer-only cache.

The bounded local vCard layer exports deterministic vCard 4.0 and conservatively imports supported vCard 3.0/4.0. It handles CRLF unfolding/folding, text escaping, stable UID, structured names/addresses, multiple values, Unicode, revisions, and v4 groups/members. Import upserts by UID, suppresses unchanged data, and rejects duplicate UIDs.

## Configuration

Imports are capped at 5 MiB and 10,000 cards. Field and collection sizes are bounded. Repeated emails/phones and repeated list members are rejected case-insensitively; only one preferred email, phone, or address is accepted.

## Failure modes

- Unsupported/custom vCard properties, contact photos, keys, and provider extensions are not preserved.
- Malformed or ambiguous bundles are rejected instead of guessed.
- CardDAV synchronization and merge conflicts are not implemented.
- JSON-scale and very large address-book performance are not load-tested.

## Security considerations

Contact data is private local plaintext. Imports are untrusted text and never invoke URLs, scripts, or remote resources. Export must make fields and destination clear. App-data ACLs and backups must be protected; no at-rest encryption is claimed.

## Verification

The consolidated current-tree check passes 22 test files / 96 tests. The real-Electron suite passes all 15 scenarios, including contact and mailing-list persistence across restart, membership editing, guarded editor replacement, dirty-discard focus return, save ownership, revision-aware no-op copy, deletion-confirmation focus trapping, and PIM load-error retry. Focused unit coverage also exercises stable UIDs, Unicode, escaping, multiple values, structured addresses, conservative import, malformed-input rejection, strict validation, and append-only restore. Broad provider interoperability, scale, clean-machine, and screen-reader matrices remain open.

## Suggested articles

- [PIM persistence and transaction history](persistence-and-transactions.md)
- [Calendars and events](calendars-and-events.md)
- [Local state and history](../data/local-state-and-history.md)
