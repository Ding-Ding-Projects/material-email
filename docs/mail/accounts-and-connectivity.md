# Accounts and connectivity

## Status

**Implemented foundation with bounded local preflight, opt-in live IMAP/SMTP TLS inspection, an ephemeral OAuth authorization-code/PKCE boundary, a provider-gated Windows token-vault adapter, a mock-only token-lifecycle harness, and a local-only POP3 state-machine demo.** Manual configuration, provider presets, standards-based DNS discovery, deterministic protocol/host/port/security diagnostics, and credential-free local foundations exist. POP3 account connection, live transport, deletion, polling, persistence, and full synchronization are not implemented. No provider client registration or production token exchange ships in this build, so the Windows vault has no production token record and provider interoperability and connected OAuth accounts remain open.

## Behavior

Account discovery validates an email address, then combines up to three sources:

- an advisory lookup of the provider domain's `_imaps._tcp` and `_submission._tcp` DNS SRV records with a four-second bound;
- built-in settings for several common domains; and
- a conventional `imap.<domain>` / `smtp.<domain>` suggestion.

The user can review and edit incoming and outgoing host, port, security, username, and authentication mode. Adding an account tests both incoming IMAP and outgoing SMTP connectivity before storing it. The secret is encrypted with Windows-backed `safeStorage`, and renderer-facing account summaries omit it. Removing an account atomically purges its live cache, drafts, outbox records, pending mail operations, and matching open composer; append-only semantic and local-revision history is retained rather than rewritten. Every account-scoped completion rechecks that the account still exists, so a late draft, send, synchronization, folder, or message result cannot recreate purged live state. A fully local demo account is available without a network connection.

### Local POP3 foundation

Account setup offers IMAP or POP3 as the incoming protocol. Selecting POP3 switches conventional local diagnostics to implicit TLS port `995` and STARTTLS port `110`, then reveals a bilingual, keyboard-readable foundation panel. Account Test, Connect, incoming-certificate inspection, authentication, and password controls remain disabled. The panel sends only strict options—`local-demo` or explicitly unsupported `live-network`, `new-only`, required leave-on-server, and a `1..50` message bound—through validated IPC; host, username, password, and mail content never cross that operation.

The runner advances a deterministic `idle → connecting → authorization → transaction → update → disconnected` trace over three bundled fixture messages. It reports fixture capabilities (`UIDL` and `TOP` available; `STLS`, `PIPELINING`, and `DELE` unavailable), stable UIDLs, and literal false values for server contact, credentials, deletion, and full synchronization. A `live-network` request transitions directly from `idle` to `unsupported`; production account test/add separately refuse POP3 before mail transport, encryption, or persistence.

Password mode retains that reviewed connection path. OAuth mode no longer accepts a pasted access token: it clears and hides the password field, disables mail testing/account creation, and exposes a separate bilingual browser-foundation panel. Production reports Google and Microsoft registration as unavailable because no client registrations are configured. The main process also rejects OAuth-labeled account tests/additions before transport, encryption, or persistence, so renderer bypass cannot turn the foundation into manual token storage.

The OAuth service generates a fresh 64-byte PKCE verifier, S256 challenge, and 32-byte callback state for each configured attempt. It binds an exclusive ephemeral listener to `127.0.0.1`, constructs the redirect with its exact port and `/oauth/callback` path, and opens the authorization URL only from the main process. Callback validation requires GET, the loopback peer, exact host/port/path, one timing-safe matching state, and exactly one bounded code or provider error. Query tokens, duplicate results, wrong state, wrong host, wrong path, and non-loopback peers are rejected. The renderer receives only phase, provider, expiry, bounded failure reason, and provider availability—never the URL, state, verifier, code, access token, or refresh token.

Successful callback validation stops at `authorization-received`: the code is discarded, verifier/state buffers are zeroed, the listener closes, and the account remains disconnected. Cancellation, five-minute timeout, listener failure, browser-launch failure, provider denial/error, and repeated invalid callbacks all reach explicit terminal states with the same cleanup. No token endpoint is called and no OAuth value is written to application state, history, notifications, or logs.

