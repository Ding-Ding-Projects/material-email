# Changelog

## Status

**Three verified releases are bundled.** The viewer renders the factual release ledger for `v0.8.1`, `v0.10.1`, and `v0.11.1`; it does not fetch release data at runtime.

## Behavior

The Changelog tab is intended to show every released version with exact version, release date, categorized changes, and the release's dim-sum code name only when a verified catalog asset exists. Search and date filters compose. Users can copy or export the currently filtered view.

The current viewer composes its bounded plain-text or regex search with typed release-date bounds. It preserves the raw date fields for the current app session, reports incomplete, impossible, and reversed ranges inline, and uses one shared filtered Markdown selection for both copy and export. Generated release-ledger validation remains open.

## Configuration

The date fields accept ISO `YYYY-MM-DD` and locale-ordered numeric dates, keep invalid or partial input visible, and persist only in session storage. Search uses its own adjacent regex builder. The richer anchored calendar with month/year jump, range selection, and named presets is not implemented yet.

## Failure modes

- A build version can be mistaken for a release.
- Search and date filters can override rather than compose.
- Export can disagree with the visible filtered range.
- Timezone conversion can move a release date by a day.
- A code name without a verified local image creates broken presentation.

## Security considerations

Release notes are factual records. Security fixes must remain specific enough to help users without exposing active exploit details or secrets. Humor changes voice only. Exported content contains no credentials or private issue data.

## Verification

Focused unit tests cover ISO and invalid calendar parsing, reversed ranges, session-compatible raw-input persistence, composed search/date filtering, and filtered Markdown serialization. The renderer consumes those same helpers for the visible list, clipboard copy, and export. No generated release-data source, complete calendar picker, expanded released-version corpus, or shipped-version verification exists.

## Suggested articles

- [Development and packaging](../delivery/development-and-packaging.md)
- [Verification matrix](../delivery/verification.md)
- [Search and regex builder](../experience/search-and-regex-builder.md)
