# Reading and message safety

## Status

**Bounded parsing, sanitization, explicit per-message remote-image consent, external-link review, and local attachment-quarantine flows are verified locally; broader reader integration remains partly implemented.** Certificate diagnostics, antivirus integration, broad malformed-message and parser wall-time matrices, live-message coverage, and the full accessibility matrix remain open.

## Behavior

The mail service retrieves raw MIME source and parses addresses, reply-to, subject, date, message ID, text, HTML, flags, size, and attachment metadata. HTML passes through a strict allowlist. The default variant contains no image elements. A separate sanitized variant may retain at most 1,000 absolute HTTP(S) `img` sources without event handlers, styles, `srcset`, credentials, protocol-relative URLs, scripts, media, frames, or forms; it also records each image's normalized origin, hostname, and protocol.

Every detail and attachment path uses the same parser policy. A new parse with a known server size above 32 MiB is refused before parsing; the IMAP range request itself asks for at most 32 MiB plus one extra detection byte. Pre-parse limits are 64 KiB for the complete header block and 8 KiB for each physical header line, and a NUL in the header block is rejected. Post-decode limits are 2 MiB of text, 4 MiB of HTML, 100 attachments, 20 MiB for one decoded attachment, and 24 MiB of decoded attachments combined. CID links are not expanded into base64 data URLs, and the unused mail-parser text-to-HTML synthesis is disabled. These are application safety limits, not provider limits or interoperability claims.

When a message has those sources, the reader shows their image count and exact origins before offering **Load for this message**. Consent is false by default, stored only on that cached message, survives restart, and can be revoked with **Block remote images again**. A changed mailbox UIDVALIDITY replaces the cached detail and therefore returns to default deny. The denied frame contains no remote image element. The allowed frame keeps its opaque sandbox and no-referrer policy and adds only the listed sanitized image origins to `img-src`; scripts, forms, frames, object/media loading, `connect-src`, base URLs, and same-origin access remain denied.

Ordinary attachments can be saved individually or together through native dialogs. Filenames are reduced to their basename, Windows-invalid/control characters are replaced, and multi-save uses collision-safe numbered names with exclusive file creation. Attachments classified as caution or dangerous never enter that direct save path: after metadata review they are written under randomized `.quarantine` payload names inside private application data. The persisted record keeps the original name, declared content type, byte size, SHA-256 integrity value, risk reasons, timestamp, and account/folder/UID/UIDVALIDITY/index provenance.

The Tools tab exposes the persisted local quarantine as an accessible bilingual decision surface. **Release…** rechecks size and SHA-256, asks for a destination through the native save dialog, copies the bytes, and removes the active quarantine record only after the copy succeeds. **Delete** removes the local payload without releasing it. Both actions require an explicit blocking decision and produce non-blocking result notifications. This is filename/type risk routing and integrity checking, not antivirus scanning or a claim that released content is safe.

HTTP(S) links opened from message content are denied as direct popups. The main process creates a 60-second, single-use opaque review request, sends only its normalized URL, host, risk, and reasons to the trusted top-level renderer, and opens the URL only after the user confirms. The renderer shows the existing keyboard-focus-trapped bilingual confirmation dialog; cancel and expiry consume the request without opening a browser.

## Configuration

Allowed message structures include common text blocks, emphasis, lists, quotations, code, simple tables, headings, horizontal rules, and links. Link schemes are limited to HTTP, HTTPS, and mailto. Remote-image consent is per message; there is no sender-wide, domain-wide, or global automatic allow rule.

The MIME limits are fixed in this slice and have no override UI. Exact-limit values are accepted; the first byte, character, attachment, or decoded byte above a ceiling is refused.

## Failure modes

- Aggressive sanitization can remove legitimate styling, inline media, complex tables, and embedded content.
- A legitimate message above a local MIME ceiling cannot currently be opened or have its attachments saved in Material Email. Refusal leaves its cache and server state unchanged; selecting it again safely retries only if the server copy changed.
- A bounded raw input can still exercise parser CPU. Parsing remains in the Electron main process without a preemptive worker deadline, so hard wall-time isolation and a broad malformed corpus remain open.
- A consented image request can reveal the reader's network address and message-open timing to every listed origin. HTTP sources receive an explicit unencrypted-transport warning; this is not certificate analysis.
- A remote image may fail because of DNS, TLS, server, policy, or connectivity errors. The app does not claim to diagnose certificates or image-server failures.
- A message deleted or changed on the server between list and open may no longer be retrievable.
- Attachment metadata can disagree with bytes or filename.
- Quarantine does not inspect attachment contents for malware. A release is a user decision after metadata review, not an antivirus approval.
- If quarantined bytes no longer match the persisted byte count or SHA-256 value, release fails closed and the active record remains available for deletion or diagnosis.
- A mixed save-all request quarantines caution/dangerous members before opening the folder chooser for ordinary members. Cancelling that chooser does not undo or release the quarantined members.
- A closed, expired, malformed, or already-used review request cannot open a browser. Windows handler failures are surfaced as a non-modal error notification after the request is consumed.

## Security considerations

Sanitized HTML remains untrusted. MIME limits reduce resource exposure but do not make a parsed message trustworthy. Keep message markup outside the application DOM and never interpolate raw headers into markup. The only message-body network exception is an explicitly consented image whose normalized origin appears in that message's sanitized source summary; the application document CSP is unchanged, and the reader revalidates the image URL against that exact set before constructing its scoped CSP. The shared safety layer assesses external links for HTTP, embedded credentials, IP literals, non-default ports, punycode, bidi/control characters, and visible-host mismatches. The review queue revalidates the allowed protocol immediately before `shell.openExternal`; it never trusts renderer-supplied URLs. Quarantine payload paths are derived only from main-process UUIDs; the renderer receives metadata, never an internal path. Certificate diagnostics, safe-link preview, and antivirus/content scanning remain open.

## Verification

Focused MIME safety tests pass 32 assertions across four files. They cover exact bounded IMAP range requests, known-size refusal before parsing, raw source/header/header-line/text/HTML ceilings, NUL headers, attachment count and decoded-byte ceilings, stable non-internal error copy, unchanged cache state, and an unterminated multipart that still reaches the unchanged sanitizer. Existing tests continue to prove active elements, credential-bearing/protocol-relative images, event handlers, `srcset`, frames, scripts, and JavaScript links are removed while safe structure and mailto links remain. Real Electron tests prove the denied frame has no image, explicit consent reconstructs only the listed image with no referrer, the exact-origin decision survives restart, revocation removes it, focus returns to the toggle, and bilingual semantics remain present. Malware-content detection, broad malformed MIME corpora, parser wall-time isolation, certificate UX, live-server remote-image behavior, live-server deletion races, and provider interoperability remain open.

## Suggested articles

- [Security boundaries](../architecture/security-boundaries.md)
- [Synchronization and folders](synchronization-and-folders.md)
- [Compose, drafts, and sending](compose-drafts-and-sending.md)
