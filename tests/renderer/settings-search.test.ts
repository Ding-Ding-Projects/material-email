import { describe, expect, it } from "vitest";
import { regexLimits } from "../../src/renderer/lib/regex";
import {
  SETTINGS_SEARCH_STORAGE_KEY,
  defaultSettingsSearch,
  parseSettingsSearch,
  serializeSettingsSearch,
} from "../../src/renderer/lib/settings-search";

describe("Settings search persistence", () => {
  it("uses a literal case-insensitive default for absent or corrupt storage", () => {
    expect(SETTINGS_SEARCH_STORAGE_KEY).toBe("material-email.settings-search.v1");
    expect(parseSettingsSearch(null)).toEqual(defaultSettingsSearch());
    expect(parseSettingsSearch("not-json")).toEqual(defaultSettingsSearch());
  });

  it("round-trips the Settings mode, pattern, and normalized JavaScript flags", () => {
    const serialized = serializeSettingsSearch({ mode: "regex", pattern: "^(Theme|Language)$", flags: "uimmi" });
    expect(parseSettingsSearch(serialized)).toEqual({
      mode: "regex",
      pattern: "^(Theme|Language)$",
      flags: "imu",
    });
  });

  it("bounds stored patterns and rejects unsupported field types", () => {
    const oversized = "x".repeat(regexLimits.pattern + 20);
    expect(parseSettingsSearch(JSON.stringify({ mode: "regex", pattern: oversized, flags: "igx" }))).toEqual({
      mode: "regex",
      pattern: "x".repeat(regexLimits.pattern),
      flags: "i",
    });
    expect(parseSettingsSearch(JSON.stringify({ mode: "regexp", pattern: 42, flags: null }))).toEqual(defaultSettingsSearch());
  });

  it("persists no builder-open or sample-text state", () => {
    const serialized = serializeSettingsSearch({ mode: "plain", pattern: "accent", flags: "" });
    expect(JSON.parse(serialized)).toEqual({ mode: "plain", pattern: "accent", flags: "" });
    expect(serialized).not.toContain("sample");
    expect(serialized).not.toContain("builderOpen");
  });
});
