import { describe, expect, it } from "vitest";
import {
  SURFACE_TONE_COPY,
  localizedNotificationAction,
  localizedNotificationCategory,
  localizedNotificationKind,
  localizedNotificationSearchStatus,
  localizedQueueRecoveryAction,
  localizedSurfaceTone,
  localizedTone,
  localizedWindowControl,
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
    expect(localizedSurfaceTone("settingsNoMatch", {
      language: "bilingual",
      funnyEnglish: 1,
      funnyCantonese: 5,
    })).toBe(`${SURFACE_TONE_COPY.settingsNoMatch.english[0]} · ${SURFACE_TONE_COPY.settingsNoMatch.cantonese[4]}`);
    expect(localizedSurfaceTone("tabDiscoveryNoMatch", {
      language: "bilingual",
      funnyEnglish: 1,
      funnyCantonese: 5,
    })).toBe(`${SURFACE_TONE_COPY.tabDiscoveryNoMatch.english[0]} · ${SURFACE_TONE_COPY.tabDiscoveryNoMatch.cantonese[4]}`);
    expect(localizedSurfaceTone("notificationNoMatch", {
      language: "bilingual",
      funnyEnglish: 1,
      funnyCantonese: 5,
    })).toBe(`${SURFACE_TONE_COPY.notificationNoMatch.english[0]} · ${SURFACE_TONE_COPY.notificationNoMatch.cantonese[4]}`);
  });

  it("keeps Notification Centre counts factual while styling each language independently", () => {
    const serious = localizedNotificationSearchStatus(1, 3, 1, {
      language: "en",
      funnyEnglish: 1,
      funnyCantonese: 5,
    });
    expect(serious).toBe("Showing 1 of 3 notifications. 1 matching notification is unread.");

    const bilingual = localizedNotificationSearchStatus(2, 3, 0, {
      language: "bilingual",
      funnyEnglish: 1,
      funnyCantonese: 5,
    });
    expect(bilingual).toContain("Showing 2 of 3 notifications. 0 matching notifications are unread.");
    expect(bilingual).toContain("顯示 3 個通知入面嘅 2 個；其中 0 個符合通知未讀。");
    expect(bilingual).not.toContain("tiny paperwork");
    expect(bilingual).toContain("迷你文書");
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

  it("localizes every notification category and supported action without changing its target", () => {
    expect(localizedNotificationCategory("delivery", { language: "en" })).toBe("Delivery");
    expect(localizedNotificationCategory("security", { language: "yue" })).toBe("安全");
    expect(localizedNotificationCategory("history", { language: "bilingual" })).toBe("History · 歷史");

    const retry = { kind: "retry", target: "pending-operation", accountId: "account-1", operationId: "operation-1" } as const;
    const undo = { kind: "undo", target: "settings-revision", historyId: "history-1" } as const;
    const open = { kind: "open", target: "page", page: "settings" } as const;
    expect(localizedNotificationAction(retry, { language: "en" })).toBe("Retry queued change");
    expect(localizedNotificationAction(undo, { language: "yue" })).toBe("撤銷還原");
    expect(localizedNotificationAction(open, { language: "bilingual" })).toBe("Open Settings · 開啟設定");
    expect(retry).toEqual({ kind: "retry", target: "pending-operation", accountId: "account-1", operationId: "operation-1" });
  });

  it("keeps every window-control action explicit while applying independent humor levels", () => {
    for (const action of ["minimize", "maximize", "restore", "close"] as const) {
      const english = localizedWindowControl(action, { language: "en", funnyEnglish: 5, funnyCantonese: 1 });
      const cantonese = localizedWindowControl(action, { language: "yue", funnyEnglish: 1, funnyCantonese: 5 });
      expect(english.toLowerCase()).toContain(action);
      expect(cantonese).not.toBe("");
    }
    expect(localizedWindowControl("close", {
      language: "bilingual",
      funnyEnglish: 1,
      funnyCantonese: 5,
    })).toBe("Close window · 關閉視窗——未完成更改要先見迷你寫字板督察");
  });

  it("keeps queued-mail recovery actions factual while applying independent humor levels", () => {
    for (const action of ["retry", "undo", "open-history"] as const) {
      const english = localizedQueueRecoveryAction(action, { language: "en", funnyEnglish: 5, funnyCantonese: 1 });
      const cantonese = localizedQueueRecoveryAction(action, { language: "yue", funnyEnglish: 1, funnyCantonese: 5 });
      expect(english).not.toBe("");
      expect(cantonese).not.toBe("");
    }
    expect(localizedQueueRecoveryAction("retry", {
      language: "bilingual",
      funnyEnglish: 1,
      funnyCantonese: 5,
    })).toBe("Retry once · 重試一次——只撳一下迷你伺服器門鐘");
    expect(localizedQueueRecoveryAction("undo", {
      language: "en",
      funnyEnglish: 1,
      funnyCantonese: 5,
    })).toContain("Undo queued send");
    expect(localizedQueueRecoveryAction("open-history", {
      language: "yue",
      funnyEnglish: 5,
      funnyCantonese: 1,
    })).toBe("開啟傳送歷史");
  });
});
