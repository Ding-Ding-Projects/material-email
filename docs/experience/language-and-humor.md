# Language and humor controls

## Status

**Preference foundation plus a focused five-level renderer matrix.** The appearance editor, both advanced date pickers, notification centre, renderer toasts, and notification severity labels now use the active language and independent per-language humor levels. Complete string separation and an every-message audit remain open.

## Behavior

Users can select English, playful Hong Kong-style Cantonese, or a compact bilingual mode. English and Cantonese each have an independent humor level from 1 (fully serious) through 5 (most playful). The active level selects tone variants while addresses, dates, counts, server names, errors, destructive effects, and other facts remain unchanged.

The defaults are English, English humor level 2, and Cantonese humor level 3. Preferences persist in the local application state. Bilingual mode presents both languages in the same surface and marks each segment semantically: English copy uses `lang="en"` and Cantonese copy uses `lang="zh-HK"`, so assistive technology does not have to infer a mid-label language change.

## Configuration

Language and humor controls live in Settings and apply at runtime. The HTML language metadata follows the primary language. Locale-sensitive dates use English (Canada) or Hong Kong Chinese formatting according to the selected mode.

The focused appearance, History date-picker, Changelog date-picker, and notification copy each provide five factual variants per language. Renderer toasts preserve their original event facts and add only level-selected surrounding voice. Missing or blank variants fall back to the nearest lower available level, then the next available level, and finally the other language rather than leaving an empty control.

## Failure modes

- Inline translation tables can drift or leave English-only strings.
- Bilingual copy can overflow controls or overwhelm screen-reader output.
- Humor can obscure a warning if facts are not kept in a separate invariant.
- A missing variant needs a predictable serious fallback.
- Dynamic server/error text must be preserved verbatim while surrounding copy changes tone.

## Security considerations

Humor never changes consent, destructive impact, credential guidance, financial facts, security facts, or recovery actions. Never joke about a user's data loss, money, disability, or private message content. Locale changes must not alter parsing of ports, identifiers, hashes, or protocol values.

## Verification

The preference types, defaults, persistence, renderer selection function, locale switch, and semantic bilingual spans exist. Focused renderer tests cover active-language isolation, inverse bilingual levels, all target-surface tone tables, blank/missing fallback, factual toast preservation, and localized notification severity. A real-Electron matrix verifies English, Cantonese, and bilingual rendering across appearance, History, Changelog, and Notifications; it also flips bilingual levels from English 1/Cantonese 5 to English 5/Cantonese 1 and checks a live toast. Existing Electron coverage verifies representative mail, Settings, PIM, and error copy with `en`/`zh-HK` segments at 760 × 560 without document-width overflow. A full inventory proving every other rendered message has all five independent levels has not been completed; native screen-reader and the full display-scale matrix remain open.

## Suggested articles

- [Material interface and accessibility](material-interface-and-accessibility.md)
- [Notifications](notifications.md)
- [Appearance customization](appearance-customization.md)
