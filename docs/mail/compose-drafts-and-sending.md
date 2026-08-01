# Compose, drafts, and sending

## Status

**Implemented foundation.** Text drafts, recipients, file-path attachments, SMTP submission, and outbox fallback exist. Complete compose safety and live delivery proof remain open.

## Behavior

A draft records account, To/Cc/Bcc lists, subject, plain-text body, reply references, and authorized local attachment paths. New paths must come from the native attachment picker. A persisted draft may reuse its own approved paths after restart, but another draft identifier cannot borrow them. The composer compares the current form with its last loaded/saved baseline, so merely opening or reloading a draft is not treated as an unsaved edit. Saving assigns a stable draft identifier, appends a history event for a real change, and refreshes that baseline. Sending requires at least one recipient and verifies that every attachment still names a regular file.

SMTP results distinguish full acceptance, partial acceptance, and zero acceptance. Partial delivery records and returns the exact accepted and rejected lists, removes the original draft to avoid duplicating accepted recipients, and raises a warning. A permanent all-recipient SMTP 5xx is never called success and is not treated as a retryable network outage: the unchanged message is retained as a draft, no outbox retry is created, an error is recorded, and the exact rejected recipient list is returned to the composer.

Closing or replacing a dirty composer uses an accessible discard decision instead of silently losing changes. Cancelling that decision returns focus to the originating compose control; confirming discard closes without changing the persisted baseline. Send and Save are mutually exclusive. Both submit an immutable snapshot: text entered while either operation is in flight remains visible and dirty rather than being overwritten or falsely reported as sent/saved. The main process compares a send-start persisted snapshot before removing or replacing a draft, so a newer same-ID save survives full, partial, queued, and rejected delivery outcomes.

If submission fails before a recipient verdict is available, the message is placed in a local outbox with the exact draft, a redacted actionable failure category, timestamp, and attempt count. Raw host paths, URLs/query parameters, private search text, provider-library detail, and stack locations are not copied into the queue. The next account sync retries it in order. If that retry receives a permanent zero-acceptance result, it leaves the outbox and returns to drafts instead of looping; partial acceptance is recorded without retrying already accepted recipients. Demo-account sending is local simulation and never contacts a server.

The Outbox recovery card keeps the attempt count, automatic ceiling, queue-head position, and last factual error visible across restart. Its localized action labels follow the active language and independent English/Cantonese humor levels without changing the facts: **Retry once** makes one attempt only and is available only for the queue head; **Undo queued send** returns the unchanged snapshot to Drafts without contacting a server; and **Open delivery history** opens History with unrelated date/action filters cleared and the exact queue identifier applied. Each action's accessible name includes the queued subject, and retry/undo reference the visible stored error through `aria-describedby`.

## Configuration

SMTP uses TLS, required STARTTLS, or explicit plain mode according to account settings. Connection, greeting, and socket timeouts are bounded. Newly configured accounts use password authentication; the OAuth browser foundation deliberately stops before token exchange and cannot currently create a sending account. Previously persisted OAuth-labeled accounts remain a migration boundary rather than evidence of a reviewed token lifecycle.

## Failure modes

- The current body is plain text; rich composition is not implemented.
- No address-completion, recipient-domain warning, public-recipient/Bcc check, attachment reminder, spell check, scheduled send, templates, or send-later choice is proven.
- Partial acceptance cannot automatically create a remaining-recipient draft without a deliberate duplicate-prevention design; the exact rejected list is reported for manual review.
- A queued snapshot cannot be edited in place; undo it to Drafts before changing recipients or content.
- Attachment files can change or disappear between selection and send.
- A transport timeout after server acceptance can create duplicate-send ambiguity.

## Security considerations

Bcc recipients must never appear in visible recipient lists or history exports not intended to include them. Attachment paths, message content, raw transport endpoints, provider details, and search/query text are sensitive local data. Renderer knowledge of a path is not authorization to read it; native selection or the matching persisted draft grants that capability. Queue/history/notification error copy uses the shared redaction boundary, including when legacy stored rows are projected after restart. Future HTML composition needs an independent sanitization model. OAuth, cryptographic signing/encryption, certificate failure, and duplicate-send handling require dedicated reviews.

## Verification

The current local gate covers bounded compose IPC, attachment authorization, saved dirty baselines, guarded replacement, edits made during in-flight save/send, compare-and-swap draft preservation, accessible discard/focus return, and full/partial/permanent-zero/queued recipient classification. The focused redaction/recovery evidence passes 3 unit/service/history files / 19 tests and 1 / 1 offline real-Electron scenario: a legacy row seeded with a raw Windows path, tokenized URL, private query, and provider-library name retains only an actionable connection-refused category after restart; the bilingual subject-specific recovery actions, exact History navigation, undo-to-Drafts, and remaining-row restart behavior still pass. No live-provider delivery, duplicate-ambiguity, oversized-attachment, clean-machine, packaged screen-reader, or display-scale matrix has completed.

## Drafts and Outbox workspace

Saved drafts remain addressable after the composer closes. The Drafts surface lists local drafts with recipient counts and previews; users can reopen, edit, or delete them. The Outbox surface lists queued deliveries, exposes retry-once, undo-to-Drafts, and exact History actions, and keeps attempt counts and the last factual error visible. Both surfaces are account-scoped and use the same validated IPC boundary as sending.

Failure modes are explicit: a missing or removed draft/outbox item is rejected without mutating another account, cancellation preserves the queued message as a local draft, and retry delegates through the normal attachment authorization and send path.

## Suggested articles

- [Accounts and connectivity](accounts-and-connectivity.md)
- [Synchronization and folders](synchronization-and-folders.md)
- [Notifications](../experience/notifications.md)
