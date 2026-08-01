import { describe, expect, it } from "vitest";
import {
  BUILT_IN_TAB_APPEARANCE_PRESETS,
  TAB_APPEARANCE_THEME_FORMAT,
  TAB_APPEARANCE_THEME_VERSION,
  createUserTabAppearancePreset,
  parseTabAppearancePresetLibrary,
  parseTabAppearanceThemeText,
  serializeTabAppearanceTheme,
  validateTabAppearanceThemeDocument,
} from "../src/shared/tab-appearance-theme";

const validTheme = () => ({
  format: TAB_APPEARANCE_THEME_FORMAT,
  version: TAB_APPEARANCE_THEME_VERSION,
  name: "Calm workspace",
  tabStyles: {
    settings: { accent: "#336699", background: "#E2E8F0", foreground: "#1E293B", fontSize: 15, fontWeight: 650, radius: 12 },
  },
  presets: [{ id: "user-calm", name: "Calm inbox", style: { accent: "#336699", radius: 12 } }],
});

describe("appearance preset and theme validation", () => {
  it("ships three local named presets with complete validated tab styles", () => {
    expect(BUILT_IN_TAB_APPEARANCE_PRESETS.map(preset => preset.label.en)).toEqual([
      "Material Violet",
      "Quiet Slate",
      "High Contrast",
    ]);
    for (const preset of BUILT_IN_TAB_APPEARANCE_PRESETS) {
      expect(createUserTabAppearancePreset(`user-${preset.id}`, preset.label.yue, preset.style)).toBeDefined();
    }
  });

  it("normalizes a bounded local preset library and drops malformed or duplicate entries", () => {
    const parsed = parseTabAppearancePresetLibrary(JSON.stringify({
      version: 1,
      presets: [
        { id: "user-calm", name: "  Calm   inbox  ", style: { accent: "#336699", radius: 12 } },
        { id: "user-calm", name: "Duplicate", style: { radius: 8 } },
        { id: "user-bad", name: "Bad", style: { background: "url(https://example.test/nope)" } },
      ],
    }));
    expect(parsed).toEqual({
      version: 1,
      presets: [{ id: "user-calm", name: "Calm inbox", style: { accent: "#336699", radius: 12 } }],
    });
    expect(parseTabAppearancePresetLibrary("{broken").presets).toEqual([]);
    expect(parseTabAppearancePresetLibrary("x".repeat(128 * 1024 + 1)).presets).toEqual([]);
  });

  it("strictly rejects unknown fields, secret-shaped baggage, unknown tabs, and out-of-range values", () => {
    expect(validateTabAppearanceThemeDocument({ ...validTheme(), accountPassword: "must-not-cross" }).ok).toBe(false);
    expect(validateTabAppearanceThemeDocument({ ...validTheme(), tabStyles: { compose: { radius: 4 } } }).ok).toBe(false);
    expect(validateTabAppearanceThemeDocument({ ...validTheme(), tabStyles: { settings: { fontSize: 999 } } }).ok).toBe(false);
    expect(validateTabAppearanceThemeDocument({ ...validTheme(), presets: [{ id: "user-x", name: "X", style: { radius: 3 }, credential: "nope" }] }).ok).toBe(false);
  });

  it("round-trips only the versioned allow-listed document and normalizes local colors", () => {
    const source = serializeTabAppearanceTheme({
      ...validTheme(),
      tabStyles: { settings: { accent: "#abcdef", radius: 10 } },
    });
    expect(source).not.toContain("credential");
    expect(parseTabAppearanceThemeText(source)).toEqual({
      ok: true,
      theme: {
        ...validTheme(),
        tabStyles: { settings: { accent: "#ABCDEF", radius: 10 } },
      },
    });
    expect(parseTabAppearanceThemeText("not json")).toMatchObject({ ok: false });
  });
});
