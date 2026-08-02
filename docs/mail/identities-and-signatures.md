# Identities and signatures

## Current status

**Verified local model wired end to end, with local SMTP header evidence and no live delivery evidence.** Each account carries one or more identities, exactly one of which is its default. An identity supplies the `From` address the composer sends as, an optional `Reply-To`, and a signature placed above or below quoted material. Identities are created, edited, promoted, and removed from Settings, chosen per draft in the composer, and resolved again in the main process at send and at outbox delivery. Nothing here is checked against a mail server: an identity is a local claim about a `From` address, and a provider can still refuse an address the account does not own.

## Behavior

### What an identity is

- An identity belongs to exactly one account and records a display name, an email address, an optional reply-to address, an optional organization, a signature, a signature placement, a default flag, and an ordinal.
- The display name and the organization become header values, so they are normalized to a single line: NFKC normalization, `CRLF` folded to `\n`, control characters removed, then any remaining newline folded to a space rather than joining two words together. A signature keeps its newlines, because a signature has a reason to contain them.
- Addresses are checked against a deliberately conservative pattern — one `@`, a non-empty local part, a dotted domain, no whitespace or angle brackets, at most 320 characters. It rejects `mat@localhost` and accepts `mat+tag@mail.example.co.uk`. A stricter grammar would refuse addresses real servers accept.
- Identities sort default first, then by ordinal, then by display name, then by identifier, so the list order in Settings and in the composer picker is the same and is stable across restarts.

### Exactly one default per account

- Every account has exactly one default identity. The rule is enforced when an identity is saved, when one is removed, when one is promoted, and again when state is loaded, rather than being established once and trusted afterwards.
- Saving an identity marked default demotes that account's other identities. The first identity created on an account is always the default, so there is no "no identity" state to handle later.
- Removing the default promotes the highest-sorting sibling. Removing the last remaining identity on an account is refused (`IDENTITY_LAST_DEFAULT`).
- Loading state applies the same rule to the file: a state file carrying several defaults for one account keeps the first and demotes the rest, and one carrying none promotes the first identity it sees. A hand-edited file therefore cannot make the composer's `From` address depend on array order.

### Seeding and backfill

- Adding an account seeds one identity immediately, from the account's display name — falling back to the account's email address when that name is empty — and the account's email address. The demonstration account is seeded the same way.
- Accounts saved before identities existed have none. On the first bootstrap after upgrading, every account without an identity is seeded, and each seeding is recorded in local history as a `created` settings event. The composer therefore has a `From` address on the first launch after the upgrade rather than after a first manual edit.
- Removing an account forgets exactly that account's identities and leaves every other account's identities intact.

### Composer picker and signature placement

- The composer's From row is a real `<select>` when the account has two or more identities and a static read-only field when it has one, so a single-identity account is told which address it sends as without being offered a choice it does not have.
- A new message and a forward start from the account default. A reply starts from the identity the message was actually addressed to, checking `To` before `Cc`, and falls back to the account default when nothing matches.
- The signature is placed when the composer opens and again whenever the identity changes. Switching identities replaces the signature rather than stacking a second one: the outgoing identity's signature is named, so the exact previous block is cut out.
- Placement is per identity. **Above quoted material** (the default) inserts the block before the quote marker that reply and forward wrote, trimming the trailing whitespace ahead of it; **below quoted material** appends the block after everything. When the body has no quoted material, or the recorded quote position no longer lies inside the body, the signature is appended.
- A signature is written as the RFC 3676 separator block — a line containing `-- ` between the body and the signature — so a quoting client can recognize and strip it.
- Naming the previous signature is what makes an above-quote signature safe to replace. The separator marks where a signature starts and never where it ends, so cutting from the separator to the end of the body would take the quoted material with it. A caller that passes no previous signature at all gets the bare separator instead, cutting from it to the end of the body unconditionally — a body carrying someone else's separator is truncated by that path, so every caller in this application names what it applied. Passing an empty string is the authoritative way to say nothing of ours is present, and it cuts nothing.

### From and Reply-To headers

