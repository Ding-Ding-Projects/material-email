# Changelog

## Status

**UI foundation; no released versions exist.** The viewer must not invent entries to fill an empty release history.

## Behavior

The Changelog tab is intended to show every released version with exact version, release date, categorized changes, and the release's dim-sum code name only when a verified catalog asset exists. Search and date filters compose. Users can copy or export the currently filtered view.

Because Material Email has no verified release yet, the truthful state is an empty/no-release message. Development milestones belong in the handoff and roadmap, not a fictional release entry.

## Configuration

The required date control accepts locale-formatted typed dates and ISO dates, supports a calendar with month/year jumps, range selection, and named presets, and keeps invalid/partial input visible with inline feedback. Search uses its own adjacent regex builder.

## Failure modes

- A build version can be mistaken for a release.
- Search and date filters can override rather than compose.
- Export can disagree with the visible filtered range.
- Timezone conversion can move a release date by a day.
- A code name without a verified local image creates broken presentation.

## Security considerations

Release notes are factual records. Security fixes must remain specific enough to help users without exposing active exploit details or secrets. Humor changes voice only. Exported content contains no credentials or private issue data.

## Verification

The renderer contains a Changelog route and shared search/export foundations. No release-data source, complete date picker, released-version corpus, code-name asset, or shipped-version verification exists.

## Suggested articles

- [Development and packaging](../delivery/development-and-packaging.md)
- [Verification matrix](../delivery/verification.md)
- [Search and regex builder](../experience/search-and-regex-builder.md)

