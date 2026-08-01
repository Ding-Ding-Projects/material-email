# PIM persistence and transaction history

## Status

**Integrated persistence and transaction feature with current-tree checks passing.** Focused coverage passes for recovery, cross-process locking, validation, restore, renderer state, and real-Electron restart behavior. A searchable renderer transaction surface is integrated. Migration, retention/pruning, and large-data load testing remain open.

## Behavior

PIM state uses a strict generation-numbered atomic JSON envelope at the caller-owned app-data root below `pim/material-email-pim-v1.json`. Serialized writes validate the complete next state, fsync supported targets, rename, retain next/backup recovery slots, return defensive clones, and suppress no-op generations. Load chooses the highest valid generation and refuses corruption when no valid candidate exists. A token/PID lock serializes independent instances and processes, quarantines proven dead-owner locks after a grace period, bounds acquisition, and retries transient Windows lock-release failures while re-verifying ownership.

Every contact, mailing-list, event, and task mutation appends an ordered transaction with unique ID/sequence/time, action, entity kind/UID, and validated full before/after snapshots. Filters compose actions, kinds, UIDs, and time range. Restore appends a new `restored` transaction and raises the entity revision; history is never rewritten.

The renderer transaction page composes service-backed action, entity-kind, and date filters with a separate bounded text/regex search. That PIM-history search restores its own local mode, pattern, and normalized JavaScript flags, leaves sample/open state ephemeral, and reports exact matching/current-filter-scope counts. Invalid regex is a named alert rather than a false no-match result; a valid no-match is a named localized status with keyboard recovery. Deleted records can be restored from their latest deletion snapshot without rewriting the journal. PIM pages keep loaded/saved revision baselines: when a service save returns the same revision, copy reports that nothing changed instead of announcing a new save. Loading failures remain visible with an explicit retry action rather than being rendered as an empty successful state.

## Configuration

The persisted schema is version 1. Unknown fields are rejected. Entity/transaction UIDs are unique, transaction sequences strictly increase, and the next sequence cannot reuse a value. Files request mode `0600` where supported.

## Failure modes

- No schema migration/downgrade, retention/pruning UI, or large-data load proof exists.
- Disk exhaustion and denied-permission matrices remain incomplete. Transient Windows lock-release and unsupported-directory-fsync behavior are handled narrowly, but broad antivirus and abrupt-power-loss testing remains open.
- Full snapshots increase storage size and local sensitivity.

## Security considerations

There is no credential/token schema, Electron import, network import, remote content, or logging. Ordinary contact/calendar/task data is local plaintext; protect app-data ACLs and backups. Strict validation rejects unknown or corrupted candidates but is not encryption.

## Verification

The focused PIM-search helper passes 1 renderer file / 5 tests, and its dedicated 1 / 1 real-Electron scenario proves independent PIM-history restart state, exact localized count facts, and semantic result/focus behavior without changing transaction filtering or restore semantics. Existing PIM coverage also exercises persistence across restart, revision-aware no-op copy, dirty-editor/save ownership, explicit load-error retry, same-instance/independent-instance/separate-process concurrency, stale-lock recovery, rejected-operation cleanup, no-op suppression, recovery-candidate selection, corruption refusal, stable UIDs, strict validation, composed transaction filters, and append-only restore. Large-data, power-loss, clean-machine, and screen-reader matrices remain open.

## Suggested articles

- [Contacts, mailing lists, and vCard](contacts-mailing-lists-and-vcard.md)
- [Calendars and events](calendars-and-events.md)
- [Local state and history](../data/local-state-and-history.md)
