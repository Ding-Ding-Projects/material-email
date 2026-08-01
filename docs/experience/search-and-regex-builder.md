# Search and regex builder

## Status

**Core matcher, command-palette, cached-mail adversarial integration, global Settings, four Tab Manager discovery searches, and reviewed bulk close have focused restart/focus tests; the complete every-surface and nested-settings matrix remains open.** JavaScript regex evaluation is local and bounded, but not isolated by a hard timeout.

## Behavior

Every search begins in literal plain-text mode. An adjacent button opens a non-modal builder anchored to that field. Regex mode supports guided inserts for literals, character classes, anchors, groups, alternation, and quantifiers; raw editing; flags; sample text; syntax feedback; live matches; capture groups; copy; and export. Each field keeps independent pattern, flags, sample, validation, and open state.

Settings, semantic and whole-workspace History, Notifications, the four Tab Manager discovery scopes, Tab Manager bulk close, and the command palette all use this shared field-bound renderer path. Global Settings, each Tab Manager discovery field, and bulk close intentionally restore their bounded mode, pattern, and normalized flags from renderer-local storage; samples and builder-open state reset at restart. Bulk close additionally restores its direction and explicit pinned-inclusion choice, discloses both beside the controls and in its semantic preview, and treats whitespace-only input as empty before destructive review. A valid Settings or tab-discovery query with no result produces a named polite status, independently humor-levelled English/Cantonese guidance, and a keyboard-reachable action that returns focus to its field. Invalid regex remains a validation error instead of being mislabeled as an empty result. Inside the Tab Manager, the nested builder is constrained to its owning search width so its controls are not clipped, and both its close action and <kbd>Escape</kbd> return focus without dismissing the manager.

The command palette resets to an empty plain-text model whenever it opens, searches the visible English and Cantonese command labels, and executes <kbd>Enter</kbd> only from its search input when the current model yields a result. Invalid or risky regex patterns yield no executable command. <kbd>Escape</kbd> closes the palette's builder before it closes the palette itself.

The real engine is JavaScript `RegExp`. Supported flags are `i`, `m`, `s`, and `u`; duplicate and unsupported flags are removed. Zero-width sample matches advance by one Unicode code point when `u` is active, so an astral surrogate pair cannot make the preview repeat the same index forever.

The mail field sends valid plain/regex queries through the desktop bridge to an ephemeral [bounded cached-mail index](../mail/cached-mail-search-index.md). It searches capped summary/body-snippet fields across cached accounts and returns account/folder/conversation attribution. Other search surfaces retain their documented local collection behavior.

## Configuration

- Pattern maximum: 2,048 characters
- Sample/input maximum: 50,000 characters per evaluation
- Match maximum: 200
- Global Settings search storage: `material-email.settings-search.v1`, containing only bounded `mode`, `pattern`, and normalized `flags`
- Tab Manager discovery storage: `material-email.tab-discovery-searches.v1`, containing the same bounded fields independently for current-strip, per-group, group-name, and master search
- Bulk-close review storage: `material-email.bulk-tab-close-review.v1`, containing bounded mode/pattern/flags plus strict inverse and include-pinned booleans; sample/open state is omitted
- Plain text is escaped before compilation
- A conservative heuristic rejects nested quantified groups, repeated wildcard quantifiers, adjacent unbounded repetitions of the same atom, and simple repeated alternatives where one branch overlaps a prefix of another

## Failure modes

- JavaScript regex has no built-in timeout; patterns outside the documented nested/adjacent/prefix-overlap heuristic may still backtrack badly.
- Flag normalization silently drops unsupported flags, so the UI must show the normalized result.
- Search behavior can drift if a field copies rather than shares its own displayed model. The command palette no longer keeps a separate lowercase-only query string.
- The global Settings field is covered, but account setup and other nested settings/adjustment surfaces still need their own complete adjacent-search audit and focused proof.
- Empty or invalid patterns must never trigger bulk close.
- Unicode behavior follows JavaScript, not PCRE, .NET, or another application's search dialect.

## Security considerations

Patterns and samples remain local. Global Settings, the four Tab Manager discovery fields, and bulk close treat use as intent to restore their bounded mode, pattern, and flags on this computer and disclose that behavior in the attached builder; samples are never serialized. Bulk close also persists and visibly restates direction and pinned inclusion, but it never derives candidates from an empty, whitespace-only, invalid, or rejected risky pattern. Other search surfaces keep their documented persistence boundaries. Keep bounds and risky-pattern checks in shared logic. For stronger guarantees, evaluate regex in a worker that can be terminated by a deadline or adopt a linear-time engine with documented dialect differences.

## Verification

The focused Settings parser/localization slice passes 2 files / 18 tests. It covers absent/corrupt storage, bounded patterns, strict field types, normalized JavaScript flags, omission of sample/open state, all five independently selected English/Cantonese no-match tones, and bilingual composition. A dedicated 1 / 1 real-Electron Settings scenario proves regex mode/pattern/`m`/`u` restoration, `i` removal, sample reset, semantic no-match naming, inverse bilingual humor levels, and focus return.

The focused Tab Manager discovery parser/localization slice also passes 2 files / 18 tests. It covers the exact four-key allowlist, independent mode/pattern/flag round trips, corrupt/missing field defaults, pattern bounds, unsupported-flag removal, and omission of samples, open state, and unrelated searches. A dedicated 1 / 1 real-Electron restart scenario proves all four restored queries, independent plain/regex modes, normalized flags, sample reset, invalid-regex/no-match separation, scope-specific named statuses, inverse bilingual humor levels, edit recovery, nested-builder pointer reachability, and close-button/<kbd>Escape</kbd> focus return.

The focused bulk-close parser/evaluator slice passes 1 file / 6 tests. A dedicated 1 / 1 real-Electron restart scenario proves bounded regex state, inverse and pinned-choice restoration, sample reset, whitespace and invalid-pattern blocking, localized named preview semantics, explicit pinned exclusion/inclusion, exact confirmation text, and focus return after cancellation and successful mutation.

The focused shared-regex and cached-index slice separately passes 2 files / 9 tests. It covers literal plain text, captures, Unicode-aware zero-width progress, `m/u` semantics, invalid syntax, nested quantifiers, prefix-overlapping alternatives, adjacent same-atom/wildcard repetition, safe command-style alternation, and the 50,000-character/200-match plus 2,000-document/200-result ceilings. A dedicated real-Electron Unified Inbox scenario proves the literal default, rejected-pattern disclosure and disabled execution, astral zero-width preview, multiline cached result, and actionable zero-width no-match state. Existing command-palette coverage still passes separately. Full tests remain open for nested settings surfaces, dotall, remaining non-discovery search workflows, copy/export, broader keyboard focus, and hard wall-time isolation beyond the rejected adversarial families.

## Suggested articles

- [Tabs and discovery](tabs-and-discovery.md)
- [Local state and history](../data/local-state-and-history.md)
- [Changelog](../data/changelog.md)
