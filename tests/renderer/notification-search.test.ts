import { describe, expect, it } from "vitest";
import { regexLimits } from "../../src/renderer/lib/regex";
import {
  NOTIFICATION_SEARCH_STORAGE_KEY,
  defaultNotificationSearch,
  parseNotificationSearch,
  serializeNotificationSearch,
} from "../../src/renderer/lib/notification-search";

describe("Notification Centre search persistence", () => {
  it("uses a literal case-insensitive default for absent or corrupt storage", () => {
    expect(NOTIFICATION_SEARCH_STORAGE_KEY).toBe("material-email.notification-search.v1");
    expect(parseNotificationSearch(null)).toEqual(defaultNotificationSearch());
    expect(parseNotificationSearch("not-json")).toEqual(defaultNotificationSearch());
  });

  it("round-trips mode, pattern, and normalized JavaScript flags", () => {
    const serialized = serializeNotificationSearch({
      mode: "regex",
      pattern: "^(Warning|Delivery)$",
      flags: "uimsmi",
    });
    expect(parseNotificationSearch(serialized)).toEqual({
      mode: "regex",
      pattern: "^(Warning|Delivery)$",
      flags: "imsu",
    });
  });

  it("bounds stored patterns and defaults unsupported field types", () => {
    const oversized = "x".repeat(regexLimits.pattern + 20);
    expect(parseNotificationSearch(JSON.stringify({ mode: "regex", pattern: oversized, flags: "igx" }))).toEqual({
      mode: "regex",
      pattern: "x".repeat(regexLimits.pattern),
      flags: "i",
    });
    expect(parseNotificationSearch(JSON.stringify({ mode: "regexp", pattern: 42, flags: null }))).toEqual(defaultNotificationSearch());
  });

  it("persists no sample, popover state, or unrelated search model", () => {
    const serialized = serializeNotificationSearch({
      mode: "plain",
      pattern: "account",
      flags: "",
      sample: "private sample",
      builderOpen: true,
      settings: { pattern: "theme" },
    } as Parameters<typeof serializeNotificationSearch>[0]);
    expect(JSON.parse(serialized)).toEqual({ mode: "plain", pattern: "account", flags: "" });
    expect(serialized).not.toContain("sample");
    expect(serialized).not.toContain("builderOpen");
    expect(serialized).not.toContain("settings");
  });
});
