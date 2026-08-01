import { describe, expect, it } from "vitest";
import {
  changelogCalendarWeeks,
  changelogDateRangeForPreset,
  changelogMarkdown,
  filterChangelogEntries,
  parseDateInput,
  persistChangelogDateInputs,
  readChangelogDateInputs,
  shiftChangelogMonth,
  validateDateRange,
} from "../../src/renderer/lib/changelog";

describe("changelog date model", () => {
  it("accepts ISO and preserves invalid raw input", () => {
    expect(parseDateInput("2026-08-01").isoDate).toBe("2026-08-01");
    expect(parseDateInput("2026-02-31")).toMatchObject({ raw: "2026-02-31", isoDate: null, error: "calendar" });
  });
  it("accepts locale-ordered dates and distinguishes partial typing from invalid text", () => {
    expect(parseDateInput("2026/8/1", "en-CA").isoDate).toBe("2026-08-01");
    expect(parseDateInput("1/8/2026", "zh-HK").isoDate).toBe("2026-08-01");
    expect(parseDateInput("2026-08")).toMatchObject({ raw: "2026-08", isoDate: null, error: "partial" });
    expect(parseDateInput("tea o'clock")).toMatchObject({ isoDate: null, error: "format" });
  });
  it("rejects reversed ranges", () => {
    expect(validateDateRange("2026-08-02", "2026-08-01").error).toBe("inverted");
  });
  it("round-trips raw date inputs through session-compatible storage", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string): string | null => values.get(key) ?? null,
      setItem: (key: string, value: string): void => { values.set(key, value); },
    };
    expect(persistChangelogDateInputs(storage, { from: "2026/08/01", to: "still typing" })).toBe(true);
    expect(readChangelogDateInputs(storage)).toEqual({ from: "2026/08/01", to: "still typing" });
  });
  it("composes text and date predicates and serializes the selection", () => {
    const entries = [
      { version: "1", date: "2026-08-01", title: "Alpha", changes: [{ category: "Mail", detail: "one" }] },
      { version: "2", date: "2026-08-02", title: "Beta", changes: [{ category: "Mail", detail: "two" }] },
    ];
    const selected = filterChangelogEntries(entries, "Mail", text => text.includes("Mail"), "2026-08-02", "2026-08-02");
    expect(selected).toHaveLength(1);
    const markdown = changelogMarkdown(selected, "Mail", "2026-08-02", "2026-08-02");
    expect(markdown).toContain("Date range: 2026-08-02 through 2026-08-02");
    expect(markdown).toContain("## 2 — Beta");
    expect(markdown).not.toContain("## 1 — Alpha");
  });
  it("builds deterministic presets and navigable calendar months", () => {
    expect(changelogDateRangeForPreset("last-30-days", "2026-08-01")).toEqual({ from: "2026-07-03", to: "2026-08-01" });
    expect(changelogDateRangeForPreset("this-month", "2026-08-01")).toEqual({ from: "2026-08-01", to: "2026-08-01" });
    expect(changelogDateRangeForPreset("this-year", "2026-08-01")).toEqual({ from: "2026-01-01", to: "2026-08-01" });
    expect(changelogDateRangeForPreset("all", "2026-08-01")).toEqual({ from: "", to: "" });
    expect(shiftChangelogMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftChangelogMonth("2026-12", 1)).toBe("2027-01");
    const august = changelogCalendarWeeks("2026-08");
    expect(august).toHaveLength(6);
    expect(august.flat().filter(Boolean)).toHaveLength(31);
    expect(august[0]?.[6]?.isoDate).toBe("2026-08-01");
  });
});
