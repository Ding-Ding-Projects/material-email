# Accounts and connectivity

## Status

**Implemented foundation with bounded local preflight, opt-in live TLS inspection, and an ephemeral OAuth authorization-code/PKCE boundary.** Manual configuration, provider presets, standards-based DNS discovery, deterministic host/port/security diagnostics, a credential-free certificate inspection action, and a main-process OAuth state machine exist. No provider client registration or token exchange ships in this build, so provider interoperability and connected OAuth accounts remain open.

## Behavior

Account discovery validates an email address, then combines up to three sources:

- an advisory lookup of the provider domain's `_imaps._tcp` and `_submission._tcp` DNS SRV records with a four-second bound;
- built-in settings for several common domains; and
- a conventional `imap.<domain>` / `smtp.<domain>` suggestion.

The user can review and edit incoming and outgoing host, port, security, username, and authentication mode. Adding an account tests both incoming IMAP and outgoing SMTP connectivity before storing it. The secret is encrypted with Windows-backed `safeStorage`, and renderer-facing account summaries omit it. Removing an account atomically purges its live cache, drafts, outbox records, pending mail operations, and matching open composer; append-only semantic and local-revision history is retained rather than rewritten. Every account-scoped completion rechecks that the account still exists, so a late draft, send, synchronization, folder, or message result cannot recreate purged live state. A fully local demo account is available without a network connection.

Password mode retains that reviewed connection path. OAuth mode no longer accepts a pasted access token: it clears and hides the password field, disables mail testing/account creation, and exposes a separate bilingual browser-foundation panel. Production reports Google and Microsoft registration as unavailable because no client registrations are configured. The main process also rejects OAuth-labeled account tests/additions before transport, encryption, or persistence, so renderer bypass cannot turn the foundation into manual token storage.

The OAuth service generates a fresh 64-byte PKCE verifier, S256 challenge, and 32-byte callback state for each configured attempt. It binds an exclusive ephemeral listener to `127.0.0.1`, constructs the redirect with its exact port and `/oauth/callback` path, and opens the authorization URL only from the main process. Callback validation requires GET, the loopback peer, exact host/port/path, one timing-safe matching state, and exactly one bounded code or provider error. Query tokens, duplicate results, wrong state, wrong host, wrong path, and non-loopback peers are rejected. The renderer receives only phase, provider, expiry, bounded failure reason, and provider availability—never the URL, state, verifier, code, access token, or refresh token.

Successful callback validation stops at `authorization-received`: the code is discarded, verifier/state buffers are zeroed, the listener closes, and the account remains disconnected. Cancellation, five-minute timeout, listener failure, browser-launch failure, provider denial/error, and repeated invalid callbacks all reach explicit terminal states with the same cleanup. No token endpoint is called and no OAuth value is written to application state, history, notifications, or logs.

Before either test or add can open a mail connection, a shared local preflight checks both endpoints. It blocks host fields containing schemes, paths, credentials, bracket notation, embedded ports, or certificate wildcards; blocks conventional implicit-TLS/STARTTLS port inversions; and rejects ports outside `1..65535`. IP literals and single-label/private names produce advisory certificate-identity warnings because they can be valid only when the server certificate policy covers the exact entered identity. Custom secure ports also remain advisory. The renderer presents the result live in an English, Hong Kong Cantonese, or bilingual status region, marks blocking fields with `aria-invalid`, promotes submitted errors to an assertive alert, focuses the first invalid field, and reports that no connection was started.

Live certificate inspection remains off until the user presses the incoming or outgoing inspection button. The main process then opens only a bounded diagnostic connection to the currently entered host and port: direct TLS for `tls`, or a fixed credential-free `STARTTLS` negotiation for IMAP/SMTP. One five-second deadline covers DNS, TCP, greeting, STARTTLS, and TLS handshake work; protocol responses cap at 16 KiB and certificate display caps at eight chain entries. No username, password, token, or mail content crosses this IPC or is sent to the server. Plain mode returns locally without opening a socket.

