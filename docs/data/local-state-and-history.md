# Local state and history

## Status

**Validated atomic JSON, corruption recovery, and isolated Git snapshot foundations are tested.** Complete diff, retention, filtering, encryption-migration, and every-record restore UX remain open.

## Behavior

Application state lives in a versioned JSON file below Electron's per-user application-data directory. Updates clone the current state, serialize through one promise queue, validate the complete serialized candidate, flush a same-directory temporary file, preserve the last valid primary as a backup, then rename the candidate into place. Reads wait for queued writes and return defensive copies.

Startup distinguishes absence from corruption. Defaults are written only when neither the primary nor any recovery material exists. Invalid JSON, an incompatible schema, an oversized file, or a non-file state path never triggers a silent reset. The store instead promotes the newest valid backup or interrupted-rename candidate and quarantines the corrupt primary. Bootstrap records the recovery in semantic history and shows a warning notification. With no valid recovery copy, startup refuses to overwrite the original and reports a corruption error.

After state writes, the application attempts to snapshot the full state file into an isolated local Git repository under its own data directory. It uses a fixed local identity, creates no commit for unchanged state, and never places `.git` inside a user-owned mail or project folder. Snapshot failures are logged without failing the user's primary operation.

The application also keeps semantic history records. Settings history can be restored, and the restore appends a new record. Removing an account purges that account's live cache, drafts, outbox records, and pending operations in the primary state, while prior semantic records and already-created local revisions remain append-only. A whole-state local revision is accepted only when it is a compatible validated state from a commit in the current local-history lineage. The live state is snapshotted before replacement, and the restore creates another snapshot and semantic record, keeping time travel append-only.

## Configuration

- State schema: version 1
- Maximum state/recovery candidate size: 64 MiB
- Stable recovery copy: `material-email-state-v1.json.backup`
- Notification retention: newest 500 records
- Semantic history retention: newest 2,000 records
- Local revision listing: default 200, hard maximum 2,000
- Revision identifiers: 7–40 hexadecimal Git object characters

## Failure modes

- Corruption with no valid recovery copy blocks startup until the file is repaired or deliberately moved; a dedicated recovery UI is not yet available.
- Windows does not support directory `fsync` consistently. Known unsupported error codes are tolerated after file handles are flushed, while rename recovery copies remain in the same directory. A broader power-loss and antivirus-lock test matrix remains open.
- Git might be missing, locked, or unavailable; state changes still succeed but snapshot history can lag.
- Whole-state schema changes can make older revisions incompatible.
- Restoring server-backed cache can present stale data until the next sync.
- Semantic non-settings records are view-only to avoid unsafe server-side rewrites.

## Security considerations

Snapshots contain the same sensitive metadata as live state. Stored account secrets remain `safeStorage` ciphertext, but file permissions, backup software, stable encryption binding, exported history, retention, and secure deletion require review. Git commands use argument arrays, and revision input is restricted to hashes to avoid option/path injection.

## Verification

The current local gate exercises defaults, defensive copies, serialized writes, corruption recovery, immutable snapshots, no-op suppression, validated revision input, and account-removal purging while append-only history remains. Two real-Electron restart paths pass. Missing Git, disk-full, real power-loss, antivirus-lock timing, DPAPI account changes, diff UI, action/date filters, pruning, and export remain open.

## Suggested articles

- [Security boundaries](../architecture/security-boundaries.md)
- [External editor and export](external-editor-and-export.md)
- [Changelog](changelog.md)
