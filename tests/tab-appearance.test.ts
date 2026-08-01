import { describe, expect, it } from "vitest";
import {
  normalizeTabPreferences,
  parseTabPreferences,
  resetTabStyleProperty,
  resolveTabStyle,
  setTabStyleProperty,
  type TabPreferences,
} from "../src/renderer/lib/tab-appearance";

type TabId = "mail" | "settings" | "history";

const tabIds: readonly TabId[] = ["mail", "settings", "history"];
const fallback = (): TabPreferences<TabId> => ({
  order: [...tabIds],
  pinned: ["mail"],
  closed: [],
  styles: {},
});

describe("per-tab appearance persistence", () => {
  it("normalizes IDs and bounded style overrides from untrusted local storage", () => {
    const normalized = normalizeTabPreferences({
      order: ["settings", "settings", "unknown"],
      pinned: ["mail", "mail", "unknown"],
      closed: ["mail", "history", "unknown"],
      styles: {
        settings: { background: " #336699 ", foreground: "not-a-color", fontSize: 400, fontWeight: 250, radius: -4 },
        history: { foreground: "#abcdef80", fontWeight: 725 },
        unknown: { background: "#000000" },
      },
    }, tabIds, fallback());

    expect(normalized.order).toEqual(["settings", "mail", "history"]);
    expect(normalized.pinned).toEqual(["mail"]);
    expect(normalized.closed).toEqual(["history"]);
    expect(normalized.styles).toEqual({
      settings: { background: "#336699", fontSize: 22, fontWeight: 300, radius: 0 },
      history: { foreground: "#ABCDEF80", fontWeight: 725 },
    });
  });

  it("falls back safely for malformed JSON without sharing mutable defaults", () => {
    const first = parseTabPreferences("{not-json", tabIds, fallback());
    first.order.reverse();
    const second = parseTabPreferences(null, tabIds, fallback());
    expect(second).toEqual(fallback());
  });

  it("stores only changed properties and resets one override without disturbing the others", () => {
    const background = setTabStyleProperty(undefined, "background", "#123456");
    const customized = setTabStyleProperty(background, "fontSize", 99);
    expect(customized).toEqual({ background: "#123456", fontSize: 22 });
    expect(setTabStyleProperty(customized, "foreground", "url(https://example.test/nope)")).toEqual(customized);

    const resetBackground = resetTabStyleProperty(customized, "background");
    expect(resetBackground).toEqual({ fontSize: 22 });
    expect(resetTabStyleProperty(resetBackground, "fontSize")).toBeUndefined();
  });

  it("resolves untouched preview properties without converting them into persisted overrides", () => {
    const overrides = { radius: 8 };
    expect(resolveTabStyle(overrides)).toEqual({
      background: "#EADDFF",
      foreground: "#21005D",
      fontSize: 14,
      fontWeight: 600,
      radius: 8,
    });
    expect(overrides).toEqual({ radius: 8 });
  });
});
