# Tabs and discovery

## Status

**Implementation foundation with focused tab-strip, discovery-search, and reviewed bulk-close proof; complete interaction verification open.** Workspace tabs, pinning, ordering, groups, search, bulk-close previews, and per-tab styles appear in renderer code. Real-Electron regressions cover the primary tab strip's roving focus and tab/tabpanel relationships, all four discovery searches, and the bulk-close review's restart, safety, semantics, confirmation, and focus-return path.

## Behavior

Material Email separates Mail, Settings, Changelog, History, Notifications, and Tools into browser-style tabs. A pinned region stays ahead of ordinary tabs. Tab order, closed tabs, pinned tabs, group order, collapsed state, and per-tab appearance are persisted locally. <kbd>Left</kbd>/<kbd>Right</kbd> and <kbd>Home</kbd>/<kbd>End</kbd> automatically activate a tab while keeping keyboard focus in the tab strip; one selected tab remains in the sequential focus order. Pointer and command activation retain their existing move-into-panel behavior.

The required search scopes are distinct: current strip, individual group, group names, and all application tabs. Each field restores its own bounded plain/regex mode, pattern, and normalized `i/m/s/u` flags from renderer-local storage; samples and builder-open state reset at restart. Valid no-result queries expose scope-specific named status regions, independently humor-levelled English/Cantonese guidance, and an action returning focus to the originating field. Invalid regex stays a validation error. Closing a builder with its close action or <kbd>Escape</kbd> keeps the Tab Manager open and returns focus to that field. Search results identify the tab, group, and pinned state.

Bulk close supports matching and inverse predicates over visible localized tab labels. Its bounded mode, pattern, normalized flags, direction, and explicit pinned-tab choice persist together, while sample text and builder-open state remain ephemeral. Whitespace-only, invalid, and rejected risky patterns produce no candidates and cannot open confirmation. A named polite preview reports the matcher mode, direction, exact affected count/list, and whether matching pinned tabs are protected or explicitly included. Pinned tabs are excluded on a fresh default and enter the exact confirmation snapshot only after the saved switch is enabled. Cancel and successful close both return focus to the originating bulk search. The existing blocking confirmation and persisted closed-tab state remain the mutation boundary.

Each workspace tab also has a validated, restart-persistent appearance override with pointer, context-menu, and direct keyboard access plus per-property and whole-tab reset. Accent, background, and text colors expose synchronized HEX/HEX8, RGB, and HSL values, a continuous native color field, live target-tab preview, and text/accent contrast readouts.

## Configuration

Groups are Workspace, Records, and System in the current fixed feature set. Each search owns its own plain/regex model. The four discovery models use `material-email.tab-discovery-searches.v1`; only bounded mode, pattern, and normalized flags are serialized. Bulk review uses `material-email.bulk-tab-close-review.v1` for those same matcher fields plus the inverse and explicit pinned-inclusion booleans. Pinned inclusion is false on a fresh default; when deliberately changed, its restored state is disclosed beside the switch and in every preview. Per-tab accent, background, foreground, size, weight, and radius overrides persist; absent properties inherit the tab strip. <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>E</kbd> edits the focused tab, and closing returns focus to it.

## Failure modes

- Closing the active tab requires a deterministic accessible successor.
- Drag reorder can disagree with keyboard order or persisted order.
- Revealing a result in a collapsed group must not erase the saved collapsed preference.
- A restored include-pinned choice becomes unsafe if its current state is not conspicuous in both the option and preview.
- Fixed groups are not yet evidence of complete create/rename/color/remove group management.
- Unsaved compose work needs an independent close guard.

## Security considerations

Tab search matches visible labels only, not hidden page content. Bulk actions show mode, direction, pinned policy, exact affected count, and names before mutation. Empty, whitespace-only, invalid, and rejected risky patterns cannot reach confirmation. Pinned tabs remain protected unless the user restores or makes an explicit, visibly disclosed choice; the final modal snapshots the exact candidate and pinned sets. Unsaved-work protection remains an independent close concern.

## Verification

Source inspection confirms semantic tab roles, pinned rendering, persisted tab state, independent search keys, and preview-oriented bulk-close state. Six focused unit cases and one real-Electron workflow cover color conversion/contrast, validation, appearance persistence/reset, synchronized RGB/HSL/HEX editing, live target styling, context-menu keyboard entry, and exact editor focus return. A focused real-Electron test additionally verifies <kbd>Right</kbd>, <kbd>Home</kbd>, and <kbd>End</kbd> focus retention, a single roving `tabindex="0"`, reciprocal tab/tabpanel IDs, and a computed solid 3 px inset focus indicator. The discovery-search slice passes 2 renderer files / 18 tests plus 1 / 1 real-Electron scenario for four independent restored models, normalized flags, sample reset, invalid-regex separation, inverse bilingual humor levels, named no-match status, edit action, unclipped nested-builder controls, and close-button/<kbd>Escape</kbd> focus return. This is not native screen-reader, high-contrast, narrow-width, or display-scale certification; those matrices, drag/keyboard reorder equivalence, dynamic group management, and unsaved-work protection outside this editor remain open.

The focused bulk-close slice passes 1 renderer file / 6 tests plus 1 / 1 real-Electron restart scenario. It covers corrupt/default and bounded persistence, strict option parsing, whitespace/invalid/risky blocking, matching/inverse predicate parity, default pinned exclusion, explicit pinned inclusion, bilingual named preview semantics, exact confirmation disclosure, sample reset, and focus return after builder close, confirmation cancellation, and successful close. The Electron scenario uses an isolated profile and verifies that the resulting closed-tab state still enters the existing recently-closed path.

## Suggested articles

- [Search and regex builder](search-and-regex-builder.md)
- [Appearance customization](appearance-customization.md)
- [Material interface and accessibility](material-interface-and-accessibility.md)
