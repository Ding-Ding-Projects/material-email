# Reading and message safety

## Status

**Parser, sanitizer, and external-link review flow verified locally; reader integration remains partly implemented.** Certificate diagnostics, remote-content consent, live-message coverage, and the full accessibility matrix remain open.

## Behavior

The mail service retrieves raw MIME source and parses addresses, reply-to, subject, date, message ID, text, HTML, flags, size, and attachment metadata. HTML passes through a strict allowlist. Images are not allowed, which removes remote tracking pixels and inline image rendering. The renderer places the sanitized body in a separate document with `default-src 'none'`, no forms or base URL, and only data images permitted by policy.

Attachments can be saved individually or together through native dialogs. Filenames are reduced to their basename, Windows-invalid/control characters are replaced, and multi-save uses collision-safe numbered names with exclusive file creation.

HTTP(S) links opened from message content are denied as direct popups. The main process creates a 60-second, single-use opaque review request, sends only its normalized URL, host, risk, and reasons to the trusted top-level renderer, and opens the URL only after the user confirms. The renderer shows the existing keyboard-focus-trapped bilingual confirmation dialog; cancel and expiry consume the request without opening a browser.

## Configuration

Allowed message structures include common text blocks, emphasis, lists, quotations, code, simple tables, headings, horizontal rules, and links. Link schemes are limited to HTTP, HTTPS, and mailto. Remote content has no current per-sender opt-in.

## Failure modes

- Aggressive sanitization can remove legitimate styling, inline media, complex tables, and embedded content.
- A message deleted or changed on the server between list and open may no longer be retrievable.
- Attachment metadata can disagree with bytes or filename.
- Saving does not perform antivirus scanning or quarantine tagging. It now classifies risky filenames and MIME/extension conflicts, shows factual warnings, and requires an explicit review before saving risky attachments.
- A closed, expired, malformed, or already-used review request cannot open a browser. Windows handler failures are surfaced as a non-modal error notification after the request is consumed.

## Security considerations

Sanitized HTML remains untrusted. Keep it outside the application DOM, keep script execution and network access disabled, and never interpolate raw headers into markup. The shared safety layer assesses external URLs for HTTP, embedded credentials, IP literals, non-default ports, punycode, bidi/control characters, and visible-host mismatches. The review queue revalidates the allowed protocol immediately before `shell.openExternal`; it never trusts renderer-supplied URLs. Certificate diagnostics, safe-link preview, and explicit remote-content consent remain open before loosening the boundary.

## Verification

Focused tests prove active elements, remote images, event handlers, and JavaScript links are removed while safe structure and mailto links remain. MIME fixture tests cover subject, addresses, seen/starred flags, sanitized HTML, and attachment metadata. External-link queue tests cover normalization, opaque IDs, unsupported protocols, cancellation, expiry, one-time consumption, and pre-open revalidation; IPC validation covers bounded request IDs. Dedicated iframe sandbox tests, malformed MIME corpus tests, oversized-message limits, certificate UX, attachment bytes, and live-server deletion races remain open.

## Suggested articles

- [Security boundaries](../architecture/security-boundaries.md)
- [Synchronization and folders](synchronization-and-folders.md)
- [Compose, drafts, and sending](compose-drafts-and-sending.md)
