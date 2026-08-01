# Synchronization and folders

## Status

**Implemented foundation.** The service supports IMAP discovery, selected-folder/inbox refresh, flags, moves, a local outbox, and ordered retry queues. Live interoperability and conflict testing remain open.

## Behavior

Synchronization connects to IMAP, replays pending operations for the account, lists folders, then refreshes the Inbox and selected folder. Folder roles are inferred from IMAP special-use flags. Message summaries include addresses, subject, date, preview, unread/starred state, attachment presence, and size.

Read/star changes and moves attempt the server first. A false mutation result is a failure, not a successful no-op. If the operation cannot complete, an ordered pending operation is retained for the next sync; replay stops on the first error so later operations do not overtake it. Failed sends enter a local outbox and are retried after pending flag/move operations.

Server moves require the IMAP MOVE capability. If it is absent, the operation fails closed before ImapFlow can fall back to a copy/delete sequence. A successful MOVE consumes the server-returned destination UID and UIDVALIDITY and never reuses the source UID as destination identity. The destination cache is updated only when that folder has an authoritative mapped cache; an unmapped or offline destination waits for its next refresh rather than receiving an invented local identity.

Message identity is bound to its folder UIDVALIDITY. Detail, attachment, flag, MOVE, and queued-operation paths carry the expected generation and compare it with the live mailbox after acquiring its lock. A mismatch fails closed and asks for refresh instead of acting on a different message that reused the UID. Final cache mutations recheck the same generation. In the renderer, account, folder, synchronization, and message-detail requests carry monotonic ownership tokens, so a late result cannot overwrite a newer selection or persist the losing folder.

## Configuration

IMAP uses the account's host, port, security mode, username, and encrypted credential. Each list request currently caps the fetched summary range at 250 messages. The folder cache and queues live in the local state file.

## Failure modes

- A failed sync records the error and preserves prior cached data.
- Pending operations have no current user-facing conflict-resolution strategy or retry ceiling.
- A server-side UIDVALIDITY change invalidates old cached UID identity and causes stale actions to fail closed; broad provider reset and simultaneous-client matrices remain unverified.
- A queued move can remain pending when the server lacks MOVE; the client does not trade message safety for a copy/delete fallback.
- An unmapped/offline destination can look unchanged until refresh, even after the server accepted a move.
- Only the Inbox and selected folder refresh automatically in the current sync path.
- Provider-specific IMAP extensions, quotas, namespaces, and server search are not fully exercised.

## Security considerations

Keep account connections short-lived, close them on every path, and never log protocol payloads or credentials. Offline queues can reveal message subjects and destinations in local state, so OS access controls and encrypted-sensitive-field policy matter. Conflict UI must never discard a queued user action silently.

## Verification

The current local gate covers false IMAP mutation results, MOVE capability fail-closed behavior, destination UID/UIDVALIDITY mapping, source-UID non-reuse, expected-generation refusal under the mailbox lock, stale-detail suppression, safe queued-operation replay, deferred refresh of unmapped/offline destinations, and four deterministic renderer request races. No live offline/online replay, provider MOVE-variant, broad UIDVALIDITY reset, simultaneous-client conflict, high-volume mailbox, or network-interruption matrix has completed.

## Suggested articles

- [Accounts and connectivity](accounts-and-connectivity.md)
- [Reading and message safety](reading-and-message-safety.md)
- [Local state and history](../data/local-state-and-history.md)