### Windows token vault adapter

`src/main/oauth-token-vault.ts` provides a durable, main-process-only adapter around Electron `safeStorage` on Windows. A caller must supply a bounded, unique provider registration before initial save or rotation; the production registration and revoker lists are explicitly empty. Initial access and refresh values are independently encrypted before an atomic same-directory file replacement. A refresh rotates the encrypted access value, increments a generation, and either replaces a returned refresh value or preserves its existing ciphertext when a provider omits one. Tokens are limited to 8 KiB each, lifetimes to 24 hours, scopes to 50 unique bounded values, and the vault to 64 records in a 1 MiB document.

Renderer IPC exposes only Windows protection availability, bounded failure state, provider registration, record count, generation, expiry, and whether clear/revoke actions are currently available. It exposes no token, ciphertext, account key, scope name, provider error, or file path. Settings presents this status in an accessible bilingual live region. Provider-level local clear remains possible for orphaned ciphertext even when registration or Windows encryption later becomes unavailable. Revoke is enabled only for a registered main-process revoker; it decrypts inside the main process and removes the local records whether that provider call succeeds or fails. Active-file removal is not a secure-erasure claim, and no provider revoker ships in this build.

### Mock-only token lifecycle

`src/main/mock-oauth-token-lifecycle.ts` is an explicit local test/demo harness, not part of production initialization, `AppService`, preload, IPC, account state, or the visible demo workspace. `createDemoOAuthTokenLifecycle()` must be called deliberately by a demo harness; opening the normal local demo does not mint a token. The mock endpoint performs no network request and generates values labelled `mock-*`.

The harness models `idle → exchanging → active → expired/refreshing → active → revoking → revoked`, plus sanitized error states. Exchange requires a bounded mock authorization code and a 43–128-character base64url PKCE verifier. Refresh rotates both mock values and increments a renderer-safe generation counter. Revocation deletes the local encrypted record even when the mock provider revocation call fails. Public status contains only `mockOnly: true`, phase, expiry, scope count, generation, and a bounded failure code—never token material.

`EphemeralAesGcmOAuthTokenStorage` satisfies the mock encrypted-storage contract by keeping only AES-256-GCM ciphertext in a process-local map, binding ciphertext to its storage key with authenticated additional data, replacing/zeroing old blobs, and zeroing its random 256-bit key on disposal. It is deliberately non-durable and is **not** Windows credential storage or production at-rest evidence. The production Windows adapter is separate and never imports this mock endpoint or lifecycle.

Before either test or add can open a mail connection, a shared local preflight checks both endpoints. It blocks host fields containing schemes, paths, credentials, bracket notation, embedded ports, or certificate wildcards; blocks conventional implicit-TLS/STARTTLS port inversions; and rejects ports outside `1..65535`. IP literals and single-label/private names produce advisory certificate-identity warnings because they can be valid only when the server certificate policy covers the exact entered identity. Custom secure ports also remain advisory. The renderer presents the result live in an English, Hong Kong Cantonese, or bilingual status region, marks blocking fields with `aria-invalid`, promotes submitted errors to an assertive alert, focuses the first invalid field, and reports that no connection was started.

Live certificate inspection remains off until the user presses the incoming or outgoing inspection button. The main process then opens only a bounded diagnostic connection to the currently entered host and port: direct TLS for `tls`, or a fixed credential-free `STARTTLS` negotiation for IMAP/SMTP. One five-second deadline covers DNS, TCP, greeting, STARTTLS, and TLS handshake work; protocol responses cap at 16 KiB and certificate display caps at eight chain entries. No username, password, token, or mail content crosses this IPC or is sent to the server. Plain mode returns locally without opening a socket.

The result reports the runtime authorization decision, independent hostname match, TLS protocol/cipher, validity dates, public-key type/size, chain completion state, and short one-way certificate identifiers. Subject/issuer names, SAN entries, serial numbers, full fingerprints, PEM/DER bytes, and server greetings remain in the main process and are neither displayed nor persisted.

