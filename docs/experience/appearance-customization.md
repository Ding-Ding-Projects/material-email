# Appearance customization

## Status

**Global preferences plus a verified per-workspace-tab customization and transfer slice; every-element editor incomplete.** Theme, density, accent, font family, scale, and weight are represented. Workspace tabs have a focused persisted editor with synchronized color representations, contrast feedback, local named presets, and reviewed theme transfer, but Word-depth editing for every rendered element is not claimed.

## Behavior

Users can choose system/light/dark theme, three density levels, an accent color, font family, font scale, and font weight. Changes persist with other preferences and update the live interface. Each rendered workspace tab has an anchored non-modal editor for accent, background, and text colors plus font size, font weight, and corner radius. Every color exposes a native continuous field and synchronized numeric HEX/HEX8, RGB, and HSL entries. Valid changes update both the editor preview and targeted tab immediately, then persist locally across restarts. Dynamic tab and preview values are applied through validated CSSOM properties rather than blocked inline markup under the renderer's `style-src 'self'` policy. Malformed IDs, duplicate layout entries, invalid colors, unknown properties, and out-of-range numbers are normalized before use.

The editor reports text/background contrast against the WCAG AA normal-text target of 4.5:1 and accent/background contrast against the 3:1 non-text target. Pass and check states are descriptive feedback, not an automatic color substitution. A HEX8 alpha value is preserved when RGB or HSL channels change; because the surrounding surface varies by theme, alpha contrast is explicitly identified as an estimate composited over white.

Right-clicking a workspace tab exposes **Edit tab appearance…**. <kbd>Shift</kbd>+right-click opens the editor directly, <kbd>Shift</kbd>+<kbd>F10</kbd> opens the keyboard-operable tab menu, and <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>E</kbd> opens the editor for the focused tab. Opening moves focus into the editor; <kbd>Escape</kbd> or **Done** returns focus to that same tab. Each property can return to the inherited tab style independently, while **Reset tab** removes all overrides. The context menu and editor recompute their anchored position after viewport or scroll changes, while CSS viewport clamps keep their scrollable bounds usable even when a synthetic Electron viewport change does not emit a native resize event.

The editor's supporting copy follows English, Hong Kong Cantonese, or semantic bilingual mode and selects English and Cantonese tone independently at levels 1–5. Every variant still states that preview is immediate and scoped to the current tab; humor changes only the surrounding voice.

Three bilingual built-in presets—Material Violet, Quiet Slate, and High Contrast—apply a complete bounded style to only the current tab. Users can name and save the current resolved tab style as one of at most 24 local presets. Saved names and validated values persist in a dedicated local-storage document, survive restart, can be deleted individually, and can be reset together without changing tabs that already use those values. Applying a preset remains ordinary per-tab style persistence, so all existing property and whole-tab resets still work.

The preset section uses system-color boundaries when forced colors are active. Buttons receive explicit keyboard focus rings; because Chromium can replace a native select's own author outline, the preset field wrapper exposes the visible keyboard-only 3 px ring while leaving the native control's forced-color adjustment intact.

**Export theme** writes a version-1 JSON document containing only recognized workspace-tab style overrides and saved preset names/values. **Import theme…** uses a native desktop file chooser, validates the document in the main process, reports the selected basename and counts in a blocking review, then replaces only tab appearance overrides and the saved-preset library. Tab layout, global preferences, accounts, messages, credentials, and filesystem paths are outside the format and remain unchanged. Canceling either dialog changes nothing.

The Appearance card also provides a persisted global reset for theme, density, accent, interface font, font scale, and font weight; language, humor, narrator, notification, account, folder, and dim-sum preferences are preserved. The broader completion target remains an anchored, non-modal editor available from every rendered element with Word-depth typography, complete color translation, picker self-customization, keyboard access, and focus return.

## Configuration

