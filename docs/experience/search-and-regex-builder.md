# Search and regex builder

## Status

**Core matcher and command-palette integration tests pass; the complete every-surface matrix remains open.** JavaScript regex evaluation is local and bounded, but not isolated by a hard timeout.

## Behavior

Every search begins in literal plain-text mode. An adjacent button opens a non-modal builder anchored to that field. Regex mode supports guided inserts for literals, character classes, anchors, groups, alternation, and quantifiers; raw editing; flags; sample text; syntax feedback; live matches; capture groups; copy; and export. Each field keeps independent pattern, flags, sample, validation, and open state.

Settings, semantic and whole-workspace History, Notifications, the four Tab Manager discovery scopes, Tab Manager bulk close, and the command palette all use this shared field-bound renderer path. The command palette resets to an empty plain-text model whenever it opens, searches the visible English and Cantonese command labels, and executes <kbd>Enter</kbd> only from its search input when the current model yields a result. Invalid or risky regex patterns yield no executable command. <kbd>Escape</kbd> closes the palette's builder before it closes the palette itself.

The real engine is JavaScript `RegExp`. Supported flags are `i`, `m`, `s`, and `u`; duplicate and unsupported flags are removed. Zero-width matches advance safely.

The mail field sends valid plain/regex queries through the desktop bridge to an ephemeral [bounded cached-mail index](../mail/cached-mail-search-index.md). It searches capped summary/body-snippet fields across cached accounts and returns account/folder/conversation attribution. Other search surfaces retain their documented local collection behavior.

## Configuration

- Pattern maximum: 2,048 characters
- Sample/input maximum: 50,000 characters per evaluation
- Match maximum: 200
- Plain text is escaped before compilation
- A heuristic rejects nested quantified groups and repeated wildcard quantifiers

## Failure modes

- JavaScript regex has no built-in timeout; patterns outside the current heuristic may still backtrack badly.
- Flag normalization silently drops unsupported flags, so the UI must show the normalized result.
- Search behavior can drift if a field copies rather than shares its own displayed model. The command palette no longer keeps a separate lowercase-only query string.
- Empty or invalid patterns must never trigger bulk close.
- Unicode behavior follows JavaScript, not PCRE, .NET, or another application's search dialect.

## Security considerations

Patterns and samples remain local and must not be persisted without user intent. Keep bounds and risky-pattern checks in shared logic. For stronger guarantees, evaluate regex in a worker that can be terminated by a deadline or adopt a linear-time engine with documented dialect differences.

## Verification

Eight focused matcher and command-filter assertions cover literal plain-text behavior, case-insensitivity, bilingual command labels, captures, zero-width progress, invalid syntax, risky nested quantifiers, empty defaults, and supported-flag normalization. One real-Electron scenario covers command-palette focus, literal default behavior, physical builder anchoring, invalid-state exposure, disabled invalid execution, nested <kbd>Escape</kbd>, validated regex filtering, and <kbd>Enter</kbd> activation. Full tests are still needed for Unicode, multiline/dotall, 2,048/50,000/200 limits, every remaining search workflow, copy/export, broader keyboard focus, and adversarial time bounds.

## Suggested articles

- [Tabs and discovery](tabs-and-discovery.md)
- [Local state and history](../data/local-state-and-history.md)
- [Changelog](../data/changelog.md)
