# Appearance customization

## Status

**Global preference foundation; per-element editor incomplete.** Theme, density, accent, font family, scale, weight, and some tab styling are represented. Word-depth editing for every element is not yet verified.

## Behavior

Users can choose system/light/dark theme, three density levels, an accent color, font family, font scale, and font weight. Changes persist with other preferences and are intended to update the live interface. Tabs have additional per-tab styling values and an anchored appearance editor foundation.

The Appearance card also provides a persisted global reset for theme, density, accent, interface font, font scale, and font weight; language, humor, narrator, notification, account, folder, and dim-sum preferences are preserved. The broader completion target remains an anchored, non-modal editor available from every rendered element, with keyboard access, focus return, per-property reset, presets, and theme export/import.

## Configuration

Defaults are system theme, comfortable density, `#6750A4` accent, Segoe UI Variable, scale 1, and weight 400. Unsupported properties must remain visible with an explanation and retain any imported value.

## Failure modes

- A malformed imported theme can create unreadable or oversized UI.
- Custom colors can fail contrast requirements across states.
- A requested font may be missing or lack CJK glyphs.
- Per-element rules can collide or orphan when dynamic elements are recreated.
- The editor can style targets while failing to style its own chrome.

## Security considerations

Theme files are untrusted structured data. Validate sizes, numeric ranges, identifiers, and color values; never permit arbitrary CSS, URLs, scripts, or font downloads. Keep all fonts/assets local and preserve a CJK-safe fallback.

## Verification

Preference persistence and runtime token application are present in the renderer foundation. The required continuous color field and translation across named, HEX/HEX8, RGB/A, HSL/A, HSV, HWB, Lab/LCH, OKLab/OKLCH, and CMYK; installed-font previews; Word-depth typography; editor self-customization; import/export; resets; and every-element context menus remain open until explicitly tested.

## Suggested articles

- [Material interface and accessibility](material-interface-and-accessibility.md)
- [Tabs and discovery](tabs-and-discovery.md)
- [Language and humor controls](language-and-humor.md)
