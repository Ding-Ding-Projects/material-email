export type MatchMode = "plain" | "regex";

export interface MatcherOptions {
  mode: MatchMode;
  pattern: string;
  flags: string;
}

export interface RegexValidation {
  valid: boolean;
  message: string;
  normalizedFlags: string;
}

export interface RegexSampleMatch {
  value: string;
  index: number;
  groups: string[];
}

const MAX_PATTERN_LENGTH = 2_048;
const MAX_SAMPLE_LENGTH = 50_000;
const MAX_MATCHES = 200;
const VALID_FLAGS = new Set(["i", "m", "s", "u"]);

interface PatternAtom {
  key: string;
  end: number;
}

export const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const normalizeFlags = (flags: string): string =>
  [...new Set(flags)].filter(flag => VALID_FLAGS.has(flag)).sort().join("");

const hasRiskyNestedQuantifier = (pattern: string): boolean => {
  const groupWithQuantifier = /\((?:\\.|\[[^\]]*\]|[^()])*[+*](?:\\.|\[[^\]]*\]|[^()])*\)\s*(?:[+*]|\{\d+(?:,\d*)?\})/;
  const repeatedWildcard = /(?:\.\*|\.\+)\s*(?:[+*]|\{\d+(?:,\d*)?\})/;
  return groupWithQuantifier.test(pattern) || repeatedWildcard.test(pattern);
};

const readPatternAtom = (pattern: string, start: number): PatternAtom | null => {
  const first = pattern[start];
  if (!first || "()|^$*+?{}".includes(first)) return null;
  if (first === "\\") {
    if (start + 1 >= pattern.length) return null;
    const propertyEscape = pattern[start + 1] === "p" || pattern[start + 1] === "P" || pattern[start + 1] === "u";
    if (propertyEscape && pattern[start + 2] === "{") {
      const close = pattern.indexOf("}", start + 3);
      if (close >= 0) return { key: pattern.slice(start, close + 1), end: close + 1 };
    }
    return { key: pattern.slice(start, start + 2), end: start + 2 };
  }
  if (first === "[") {
    let escaped = false;
    for (let index = start + 1; index < pattern.length; index += 1) {
      const value = pattern[index];
      if (!escaped && value === "]") return { key: pattern.slice(start, index + 1), end: index + 1 };
      if (!escaped && value === "\\") escaped = true;
      else escaped = false;
    }
    return null;
  }
  const codePoint = pattern.codePointAt(start);
  if (codePoint === undefined) return null;
  const value = String.fromCodePoint(codePoint);
  return { key: value, end: start + value.length };
};

const readUnboundedQuantifierEnd = (pattern: string, start: number): number | null => {
  const first = pattern[start];
  let end: number | null = first === "*" || first === "+" ? start + 1 : null;
  if (first === "{") {
    const match = /^\{\d+,\}/u.exec(pattern.slice(start));
    if (match) end = start + match[0].length;
  }
  if (end !== null && pattern[end] === "?") end += 1;
  return end;
};

const atomsCanOverlap = (left: string, right: string): boolean => left === "." || right === "." || left === right;

const hasAdjacentOverlappingQuantifiers = (pattern: string): boolean => {
  let prior: { key: string; end: number } | null = null;
  for (let index = 0; index < pattern.length;) {
    const atom = readPatternAtom(pattern, index);
    if (!atom) {
      prior = null;
      index += 1;
      continue;
    }
    const quantifierEnd = readUnboundedQuantifierEnd(pattern, atom.end);
    if (quantifierEnd === null) {
      prior = null;
      index = atom.end;
      continue;
    }
    if (prior && prior.end === index && atomsCanOverlap(prior.key, atom.key)) return true;
    prior = { key: atom.key, end: quantifierEnd };
    index = quantifierEnd;
  }
  return false;
};

const splitTopLevelAlternatives = (content: string): string[] => {
  const alternatives: string[] = [];
  let start = 0;
  let depth = 0;
  let inClass = false;
  let escaped = false;
  for (let index = 0; index < content.length; index += 1) {
    const value = content[index];
    if (escaped) { escaped = false; continue; }
    if (value === "\\") { escaped = true; continue; }
    if (inClass) {
      if (value === "]") inClass = false;
      continue;
    }
    if (value === "[") { inClass = true; continue; }
    if (value === "(") depth += 1;
    else if (value === ")") depth -= 1;
    else if (value === "|" && depth === 0) {
      alternatives.push(content.slice(start, index));
      start = index + 1;
    }
  }
  alternatives.push(content.slice(start));
  return alternatives;
};

const simpleAlternativeAtoms = (alternative: string): string[] | null => {
  const atoms: string[] = [];
  for (let index = 0; index < alternative.length;) {
    const atom = readPatternAtom(alternative, index);
    if (!atom) return null;
    atoms.push(atom.key);
    index = atom.end;
  }
  return atoms;
};

