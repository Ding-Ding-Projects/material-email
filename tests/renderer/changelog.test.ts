import { describe, expect, it } from "vitest";
import {
  changelogMarkdown,
  filterChangelogEntries,
  parseDateInput,
  persistChangelogDateInputs,
  readChangelogDateInputs,
  validateDateRange,
} from "../../src/renderer/lib/changelog";

describe("changelog date model", () => {
  it("accepts ISO and preserves invalid raw input", () => {
    expect(parseDateInput("2026-08-01").isoDate).toBe("2026-08-01");
    expect(parseDateInput("2026-02-31")).toMatchObject({ raw: "2026-02-31", isoDate: null, error: "calendar" });
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
});