## Configuration

Incoming and outgoing settings each accept a host, port from 1 to 65535, `tls`, `starttls`, or explicit `plain` transport, and a username. Password authentication is the only mode that can currently test and persist a new connected account. OAuth provider and revoker configuration is constructor-injected in focused tests only; both production lists are empty. Inputs and provider IDs are length-bounded and schema-validated in the main process.

Conventional combinations are IMAP implicit TLS on `993`, IMAP STARTTLS on `143`, POP3 implicit TLS on `995`, POP3 STARTTLS on `110`, SMTP implicit TLS on `465`, and SMTP STARTTLS on `25`, `587`, or `2525`. POP3 ports are local validation only in this build. Other secure ports remain advisory. Explicit plain transport has no certificate identity check and does not protect credentials or message data.

## Failure modes

- DNS discovery may time out, omit one service, or return stale records; manual configuration remains available.
- Conventional hostnames are guesses, not verified provider data.
- Connection tests can fail on DNS, proxy, firewall, certificate, protocol, authentication, or provider-policy errors.
- The local preflight cannot know whether a syntactically valid DNS name appears on the server certificate or whether a custom port speaks the selected protocol; the optional live inspection can observe the presented chain and runtime hostname/trust decision only after explicit action.
- Live inspection is point-in-time evidence from one bounded handshake. It does not perform OCSP/CRL revocation retrieval, certificate-transparency analysis, interception detection, pinning, provider login, or IMAP/SMTP interoperability testing.
- Password authentication may be disabled by a provider.
- OAuth mode cannot connect an account until provider client registration, token exchange, provider-specific refresh/revocation, scope review, and mail authentication are implemented. The Windows vault adapter alone is not a usable token or a connected account.
- The mock token lifecycle proves local state transitions and ciphertext handling only. Mock exchange/refresh/revoke results are not provider responses, usable credentials, persistence proof, or interoperability evidence.
- The POP3 fixture proves only option validation, deterministic transition ordering, bounded local retrieval, and capability reporting. It does not prove authentication, TLS, provider capabilities, retention, `DELE`, polling, persistence, folder behavior, or complete synchronization.
- Local software can occupy an ephemeral callback port, block browser launch, or send invalid loopback requests. The state machine bounds and reports those cases but cannot make the local host trustworthy.
- Removing an account deletes its live local cache, drafts, outbox records, and pending operations but does not delete server data; retained append-only history can still describe the removed account and prior actions.

## Security considerations

Discovery performs DNS lookups only; it does not fetch or execute provider-hosted configuration code. Results remain advisory. The preflight runs locally and never logs or transmits entered settings. The POP3 runner imports no socket, DNS, TLS, provider, credential-storage, filesystem, logging, or production mail-transport dependency, and its IPC schema rejects credential-shaped fields. Live inspection is a separate IMAP/SMTP action with bounded credential-free input and redacted output. OAuth attempt secrets stay in the main process; the Windows vault sends only metadata through IPC; and the mock lifecycle remains isolated. Never log secrets or server-returned private data.

## Verification

Focused Windows-vault verification passes 6 vault unit tests inside a 5-file / 36-test OAuth/IPC slice. It covers the registration gate, unavailable encryption, ciphertext-only persistence, access/refresh rotation, sanitized status, direct orphaned-record clear, successful revoke-and-clear, and revoke-failure local clearing with a test-only provider source. Real-Electron Settings coverage verifies bilingual status, disabled unregistered actions, no token input/key, and the 760 × 560 width bound. This is local adapter/UI evidence, not live provider exchange, revocation, mail authentication, or interoperability.

## Suggested articles

- [Synchronization and folders](synchronization-and-folders.md)
- [Security boundaries](../architecture/security-boundaries.md)
- [LibreOffice source-reference map](../architecture/libreoffice-source-map.md)
