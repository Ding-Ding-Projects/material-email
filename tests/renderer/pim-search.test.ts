import { describe, expect, it } from "vitest";
import {
  PIM_SEARCH_KEYS,
  PIM_SEARCH_STORAGE_KEY,
  classifyPimSearch,
  defaultPimSearches,
  localizedPimSearchNoMatch,
  localizedPimSearchStatus,
  parsePimSearches,
  pimSearchNoMatchToneScale,
  pimSearchStatusToneScale,
  serializePimSearches,
} from "../../src/renderer/lib/pim-search";
import { regexLimits } from "../../src/renderer/lib/regex";

describe("bounded PIM search state", () => {
  it("owns six independent literal-first search models and recovers from corrupt storage", () => {
    expect(PIM_SEARCH_STORAGE_KEY).toBe("material-email.pim-searches.v1");
    expect(PIM_SEARCH_KEYS).toEqual([
      "contacts",
      "mailing-lists",
      "calendar-events",
      "tasks",
      "pim-history",
      "mailing-list-members-editor",
    ]);
    expect(parsePimSearches(null)).toEqual(defaultPimSearches());
    expect(parsePimSearches("not-json")).toEqual(defaultPimSearches());
    expect(parsePimSearches("[]")).toEqual(defaultPimSearches());
  });

  it("round-trips every independent mode and pattern with normalized JavaScript flags", () => {
    const searches = defaultPimSearches();
    PIM_SEARCH_KEYS.forEach((key, index) => {
      searches[key] = {
        mode: index % 2 === 0 ? "regex" : "plain",
        pattern: `${key}-${index}`,
        flags: index % 2 === 0 ? "uimsmi" : "smxi",
      };
    });

    const parsed = parsePimSearches(serializePimSearches(searches));
    expect(parsed.contacts).toEqual({ mode: "regex", pattern: "contacts-0", flags: "imsu" });
    expect(parsed["mailing-lists"]).toEqual({ mode: "plain", pattern: "mailing-lists-1", flags: "ims" });
    expect(parsed["calendar-events"]).toEqual({ mode: "regex", pattern: "calendar-events-2", flags: "imsu" });
    expect(parsed.tasks.pattern).toBe("tasks-3");
    expect(parsed["pim-history"].pattern).toBe("pim-history-4");
    expect(parsed["mailing-list-members-editor"].pattern).toBe("mailing-list-members-editor-5");
  });

  it("bounds persisted patterns and excludes samples, popover state, and unrelated searches", () => {
    const searches = defaultPimSearches();
    searches.contacts = {
      mode: "regex",
      pattern: "x".repeat(regexLimits.pattern + 20),
      flags: "giu",
      sample: "private transient sample",
      builderOpen: true,
    } as typeof searches.contacts;
    const serialized = serializePimSearches({
      ...searches,
      settings: { mode: "regex", pattern: "theme", flags: "i" },
    } as Parameters<typeof serializePimSearches>[0]);
    const parsedJson = JSON.parse(serialized) as Record<string, unknown>;
    expect(parsePimSearches(serialized).contacts).toEqual({
      mode: "regex",
      pattern: "x".repeat(regexLimits.pattern),
      flags: "iu",
    });
    expect(parsedJson).not.toHaveProperty("settings");
    expect(serialized).not.toContain("sample");
    expect(serialized).not.toContain("builderOpen");
  });

  it("distinguishes idle, invalid, valid matches, and valid no-match results", () => {
    expect(classifyPimSearch({ mode: "plain", pattern: "", flags: "i" }, 0)).toBe("idle");
    expect(classifyPimSearch({ mode: "regex", pattern: "(", flags: "i" }, 0)).toBe("invalid");
    expect(classifyPimSearch({ mode: "regex", pattern: "^Ada$", flags: "i" }, 0)).toBe("no-match");
    expect(classifyPimSearch({ mode: "plain", pattern: "Ada", flags: "i" }, 1)).toBe("matches");
  });

  it("keeps exact counts and surface facts while English and Cantonese humor levels choose voice independently", () => {
    const englishScale = pimSearchStatusToneScale("contacts", 2, 5);
    const cantoneseNoMatch = pimSearchNoMatchToneScale("tasks");
    expect(englishScale.english[0]).toBe("Showing 2 of 5 contacts.");
    expect(englishScale.english[4]).toContain("Showing 2 of 5 contacts.");
    expect(cantoneseNoMatch.cantonese[0]).toContain("工作標題、描述、狀態、優先次序同類別都冇配對。");

    expect(localizedPimSearchStatus("contacts", 2, 5, {
      language: "en",
      funnyEnglish: 1,
      funnyCantonese: 5,
    })).toBe("Showing 2 of 5 contacts.");
    expect(localizedPimSearchNoMatch("tasks", {
      language: "bilingual",
      funnyEnglish: 1,
      funnyCantonese: 5,
    }, (english, cantonese) => `${english} || ${cantonese}`)).toContain("Edit or clear this local search. || 工作標題、描述、狀態、優先次序同類別都冇配對。");
  });
});
