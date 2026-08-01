# Tabs and discovery

## Status

**Implementation foundation with focused keyboard proof; complete interaction verification open.** Workspace tabs, pinning, ordering, groups, search, bulk-close previews, and per-tab styles appear in renderer code. A real-Electron regression now covers the primary tab strip's roving focus and tab/tabpanel relationships.

## Behavior

Material Email separates Mail, Settings, Changelog, History, Notifications, and Tools into browser-style tabs. A pinned region stays ahead of ordinary tabs. Tab order, closed tabs, pinned tabs, group order, collapsed state, and per-tab appearance are persisted locally. <kbd>Left</kbd>/<kbd>Right</kbd> and <kbd>Home</kbd>/<kbd>End</kbd> automatically activate a tab while keeping keyboard focus in the tab strip; one selected tab remains in the sequential focus order. Pointer and command activation retain their existing move-into-panel behavior.

The required search scopes are distinct: current strip, individual group, group names, and all application tabs. Search results identify the tab, group, and pinned state. Bulk close supports both containing and not-containing predicates, uses visible tab labels, previews affected tabs, excludes pinned tabs by default, and refuses empty or invalid queries. Each workspace tab also has a validated, restart-persistent appearance override with pointer, context-menu, and direct keyboard access plus per-property and whole-tab reset.

## Configuration

Groups are Workspace, Records, and System in the current fixed feature set. Each search owns its own plain/regex model. Pinned inclusion for bulk close is an explicit opt-in. Per-tab background, foreground, size, weight, and radius overrides persist; absent properties inherit the tab strip. <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>E</kbd> edits the focused tab, and closing returns focus to it.

## Failure modes

- Closing the active tab requires a deterministic accessible successor.
- Drag reorder can disagree with keyboard order or persisted order.
- Revealing a result in a collapsed group must not erase the saved collapsed preference.
- A bulk-close inverse predicate can drift if it is compiled separately.
- Fixed groups are not yet evidence of complete create/rename/color/remove group management.
- Unsaved compose work needs an independent close guard.

## Security considerations

Tab search matches visible labels only, not hidden page content. Bulk actions must show scope and affected count before mutation. Pinned and unsaved tabs remain protected unless the user makes an explicit reviewed choice.

## Verification

Source inspection confirms semantic tab roles, pinned rendering, persisted tab state, independent search keys, and preview-oriented bulk-close state. Focused unit and Electron tests cover validation, appearance persistence/reset, context-menu keyboard entry, and exact editor focus return. A focused real-Electron test additionally verifies <kbd>Right</kbd>, <kbd>Home</kbd>, and <kbd>End</kbd> focus retention, a single roving `tabindex="0"`, reciprocal tab/tabpanel IDs, and a computed solid 3 px inset focus indicator. This is not native screen-reader, high-contrast, narrow-width, or display-scale certification; those matrices, drag/keyboard reorder equivalence, all four searches, group management, and unsaved-work protection outside this editor remain open.

## Suggested articles

- [Search and regex builder](search-and-regex-builder.md)
- [Appearance customization](appearance-customization.md)
- [Material interface and accessibility](material-interface-and-accessibility.md)