- The resolved identity sets the `From` header to its display name and its email address, and the SMTP envelope sender follows that address, so the identity reaches the transaction as well as the header block.
- `Reply-To` is written **only when the identity's reply-to address differs from its own email address**, compared case-insensitively after trimming. An identity whose reply-to repeats its own address, or leaves it blank, produces no `Reply-To` header at all.
- A draft's identity is resolved again in the main process at send time, not taken from the renderer. An identity identifier that belongs to a different account is ignored and the account default is used instead, so a stale draft cannot send `From` an unrelated account.
- A queued message resolves its identity at delivery time rather than at queue time, so an identity whose address changed while the message sat in the outbox delivers with the current address. The signature is already part of the queued body and is not re-placed.
- A draft with no resolvable identity — an account that somehow holds none — falls back to the account's own display name and address, which is what every draft written before identities existed expects.
- The organization field is stored, normalized, and shown in the editor, but this build writes no `Organization` header from it.

### Configuration through Settings

- The **Identities and signatures** card in Settings groups identities under their account and offers **Add identity**, edit, **Make default**, and remove per row. The default row shows a badge instead of a promote button.
- The editor is an inline form with display name, email address, reply-to, organization, signature placement, and the signature body. A rejected save re-renders with what the user typed rather than the previously stored values, and the reason is shown in the form.
- Removing an identity asks for confirmation first and states the consequence: the identity and its signature are removed from this computer, another identity becomes the default if this one was, drafts and queued messages that used it fall back to that default, and messages already sent are unchanged.
- The card is reachable from the settings search, which matches on identity, signature, From, Reply-To, alias, display name, organization, default, sender, placement, and quoted.
- Create, update, delete, and promote each append a local history event against `identity:<id>`, so an accidental change is reviewable and restorable through the ordinary local history path.

## Configuration

Identities live in the existing local application state file alongside accounts and drafts, and are covered by the ordinary atomic write, validation, recovery, and local-history snapshot paths. There is no separate setting to enable them and no per-identity server configuration: an identity changes which addresses are written into a message, never which server carries it. The account's own outgoing server settings still decide how the message is submitted.

Limits are per account and are fixed in this build: 20 identities per account, 120 characters of display name, 200 characters of organization, 320 characters of address, and 8,192 characters of signature. The persisted list as a whole is bounded at 2,000 records.

## Failure modes and limits

- An invalid email address is refused with a stated reason (`IDENTITY_EMAIL_INVALID`), as is an invalid reply-to address (`IDENTITY_REPLY_TO_INVALID`) and a blank display name (`IDENTITY_NAME_REQUIRED`). Nothing is saved and the form keeps the entered values.
- The last identity on an account cannot be removed. The remove control is disabled with a stated reason while only one remains, and the model refuses the operation independently of the disabled control.
- An account holds at most 20 identities. **Add identity** is disabled at the ceiling with a stated reason, and a further save is refused with `IDENTITY_LIMIT_REACHED`.
- Editing an identity that no longer exists is refused with `IDENTITY_NOT_FOUND` rather than creating a replacement.
- A draft or queued message naming a removed identity falls back to the account default. The stored identifier is cleared from drafts and outbox items when the identity is deleted, and an open composer holding the removed identifier drops it as soon as the list refreshes.
- Signature replacement works on the exact previous block. A body whose signature was hand-edited after it was placed no longer matches that block, so switching identities appends the new signature instead of replacing the edited text, and the edited text is left where it is.
- The organization value is stored but is not written into any header by this build.
- Identities are local to this computer. They are not synchronized to a server, not read from a provider's configured aliases, and do not survive reinstalling elsewhere without exporting local state.
- Nothing in this feature proves an account may send as a given address. A server that enforces sender authorization can accept the account's credentials and still reject the message, and that rejection is reported through the ordinary send-outcome path rather than by this feature.

## Security and privacy

