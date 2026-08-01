import { describe, expect, it } from "vitest";
import {
  SURFACE_TONE_COPY,
  localizedNotificationKind,
  localizedSurfaceTone,
  localizedTone,
  notificationToastToneScale,
  selectToneVariant,
} from "../../src/renderer/lib/localization";

describe("renderer language and humor selection", () => {
  it("selects every authored level for every focused surface in both languages", () => {
    for (const [surface, scale] of Object.entries(SURFACE_TONE_COPY)) {
      for (const funnyLevel of [1, 2, 3, 4, 5] as const) {
        expect(localizedSurfaceTone(surface as keyof typeof SURFACE_TONE_COPY, {
          language: "en",
          funnyEnglish: funnyLevel,
          funnyCantonese: 1,
        })).toBe(scale.english[funnyLevel - 1]);
        expect(localizedSurfaceTone(surface as keyof typeof SURFACE_TONE_COPY, {
          language: "yue",
          funnyEnglish: 1,
          funnyCantonese: funnyLevel,
        })).toBe(scale.cantonese[funnyLevel - 1]);
      }
    }
  });

  it.each([
    ["en", 1, 5, SURFACE_TONE_COPY.appearance.english[0]],
    ["en", 5, 1, SURFACE_TONE_COPY.appearance.english[4]],
    ["yue", 5, 1, SURFACE_TONE_COPY.appearance.cantonese[0]],
    ["yue", 1, 5, SURFACE_TONE_COPY.appearance.cantonese[4]],
  ] as const)("uses only the active language level in %s mode at English %i and Cantonese %i", (language, funnyEnglish, funnyCantonese, expected) => {
    expect(localizedSurfaceTone("appearance", { language, funnyEnglish, funnyCantonese })).toBe(expected);
  });

  it("combines independently selected levels in bilingual mode", () => {
    expect(localizedSurfaceTone("historyDatePicker", {
      language: "bilingual",
      funnyEnglish: 1,
      funnyCantonese: 5,
    })).toBe(`${SURFACE_TONE_COPY.historyDatePicker.english[0]} · ${SURFACE_TONE_COPY.historyDatePicker.cantonese[4]}`);
    expect(localizedSurfaceTone("notifications", {
      language: "bilingual",
      funnyEnglish: 5,
      funnyCantonese: 1,
    })).toBe(`${SURFACE_TONE_COPY.notifications.english[4]} · ${SURFACE_TONE_COPY.notifications.cantonese[0]}`);
  });

  it("falls back to the nearest lower level and then the other language instead of rendering blank copy", () => {
    expect(selectToneVariant(["serious", undefined, "medium"], 5)).toBe("medium");
    expect(localizedTone(
      { language: "yue", funnyEnglish: 5, funnyCantonese: 5 },
      { english: ["English fallback"], cantonese: [] },
    )).toBe("English fallback");
    expect(localizedTone(
      { language: "en", funnyEnglish: Number.NaN as 1, funnyCantonese: 1 },
      { english: ["Safe default", "Second"], cantonese: ["安全預設"] },
    )).toBe("Safe default");
  });

  it("keeps toast facts while each language receives its own selected voice", () => {
    const scale = notificationToastToneScale("Nothing was deleted.", "冇刪除任何資料。");
    const copy = localizedTone({ language: "bilingual", funnyEnglish: 1, funnyCantonese: 5 }, scale);
    expect(copy).toContain("Nothing was deleted.");
    expect(copy).toContain("冇刪除任何資料。");
    expect(copy).not.toContain("tiny stage exit");
    expect(copy).toContain("迷你謝幕禮");
  });

  it.each([
    ["en", "Warning"],
    ["yue", "警告"],
    ["bilingual", "Warning · 警告"],
  ] as const)("localizes notification kind labels in %s mode", (language, expected) => {
    expect(localizedNotificationKind("warning", { language })).toBe(expected);
  });
});
