# Local unified folders

## Current status

**Verified bounded slice.** Material Email can show local cross-account **Unified Inbox**, **Starred**, and **Unread** views from message summaries already present in its persisted cache. This is not server-complete synchronization, conversation threading, or a new mail index.

## Behavior

- Unified Inbox includes cached collections whose discovered folder role is `inbox`.
- Starred and Unread filter all coherent cached folder collections for configured accounts by their existing summary flags.
- Results use the existing composite message identity (`accountId`, folder path, and UID), discard orphaned or internally inconsistent cache rows, remove duplicate identities, and sort newest first with a deterministic identity tie-break.
- Every unified row displays its account name and email address. Those labels join sender, recipient, subject, and preview in the existing plain-text/JavaScript-regex mail search.
- Reopening or refreshing a unified view preserves the selected composite identity when it is still present. If it disappeared, selection falls back near its prior list position.
- Reply, forward, star, and read-state actions retain the source account. Move/archive/trash controls are unavailable in a unified view because folder destinations are account-specific; opening the account folder restores them.

## Configuration

There is no separate index or synchronization setting. Add accounts normally, synchronize each account to refresh its own cached summaries, then choose a unified folder above the selected account's folder list. The current account remains the compose and manual-sync account.

## Failure modes and limits

- A message or folder that has never been cached cannot appear.
- Automatic synchronization still refreshes only the selected account's Inbox and selected folder. Other accounts may remain stale until synchronized individually.
- Read/star membership is evaluated from cached summary flags. A late server change is not known until that account refreshes.
- The views do not group related messages, search message bodies, expand threads, or claim all-mail coverage.
- If local aggregation fails, the app keeps the failure non-blocking and does not contact another server as a fallback.

## Security and privacy

Aggregation runs in the main process over validated local state and returns the existing secret-free message summaries through a strict one-value IPC schema. It performs no network request, does not expose account credentials, and rejects cache entries whose account/folder attribution disagrees with their collection key. Search and regex evaluation remain local and bounded by the existing mail-search limits.

## Verification

- `tests/unified-folders.test.ts` covers account/folder filtering, orphan and inconsistent-row rejection, deduplication, deterministic sorting, and stable selection.
- `tests/ipc-validation.test.ts` limits the IPC input to `inbox`, `starred`, or `unread`.
- `tests/e2e/unified-folders.spec.ts` exercises two accounts in Electron, visible attribution, account-label search, the shared anchored regex builder, selection across reordered refreshes, and all three virtual folders.

## Suggested articles

- [Synchronization and folders](synchronization-and-folders.md)
- [Search and regex builder](../experience/search-and-regex-builder.md)
- [Reading and message safety](reading-and-message-safety.md)
- [Accounts and connectivity](accounts-and-connectivity.md)