The result reports the runtime authorization decision, independent hostname match, TLS protocol/cipher, validity dates, public-key type/size, chain completion state, and short one-way certificate identifiers. Subject/issuer names, SAN entries, serial numbers, full fingerprints, PEM/DER bytes, and server greetings remain in the main process and are neither displayed nor persisted.

## Configuration

Incoming and outgoing settings each accept a host, port from 1 to 65535, `tls`, `starttls`, or explicit `plain` transport, and a username. Password authentication is the only mode that can currently test and persist a new connected account. OAuth provider configuration is constructor-injected in focused tests only; the production configuration list is empty. Inputs and provider IDs are length-bounded and schema-validated in the main process.

Conventional combinations are IMAP implicit TLS on `993`, IMAP STARTTLS on `143`, SMTP implicit TLS on `465`, and SMTP STARTTLS on `25`, `587`, or `2525`. Other secure ports are permitted with an advisory so private or custom services are not silently rejected. Explicit plain transport is permitted only with a visible warning; it has no certificate identity check and does not protect credentials or message data.

## Failure modes

- DNS discovery may time out, omit one service, or return stale records; manual configuration remains available.
- Conventional hostnames are guesses, not verified provider data.
- Connection tests can fail on DNS, proxy, firewall, certificate, protocol, authentication, or provider-policy errors.
- The local preflight cannot know whether a syntactically valid DNS name appears on the server certificate or whether a custom port speaks the selected protocol; the optional live inspection can observe the presented chain and runtime hostname/trust decision only after explicit action.
- Live inspection is point-in-time evidence from one bounded handshake. It does not perform OCSP/CRL revocation retrieval, certificate-transparency analysis, interception detection, pinning, provider login, or IMAP/SMTP interoperability testing.
- Password authentication may be disabled by a provider.
- OAuth mode cannot connect an account until provider client registration, token exchange, encrypted token lifecycle/refresh, revocation, and scope review are implemented. A validated authorization-code callback is not a usable token or a connected account.
- Local software can occupy an ephemeral callback port, block browser launch, or send invalid loopback requests. The state machine bounds and reports those cases but cannot make the local host trustworthy.
- Removing an account deletes its live local cache, drafts, outbox records, and pending operations but does not delete server data; retained append-only history can still describe the removed account and prior actions.

## Security considerations

Discovery performs DNS lookups only; it does not fetch or execute provider-hosted configuration code. Results remain advisory and are shown for review before credentials are used. The preflight runs locally and never logs or transmits entered settings; the main process repeats the blocking check so renderer bypass cannot start a transport. Live inspection is a separate explicit action with a credential-free contract, bounded server replies, sanitized failure copy, redacted renderer result, and no persistence. OAuth secrets are confined to the main-process attempt, zeroed/cleared at terminal cleanup, omitted from IPC, and never passed to the JSON/history stores or logging calls. Never log secrets or server-returned private data. Plain transport should be treated as unsafe. Provider presets, future authorization endpoints/scopes, redirect policy, and token lifecycle need regular security review without silently changing an existing account.

## Verification

Focused OAuth verification passes 8 state-machine/PKCE/callback unit tests, the combined 4-file IPC/security focus passes 29 tests, and 1 real-Electron scenario covers bilingual semantics, no pasted-token field, disabled account actions, waiting/cancel states, focus preservation through polling, and the 760 × 560 width bound. Focused local-preflight verification passes 2 unit files / 8 tests plus 1 real-Electron scenario. Focused live-inspection verification passes 2 unit/IPC files / 15 tests plus 1 real-Electron loopback-TLS scenario. Live Gmail, Outlook, Yahoo, iCloud, custom-domain authorization, token exchange/refresh/revocation, provider scopes/consent, public-provider callback variations, and provider interoperability remain untested and unclaimed.

## Suggested articles

- [Synchronization and folders](synchronization-and-folders.md)
- [Security boundaries](../architecture/security-boundaries.md)
- [LibreOffice source-reference map](../architecture/libreoffice-source-map.md)
