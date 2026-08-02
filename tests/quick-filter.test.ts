import { describe, expect, it } from "vitest";
import {
  QUICK_FILTER_TAG_LIMIT,
  applyQuickFilter,
  emptyQuickFilterState,
  quickFilterIsInert,
  toggleQuickFilterFacet,
  toggleQuickFilterTag,
  type QuickFilterSubject,
} from "../src/shared/quick-filter.js";
import type { MessageSummary } from "../src/shared/contracts.js";

const message = (overrides: Partial<MessageSummary> = {}): MessageSummary => ({
  id: "account-1:INBOX:1",
  accountId: "account-1",
  folderPath: "INBOX",
  uid: 1,
  from: [{ name: "Auntie Mei", address: "mei@dimsum-kitchen.example" }],
  to: [{ name: "Mat", address: "mat@example.com" }],
  cc: [],
  subject: "Har gow roster",
  date: "2026-08-01T09:00:00.000Z",
  preview: "Bamboo steamers at six.",
  unread: false,
  starred: false,
  hasAttachments: false,
  size: 1_024,
  ...overrides,
});

const subjects: QuickFilterSubject[] = [
  { message: message({ id: "a", uid: 1, unread: true }), tagIds: ["work"] },
  { message: message({ id: "b", uid: 2, starred: true, subject: "Siu mai order" }), tagIds: ["work", "later"] },
  { message: message({ id: "c", uid: 3, hasAttachments: true, from: [{ name: "Bank", address: "no-reply@bank.example" }] }), tagIds: [] },
  { message: message({ id: "d", uid: 4 }), tagIds: [] },
];

const ids = (result: { messages: readonly MessageSummary[] }): string[] => result.messages.map(entry => entry.id);

describe("quick filter state", () => {
  it("starts inactive and inert", () => {
    const state = emptyQuickFilterState();
    expect(state.active).toBe(false);
    expect(quickFilterIsInert(state)).toBe(true);
  });

  it("returns every message untouched while inactive", () => {
    const result = applyQuickFilter(emptyQuickFilterState(), subjects);
    expect(ids(result)).toEqual(["a", "b", "c", "d"]);
    expect(result.matchedCount).toBe(4);
    expect(result.inert).toBe(false);
  });

  it("reports an active-but-empty filter as inert rather than hiding everything", () => {
    const result = applyQuickFilter({ ...emptyQuickFilterState(), active: true }, subjects);
    expect(ids(result)).toEqual(["a", "b", "c", "d"]);
    expect(result.inert).toBe(true);
  });
});

describe("quick filter facets", () => {
  it("filters by unread, starred, and attachment state", () => {
    const base = { ...emptyQuickFilterState(), active: true };
    expect(ids(applyQuickFilter({ ...base, facets: ["unread"] }, subjects))).toEqual(["a"]);
    expect(ids(applyQuickFilter({ ...base, facets: ["starred"] }, subjects))).toEqual(["b"]);
    expect(ids(applyQuickFilter({ ...base, facets: ["attachments"] }, subjects))).toEqual(["c"]);
    expect(ids(applyQuickFilter({ ...base, facets: ["tagged"] }, subjects))).toEqual(["a", "b"]);
  });

  it("combines facets conjunctively", () => {
    const state = { ...emptyQuickFilterState(), active: true, facets: ["unread" as const, "starred" as const] };
    expect(ids(applyQuickFilter(state, subjects))).toEqual([]);
  });

  it("toggles a facet on and back off, activating the filter", () => {
    const on = toggleQuickFilterFacet(emptyQuickFilterState(), "unread");
    expect(on).toMatchObject({ active: true, facets: ["unread"] });
    expect(toggleQuickFilterFacet(on, "unread").facets).toEqual([]);
  });
});

