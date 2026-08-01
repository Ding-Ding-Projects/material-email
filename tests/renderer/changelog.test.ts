import { describe, expect, it } from "vitest";
import { changelogMarkdown, filterChangelogEntries, parseDateInput, validateDateRange } from "../../src/renderer/lib/changelog";

describe("changelog date model", () => {
  it("accepts ISO and preserves invalid raw input", () => { expect(parseDateInput("2026-08-01").isoDate).toBe("2026-08-01"); expect(parseDateInput("2026-02-31")).toMatchObject({ raw: "2026-02-31", isoDate: null, error: "calendar" }); });
  it("rejects reversed ranges", () => { expect(validateDateRange("2026-08-02", "2026-08-01").error).toBe("inverted"); });
  it("composes text and date predicates and serializes the same selection", () => { const entries = [{ version: "1", date: "2026-08-01", title: "Alpha", changes: [{ category: "Mail", detail: "one" }] }, { version: "2", date: "2026-08-02", title: "Beta", changes: [{ category: "Mail", detail: "two" }] }]; const selected = filterChangelogEntries(entries, "", text => text.includes("Beta"), "2026-08-01", "2026-08-02"); expect(selected).toHaveLength(1); expect(changelogMarkdown(selected, "Beta", "2026-08-01", "2026-08-02")).toContain("## 2 — Beta"); });
});
