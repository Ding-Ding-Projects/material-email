# Changelog

## Status

The release audit on 2026-08-01 found **eleven published versions** from `v0.8.1` through installer-only `v0.45.1`. The viewer now lists every audited published version; the two installer-only releases intentionally carry no borrowed code name or photo.

## Behavior

The Changelog tab is intended to show every released version with exact version, release date, categorized changes, and the release's dim-sum code name only when a verified catalog asset exists. Search and date filters compose. Users can copy or export the currently filtered view.

The current viewer composes its bounded plain-text or regex search with release-date bounds. A non-modal calendar popover stays anchored to the date controls and supports two-click range selection, previous/next month navigation, direct month and year jumps, and named ranges for the last 30 days, current month, current year, or all releases. The day grid uses one roving keyboard stop with Arrow, Home/End, Page Up/Down, and Ctrl+Page Up/Down navigation; Escape and Done return focus to the trigger. It preserves the raw date fields for the current app session, reports incomplete, impossible, and reversed ranges inline, and uses one shared filtered Markdown selection for the visible list, copy, and export. A release without a catalog decoration shows neither a borrowed code name nor a fallback photo.

When forced colors are active, navigation controls use system-color borders, native month/year controls receive a visible keyboard-only wrapper ring, range membership gains a `Highlight` outline, and selected endpoints use paired `Highlight`/`HighlightText` colors with a contrasting focus ring.

## Configuration

The date fields accept ISO `YYYY-MM-DD` and Windows-locale-ordered numeric dates, keep invalid or partial input visible, and persist only in session storage. Calendar and preset choices write the same date fields, so typing and picking never become competing filters. Search keeps its own adjacent regex builder and independent state.

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

Focused unit tests cover ISO and locale parsing, distinct partial/format/calendar errors, reversed ranges, session-compatible raw-input persistence, deterministic presets, month-grid navigation, composed search/date filtering, filtered Markdown serialization, and the catalog-exhausted release contract. A real-Electron scenario covers the anchored non-modal dialog, roving keyboard focus, direct year jump, previous/next month navigation, a cross-month range, focus return, and simultaneous text/date filtering. A focused responsive scenario additionally proves that the picker stays fixed, collision-clamped, horizontally contained, and focus-stable at 760 × 560, 608 × 448, and 380 × 280 effective CSS viewports; the smaller sizes do not certify native Windows display scaling. The focused forced-colors Electron workflow covers both Changelog and History date pickers under Chromium emulation, including the selected endpoint's contrasting focus ring. The renderer consumes the same filtering helpers for the visible list, clipboard copy, and export. Site verification exercises both decorated and installer-only published metadata. Generated release data plus native Windows High Contrast, screen-reader, and display-scale certification remain open.

## Suggested articles

- [Development and packaging](../delivery/development-and-packaging.md)
- [Verification matrix](../delivery/verification.md)
- [Search and regex builder](../experience/search-and-regex-builder.md)
