# Accounts and connectivity

## Status

**Implemented foundation.** Manual configuration, provider presets, and standards-based DNS discovery exist. SRV mapping has focused tests; live provider and interactive OAuth verification remain open.

## Behavior

Account discovery validates an email address, then combines up to three sources:

- an advisory lookup of the provider domain's `_imaps._tcp` and `_submission._tcp` DNS SRV records with a four-second bound;
- built-in settings for several common domains; and
- a conventional `imap.<domain>` / `smtp.<domain>` suggestion.

The user can review and edit incoming and outgoing host, port, security, username, and authentication mode. Adding an account tests both incoming IMAP and outgoing SMTP connectivity before storing it. The secret is encrypted with Windows-backed `safeStorage`, and renderer-facing account summaries omit it. Removing an account atomically purges its live cache, drafts, outbox records, pending mail operations, and matching open composer; append-only semantic and local-revision history is retained rather than rewritten. Every account-scoped completion rechecks that the account still exists, so a late draft, send, synchronization, folder, or message result cannot recreate purged live state. A fully local demo account is available without a network connection.

## Configuration

Incoming and outgoing settings each accept a host, port from 1 to 65535, `tls`, `starttls`, or explicit `plain` transport, and a username. Authentication can be password or OAuth2 token. Inputs are length-bounded and schema-validated in the main process.

## Failure modes

- DNS discovery may time out, omit one service, or return stale records; manual configuration remains available.
- Conventional hostnames are guesses, not verified provider data.
- Connection tests can fail on DNS, proxy, firewall, certificate, protocol, authentication, or provider-policy errors.
- Password authentication may be disabled by a provider.
- Selecting OAuth2 does not launch an authorization browser; the current secret field accepts an existing access token.
- Removing an account deletes its live local cache, drafts, outbox records, and pending operations but does not delete server data; retained append-only history can still describe the removed account and prior actions.

## Security considerations

Discovery performs DNS lookups only; it does not fetch or execute provider-hosted configuration code. Results remain advisory and are shown for review before credentials are used. Never log secrets or server-returned private data. Plain transport should be treated as unsafe. Provider presets and discovery behavior need regular security review without silently changing an existing account.

## Verification

The 22-file / 96-test local gate covers SRV selection, validation, encrypted persistence, connection cleanup, account-removal purging without history rewriting, direct post-removal rejection, and late cache/send completion refusal. Live Gmail, Outlook, Yahoo, iCloud, custom-domain, certificate-error, proxy, IPv6, and token-expiry matrices are open.

## Suggested articles

- [Synchronization and folders](synchronization-and-folders.md)
- [Security boundaries](../architecture/security-boundaries.md)
- [LibreOffice source-reference map](../architecture/libreoffice-source-map.md)
