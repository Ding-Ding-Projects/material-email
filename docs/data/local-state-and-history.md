# Local state and history

## Status

**Validated atomic JSON, corruption recovery, isolated Git snapshots, advanced semantic-history date filtering, revision diff/label/restore, and a bounded retention/pruning slice are tested.** Secure deletion, encryption migration, storage-reclamation proof, and every-record restore remain open.

## Behavior

Application state lives in a versioned JSON file below Electron's per-user application-data directory. Updates clone the current state, serialize through one promise queue, validate the complete serialized candidate, flush a same-directory temporary file, preserve the last valid primary as a backup, then rename the candidate into place. Reads wait for queued writes and return defensive copies.

Startup distinguishes absence from corruption. Defaults are written only when neither the primary nor any recovery material exists. Invalid JSON, an incompatible schema, an oversized file, or a non-file state path never triggers a silent reset. The store instead promotes the newest valid backup or interrupted-rename candidate and quarantines the corrupt primary. Bootstrap records the recovery in semantic history and shows a warning notification. With no valid recovery copy, startup refuses to overwrite the original and reports a corruption error.

After state writes, the application attempts to snapshot the full state file into an isolated local Git repository under its own data directory. It uses a fixed local identity, creates no commit for unchanged state, and never places `.git` inside a user-owned mail or project folder. Snapshot failures are logged without failing the user's primary operation.

The application also keeps semantic history records. Settings history can be restored, and the restore appends a new record. Removing an account purges that account's live cache, drafts, outbox records, and pending operations in the primary state, while prior semantic records and already-created local revisions remain append-only. A whole-state local revision is accepted only when it is a compatible validated state from a commit in the current local-history lineage. The live state is snapshotted before replacement, and the restore creates another snapshot and semantic record, keeping time travel append-only.

The semantic-history list composes its independent plain-text/JavaScript-regex search, derived action checkboxes, and date range. Its anchored non-modal calendar accepts two-click ranges, direct month/year jumps, keyboard day navigation, and last-seven-days, last-thirty-days, current-month, current-year, or all-history presets. The two text fields accept ISO dates and the active English or Hong Kong Chinese locale order. Partial, malformed, impossible, and inverted text stays visible with inline bilingual feedback rather than being discarded. Raw date text is session-persisted separately from Changelog, while valid canonical bounds drive both the visible rows and JSON export; invalid search or date state disables export.

Under forced colors, the calendar uses system-color control boundaries, a visible field-wrapper focus fallback for native month/year controls, outlined range membership, and paired `Highlight`/`HighlightText` endpoints with a contrasting keyboard focus ring.

The History and Changelog calendar instructions now select five factual tone levels independently for English and Cantonese. Every History variant states that filtering neither exports nor deletes data; every Changelog variant states that filtering neither copies nor exports data. Missing copy falls back deterministically instead of leaving the anchored dialog unnamed or blank.

The History page lists all returned whole-workspace revisions instead of an eight-row teaser. Its independent plain-text-first search and anchored JavaScript regex builder match revision labels, immutable hashes, commit subjects, and timestamps. Expanding a revision loads a bounded, line-classified diff against its parent; the first revision is compared with an empty workspace. Encrypted-secret values are redacted before the preview crosses the typed preload boundary. A user label is stored in a dedicated local Git notes ref, so labeling does not rewrite the snapshot commit. Restore remains behind a reviewed blocking decision and returns focus when cancelled.

The same surface persists a retention age from 30 through 3,650 days, defaulting to 365. Preview is a read-only dry run that reports the exact eligible revisions and separately counts the protected current, labeled, and recent revisions. Applying the preview repeats the cutoff, active-head, exact-candidate, clean-worktree, linear-history, and app-ownership checks. Pruning reconstructs only the retained app-owned snapshot line, copies labels, and proves the rewritten tip has the same tree as the previous current revision before moving the app-owned branch. Any non-app-owned commit blocks automatic pruning. A successful apply appends a `pruned` semantic-history record and a new current snapshot.

## Configuration

