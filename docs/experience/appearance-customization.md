# Appearance customization

## Status

**Global preferences plus a verified per-workspace-tab color-depth slice; every-element editor incomplete.** Theme, density, accent, font family, scale, and weight are represented. Workspace tabs now have a focused persisted editor with three synchronized color representations and contrast feedback, but Word-depth editing for every rendered element is not claimed.

## Behavior

Users can choose system/light/dark theme, three density levels, an accent color, font family, font scale, and font weight. Changes persist with other preferences and update the live interface. Each rendered workspace tab has an anchored non-modal editor for accent, background, and text colors plus font size, font weight, and corner radius. Every color exposes a native continuous field and synchronized numeric HEX/HEX8, RGB, and HSL entries. Valid changes update both the editor preview and targeted tab immediately, then persist locally across restarts. Malformed IDs, duplicate layout entries, invalid colors, unknown properties, and out-of-range numbers are normalized before use.

The editor reports text/background contrast against the WCAG AA normal-text target of 4.5:1 and accent/background contrast against the 3:1 non-text target. Pass and check states are descriptive feedback, not an automatic color substitution. A HEX8 alpha value is preserved when RGB or HSL channels change; because the surrounding surface varies by theme, alpha contrast is explicitly identified as an estimate composited over white.

Right-clicking a workspace tab exposes **Edit tab appearance…**. <kbd>Shift</kbd>+right-click opens the editor directly, <kbd>Shift</kbd>+<kbd>F10</kbd> opens the keyboard-operable tab menu, and <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>E</kbd> opens the editor for the focused tab. Opening moves focus into the editor; <kbd>Escape</kbd> or **Done** returns focus to that same tab. Each property can return to the inherited tab style independently, while **Reset tab** removes all overrides.

The Appearance card also provides a persisted global reset for theme, density, accent, interface font, font scale, and font weight; language, humor, narrator, notification, account, folder, and dim-sum preferences are preserved. The broader completion target remains an anchored, non-modal editor available from every rendered element, with keyboard access, focus return, per-property reset, presets, and theme export/import.

## Configuration

Global defaults are system theme, comfortable density, `#6750A4` accent, Segoe UI Variable, scale 1, and weight 400. The focused tab editor accepts local `#RRGGBB` or `#RRGGBBAA`, RGB channels from 0–255, hue from 0–360 degrees, and saturation/lightness from 0–100%. It also bounds font sizes to 11–22 px, weights to 300–800, and radii to 0–28 px. Its preview supplies values for inherited properties—including the live global accent—without converting those values into stored tab overrides. Unsupported broader properties remain an explicit open scope.

## Failure modes

- A malformed imported theme can create unreadable or oversized UI.
- Custom colors can fail contrast requirements across states; the live metrics identify the current ratios but do not block or silently rewrite the user's choice.
- A requested font may be missing or lack CJK glyphs.
- Per-tab rules stored by an older or manually edited build can be malformed; startup normalization drops unsafe fields and restores missing tabs.
- Per-element rules can collide or orphan when dynamic elements are recreated; only stable workspace-tab IDs are handled by this slice.
- The editor can style targets while failing to style its own chrome.

## Security considerations

Theme files are untrusted structured data. Validate sizes, numeric ranges, identifiers, and color values; never permit arbitrary CSS, URLs, scripts, or font downloads. Keep all fonts/assets local and preserve a CJK-safe fallback.

## Verification

Six focused unit cases verify normalization of untrusted local tab state, bounded accent/background/text overrides, malformed-JSON fallback, one-property reset, preview resolution, HEX/RGB/HSL conversion, alpha preservation, invalid-channel rejection, and contrast math. One real Electron scenario verifies keyboard context-menu entry, direct keyboard entry, initial focus, RGB background editing, HEX foreground editing, HSL accent editing, live target/preview styling, contrast status, per-property reset, restart persistence, full reset, and exact focus return.

Numeric alpha entry outside HEX8; named colors; RGB/A and HSL/A controls; HSV/HSB, HWB, Lab/LCH, OKLab/OKLCH, and CMYK translation; gamut/clipping warnings; installed-font previews; Word-depth typography; editor self-customization; import/export; and every-element context menus remain open.

## Suggested articles

- [Material interface and accessibility](material-interface-and-accessibility.md)
- [Tabs and discovery](tabs-and-discovery.md)
- [Language and humor controls](language-and-humor.md)
