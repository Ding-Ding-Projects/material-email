# Language and humor controls

## Status

**Preference and renderer foundation.** Complete string separation and every-message audit remain open.

## Behavior

Users can select English, playful Hong Kong-style Cantonese, or a compact bilingual mode. English and Cantonese each have an independent humor level from 1 (fully serious) through 5 (most playful). The active level selects tone variants while addresses, dates, counts, server names, errors, destructive effects, and other facts remain unchanged.

The defaults are English, English humor level 2, and Cantonese humor level 3. Preferences persist in the local application state. Bilingual mode presents both languages in the same surface and marks each segment semantically: English copy uses `lang="en"` and Cantonese copy uses `lang="zh-HK"`, so assistive technology does not have to infer a mid-label language change.

## Configuration

Language and humor controls live in Settings and apply at runtime. The HTML language metadata follows the primary language. Locale-sensitive dates use English (Canada) or Hong Kong Chinese formatting according to the selected mode.

## Failure modes

- Inline translation tables can drift or leave English-only strings.
- Bilingual copy can overflow controls or overwhelm screen-reader output.
- Humor can obscure a warning if facts are not kept in a separate invariant.
- A missing variant needs a predictable serious fallback.
- Dynamic server/error text must be preserved verbatim while surrounding copy changes tone.

## Security considerations

Humor never changes consent, destructive impact, credential guidance, financial facts, security facts, or recovery actions. Never joke about a user's data loss, money, disability, or private message content. Locale changes must not alter parsing of ports, identifiers, hashes, or protocol values.

## Verification

The preference types, defaults, persistence, renderer selection function, locale switch, and semantic bilingual spans exist. Electron coverage verifies representative mail, Settings, PIM, and error copy with `en`/`zh-HK` segments at 760 × 560 without document-width overflow. A full inventory proving every rendered message has English, Cantonese, and bilingual behavior at all five independent levels has not been completed; native screen-reader and the full display-scale matrix remain open.

## Suggested articles

- [Material interface and accessibility](material-interface-and-accessibility.md)
- [Notifications](notifications.md)
- [Appearance customization](appearance-customization.md)
