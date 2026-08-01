import { describe, expect, it } from "vitest";
import { regexLimits } from "../../src/renderer/lib/regex";
import {
  TAB_DISCOVERY_SEARCH_KEYS,
  TAB_DISCOVERY_SEARCH_STORAGE_KEY,
  defaultTabDiscoverySearches,
  isTabDiscoverySearchKey,
  parseTabDiscoverySearches,
  serializeTabDiscoverySearches,
} from "../../src/renderer/lib/tab-discovery-search";

describe("Tab discovery search persistence", () => {
  it("defines one independent model for every discovery field", () => {
    expect(TAB_DISCOVERY_SEARCH_STORAGE_KEY).toBe("material-email.tab-discovery-searches.v1");
    expect(TAB_DISCOVERY_SEARCH_KEYS).toEqual(["tabs-current", "tabs-group", "tab-groups", "tabs-master"]);
    expect(Object.keys(defaultTabDiscoverySearches())).toEqual(TAB_DISCOVERY_SEARCH_KEYS);
    expect(isTabDiscoverySearchKey("tabs-master")).toBe(true);
    expect(isTabDiscoverySearchKey("bulk-tabs")).toBe(false);
  });

  it("round-trips independent modes, patterns, and normalized JavaScript flags", () => {
    const searches = defaultTabDiscoverySearches();
    searches["tabs-current"] = { mode: "regex", pattern: "^Mail$", flags: "uimmi" };
    searches["tabs-group"] = { mode: "plain", pattern: "records", flags: "s" };
    searches["tab-groups"] = { mode: "regex", pattern: "^(Workspace|System)$", flags: "mi" };
    searches["tabs-master"] = { mode: "regex", pattern: "Settings$", flags: "usx" };

    expect(parseTabDiscoverySearches(serializeTabDiscoverySearches(searches))).toEqual({
      "tabs-current": { mode: "regex", pattern: "^Mail$", flags: "imu" },
      "tabs-group": { mode: "plain", pattern: "records", flags: "s" },
      "tab-groups": { mode: "regex", pattern: "^(Workspace|System)$", flags: "im" },
      "tabs-master": { mode: "regex", pattern: "Settings$", flags: "su" },
    });
  });

  it("bounds stored patterns and defaults corrupt, missing, or mistyped entries", () => {
    const oversized = "x".repeat(regexLimits.pattern + 10);
    const parsed = parseTabDiscoverySearches(JSON.stringify({
      "tabs-current": { mode: "regex", pattern: oversized, flags: "gix" },
      "tabs-group": { mode: "regexp", pattern: 42, flags: null },
      "tab-groups": [],
    }));

    expect(parsed["tabs-current"]).toEqual({ mode: "regex", pattern: "x".repeat(regexLimits.pattern), flags: "i" });
    expect(parsed["tabs-group"]).toEqual({ mode: "plain", pattern: "", flags: "i" });
    expect(parsed["tab-groups"]).toEqual({ mode: "plain", pattern: "", flags: "i" });
    expect(parsed["tabs-master"]).toEqual({ mode: "plain", pattern: "", flags: "i" });
    expect(parseTabDiscoverySearches("not-json")).toEqual(defaultTabDiscoverySearches());
  });

  it("serializes no sample text, builder-open state, or unrelated search", () => {
    const searches = defaultTabDiscoverySearches() as ReturnType<typeof defaultTabDiscoverySearches> & {
      commands?: unknown;
    };
    Object.assign(searches["tabs-master"], { pattern: "Tools", sample: "private sample", builderOpen: true });
    searches.commands = { mode: "regex", pattern: "compose", flags: "i" };

    const serialized = serializeTabDiscoverySearches(searches);
    expect(serialized).not.toContain("sample");
    expect(serialized).not.toContain("builderOpen");
    expect(serialized).not.toContain("commands");
    expect(JSON.parse(serialized)["tabs-master"]).toEqual({ mode: "plain", pattern: "Tools", flags: "i" });
  });
});
