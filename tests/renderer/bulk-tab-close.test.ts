import { describe, expect, it } from "vitest";
import { regexLimits } from "../../src/renderer/lib/regex";
import {
  BULK_TAB_CLOSE_STORAGE_KEY,
  defaultBulkTabCloseReview,
  evaluateBulkTabClose,
  parseBulkTabCloseReview,
  serializeBulkTabCloseReview,
} from "../../src/renderer/lib/bulk-tab-close";

const candidates = [
  { id: "mail", label: "Mail · 郵件", pinned: true },
  { id: "settings", label: "Settings · 設定", pinned: false },
  { id: "tools", label: "Tools · 工具", pinned: false },
] as const;

describe("bulk tab close review persistence", () => {
  it("uses a literal, pin-protecting default for absent or corrupt storage", () => {
    expect(BULK_TAB_CLOSE_STORAGE_KEY).toBe("material-email.bulk-tab-close-review.v1");
    expect(parseBulkTabCloseReview(null)).toEqual(defaultBulkTabCloseReview());
    expect(parseBulkTabCloseReview("not-json")).toEqual(defaultBulkTabCloseReview());
    expect(parseBulkTabCloseReview("[]")).toEqual(defaultBulkTabCloseReview());
  });

  it("round-trips bounded matcher and explicit review options without ephemeral builder state", () => {
    const oversized = "x".repeat(regexLimits.pattern + 10);
    const serialized = serializeBulkTabCloseReview({
      search: { mode: "regex", pattern: oversized, flags: "uimmi" },
      inverse: true,
      includePinned: true,
    });

    expect(parseBulkTabCloseReview(serialized)).toEqual({
      search: { mode: "regex", pattern: "x".repeat(regexLimits.pattern), flags: "imu" },
      inverse: true,
      includePinned: true,
    });
    expect(serialized).not.toContain("sample");
    expect(serialized).not.toContain("builderOpen");
  });

  it("defaults mistyped fields instead of widening a destructive review", () => {
    expect(parseBulkTabCloseReview(JSON.stringify({
      search: { mode: "regexp", pattern: 42, flags: null },
      inverse: "true",
      includePinned: 1,
    }))).toEqual(defaultBulkTabCloseReview());
  });
});

describe("bulk tab close evaluation", () => {
  it("blocks empty, whitespace-only, invalid, and risky patterns before selecting tabs", () => {
    for (const search of [
      { mode: "plain" as const, pattern: "", flags: "i" },
      { mode: "plain" as const, pattern: "   ", flags: "i" },
    ]) {
      expect(evaluateBulkTabClose(candidates, { search, inverse: true, includePinned: true })).toEqual({
        status: "empty",
        tabIds: [],
        excludedPinnedIds: [],
      });
    }

    for (const pattern of ["[", "(a+)+$"]) {
      expect(evaluateBulkTabClose(candidates, {
        search: { mode: "regex", pattern, flags: "i" },
        inverse: true,
        includePinned: true,
      })).toEqual({ status: "invalid", tabIds: [], excludedPinnedIds: [] });
    }
  });

  it("uses one predicate for containing and inverse review while excluding pinned tabs by default", () => {
    expect(evaluateBulkTabClose(candidates, {
      search: { mode: "plain", pattern: "mail", flags: "i" },
      inverse: false,
      includePinned: false,
    })).toEqual({ status: "ready", tabIds: [], excludedPinnedIds: ["mail"] });

    expect(evaluateBulkTabClose(candidates, {
      search: { mode: "plain", pattern: "mail", flags: "i" },
      inverse: true,
      includePinned: false,
    })).toEqual({ status: "ready", tabIds: ["settings", "tools"], excludedPinnedIds: [] });
  });

  it("includes a pinned tab only after the explicit option is enabled", () => {
    expect(evaluateBulkTabClose(candidates, {
      search: { mode: "regex", pattern: "^(Mail|Tools)", flags: "i" },
      inverse: false,
      includePinned: true,
    })).toEqual({ status: "ready", tabIds: ["mail", "tools"], excludedPinnedIds: [] });
  });
});
