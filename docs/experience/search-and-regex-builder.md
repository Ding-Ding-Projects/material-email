# Search and regex builder

## Status

**Core matcher, command-palette, and cached-mail adversarial integration tests pass; the complete every-surface matrix remains open.** JavaScript regex evaluation is local and bounded, but not isolated by a hard timeout.

## Behavior

Every search begins in literal plain-text mode. An adjacent button opens a non-modal builder anchored to that field. Regex mode supports guided inserts for literals, character classes, anchors, groups, alternation, and quantifiers; raw editing; flags; sample text; syntax feedback; live matches; capture groups; copy; and export. Each field keeps independent pattern, flags, sample, validation, and open state.

Settings, semantic and whole-workspace History, Notifications, the four Tab Manager discovery scopes, Tab Manager bulk close, and the command palette all use this shared field-bound renderer path. The command palette resets to an empty plain-text model whenever it opens, searches the visible English and Cantonese command labels, and executes <kbd>Enter</kbd> only from its search input when the current model yields a result. Invalid or risky regex patterns yield no executable command. <kbd>Escape</kbd> closes the palette's builder before it closes the palette itself.

The real engine is JavaScript `RegExp`. Supported flags are `i`, `m`, `s`, and `u`; duplicate and unsupported flags are removed. Zero-width sample matches advance by one Unicode code point when `u` is active, so an astral surrogate pair cannot make the preview repeat the same index forever.

The mail field sends valid plain/regex queries through the desktop bridge to an ephemeral [bounded cached-mail index](../mail/cached-mail-search-index.md). It searches capped summary/body-snippet fields across cached accounts and returns account/folder/conversation attribution. Other search surfaces retain their documented local collection behavior.

## Configuration

- Pattern maximum: 2,048 characters
- Sample/input maximum: 50,000 characters per evaluation
- Match maximum: 200
- Plain text is escaped before compilation
- A conservative heuristic rejects nested quantified groups, repeated wildcard quantifiers, adjacent unbounded repetitions of the same atom, and simple repeated alternatives where one branch overlaps a prefix of another

## Failure modes

- JavaScript regex has no built-in timeout; patterns outside the documented nested/adjacent/prefix-overlap heuristic may still backtrack badly.
- Flag normalization silently drops unsupported flags, so the UI must show the normalized result.
- Search behavior can drift if a field copies rather than shares its own displayed model. The command palette no longer keeps a separate lowercase-only query string.
- Empty or invalid patterns must never trigger bulk close.
- Unicode behavior follows JavaScript, not PCRE, .NET, or another application's search dialect.

## Security considerations

Patterns and samples remain local and must not be persisted without user intent. Keep bounds and risky-pattern checks in shared logic. For stronger guarantees, evaluate regex in a worker that can be terminated by a deadline or adopt a linear-time engine with documented dialect differences.

## Verification

The focused shared-regex and cached-index slice passes 2 files / 9 tests. It covers literal plain text, captures, Unicode-aware zero-width progress, `m/u` semantics, invalid syntax, nested quantifiers, prefix-overlapping alternatives, adjacent same-atom/wildcard repetition, safe command-style alternation, and the 50,000-character/200-match plus 2,000-document/200-result ceilings. A dedicated real-Electron Unified Inbox scenario proves the literal default, rejected-pattern disclosure and disabled execution, astral zero-width preview, multiline cached result, and actionable zero-width no-match state. Existing command-palette coverage still passes separately. Full tests remain open for dotall, every other search workflow, copy/export, broader keyboard focus, and hard wall-time isolation beyond the rejected adversarial families.

## Suggested articles

- [Tabs and discovery](tabs-and-discovery.md)
- [Local state and history](../data/local-state-and-history.md)
- [Changelog](../data/changelog.md)