describe("quick filter tags", () => {
  it("matches any selected tag by default", () => {
    const state = { ...emptyQuickFilterState(), active: true, tagIds: ["later"] };
    expect(ids(applyQuickFilter(state, subjects))).toEqual(["b"]);
  });

  it("requires every selected tag in all mode", () => {
    const any = { ...emptyQuickFilterState(), active: true, tagIds: ["work", "later"], tagMatch: "any" as const };
    const all = { ...any, tagMatch: "all" as const };
    expect(ids(applyQuickFilter(any, subjects))).toEqual(["a", "b"]);
    expect(ids(applyQuickFilter(all, subjects))).toEqual(["b"]);
  });

  it("bounds how many tags can be selected", () => {
    let state = emptyQuickFilterState();
    for (let index = 0; index < QUICK_FILTER_TAG_LIMIT + 5; index += 1) state = toggleQuickFilterTag(state, `tag-${index}`);
    expect(state.tagIds).toHaveLength(QUICK_FILTER_TAG_LIMIT);
  });
});

describe("quick filter text", () => {
  it("searches the selected scopes in plain mode", () => {
    const base = { ...emptyQuickFilterState(), active: true, pattern: "siu mai" };
    expect(ids(applyQuickFilter({ ...base, scopes: ["subject"] }, subjects))).toEqual(["b"]);
    expect(ids(applyQuickFilter({ ...base, scopes: ["sender"] }, subjects))).toEqual([]);
  });

  it("ignores case in plain mode unless the reader asks for it", () => {
    const base = { ...emptyQuickFilterState(), active: true, pattern: "SIU MAI", scopes: ["subject" as const] };
    expect(ids(applyQuickFilter(base, subjects))).toEqual(["b"]);
    expect(ids(applyQuickFilter({ ...base, caseSensitive: true }, subjects))).toEqual([]);
  });

  it("treats plain-mode punctuation literally", () => {
    const state = { ...emptyQuickFilterState(), active: true, pattern: "no-reply@bank.example", scopes: ["sender" as const] };
    expect(ids(applyQuickFilter(state, subjects))).toEqual(["c"]);
  });

  it("supports regular expressions with flags", () => {
    const state = {
      ...emptyQuickFilterState(),
      active: true,
      mode: "regex" as const,
      pattern: "^siu\\s+mai",
      flags: "i",
      scopes: ["subject" as const],
    };
    expect(ids(applyQuickFilter(state, subjects))).toEqual(["b"]);
    expect(ids(applyQuickFilter({ ...state, pattern: "^(har|siu)", flags: "i" }, subjects))).toEqual(["a", "b", "c", "d"]);
    expect(ids(applyQuickFilter({ ...state, pattern: "^siu", flags: "" }, subjects))).toEqual([]);
  });

  it("reports an invalid pattern instead of silently matching nothing", () => {
    const state = { ...emptyQuickFilterState(), active: true, mode: "regex" as const, pattern: "(" };
    const result = applyQuickFilter(state, subjects);
    expect(result.patternValid).toBe(false);
    expect(result.patternMessage.length).toBeGreaterThan(0);
    expect(result.matchedCount).toBe(0);
  });

  it("refuses a pattern that could make the regex engine unresponsive", () => {
    const state = { ...emptyQuickFilterState(), active: true, mode: "regex" as const, pattern: "(a+)+$" };
    expect(applyQuickFilter(state, subjects).patternValid).toBe(false);
  });

  it("intersects text with facets and tags", () => {
    const state = {
      ...emptyQuickFilterState(),
      active: true,
      facets: ["starred" as const],
      tagIds: ["work"],
      pattern: "siu",
      scopes: ["subject" as const],
    };
    expect(ids(applyQuickFilter(state, subjects))).toEqual(["b"]);
  });

  it("keeps the unfiltered total alongside the matched count", () => {
    const state = { ...emptyQuickFilterState(), active: true, facets: ["unread" as const] };
    const result = applyQuickFilter(state, subjects);
    expect(result.totalCount).toBe(4);
    expect(result.matchedCount).toBe(1);
  });
});
