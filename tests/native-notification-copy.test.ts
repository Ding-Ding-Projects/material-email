import { describe, expect, it } from "vitest";
import { nativeNotificationCopy } from "../src/main/native-notification-copy";

describe("native notification copy", () => {
  it("keeps English factual at serious level", () => expect(nativeNotificationCopy("error", { language: "en", funnyEnglish: 1, funnyCantonese: 5 })).toBe("An email task needs your attention."));
  it("uses Cantonese and its independent funny level", () => expect(nativeNotificationCopy("success", { language: "yue", funnyEnglish: 1, funnyCantonese: 5 })).toContain("挑咗下眉"));
  it("serializes bilingual copy without private details", () => {
    const copy = nativeNotificationCopy("warning", { language: "bilingual", funnyEnglish: 5, funnyCantonese: 5 });
    expect(copy).toContain("An email task needs review."); expect(copy).toContain("有封郵件工作要你覆核。"); expect(copy).not.toMatch(/@|subject|recipient/iu);
  });
});