- Display names, organizations, addresses, subjects, and every other value that becomes a header are refused outright at the IPC boundary when they contain a line break or NUL, so a header break cannot reach the message builder. The shared model folds a newline away as a second, independent defence; neither is relied on alone.
- The MIME encoder is a third defence behind those two. A display name that still carried a raw newline is emitted as an encoded word rather than as a header break, so a name reading `Mat Day\nBcc: attacker@example.test` produces one `From` header and no `Bcc` header.
- The identity payload schema is strict: unknown fields are rejected, every string is bounded, and the placement value must be one of the two known placements. Identity identifiers are validated as identifiers before they select anything.
- An identity holds no secret. There is no password, token, key, or passphrase field, and the account's credentials remain in the account record and its vault rather than being copied here. A signature is ordinary text the user typed and is stored in plain state like a draft body.
- The renderer proposes an identity; the main process resolves it. A renderer holding an identity identifier is not authorization to send as it, because the identifier is re-checked against the draft's own account before any address is written.
- **No mail server verifies an identity.** The `From` address written from an identity is a claim made by this client. It is not evidence of ownership, not an authentication result, and not a signature in the cryptographic sense — message signing and encryption remain a separate, metadata-only foundation documented in [Message cryptography trust states](message-cryptography-trust-states.md). The Settings card states this in place so the claim is not implied by the interface.

## Verification

- `tests/identities.test.ts` covers the shared model: address acceptance and rejection, text normalization with control characters removed and newlines kept, the length bound, the newline folded to a space for a header line while ordinary text keeps it, the required display name and valid addresses, first-identity-is-default, one default per account when another is promoted, non-interference with another account's default, in-place update keeping identifier and ordinal, a stored display name and organization carrying no newline, the missing-identity refusal, the per-account ceiling, sibling promotion when the default is removed, the last-identity refusal, reply selection by `To` then `Cc` then default, resolution from a requested identity and from the account default, the refusal to honour an identity belonging to another account, the empty-account case, sender construction, reply-to omitted when absent or only cased differently and written when it genuinely differs, and signature application — appending, replacing rather than stacking, clearing when the identity has no signature, above-quote and below-quote placement, an out-of-range quote index, and a null identity leaving the body alone.
- `tests/identity-wiring.test.ts` covers the main process over a real temporary state file: seeding exactly one default when an account is added, seeding the demonstration workspace without disturbing another account, backfilling an account persisted before identities existed and finding the backfill already done on the next launch, create-then-update in place, a second identity staying non-default until the default is moved, sibling promotion on delete with the last identity refused, the deleted identifier being cleared from drafts and outbox items, account removal forgetting only that account's identities, sending from the account default when the draft names no identity, sending from the identity the draft names, sending from the account default when the draft names another account's identity, a stored-state round trip, and the load-time transform collapsing two defaults on one account while promoting an account left with none.
- `tests/identity-smtp-headers.test.ts` reads the bytes a local SMTP fixture server actually received, unfolding continuation lines so a folded value is not mistaken for an injected header. It covers the account's own name and address in `From` with no identity chosen, the identity's display name and address in `From` with the envelope sender following it, `Reply-To` omitted for an empty and for a same-address-different-case value and written when it differs, and a display name arriving with a newline producing one `From`, no `Bcc`, and one unchanged `To` both after the model folded it and when a raw newline is forced past the model.
- Running `npx vitest run tests/identities.test.ts tests/identity-wiring.test.ts tests/identity-smtp-headers.test.ts` on this tree reported 3 files / 58 tests passed.
- `tests/e2e/identity-signature.spec.ts` passes 2 / 2 real-Electron scenarios covering the seeded single identity and its static From line, the From row becoming a real picker once a second identity exists, the chosen signature reaching the body, replacement rather than stacking on a switch, typed body text surviving the switch, the default badge moving, restart persistence, and replacement when the identity changes before any body text is typed.
- Not verified here: the accessibility and language matrices for the new controls, and a packaged run of any of it.
- Not proved by anything above: that any provider accepts a `From` address the account does not own; that a `Reply-To` header written by this build is honoured, rewritten, or stripped by a receiving client; that a signature separator is recognized by any particular third-party client; or that a message composed from a non-default identity is delivered as composed. The SMTP evidence comes from a local fixture server that authenticates a known password and queues whatever it is given, so **it is header composition evidence, not interoperability or sender-authorization evidence**. No live third-party submission from a distinct identity has been exercised.

## Suggested articles

- [Compose, drafts, and sending](compose-drafts-and-sending.md)
- [Accounts and connectivity](accounts-and-connectivity.md)
- [Message cryptography trust states](message-cryptography-trust-states.md)
- [Local state and history](../data/local-state-and-history.md)
