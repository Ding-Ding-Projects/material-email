import { describe, expect, it } from "vitest";
import { resetAppearancePreferences } from "../src/renderer/lib/appearance";
import type { Preferences } from "../src/shared/contracts";

const preferences: Preferences = { language: "bilingual", funnyEnglish: 5, funnyCantonese: 4, theme: "dark", density: "relaxed", accent: "#123456", fontFamily: "Arial", fontScale: 1.5, fontWeight: 700, dimSumEnabled: false, narratorEnabled: true, narratorLanguage: "yue", nativeNotificationsEnabled: true, historyRetentionDays: 730, selectedAccountId: "acct", selectedFolderPath: "Inbox" };

describe("appearance reset", () => {
  it("resets only the six appearance fields", () => {
    const reset = resetAppearancePreferences(preferences);
    expect(reset).toMatchObject({ theme: "system", density: "comfortable", accent: "#6750A4", fontFamily: "Segoe UI Variable", fontScale: 1, fontWeight: 400 });
    expect(reset.language).toBe("bilingual"); expect(reset.funnyEnglish).toBe(5); expect(reset.nativeNotificationsEnabled).toBe(true); expect(reset.historyRetentionDays).toBe(730); expect(reset.selectedAccountId).toBe("acct");
  });
});
