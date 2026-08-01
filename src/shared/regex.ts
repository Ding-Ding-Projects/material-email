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

export const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const normalizeFlags = (flags: string): string =>
  [...new Set(flags)].filter(flag => VALID_FLAGS.has(flag)).sort().join("");

const hasRiskyNestedQuantifier = (pattern: string): boolean => {
  const groupWithQuantifier = /\((?:\\.|\[[^\]]*\]|[^()])*[+*](?:\\.|\[[^\]]*\]|[^()])*\)\s*(?:[+*]|\{\d+(?:,\d*)?\})/;
  const repeatedWildcard = /(?:\.\*|\.\+)\s*(?:[+*]|\{\d+(?:,\d*)?\})/;
  return groupWithQuantifier.test(pattern) || repeatedWildcard.test(pattern);
};

export const validatePattern = ({ mode, pattern, flags }: MatcherOptions): RegexValidation => {
  const normalizedFlags = normalizeFlags(flags);
  if (!pattern) return { valid: false, message: "Enter a search pattern.", normalizedFlags };
  if (pattern.length > MAX_PATTERN_LENGTH) {
    return { valid: false, message: `Patterns are limited to ${MAX_PATTERN_LENGTH.toLocaleString()} characters.`, normalizedFlags };
  }
  if (mode === "plain") return { valid: true, message: "Plain-text search is ready.", normalizedFlags };
  if (hasRiskyNestedQuantifier(pattern)) {
    return {
      valid: false,
      message: "This pattern contains a nested quantifier that could make the JavaScript regex engine unresponsive.",
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
    if (match[0].length === 0) expression.lastIndex += 1;
  }
  return results;
};

export const regexLimits = Object.freeze({
  pattern: MAX_PATTERN_LENGTH,
  sample: MAX_SAMPLE_LENGTH,
  matches: MAX_MATCHES,
});