Global defaults are system theme, comfortable density, `#6750A4` accent, Segoe UI Variable, scale 1, and weight 400. The focused tab editor accepts local `#RRGGBB` or `#RRGGBBAA`, RGB channels from 0–255, hue from 0–360 degrees, and saturation/lightness from 0–100%. It also bounds font sizes to 11–22 px, weights to 300–800, and radii to 0–28 px. Preset names are normalized Unicode text from 1–48 characters; identifiers, duplicates, control characters, unknown properties, and invalid style values are rejected or dropped at the local-storage boundary. Theme names are limited to 80 characters, files to 256 KiB of strict UTF-8 JSON, and imported documents to the 11 recognized tab IDs and 24 presets. Its preview supplies values for inherited properties—including the live global accent—without converting those values into stored tab overrides. Unsupported broader properties remain an explicit open scope.

## Failure modes

- A malformed, oversized, non-UTF-8, linked, network/UNC, unknown-version, or unknown-field theme is rejected before renderer state changes.
- Import intentionally replaces the current tab-style map and saved-preset library after an explicit review; cancel leaves both unchanged.
- Custom colors can fail contrast requirements across states; the live metrics identify the current ratios but do not block or silently rewrite the user's choice.
- A requested font may be missing or lack CJK glyphs.
- Per-tab rules stored by an older or manually edited build can be malformed; startup normalization drops unsafe fields and restores missing tabs.
- Per-element rules can collide or orphan when dynamic elements are recreated; only stable workspace-tab IDs are handled by this slice.
- The editor can style targets while failing to style its own chrome.

## Security considerations

Theme files are untrusted structured data. The main process permits only regular local `.json` files selected through Electron dialogs, rejects symbolic-link and network/UNC paths, bounds bytes before reading, decodes UTF-8 fatally, and applies an exact allow-list schema before returning data through authenticated IPC. Export revalidates the same document, writes through a private temporary file, and returns only a basename. The format cannot represent arbitrary CSS, URLs, scripts, fonts, account/message data, credentials, or filesystem paths. Renderer code validates once more before applying an import and never logs file contents.

## Verification

Six focused unit cases verify normalization of untrusted local tab state, bounded accent/background/text overrides, malformed-JSON fallback, one-property reset, preview resolution, HEX/RGB/HSL conversion, alpha preservation, invalid-channel rejection, and contrast math. One real Electron scenario verifies keyboard context-menu entry, direct keyboard entry, initial focus, computed live RGB background/HEX foreground/HSL accent styling under the renderer CSP, contrast status, per-property reset, restart persistence, full reset, and exact focus return. A second real-Electron responsive scenario verifies editor containment, internal overflow, stable initial focus, reachable completion controls, exact focus return, and reduced-motion delay suppression at 760 × 560 plus 608 × 448, 507 × 373, and 380 × 280 effective CSS viewports. The smaller sizes are layout stress simulations, not native Windows display-scale certification.

A separate focused language/humor Electron matrix verifies the editor at English 1, Cantonese 5, bilingual English 1/Cantonese 5, and the inverse bilingual English 5/Cantonese 1 combination. Renderer model tests cover all five table entries and fallback behavior.

Four focused unit/service files pass 29 cases for existing tab behavior, preset-library normalization, strict theme allow-listing, secret-shaped extra-field rejection, byte bounds, IPC validation, native-dialog cancellation, JSON writing, and basename-only transfer results. One additional real-Electron scenario verifies bilingual built-in labels, independent English level 1/Cantonese level 5 toast tone, preset application, user-preset restart persistence, actual native-dialog export/import routing, safe exported content, reviewed replacement, style restoration, and saved-preset reset while the applied tab style remains intact.

Two renderer contract cases plus a focused real-Electron forced-colors scenario verify system-color preset borders, the wrapper focus fallback for the native select, and the Apply action's computed 3 px focus indicator. This is Chromium emulation evidence, not native Windows High Contrast or OS-wide certification.

Numeric alpha entry outside HEX8; named colors; RGB/A and HSL/A controls; HSV/HSB, HWB, Lab/LCH, OKLab/OKLCH, and CMYK translation; gamut/clipping warnings; installed-font previews; Word-depth typography; editor self-customization; every-element presets/transfer; and every-element context menus remain open.

## Suggested articles

- [Material interface and accessibility](material-interface-and-accessibility.md)
- [Tabs and discovery](tabs-and-discovery.md)
- [Language and humor controls](language-and-humor.md)