- State schema: version 1
- Maximum state/recovery candidate size: 64 MiB
- Stable recovery copy: `material-email-state-v1.json.backup`
- Notification retention: newest 500 records
- Semantic history retention: newest 2,000 records
- Semantic-history date input: 32 characters per bound; raw text is session-persisted under a history-only key
- Semantic-history presets: last 7 days, last 30 days, current month, current year, and all history
- Local revision listing: default 200, hard maximum 2,000
- Local revision retention: default 365 days; configurable from 30 through 3,650 whole days
- Automatic pruning: maximum 2,000 revisions in one complete preview; current, labeled, and recent revisions are protected
- Revision identifiers: 7–40 hexadecimal Git object characters
- Revision labels: 1–120 characters, trimmed, with control characters rejected
- Diff preview: first 400 lines and a 2 MiB process-output ceiling; truncation is stated in the UI

## Failure modes

- Corruption with no valid recovery copy blocks startup until the file is repaired or deliberately moved; a dedicated recovery UI is not yet available.
- Windows does not support directory `fsync` consistently. Known unsupported error codes are tolerated after file handles are flushed, while rename recovery copies remain in the same directory. A broader power-loss and antivirus-lock test matrix remains open.
- Git might be missing, locked, or unavailable; state changes still succeed but snapshot history can lag.
- Whole-state schema changes can make older revisions incompatible.
- Restoring server-backed cache can present stale data until the next sync.
- Semantic non-settings records are view-only to avoid unsafe server-side rewrites.
- Partial, malformed, impossible, or inverted semantic-history dates intentionally produce no filtered/exportable result until corrected; the typed text is retained.
- Revision preview truncation can omit later changed lines; restore still reads and validates the complete snapshot.
- Labels are local annotations and are not a retention, pruning, or export policy.
- A stale preview, unexpected head, dirty history worktree, non-linear lineage, non-app-owned commit, or history above the 2,000-revision preview ceiling blocks automatic pruning.
- Pruning removes revisions from active app history but does not promise secure deletion. Unreachable Git objects, reflogs, backups, filesystem behavior, and storage media can retain data.

## Security considerations

Snapshots contain the same sensitive metadata as live state. Stored account secrets remain `safeStorage` ciphertext, and diff previews replace encrypted-secret values with an omission marker before renderer delivery. Message and account metadata can still appear in a local diff. History date text and regex evaluation remain local, bounded, and untransmitted. File permissions, backup software, stable encryption binding, exported history, object reclamation, and secure deletion require review. Git commands use argument arrays; revision input is restricted to hashes, labels are bounded and reject control characters, and prune application is tied to the exact validated dry run.

## Verification

Focused tests exercise immutable snapshots, Git-note label persistence, parent diffs, encrypted-secret redaction, bounded label validation, exact dry-run candidates, stale-head refusal, non-app-owned blocking, current-tree and label preservation, bilingual retention semantics, persisted preference migration, and composed semantic-history action/text/date filtering. Real Electron covers diff/label/restore review, retention preview, invalid and partial typed dates, month/year navigation, keyboard day focus, named presets, two-click range selection, focus return, and date+action+regex composition. A focused language/humor matrix additionally checks English, Cantonese, and both inverse bilingual humor combinations on the History and Changelog pickers. A focused responsive scenario proves that the non-modal History picker stays fixed, collision-clamped, horizontally contained, and focus-stable at 760 × 560, 608 × 448, and 380 × 280 effective CSS viewports; the smaller sizes do not certify native Windows display scaling. Focused Chromium forced-colors emulation verifies keyboard focus plus system-color range and endpoint distinctions for both calendars; native Windows High Contrast remains open. Missing Git, disk-full, real power-loss, antivirus-lock timing, DPAPI account changes, crash injection during the ref move, object-reclamation measurement, secure deletion, and complete every-record restore remain open.

## Suggested articles

- [Security boundaries](../architecture/security-boundaries.md)
- [Local-history deletion evidence](local-history-deletion-evidence.md)
- [External editor and export](external-editor-and-export.md)
- [Changelog](changelog.md)
