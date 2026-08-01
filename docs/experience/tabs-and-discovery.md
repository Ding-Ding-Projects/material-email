# Tabs and discovery

## Status

**Implementation foundation; complete interaction verification open.** Workspace tabs, pinning, ordering, groups, search, bulk-close previews, and per-tab styles appear in renderer code.

## Behavior

Material Email separates Mail, Settings, Changelog, History, Notifications, and Tools into browser-style tabs. A pinned region stays ahead of ordinary tabs. Tab order, closed tabs, pinned tabs, group order, collapsed state, and per-tab appearance are persisted locally. Tabs support pointer reordering and keyboard activation.

The required search scopes are distinct: current strip, individual group, group names, and all application tabs. Search results identify the tab, group, and pinned state. Bulk close supports both containing and not-containing predicates, uses visible tab labels, previews affected tabs, excludes pinned tabs by default, and refuses empty or invalid queries.

## Configuration

Groups are Workspace, Records, and System in the current fixed feature set. Each search owns its own plain/regex model. Pinned inclusion for bulk close is an explicit opt-in. Per-tab background, foreground, size, weight, and radius values can be persisted.

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

Source inspection confirms semantic tab roles, pinned rendering, persisted tab state, independent search keys, and preview-oriented bulk-close state. Narrow-width overflow, drag/keyboard reorder equivalence, all four searches, group management, unsaved-work protection, focus restoration, and 200% scaling need built-app testing.

## Suggested articles

- [Search and regex builder](search-and-regex-builder.md)
- [Appearance customization](appearance-customization.md)
- [Material interface and accessibility](material-interface-and-accessibility.md)

