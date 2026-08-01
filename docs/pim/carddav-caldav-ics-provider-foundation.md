# CardDAV, CalDAV, and ICS provider foundation

## Current status

Material Email has a bounded, deterministic **local validation foundation** for CardDAV, CalDAV, and local ICS-file profiles. It is not a synchronization client and is not provider-interoperability evidence.

The main process validates a typed provider profile, returns a fixed capability model and transition trace, and reports literal negative facts for networking, credentials, persistence, synchronization, and recurrence expansion. The Settings panel exposes the same boundary in English, playful Hong Kong-style Cantonese, and bilingual modes through an accessible polite live region.

## Behavior

- CardDAV and CalDAV profiles require an absolute HTTPS URL.
- URLs containing user information, a query string, a fragment, control characters, or more than 2,048 characters are rejected before any provider interaction.
- A local ICS profile requires a `file:` URL containing an absolute Windows drive path ending in `.ics`. UNC and network file locations are rejected.
- Authentication choices are metadata labels only: none, password/basic, or OAuth 2. The foundation accepts no username, password, token, client identifier, or scope. Local ICS requires the no-credentials mode.
- A valid profile follows `idle → validating → capability-review → ready`. An invalid profile follows `idle → validating → rejected` and returns reviewable issues.
- CardDAV advertises only the bounded local vCard envelope. CalDAV and local ICS advertise only the bounded local iCalendar envelope. Discovery, ETags, sync tokens, provider reads/writes, scheduling, recurrence expansion, and credential use remain unavailable.

## Import and export boundary

The provider module includes an isolated local interchange inspector and export normalizer. This is a content boundary, not a renderer import command or sync pipeline.

- Input is limited to 1 MiB, 20,000 physical lines, and 8,192 bytes per physical line.
- vCard input must contain 1–2,000 balanced `VCARD` components, each declaring version 3.0 or 4.0.
- iCalendar input must contain exactly one balanced version-2.0 `VCALENDAR` and 1–5,000 `VEVENT`/`VTODO` components. Every event/task must carry one non-empty unique `UID` (maximum 512 characters); orphaned folds and malformed property names are rejected rather than discarded.
- `VTIMEZONE`, `VALARM`, `STANDARD`, and `DAYLIGHT` envelopes are structurally counted. `RRULE` values are counted and preserved as metadata; occurrences are never generated.
- Scheduling `METHOD` payloads, iCalendar attachments, unsupported components, malformed nesting, NUL bytes, and oversized input are refused.
- Valid export text is normalized to CRLF with a single final line ending after the same boundary checks pass.

The existing vCard service remains the record-level contact import/export implementation. No record-level ICS import/export is connected to this Settings panel.

## Configuration

Open **Settings → Contacts and calendar provider foundation**, choose the provider kind, enter the URL, choose an authentication-mode label when applicable, and select **Validate local foundation**. The result shows the normalized URL, capability availability, state trace, and negative provider-interaction facts. Nothing from this panel is persisted across restart.

## Failure modes

- Invalid or insecure URLs are rejected locally with specific issues.
- Credential-like URL material is refused instead of being logged, displayed in a result, or sent elsewhere.
- Invalid state-machine events throw rather than skipping a boundary.
- Unsupported interchange components and malformed envelopes fail closed.
- The renderer reports validation refusal in its live region and a non-blocking warning notification.

## Security and privacy

The foundation imports no socket, DNS, HTTP, TLS, mail transport, credential-store, persistence, or recurrence-engine dependency. It performs no lookup or connection, never receives a secret, and saves no provider profile. URL query strings are disallowed because they can carry secret-like material. Local file profiles exclude UNC locations so this local model cannot quietly become a network path.

## Verification

- `npx vitest run tests/pim/provider-foundation.test.ts`: 1 file, 10 tests passed. Coverage includes state ordering, HTTPS and credential-bearing URL rejection, local ICS path/auth rules, deterministic capability facts, vCard/iCalendar bounds, recurrence metadata, scheduling/attachment refusal, UID uniqueness, malformed folds/property names, malformed/oversized input, and a source dependency audit.
- `npm run typecheck`: passed.
- `npm run build`: passed.
- `npx playwright test tests/e2e/pim-provider-foundation.spec.ts --reporter=line`: 1 of 1 real-Electron scenario passed. It covers bilingual semantics, live-region roles, insecure-URL refusal, canonical HTTPS acceptance, unavailable capabilities, absent credential input, local ICS rules, and no horizontal overflow at 760 × 560.

These checks do not prove DNS, TLS, provider login, server discovery, ETags, sync tokens, read/write behavior, conflicts, scheduling, recurrence expansion, credential storage, file watching, broad ICS/vCard compatibility, or a public provider.

## Suggested articles

- [Contacts, mailing lists, and vCard](contacts-mailing-lists-and-vcard.md)
- [Calendars and events](calendars-and-events.md)
- [Tasks and refresh ordering](tasks-and-refresh-ordering.md)
- [PIM persistence and transaction history](persistence-and-transactions.md)
