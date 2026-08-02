import type { MessageSummary } from "./contracts.js";
import { createMatcher, validatePattern, type MatchMode } from "./regex.js";

export const QUICK_FILTER_TAG_LIMIT = 20;

export type QuickFilterFacet = "unread" | "starred" | "attachments" | "tagged";

export type QuickFilterScope = "sender" | "recipients" | "subject" | "preview";

export const QUICK_FILTER_FACETS: readonly QuickFilterFacet[] = Object.freeze(["unread", "starred", "attachments", "tagged"]);
export const QUICK_FILTER_SCOPES: readonly QuickFilterScope[] = Object.freeze(["sender", "recipients", "subject", "preview"]);

export interface QuickFilterState {
  active: boolean;
  facets: readonly QuickFilterFacet[];
  /** Every selected tag must be present ("all"), or any one of them ("any"). */
  tagIds: readonly string[];
  tagMatch: "any" | "all";
  mode: MatchMode;
  pattern: string;
  /** Regex-mode flags, owned by the adjacent regex builder. Plain mode uses {@link caseSensitive}. */
  flags: string;
  caseSensitive: boolean;
  scopes: readonly QuickFilterScope[];
}

export interface QuickFilterSubject {
  message: MessageSummary;
  tagIds: readonly string[];
}

export interface QuickFilterResult {
  messages: readonly MessageSummary[];
  totalCount: number;
  matchedCount: number;
  patternValid: boolean;
  patternMessage: string;
  /** True when the state is on but selects nothing, so callers can show the unfiltered list. */
  inert: boolean;
}

export const emptyQuickFilterState = (): QuickFilterState => ({
  active: false,
  facets: [],
  tagIds: [],
  tagMatch: "any",
  mode: "plain",
  pattern: "",
  flags: "",
  caseSensitive: false,
  scopes: ["sender", "subject", "preview"],
});

/**
 * Typing into the quick filter is a casual gesture, so plain text ignores case unless the reader
 * asks otherwise. Regex mode keeps whatever the builder produced, including its flags.
 */
const quickFilterFlags = (state: QuickFilterState): string =>
  state.mode === "regex" ? state.flags : state.caseSensitive ? "" : "i";

export const quickFilterIsInert = (state: QuickFilterState): boolean =>
  !state.facets.length && !state.tagIds.length && !state.pattern.trim();

const addressText = (addresses: readonly { name: string; address: string }[]): string =>
  addresses.map(entry => `${entry.name} ${entry.address}`.trim()).join(" ");

const scopeText = (scope: QuickFilterScope, message: MessageSummary): string => {
  switch (scope) {
    case "sender": return addressText(message.from);
    case "recipients": return `${addressText(message.to)} ${addressText(message.cc)}`;
    case "subject": return message.subject;
    case "preview": return message.preview;
  }
};

const facetMatches = (facet: QuickFilterFacet, subject: QuickFilterSubject): boolean => {
  switch (facet) {
    case "unread": return subject.message.unread;
    case "starred": return subject.message.starred;
    case "attachments": return subject.message.hasAttachments;
    case "tagged": return subject.tagIds.length > 0;
  }
};

export const applyQuickFilter = (
  state: QuickFilterState,
  subjects: readonly QuickFilterSubject[],
): QuickFilterResult => {
  const totalCount = subjects.length;
  const messages = subjects.map(subject => subject.message);
  if (!state.active || quickFilterIsInert(state)) {
    return {
      messages,
      totalCount,
      matchedCount: totalCount,
      patternValid: true,
      patternMessage: "",
      inert: state.active,
    };
  }

  const pattern = state.pattern.trim();
  const flags = quickFilterFlags(state);
  const validation = pattern
    ? validatePattern({ mode: state.mode, pattern, flags })
    : { valid: true, message: "", normalizedFlags: "" };
  if (pattern && !validation.valid) {
    return { messages: [], totalCount, matchedCount: 0, patternValid: false, patternMessage: validation.message, inert: false };
  }

  const matcher = pattern ? createMatcher({ mode: state.mode, pattern, flags }) : null;
  const scopes = state.scopes.length ? state.scopes : QUICK_FILTER_SCOPES;
  const tagIds = state.tagIds.slice(0, QUICK_FILTER_TAG_LIMIT);

  const matched = subjects.filter(subject => {
    if (!state.facets.every(facet => facetMatches(facet, subject))) return false;
    if (tagIds.length) {
      const present = tagIds.filter(id => subject.tagIds.includes(id));
      if (state.tagMatch === "all" ? present.length !== tagIds.length : present.length === 0) return false;
    }
    if (!matcher) return true;
    return scopes.some(scope => matcher(scopeText(scope, subject.message)));
  });

  return {
    messages: matched.map(subject => subject.message),
    totalCount,
    matchedCount: matched.length,
    patternValid: true,
    patternMessage: validation.message,
    inert: false,
  };
};

export const toggleQuickFilterFacet = (state: QuickFilterState, facet: QuickFilterFacet): QuickFilterState => ({
  ...state,
  active: true,
  facets: state.facets.includes(facet) ? state.facets.filter(value => value !== facet) : [...state.facets, facet],
});

export const toggleQuickFilterTag = (state: QuickFilterState, tagId: string): QuickFilterState => {
  const tagIds = state.tagIds.includes(tagId)
    ? state.tagIds.filter(value => value !== tagId)
    : [...state.tagIds, tagId].slice(0, QUICK_FILTER_TAG_LIMIT);
  return { ...state, active: true, tagIds };
};