const isAtomPrefix = (left: readonly string[], right: readonly string[]): boolean =>
  left.length <= right.length && left.every((atom, index) => atomsCanOverlap(atom, right[index] ?? ""));

const repeatedGroupHasOverlappingAlternatives = (pattern: string): boolean => {
  const groups: Array<{ contentStart: number }> = [];
  let inClass = false;
  let escaped = false;
  for (let index = 0; index < pattern.length; index += 1) {
    const value = pattern[index];
    if (escaped) { escaped = false; continue; }
    if (value === "\\") { escaped = true; continue; }
    if (inClass) {
      if (value === "]") inClass = false;
      continue;
    }
    if (value === "[") { inClass = true; continue; }
    if (value === "(") {
      const prefixLength = pattern.startsWith("?:", index + 1) ? 2 : 0;
      groups.push({ contentStart: index + 1 + prefixLength });
      continue;
    }
    if (value !== ")") continue;
    const group = groups.pop();
    if (!group || readUnboundedQuantifierEnd(pattern, index + 1) === null) continue;
    const alternatives = splitTopLevelAlternatives(pattern.slice(group.contentStart, index));
    if (alternatives.length < 2) continue;
    const atoms = alternatives.map(simpleAlternativeAtoms);
    if (atoms.some(candidate => candidate?.length === 0)) return true;
    for (let left = 0; left < atoms.length; left += 1) {
      const leftAtoms = atoms[left];
      if (!leftAtoms) continue;
      for (let right = left + 1; right < atoms.length; right += 1) {
        const rightAtoms = atoms[right];
        if (rightAtoms && (isAtomPrefix(leftAtoms, rightAtoms) || isAtomPrefix(rightAtoms, leftAtoms))) return true;
      }
    }
  }
  return false;
};

const hasRiskyRepetition = (pattern: string): boolean =>
  hasRiskyNestedQuantifier(pattern)
  || hasAdjacentOverlappingQuantifiers(pattern)
  || repeatedGroupHasOverlappingAlternatives(pattern);

const advanceStringIndex = (value: string, index: number, unicode: boolean): number => {
  if (!unicode || index + 1 >= value.length) return index + 1;
  const first = value.charCodeAt(index);
  const second = value.charCodeAt(index + 1);
  return first >= 0xD800 && first <= 0xDBFF && second >= 0xDC00 && second <= 0xDFFF ? index + 2 : index + 1;
};

export const validatePattern = ({ mode, pattern, flags }: MatcherOptions): RegexValidation => {
  const normalizedFlags = normalizeFlags(flags);
  if (!pattern) return { valid: false, message: "Enter a search pattern.", normalizedFlags };
  if (pattern.length > MAX_PATTERN_LENGTH) {
    return { valid: false, message: `Patterns are limited to ${MAX_PATTERN_LENGTH.toLocaleString()} characters.`, normalizedFlags };
  }
  if (mode === "plain") return { valid: true, message: "Plain-text search is ready.", normalizedFlags };
  if (hasRiskyRepetition(pattern)) {
    return {
      valid: false,
      message: "This pattern contains a nested quantifier or overlapping repetition that could make the JavaScript regex engine unresponsive.",
      normalizedFlags,
    };
  }
  try {
    new RegExp(pattern, normalizedFlags);
    return { valid: true, message: "Valid JavaScript regular expression.", normalizedFlags };
  } catch (error) {
    return {
      valid: false,
      message: error instanceof Error ? error.message : "Invalid regular expression.",
      normalizedFlags,
    };
  }
};

export const createMatcher = (options: MatcherOptions): ((value: string) => boolean) => {
  const validation = validatePattern(options);
  if (!validation.valid) return () => false;
  const source = options.mode === "plain" ? escapeRegex(options.pattern) : options.pattern;
  const expression = new RegExp(source, validation.normalizedFlags);
  return value => {
    expression.lastIndex = 0;
    return expression.test(value.slice(0, MAX_SAMPLE_LENGTH));
  };
};

export const evaluateSample = (options: MatcherOptions, sample: string): RegexSampleMatch[] => {
  const validation = validatePattern(options);
  if (!validation.valid) return [];
  const source = options.mode === "plain" ? escapeRegex(options.pattern) : options.pattern;
  const expression = new RegExp(source, `${validation.normalizedFlags}g`);
  const boundedSample = sample.slice(0, MAX_SAMPLE_LENGTH);
  const results: RegexSampleMatch[] = [];
  let match: RegExpExecArray | null;
  while ((match = expression.exec(boundedSample)) && results.length < MAX_MATCHES) {
    results.push({ value: match[0], index: match.index, groups: match.slice(1).map(value => value ?? "") });
    if (match[0].length === 0) {
      expression.lastIndex = advanceStringIndex(boundedSample, expression.lastIndex, validation.normalizedFlags.includes("u"));
    }
  }
  return results;
};

export const regexLimits = Object.freeze({
  pattern: MAX_PATTERN_LENGTH,
  sample: MAX_SAMPLE_LENGTH,
  matches: MAX_MATCHES,
});
