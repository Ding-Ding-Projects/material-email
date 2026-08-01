import {
  createMatcher,
  normalizeFlags,
  regexLimits,
  validatePattern,
  type MatcherOptions,
} from "./regex.js";

export interface PersistedBulkTabCloseReview {
  search: MatcherOptions;
  inverse: boolean;
  includePinned: boolean;
}

export interface BulkTabCloseCandidate<Id extends string> {
  id: Id;
  label: string;
  pinned: boolean;
}

export interface BulkTabCloseEvaluation<Id extends string> {
  status: "empty" | "invalid" | "ready";
  tabIds: Id[];
  excludedPinnedIds: Id[];
}

export const BULK_TAB_CLOSE_STORAGE_KEY = "material-email.bulk-tab-close-review.v1";

export const defaultBulkTabCloseReview = (): PersistedBulkTabCloseReview => ({
  search: { mode: "plain", pattern: "", flags: "i" },
  inverse: false,
  includePinned: false,
});

const parseSearch = (value: unknown): MatcherOptions => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return defaultBulkTabCloseReview().search;
  const candidate = value as Record<string, unknown>;
  return {
    mode: candidate.mode === "regex" ? "regex" : "plain",
    pattern: typeof candidate.pattern === "string" ? candidate.pattern.slice(0, regexLimits.pattern) : "",
    flags: typeof candidate.flags === "string" ? normalizeFlags(candidate.flags) : "i",
  };
};

export const parseBulkTabCloseReview = (stored: string | null): PersistedBulkTabCloseReview => {
  if (!stored) return defaultBulkTabCloseReview();
  try {
    const parsed = JSON.parse(stored) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return defaultBulkTabCloseReview();
    const source = parsed as Record<string, unknown>;
    return {
      search: parseSearch(source.search),
      inverse: source.inverse === true,
      includePinned: source.includePinned === true,
    };
  } catch {
    return defaultBulkTabCloseReview();
  }
};

export const serializeBulkTabCloseReview = (review: PersistedBulkTabCloseReview): string => JSON.stringify({
  search: {
    mode: review.search.mode === "regex" ? "regex" : "plain",
    pattern: review.search.pattern.slice(0, regexLimits.pattern),
    flags: normalizeFlags(review.search.flags),
  },
  inverse: review.inverse === true,
  includePinned: review.includePinned === true,
} satisfies PersistedBulkTabCloseReview);

export const evaluateBulkTabClose = <Id extends string>(
  candidates: readonly BulkTabCloseCandidate<Id>[],
  review: PersistedBulkTabCloseReview,
): BulkTabCloseEvaluation<Id> => {
  if (!review.search.pattern.trim()) return { status: "empty", tabIds: [], excludedPinnedIds: [] };
  if (!validatePattern(review.search).valid) return { status: "invalid", tabIds: [], excludedPinnedIds: [] };

  const matches = createMatcher(review.search);
  const selected = candidates.filter(candidate => {
    const hit = matches(candidate.label);
    return review.inverse ? !hit : hit;
  });
  const excludedPinnedIds = review.includePinned
    ? []
    : selected.filter(candidate => candidate.pinned).map(candidate => candidate.id);
  const tabIds = selected
    .filter(candidate => review.includePinned || !candidate.pinned)
    .map(candidate => candidate.id);

  return { status: "ready", tabIds, excludedPinnedIds };
};
