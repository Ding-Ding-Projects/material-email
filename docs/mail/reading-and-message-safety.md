# Reading and message safety

## Status

**Parser and sanitizer verified; reader integration partly implemented.** Live message, link, attachment, phishing, and accessibility tests remain open.

## Behavior

The mail service retrieves raw MIME source and parses addresses, reply-to, subject, date, message ID, text, HTML, flags, size, and attachment metadata. HTML passes through a strict allowlist. Images are not allowed, which removes remote tracking pixels and inline image rendering. The renderer places the sanitized body in a separate document with `default-src 'none'`, no forms or base URL, and only data images permitted by policy.

Attachments can be saved individually or together through native dialogs. Filenames are reduced to their basename, Windows-invalid/control characters are replaced, and multi-save uses collision-safe numbered names with exclusive file creation.

## Configuration

Allowed message structures include common text blocks, emphasis, lists, quotations, code, simple tables, headings, horizontal rules, and links. Link schemes are limited to HTTP, HTTPS, and mailto. Remote content has no current per-sender opt-in.

## Failure modes

- Aggressive sanitization can remove legitimate styling, inline media, complex tables, and embedded content.
- A message deleted or changed on the server between list and open may no longer be retrievable.
- Attachment metadata can disagree with bytes or filename.
- Saving does not perform antivirus scanning or quarantine tagging. It now classifies risky filenames and MIME/extension conflicts, shows factual warnings, and requires an explicit review before saving risky attachments.
- The renderer's link activation and focus behavior are not fully verified.

## Security considerations

Sanitized HTML remains untrusted. Keep it outside the application DOM, keep script execution and network access disabled, and never interpolate raw headers into markup. Add phishing warnings, Unicode-domain handling, safe link previews, attachment scanner integration, and explicit remote-content consent before loosening the boundary.

## Verification

Focused tests prove active elements, remote images, event handlers, and JavaScript links are removed while safe structure and mailto links remain. MIME fixture tests cover subject, addresses, seen/starred flags, sanitized HTML, and attachment metadata. Dedicated iframe sandbox tests, malformed MIME corpus tests, oversized-message limits, phishing UX, attachment bytes, and live-server deletion races remain open.

## Suggested articles

- [Security boundaries](../architecture/security-boundaries.md)
- [Synchronization and folders](synchronization-and-folders.md)
- [Compose, drafts, and sending](compose-drafts-and-sending.md)
