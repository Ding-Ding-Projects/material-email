# Changelog

## Status

The release audit on 2026-08-01 found **eleven published versions** from `v0.8.1` through installer-only `v0.45.1`. The viewer now lists every audited published version; the two installer-only releases intentionally carry no borrowed code name or photo.

## Behavior

The Changelog tab is intended to show every released version with exact version, release date, categorized changes, and the release's dim-sum code name only when a verified catalog asset exists. Search and date filters compose. Users can copy or export the currently filtered view.

The current viewer composes its bounded plain-text or regex search with typed release-date bounds. It preserves the raw date fields for the current app session, reports incomplete, impossible, and reversed ranges inline, and uses one shared filtered Markdown selection for both copy and export. A release without a catalog decoration shows neither a borrowed code name nor a fallback photo. The audited release ledger is covered by renderer and release-contract tests.

## Configuration

The date fields accept ISO `YYYY-MM-DD` and locale-ordered numeric dates, keep invalid or partial input visible, and persist only in session storage. Search uses its own adjacent regex builder. The richer anchored calendar with month/year jump, range selection, and named presets is not implemented yet.

## Failure modes

- A build version can be mistaken for a release.
- Search and date filters can override rather than compose.
- Export can disagree with the visible filtered range.
- Timezone conversion can move a release date by a day.
- A code name without a verified local image creates broken presentation.
- Catalog exhaustion can accidentally reuse the first dish or make an installer-only release fail post-publication verification.

## Security considerations

Release notes are factual records. Security fixes must remain specific enough to help users without exposing active exploit details or secrets. Humor changes voice only. Exported content contains no credentials or private issue data.

## Verification

Focused unit tests cover ISO and invalid calendar parsing, reversed ranges, session-compatible raw-input persistence, composed search/date filtering, filtered Markdown serialization, and the catalog-exhausted release contract. The renderer consumes the filtering helpers for the visible list, clipboard copy, and export. Site verification exercises both decorated and installer-only published metadata. No generated release-data source, complete calendar picker, or expanded in-app released-version corpus exists.

## Suggested articles

- [Development and packaging](../delivery/development-and-packaging.md)
- [Verification matrix](../delivery/verification.md)
- [Search and regex builder](../experience/search-and-regex-builder.md)
