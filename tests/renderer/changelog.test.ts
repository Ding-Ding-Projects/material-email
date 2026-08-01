import { describe, expect, it } from "vitest";
import {
  changelogEntrySearchText,
  changelogMarkdown,
  filterChangelogEntries,
  parseDateInput,
  validateDateRange,
  type ChangelogEntry,
} from "../../src/renderer/lib/changelog";

const entries: readonly ChangelogEntry[] = [
  { version: "0.1.0", date: "2026-07-15", title: "Foundation", changes: [{ category: "Mail", detail: "Local compose foundations." }] },
  { version: "0.2.0", date: "2026-08-01", title: "Safer reading", codeName: "Classic Har Gow · 蝦餃", changes: [{ category: "Security", detail: "Remote message content stays blocked." }] },
  { version: "0.3.0-dev", date: null, title: "Unreleased work", changes: [] },
];

describe("changelog date parsing", () => {
  it("accepts ISO, locale order, and locale digits", () => {
    expect(parseDateInput("2026-08-01", "zh-HK").isoDate).toBe("2026-08-01");
    expect(parseDateInput("8/1/2026", "en-US").isoDate).toBe("2026-08-01");
    expect(parseDateInput("1/8/2026", "zh-HK").isoDate).toBe("2026-08-01");
    expect(parseDateInput("٢٢/١١/٢٠٠٦", "ar-EG").isoDate).toBe("2006-11-22");
  });

  it("preserves partial, invalid, and empty input exactly", () => {
    expect(parseDateInput(" 8/1/20 ", "en-US")).toEqual({ raw: " 8/1/20 ", status: "partial", isoDate: null, error: null });
    expect(parseDateInput("2026-08", "en-US")).toEqual({ raw: "2026-08", status: "partial", isoDate: null, error: null });
    expect(parseDateInput(" 2/30/2026 ", "en-US")).toEqual({ raw: " 2/30/2026 ", status: "invalid", isoDate: null, error: "calendar" });
    expect(parseDateInput("   ", "en-US")).toEqual({ raw: "   ", status: "empty", isoDate: null, error: null });
  });
});

describe("changelog range validation", () => {
  it("accepts open bounds and reports reversed ranges", () => {
    expect(validateDateRange("", "8/1/2026", "en-US")).toMatchObject({ valid: true, status: "valid" });
    const reversed = validateDateRange("2026-08-02", "2026-08-01");
    expect(reversed).toMatchObject({ valid: false, status: "invalid", error: "inverted" });
    expect(reversed.issues).toContainEqual({ field: "range", code: "inverted" });
  });

  it("retains field-specific partial and invalid issues", () => {
    const range = validateDateRange("8/1/20", "not a date", "en-US");
    expect(range.issues).toEqual([
      { field: "from", code: "partial-date" },
      { field: "to", code: "invalid-date" },
    ]);
    expect(range.from.raw).toBe("8/1/20");
    expect(range.to.raw).toBe("not a date");
  });
});

describe("changelog filtering and Markdown", () => {
  it("AND-composes inclusive dates with an external text predicate", () => {
    const filtered = filterChangelogEntries(entries, {
      range: validateDateRange("2026-08-01", "2026-08-31"),
      matchesText: text => text.toLocaleLowerCase("en").includes("security"),
    });
    expect(filtered).toEqual([entries[1]]);
    const matchedEntry = filtered[0];
    expect(matchedEntry).toBeDefined();
    if (!matchedEntry) throw new Error("Expected a filtered changelog entry.");
    expect(changelogEntrySearchText(matchedEntry)).toContain("Classic Har Gow · 蝦餃");
    expect(filterChangelogEntries(entries, { range: validateDateRange("2026-08", "") })).toEqual([]);
    expect(filterChangelogEntries([{ ...entries[0]!, date: "2026-99-99" }], {
      range: validateDateRange("2026-01-01", "2026-12-31"),
    })).toEqual([]);
  });

  it("serializes filter metadata deterministically and escapes entry Markdown", () => {
    const markdown = changelogMarkdown([{
      version: "0.2.0",
      date: "2026-08-01",
      title: "Safety *first*",
      changes: [{ category: "Mail_[safe]", detail: "Blocked markup\nwithout hiding facts." }],
    }], { query: "blocked *markup*", range: validateDateRange("2026-08-01", "2026-08-31") });
    expect(markdown).toContain("- **Search:** blocked \\*markup\\*");
    expect(markdown).toContain("- **Date range:** 2026-08-01 through 2026-08-31");
    expect(markdown).toContain("## 0.2.0 — Safety \\*first\\*");
    expect(markdown).toContain("- **Mail\\_\\[safe\\]:** Blocked markup without hiding facts.");
    expect(markdown.endsWith("\n")).toBe(true);
  });

  it("refuses to serialize an invalid date range", () => {
    expect(() => changelogMarkdown(entries, { range: validateDateRange("2026-08-02", "2026-08-01") })).toThrow(RangeError);
  });
});
