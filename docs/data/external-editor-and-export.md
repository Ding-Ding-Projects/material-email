# External editor and export

## Status

**Implemented and locally tested foundation.** Detection, native approval, executable validation, argument-safe launch, and bounded text export dialogs exist. Packaged launch and restricted-folder tests remain open.

## Behavior

The application checks a finite Windows command inventory for `.exe` installations of Visual Studio Code, Cursor, Notepad++, and Notepad. Each detection result must resolve to a regular file with a Windows executable header. A custom executable can enter the approval list only through the native file picker; renderer-written preference paths cannot grant launch authority. Opening an editor passes the application project path as one argument through `spawn` with shell execution disabled, starts the process detached, and does not concatenate a command line.

History, settings, changelog, and regex content can be saved through native dialogs. Cancellation returns without writing. Attachment export has its own native-dialog and collision-handling paths described in [Reading and message safety](../mail/reading-and-message-safety.md).

## Configuration

The saved external-editor path is optional. Current detection uses argument-safe `where.exe` calls; a missing or non-executable result simply omits that editor. Native custom approvals are stored in main-process state outside renderer-facing preferences. Text export content is bounded to 32 MiB, suggested names must be plain filenames, and output is UTF-8.

## Failure modes

- Portable or custom-installed editors may not be on `PATH` and are not detected.
- An editor can be removed after selection.
- A signed or executable-looking program can still be malicious; detection and explicit native selection prove user choice and file shape, not publisher trust.
- Opening the application install directory may be less useful than opening a user-selected file; file ownership is not yet modeled.
- Disk-full, access-denied, filename collision, and overwrite confirmation behavior depend on native dialog/filesystem results.

## Security considerations

Never pass user text through a shell. Keep executable approval outside renderer control, validate every launch target again immediately before launch, and retain the exact argument boundary. Exports can contain sensitive settings or history; make content and destination clear before writing, and never export decrypted secrets.

## Verification

Focused tests confirm rejection of non-`.exe` and invalid-header files. Source inspection confirms finite detection, native custom approval, `execFile`/`spawn` argument arrays with shell execution disabled, regular-file checks, bounded native save dialogs, cancellation, and UTF-8 writes. Packaged-path behavior, actual custom-editor launch, removed executables, restricted folders, long paths, and sensitive-field redaction tests remain open.

## Suggested articles

- [Local state and history](local-state-and-history.md)
- [Development and packaging](../delivery/development-and-packaging.md)
- [Security boundaries](../architecture/security-boundaries.md)
