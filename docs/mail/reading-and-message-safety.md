# Reading and message safety

## Status

**Parser, sanitizer, explicit per-message remote-image consent, external-link review, and local attachment-quarantine flows are verified locally; broader reader integration remains partly implemented.** Certificate diagnostics, antivirus integration, live-message coverage, and the full accessibility matrix remain open.

## Behavior

The mail service retrieves raw MIME source and parses addresses, reply-to, subject, date, message ID, text, HTML, flags, size, and attachment metadata. HTML passes through a strict allowlist. The default variant contains no image elements. A separate sanitized variant may retain at most 1,000 absolute HTTP(S) `img` sources without event handlers, styles, `srcset`, credentials, protocol-relative URLs, scripts, media, frames, or forms; it also records each image's normalized origin, hostname, and protocol.

When a message has those sources, the reader shows their image count and exact origins before offering **Load for this message**. Consent is false by default, stored only on that cached message, survives restart, and can be revoked with **Block remote images again**. A changed mailbox UIDVALIDITY replaces the cached detail and therefore returns to default deny. The denied frame contains no remote image element. The allowed frame keeps its opaque sandbox and no-referrer policy and adds only the listed sanitized image origins to `img-src`; scripts, forms, frames, object/media loading, `connect-src`, base URLs, and same-origin access remain denied.

Ordinary attachments can be saved individually or together through native dialogs. Filenames are reduced to their basename, Windows-invalid/control characters are replaced, and multi-save uses collision-safe numbered names with exclusive file creation. Attachments classified as caution or dangerous never enter that direct save path: after metadata review they are written under randomized `.quarantine` payload names inside private application data. The persisted record keeps the original name, declared content type, byte size, SHA-256 integrity value, risk reasons, timestamp, and account/folder/UID/UIDVALIDITY/index provenance.

The Tools tab exposes the persisted local quarantine as an accessible bilingual decision surface. **Release…** rechecks size and SHA-256, asks for a destination through the native save dialog, copies the bytes, and removes the active quarantine record only after the copy succeeds. **Delete** removes the local payload without releasing it. Both actions require an explicit blocking decision and produce non-blocking result notifications. This is filename/type risk routing and integrity checking, not antivirus scanning or a claim that released content is safe.

HTTP(S) links opened from message content are denied as direct popups. The main process creates a 60-second, single-use opaque review request, sends only its normalized URL, host, risk, and reasons to the trusted top-level renderer, and opens the URL only after the user confirms. The renderer shows the existing keyboard-focus-trapped bilingual confirmation dialog; cancel and expiry consume the request without opening a browser.

## Configuration

Allowed message structures include common text blocks, emphasis, lists, quotations, code, simple tables, headings, horizontal rules, and links. Link schemes are limited to HTTP, HTTPS, and mailto. Remote-image consent is per message; there is no sender-wide, domain-wide, or global automatic allow rule.

## Failure modes

- Aggressive sanitization can remove legitimate styling, inline media, complex tables, and embedded content.
- A consented image request can reveal the reader's network address and message-open timing to every listed origin. HTTP sources receive an explicit unencrypted-transport warning; this is not certificate analysis.
- A remote image may fail because of DNS, TLS, server, policy, or connectivity errors. The app does not claim to diagnose certificates or image-server failures.
- A message deleted or changed on the server between list and open may no longer be retrievable.
- Attachment metadata can disagree with bytes or filename.
- Quarantine does not inspect attachment contents for malware. A release is a user decision after metadata review, not an antivirus approval.
- If quarantined bytes no longer match the persisted byte count or SHA-256 value, release fails closed and the active record remains available for deletion or diagnosis.
- A mixed save-all request quarantines caution/dangerous members before opening the folder chooser for ordinary members. Cancelling that chooser does not undo or release the quarantined members.
- A closed, expired, malformed, or already-used review request cannot open a browser. Windows handler failures are surfaced as a non-modal error notification after the request is consumed.

## Security considerations

Sanitized HTML remains untrusted. Keep it outside the application DOM and never interpolate raw headers into markup. The only message-body network exception is an explicitly consented image whose normalized origin appears in that message's sanitized source summary; the application document CSP is unchanged, and the reader revalidates the image URL against that exact set before constructing its scoped CSP. The shared safety layer assesses external links for HTTP, embedded credentials, IP literals, non-default ports, punycode, bidi/control characters, and visible-host mismatches. The review queue revalidates the allowed protocol immediately before `shell.openExternal`; it never trusts renderer-supplied URLs. Quarantine payload paths are derived only from main-process UUIDs; the renderer receives metadata, never an internal path. Certificate diagnostics, safe-link preview, and antivirus/content scanning remain open.

## Verification

Focused tests prove active elements, credential-bearing/protocol-relative images, event handlers, `srcset`, frames, scripts, and JavaScript links are removed while safe structure and mailto links remain. They also prove factual origin extraction, strict boolean IPC validation, old-cache default-deny migration, persisted allow/revoke behavior, and CSP boundary declarations. Real Electron tests prove the denied frame has no image, explicit consent reconstructs only the listed image with no referrer, the exact-origin decision survives restart, revocation removes it, focus returns to the toggle, and bilingual semantics remain present. MIME fixture tests cover subject, addresses, seen/starred flags, sanitized HTML, and attachment metadata. Quarantine and external-link coverage remains as described above. Malware-content detection, malformed MIME corpora, oversized-message limits, certificate UX, live-server remote-image behavior, and live-server deletion races remain open.

## Suggested articles

- [Security boundaries](../architecture/security-boundaries.md)
- [Synchronization and folders](synchronization-and-folders.md)
- [Compose, drafts, and sending](compose-drafts-and-sending.md)
