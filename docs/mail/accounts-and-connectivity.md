# Accounts and connectivity

## Status

**Implemented foundation with bounded local preflight and opt-in live TLS inspection.** Manual configuration, provider presets, standards-based DNS discovery, deterministic host/port/security diagnostics, and a credential-free certificate inspection action exist. SRV mapping and both diagnostic layers have focused tests; provider interoperability and interactive OAuth verification remain open.

## Behavior

Account discovery validates an email address, then combines up to three sources:

- an advisory lookup of the provider domain's `_imaps._tcp` and `_submission._tcp` DNS SRV records with a four-second bound;
- built-in settings for several common domains; and
- a conventional `imap.<domain>` / `smtp.<domain>` suggestion.

The user can review and edit incoming and outgoing host, port, security, username, and authentication mode. Adding an account tests both incoming IMAP and outgoing SMTP connectivity before storing it. The secret is encrypted with Windows-backed `safeStorage`, and renderer-facing account summaries omit it. Removing an account atomically purges its live cache, drafts, outbox records, pending mail operations, and matching open composer; append-only semantic and local-revision history is retained rather than rewritten. Every account-scoped completion rechecks that the account still exists, so a late draft, send, synchronization, folder, or message result cannot recreate purged live state. A fully local demo account is available without a network connection.

Before either test or add can open a mail connection, a shared local preflight checks both endpoints. It blocks host fields containing schemes, paths, credentials, bracket notation, embedded ports, or certificate wildcards; blocks conventional implicit-TLS/STARTTLS port inversions; and rejects ports outside `1..65535`. IP literals and single-label/private names produce advisory certificate-identity warnings because they can be valid only when the server certificate policy covers the exact entered identity. Custom secure ports also remain advisory. The renderer presents the result live in an English, Hong Kong Cantonese, or bilingual status region, marks blocking fields with `aria-invalid`, promotes submitted errors to an assertive alert, focuses the first invalid field, and reports that no connection was started.

Live certificate inspection remains off until the user presses the incoming or outgoing inspection button. The main process then opens only a bounded diagnostic connection to the currently entered host and port: direct TLS for `tls`, or a fixed credential-free `STARTTLS` negotiation for IMAP/SMTP. One five-second deadline covers DNS, TCP, greeting, STARTTLS, and TLS handshake work; protocol responses cap at 16 KiB and certificate display caps at eight chain entries. No username, password, token, or mail content crosses this IPC or is sent to the server. Plain mode returns locally without opening a socket.

The result reports the runtime authorization decision, independent hostname match, TLS protocol/cipher, validity dates, public-key type/size, chain completion state, and short one-way certificate identifiers. Subject/issuer names, SAN entries, serial numbers, full fingerprints, PEM/DER bytes, and server greetings remain in the main process and are neither displayed nor persisted.

## Configuration

Incoming and outgoing settings each accept a host, port from 1 to 65535, `tls`, `starttls`, or explicit `plain` transport, and a username. Authentication can be password or OAuth2 token. Inputs are length-bounded and schema-validated in the main process.

Conventional combinations are IMAP implicit TLS on `993`, IMAP STARTTLS on `143`, SMTP implicit TLS on `465`, and SMTP STARTTLS on `25`, `587`, or `2525`. Other secure ports are permitted with an advisory so private or custom services are not silently rejected. Explicit plain transport is permitted only with a visible warning; it has no certificate identity check and does not protect credentials or message data.

## Failure modes

- DNS discovery may time out, omit one service, or return stale records; manual configuration remains available.
- Conventional hostnames are guesses, not verified provider data.
- Connection tests can fail on DNS, proxy, firewall, certificate, protocol, authentication, or provider-policy errors.
- The local preflight cannot know whether a syntactically valid DNS name appears on the server certificate or whether a custom port speaks the selected protocol; the optional live inspection can observe the presented chain and runtime hostname/trust decision only after explicit action.
- Live inspection is point-in-time evidence from one bounded handshake. It does not perform OCSP/CRL revocation retrieval, certificate-transparency analysis, interception detection, pinning, provider login, or IMAP/SMTP interoperability testing.
- Password authentication may be disabled by a provider.
- Selecting OAuth2 does not launch an authorization browser; the current secret field accepts an existing access token.
- Removing an account deletes its live local cache, drafts, outbox records, and pending operations but does not delete server data; retained append-only history can still describe the removed account and prior actions.

## Security considerations

Discovery performs DNS lookups only; it does not fetch or execute provider-hosted configuration code. Results remain advisory and are shown for review before credentials are used. The preflight runs locally and never logs or transmits entered settings; the main process repeats the blocking check so renderer bypass cannot start a transport. Live inspection is a separate explicit action with a credential-free contract, bounded server replies, sanitized failure copy, redacted renderer result, and no persistence. Never log secrets or server-returned private data. Plain transport should be treated as unsafe. Provider presets and discovery behavior need regular security review without silently changing an existing account.

## Verification

Focused local-preflight verification passes 2 unit files / 8 tests plus 1 real-Electron scenario. Focused live-inspection verification passes 2 unit/IPC files / 15 tests plus 1 real-Electron loopback-TLS scenario. Coverage includes direct TLS, credential-free IMAP and SMTP STARTTLS, total timeout, response/chain bounds, strict credential-free IPC, plain no-network behavior, redaction, explicit-action-only network activity, hostname mismatch, bilingual output, and empty credential fields. Live Gmail, Outlook, Yahoo, iCloud, custom-domain, revocation/CT/interception, proxy, IPv6-connectivity, token-expiry, and provider-interoperability matrices remain open.

## Suggested articles

- [Synchronization and folders](synchronization-and-folders.md)
- [Security boundaries](../architecture/security-boundaries.md)
- [LibreOffice source-reference map](../architecture/libreoffice-source-map.md)
