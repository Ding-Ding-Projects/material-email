# Search and regex builder

## Status

**Core matcher tests pass; surface coverage is being integrated.** JavaScript regex evaluation is local and bounded, but not isolated by a hard timeout.

## Behavior

Every search begins in literal plain-text mode. An adjacent button opens a non-modal builder anchored to that field. Regex mode supports guided inserts for literals, character classes, anchors, groups, alternation, and quantifiers; raw editing; flags; sample text; syntax feedback; live matches; capture groups; copy; and export. Each field keeps independent pattern, flags, sample, validation, and open state.

The real engine is JavaScript `RegExp`. Supported flags are `i`, `m`, `s`, and `u`; duplicate and unsupported flags are removed. Zero-width matches advance safely.

## Configuration

- Pattern maximum: 2,048 characters
- Sample/input maximum: 50,000 characters per evaluation
- Match maximum: 200
- Plain text is escaped before compilation
- A heuristic rejects nested quantified groups and repeated wildcard quantifiers

## Failure modes

- JavaScript regex has no built-in timeout; patterns outside the current heuristic may still backtrack badly.
- Flag normalization silently drops unsupported flags, so the UI must show the normalized result.
- Search behavior can drift if a field copies rather than shares its own displayed model.
- Empty or invalid patterns must never trigger bulk close.
- Unicode behavior follows JavaScript, not PCRE, .NET, or another application's search dialect.

## Security considerations

Patterns and samples remain local and must not be persisted without user intent. Keep bounds and risky-pattern checks in shared logic. For stronger guarantees, evaluate regex in a worker that can be terminated by a deadline or adopt a linear-time engine with documented dialect differences.

## Verification

Four focused tests cover literal plain-text behavior, case-insensitivity, captures, zero-width progress, invalid syntax, risky nested quantifiers, and supported-flag normalization. Full tests are still needed for Unicode, multiline/dotall, 2,048/50,000/200 limits, every search surface, export, keyboard focus, and adversarial time bounds.

## Suggested articles

- [Tabs and discovery](tabs-and-discovery.md)
- [Local state and history](../data/local-state-and-history.md)
- [Changelog](../data/changelog.md)
