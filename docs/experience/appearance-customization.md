# Appearance customization

## Status

**Global preferences plus a verified per-workspace-tab slice; every-element editor incomplete.** Theme, density, accent, font family, scale, and weight are represented. Workspace tabs now have a focused persisted editor, but Word-depth editing for every rendered element is not claimed.

## Behavior

Users can choose system/light/dark theme, three density levels, an accent color, font family, font scale, and font weight. Changes persist with other preferences and update the live interface. Each rendered workspace tab has an anchored non-modal editor for bounded HEX background/text colors, font size, font weight, and corner radius. Tab overrides persist locally across restarts; malformed IDs, duplicate layout entries, invalid colors, unknown properties, and out-of-range numbers are normalized before use.

Right-clicking a workspace tab exposes **Edit tab appearance…**. <kbd>Shift</kbd>+right-click opens the editor directly, <kbd>Shift</kbd>+<kbd>F10</kbd> opens the keyboard-operable tab menu, and <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>E</kbd> opens the editor for the focused tab. Opening moves focus into the editor; <kbd>Escape</kbd> or **Done** returns focus to that same tab. Each property can return to the inherited tab style independently, while **Reset tab** removes all overrides.

The Appearance card also provides a persisted global reset for theme, density, accent, interface font, font scale, and font weight; language, humor, narrator, notification, account, folder, and dim-sum preferences are preserved. The broader completion target remains an anchored, non-modal editor available from every rendered element, with keyboard access, focus return, per-property reset, presets, and theme export/import.

## Configuration

Global defaults are system theme, comfortable density, `#6750A4` accent, Segoe UI Variable, scale 1, and weight 400. The focused tab editor accepts local `#RRGGBB` or `#RRGGBBAA` values, font sizes from 11–22 px, weights from 300–800, and radii from 0–28 px. Its preview supplies values for inherited properties without converting those values into stored overrides. Unsupported broader properties remain an explicit open scope.

## Failure modes

- A malformed imported theme can create unreadable or oversized UI.
- Custom colors can fail contrast requirements across states.
- A requested font may be missing or lack CJK glyphs.
- Per-tab rules stored by an older or manually edited build can be malformed; startup normalization drops unsafe fields and restores missing tabs.
- Per-element rules can collide or orphan when dynamic elements are recreated; only stable workspace-tab IDs are handled by this slice.
- The editor can style targets while failing to style its own chrome.

## Security considerations

Theme files are untrusted structured data. Validate sizes, numeric ranges, identifiers, and color values; never permit arbitrary CSS, URLs, scripts, or font downloads. Keep all fonts/assets local and preserve a CJK-safe fallback.

## Verification

Focused unit coverage verifies normalization of untrusted local tab state, bounded overrides, malformed-JSON fallback, one-property reset, and preview resolution. A real Electron scenario verifies keyboard context-menu entry, direct keyboard entry, initial focus, live styling, per-property reset, restart persistence, full reset, and exact focus return. The continuous color field and translation across named, HEX/HEX8, RGB/A, HSL/A, HSV, HWB, Lab/LCH, OKLab/OKLCH, and CMYK; installed-font previews; Word-depth typography; editor self-customization; import/export; and every-element context menus remain open.

## Suggested articles

- [Material interface and accessibility](material-interface-and-accessibility.md)
- [Tabs and discovery](tabs-and-discovery.md)
- [Language and humor controls](language-and-humor.md)
