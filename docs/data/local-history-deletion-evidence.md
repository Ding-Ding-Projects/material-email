# Local-history deletion evidence

## Status

**A read-only policy and evidence surface is implemented and covered by focused unit and real-Electron tests.** It documents active-history pruning honestly; cryptographic erasure, reflog expiry, Git object reclamation, backup auditing, and storage-media wiping are not provided.

## Behavior

The History page exposes **Inspect deletion limits** beside the retention controls. Inspection waits for queued history work, reads the isolated app-owned Git repository, and returns a point-in-time report without modifying a revision, ref, reflog, object, file, or preference.

The report identifies the fixed supported policy as `active-history-pruning-only`. It counts active revisions, active Git-note labels, commits reachable only through Git reflogs, loose and packed objects, packs, prune-packable objects, and Git-reported garbage. It also records the Git version and generation time. Five literal false guarantees state that the app did not perform cryptographic erasure, reflog expiry, Git garbage collection, backup auditing, or storage-media auditing.

The report can be exported as local JSON through the native save dialog. The export repeats that the data is read-only Git metadata and is not cryptographic-erasure proof.

## Configuration

- Policy: fixed to `active-history-pruning-only`
- Inspection: user initiated and read only
- Scope: the app-owned local-history Git repository below Electron's per-user application-data directory
- Reflog-only count: commits reachable through Git reflogs but not current refs
- Object inventory: values reported by `git count-objects -v`, in Git's KiB units where applicable
- Automatic reflog expiry or garbage collection: disabled

## Failure modes

- Counts describe one instant. A later snapshot, label, restore, prune, manual Git operation, or external backup can make an earlier report stale.
- A zero reflog-only, loose-object, prune-packable, or garbage count does not prove that another ref, pack, filesystem block, backup, sync tool, volume snapshot, SSD controller, or storage device lacks a copy.
- Object inventory reports storage shape, not object sensitivity, reachability, overwrite status, or recoverability.
- Git absence, repository corruption, command failure, or output outside the bounded parser causes inspection to fail visibly; the app does not substitute guessed zeroes for a failed command.
- Export can be cancelled or can fail at the chosen destination. Inspection itself does not write an evidence file.

## Security considerations

The typed report contains counts, booleans, a timestamp, and the local Git version; it does not include snapshot bodies, paths, credentials, messages, labels, hashes, or decrypted data. The authenticated renderer can request the report only through the no-argument validated IPC channel.

Active-history pruning and evidence inspection do not weaken or strengthen `safeStorage` encryption. Rewriting a ref is not erasure. Git object storage, reflogs, backups, filesystem allocation, flash translation layers, and physical-media sanitization require separate policies and environment-specific proof. Material Email deliberately runs no destructive maintenance command from this surface.

## Verification

Focused repository coverage creates four snapshots, protects one label, prunes two active revisions, and then proves that the evidence still reports reflog-only revisions while all erasure and maintenance guarantees remain false. Renderer coverage verifies factual English and Hong Kong Cantonese summaries. The focused real-Electron History workflow opens the policy report and checks the supported-policy and non-erasure disclosures.

No forensic recovery attempt, filesystem trim audit, backup-provider audit, physical-media sanitization test, Git crash-injection test, or cryptographic-key-destruction design has been completed.

## Suggested articles

- [Local state and history](local-state-and-history.md)
- [Security boundaries](../architecture/security-boundaries.md)
- [External editor and export](external-editor-and-export.md)
