# Accounts and connectivity

## Status

**Implemented foundation with bounded local preflight.** Manual configuration, provider presets, standards-based DNS discovery, and deterministic host/port/security diagnostics exist. SRV mapping and the local preflight have focused tests; live certificate inspection, provider interoperability, and interactive OAuth verification remain open.

## Behavior

Account discovery validates an email address, then combines up to three sources:

- an advisory lookup of the provider domain's `_imaps._tcp` and `_submission._tcp` DNS SRV records with a four-second bound;
- built-in settings for several common domains; and
- a conventional `imap.<domain>` / `smtp.<domain>` suggestion.

The user can review and edit incoming and outgoing host, port, security, username, and authentication mode. Adding an account tests both incoming IMAP and outgoing SMTP connectivity before storing it. The secret is encrypted with Windows-backed `safeStorage`, and renderer-facing account summaries omit it. Removing an account atomically purges its live cache, drafts, outbox records, pending mail operations, and matching open composer; append-only semantic and local-revision history is retained rather than rewritten. Every account-scoped completion rechecks that the account still exists, so a late draft, send, synchronization, folder, or message result cannot recreate purged live state. A fully local demo account is available without a network connection.

Before either test or add can open a mail connection, a shared local preflight checks both endpoints. It blocks host fields containing schemes, paths, credentials, bracket notation, embedded ports, or certificate wildcards; blocks conventional implicit-TLS/STARTTLS port inversions; and rejects ports outside `1..65535`. IP literals and single-label/private names produce advisory certificate-identity warnings because they can be valid only when the server certificate policy covers the exact entered identity. Custom secure ports also remain advisory. The renderer presents the result live in an English, Hong Kong Cantonese, or bilingual status region, marks blocking fields with `aria-invalid`, promotes submitted errors to an assertive alert, focuses the first invalid field, and reports that no connection was started.

## Configuration

Incoming and outgoing settings each accept a host, port from 1 to 65535, `tls`, `starttls`, or explicit `plain` transport, and a username. Authentication can be password or OAuth2 token. Inputs are length-bounded and schema-validated in the main process.

Conventional combinations are IMAP implicit TLS on `993`, IMAP STARTTLS on `143`, SMTP implicit TLS on `465`, and SMTP STARTTLS on `25`, `587`, or `2525`. Other secure ports are permitted with an advisory so private or custom services are not silently rejected. Explicit plain transport is permitted only with a visible warning; it has no certificate identity check and does not protect credentials or message data.

## Failure modes

- DNS discovery may time out, omit one service, or return stale records; manual configuration remains available.
- Conventional hostnames are guesses, not verified provider data.
- Connection tests can fail on DNS, proxy, firewall, certificate, protocol, authentication, or provider-policy errors.
- The local preflight cannot know whether a syntactically valid DNS name appears on the server certificate, whether a chain is trusted, expired, revoked, or intercepted, or whether a custom port actually speaks the selected protocol.
- Password authentication may be disabled by a provider.
- Selecting OAuth2 does not launch an authorization browser; the current secret field accepts an existing access token.
- Removing an account deletes its live local cache, drafts, outbox records, and pending operations but does not delete server data; retained append-only history can still describe the removed account and prior actions.

## Security considerations

Discovery performs DNS lookups only; it does not fetch or execute provider-hosted configuration code. Results remain advisory and are shown for review before credentials are used. The preflight runs locally and never logs or transmits entered settings; the main process repeats the blocking check so renderer bypass cannot start a transport. Certificate wording distinguishes a possible identity risk from an observed mismatch because no certificate has been inspected. Never log secrets or server-returned private data. Plain transport should be treated as unsafe. Provider presets and discovery behavior need regular security review without silently changing an existing account.

## Verification

Focused certificate-preflight verification passes 2 unit files / 8 tests plus 1 real-Electron scenario. It covers conventional valid combinations, malformed and wildcard hosts, IPv4/IPv6 and private-name advisories, implicit-TLS/STARTTLS inversions, custom ports, plain transport, main-process refusal before mail transport/encryption, bilingual visible copy, live ARIA state, first-invalid focus, and the no-connection error notice. This is deterministic local evidence only. Live Gmail, Outlook, Yahoo, iCloud, custom-domain, certificate-chain/expiry/revocation/hostname-mismatch, proxy, IPv6-connectivity, and token-expiry matrices remain open.

## Suggested articles

- [Synchronization and folders](synchronization-and-folders.md)
- [Security boundaries](../architecture/security-boundaries.md)
- [LibreOffice source-reference map](../architecture/libreoffice-source-map.md)
