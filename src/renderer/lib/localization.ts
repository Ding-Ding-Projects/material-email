import type { NotificationAction, NotificationCategory, Preferences } from "../../shared/contracts";

export type LocalizedTonePreferences = Pick<Preferences, "language" | "funnyEnglish" | "funnyCantonese">;
export type ToneScale = readonly (string | null | undefined)[];
export type WindowControlAction = "minimize" | "maximize" | "restore" | "close";

export interface LocalizedToneScale {
  english: ToneScale;
  cantonese: ToneScale;
}

const normalizeFunnyLevel = (value: unknown): number => {
  const numeric = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : 1;
  return Math.min(5, Math.max(1, numeric));
};

export const selectToneVariant = (scale: ToneScale, funnyLevel: unknown): string | undefined => {
  const requestedIndex = normalizeFunnyLevel(funnyLevel) - 1;
  for (let index = requestedIndex; index >= 0; index -= 1) {
    const candidate = scale[index];
    if (typeof candidate === "string" && candidate.trim()) return candidate;
  }
  for (let index = requestedIndex + 1; index < scale.length; index += 1) {
    const candidate = scale[index];
    if (typeof candidate === "string" && candidate.trim()) return candidate;
  }
  return undefined;
};

export const localizedTone = (
  preferences: LocalizedTonePreferences,
  scale: LocalizedToneScale,
  combineBilingual: (english: string, cantonese: string) => string = (english, cantonese) => `${english} · ${cantonese}`,
): string => {
  const english = selectToneVariant(scale.english, preferences.funnyEnglish)
    ?? selectToneVariant(scale.cantonese, preferences.funnyCantonese)
    ?? "";
  const cantonese = selectToneVariant(scale.cantonese, preferences.funnyCantonese)
    ?? selectToneVariant(scale.english, preferences.funnyEnglish)
    ?? "";
  if (preferences.language === "yue") return cantonese;
  if (preferences.language === "bilingual") return combineBilingual(english, cantonese);
  return english;
};

export const SURFACE_TONE_COPY = {
  appearance: {
    english: [
      "Changes preview immediately and remain local to this tab.",
      "Changes preview immediately and remain local to this tab, ready for a quick check.",
      "Changes preview immediately and remain local to this tab; try the look before it settles in.",
      "Changes preview immediately and remain local to this tab, so one tab can change jackets without dressing the whole app.",
      "Changes preview immediately and remain local to this tab; it gets a fitting room, not a full-app costume parade.",
    ],
    cantonese: [
      "改動會即時預覽，而且只會留喺呢個分頁。",
      "改動會即時預覽，而且只會留喺呢個分頁，方便你即刻核對。",
      "改動會即時預覽，而且只會留喺呢個分頁，可以先試清楚先收貨。",
      "改動會即時預覽，而且只會留喺呢個分頁；一個分頁換件衫，唔使成個 App 陪跑。",
      "改動會即時預覽，而且只會留喺呢個分頁；佢有自己試身室，唔會拉成個 App 去扮花車。",
    ],
  },
  historyDatePicker: {
    english: [
      "Typing or choosing dates updates the local History filter; it does not export or delete anything.",
      "Typing or choosing dates updates the local History filter, so you can check the range before doing anything else; it does not export or delete anything.",
      "Typing or choosing dates updates the local History filter; the records stay put while the calendar sorts them, and nothing is exported or deleted.",
      "Typing or choosing dates updates the local History filter; the calendar sorts the paperwork without touching export or the shredder.",
      "Typing or choosing dates updates the local History filter; the calendar is holding a highlighter, not driving a tiny export truck or shredder.",
    ],
    cantonese: [
      "輸入或者選擇日期只會更新本機 History 篩選；唔會匯出或者刪除任何資料。",
      "輸入或者選擇日期只會更新本機 History 篩選，方便你先核對範圍；唔會匯出或者刪除任何資料。",
      "輸入或者選擇日期只會更新本機 History 篩選；日曆負責分類，記錄留喺原位，唔會匯出或者刪除。",
      "輸入或者選擇日期只會更新本機 History 篩選；日曆只係整理文件，冇掂匯出掣同碎紙機。",
      "輸入或者選擇日期只會更新本機 History 篩選；日曆手上係螢光筆，唔係迷你匯出貨車或者碎紙機。",
    ],
  },
  changelogDatePicker: {
    english: [
      "Typing or choosing dates updates the local Changelog filter; it does not copy or export anything.",
      "Typing or choosing dates updates the local Changelog filter, so you can check the range first; it does not copy or export anything.",
      "Typing or choosing dates updates the local Changelog filter; the releases stay put while the calendar sorts them, and nothing is copied or exported.",
      "Typing or choosing dates updates the local Changelog filter; the calendar sorts the release shelf without packing an export box.",
      "Typing or choosing dates updates the local Changelog filter; the calendar is a librarian, not a tiny copy-and-export forklift.",
    ],
    cantonese: [
      "輸入或者選擇日期只會更新本機 Changelog 篩選；唔會複製或者匯出任何資料。",
      "輸入或者選擇日期只會更新本機 Changelog 篩選，方便你先核對範圍；唔會複製或者匯出任何資料。",
      "輸入或者選擇日期只會更新本機 Changelog 篩選；版本留喺原位，日曆只負責分類，唔會複製或者匯出。",
      "輸入或者選擇日期只會更新本機 Changelog 篩選；日曆只係執版本架，冇開始摺匯出紙箱。",
      "輸入或者選擇日期只會更新本機 Changelog 篩選；日曆係圖書管理員，唔係迷你複製匯出剷車。",
    ],
  },
  notifications: {
    english: [
      "Stored app notifications remain reviewable after their corner toasts disappear.",
      "Stored app notifications remain reviewable after their corner toasts disappear, so you can check them later.",
      "Stored app notifications remain reviewable; the toast leaves, but the record stays.",
      "Stored app notifications remain reviewable; the toast exits, but the notification centre keeps the receipt.",
      "Stored app notifications remain reviewable; the toast makes a tiny stage exit while the notification centre keeps every receipt.",
    ],
    cantonese: [
      "角落提示消失之後，已儲存嘅 App 通知仍然可以翻查。",
      "角落提示消失之後，已儲存嘅 App 通知仍然可以翻查，方便你遲啲再睇。",
      "已儲存嘅 App 通知仍然可以翻查；角落提示走咗，記錄仲喺度。",
      "已儲存嘅 App 通知仍然可以翻查；角落提示退場，通知中心繼續keep住張收據。",
      "已儲存嘅 App 通知仍然可以翻查；角落提示行個迷你謝幕禮，通知中心就一張收據都唔漏。",
    ],
  },
} as const satisfies Record<string, LocalizedToneScale>;

export type SurfaceTone = keyof typeof SURFACE_TONE_COPY;

export const localizedSurfaceTone = (
  surface: SurfaceTone,
  preferences: LocalizedTonePreferences,
  combineBilingual?: (english: string, cantonese: string) => string,
): string => localizedTone(preferences, SURFACE_TONE_COPY[surface], combineBilingual);

const WINDOW_CONTROL_COPY = {
  minimize: {
    english: [
      "Minimize window",
      "Minimize window to the taskbar",
      "Minimize window — keep it handy on the taskbar",
      "Minimize window — tuck it onto the taskbar",
      "Minimize window — send it for a tiny taskbar nap",
    ],
    cantonese: [
      "最小化視窗",
      "最小化視窗去工作列",
      "最小化視窗——放喺工作列隨時再開",
      "最小化視窗——暫時塞佢入工作列",
      "最小化視窗——送佢去工作列瞓個迷你晏覺",
    ],
  },
  maximize: {
    english: [
      "Maximize window",
      "Maximize window to fill the screen",
      "Maximize window — use the available screen",
      "Maximize window — give the workspace more elbow room",
      "Maximize window — let the workspace stretch its tiny elbows",
    ],
    cantonese: [
      "最大化視窗",
      "最大化視窗填滿畫面",
      "最大化視窗——用盡可用畫面",
      "最大化視窗——畀工作空間鬆動多啲",
      "最大化視窗——畀工作空間伸盡佢對迷你手踭",
    ],
  },
  restore: {
    english: [
      "Restore window",
      "Restore window to its saved size",
      "Restore window — return to the saved size",
      "Restore window — bring back its previous fit",
      "Restore window — put its made-to-measure outfit back on",
    ],
    cantonese: [
      "還原視窗",
      "還原視窗去已儲存大小",
      "還原視窗——返回已儲存大小",
      "還原視窗——著返之前嗰個尺寸",
      "還原視窗——著返件度身訂造視窗衫",
    ],
  },
  close: {
    english: [
      "Close window",
      "Close window; unsaved work will be reviewed first",
      "Close window — unsaved work gets a review first",
      "Close window — unfinished edits stop for inspection first",
      "Close window — unfinished edits face the tiny clipboard inspector first",
    ],
    cantonese: [
      "關閉視窗",
      "關閉視窗；未儲存內容會先畀你審閱",
      "關閉視窗——未儲存內容會先停低審閱",
      "關閉視窗——未完成更改要先過檢查站",
      "關閉視窗——未完成更改要先見迷你寫字板督察",
    ],
  },
} as const satisfies Record<WindowControlAction, LocalizedToneScale>;

export const localizedWindowControl = (
  action: WindowControlAction,
  preferences: LocalizedTonePreferences,
  combineBilingual?: (english: string, cantonese: string) => string,
): string => localizedTone(preferences, WINDOW_CONTROL_COPY[action], combineBilingual);

export const notificationToastToneScale = (englishBody: string, cantoneseBody: string): LocalizedToneScale => ({
  english: [
    englishBody,
    `${englishBody} You can review it later in Notifications.`,
    `${englishBody} The toast can leave; Notifications keeps the record.`,
    `${englishBody} The toast can clock out; Notifications keeps the receipt.`,
    `${englishBody} The toast can make a tiny stage exit; Notifications keeps the receipt without demanding an encore.`,
  ],
  cantonese: [
    cantoneseBody,
    `${cantoneseBody} 之後可以喺通知中心翻查。`,
    `${cantoneseBody} 角落提示可以走先，通知中心會留低記錄。`,
    `${cantoneseBody} 角落提示可以收工，通知中心會keep住張收據。`,
    `${cantoneseBody} 角落提示可以行個迷你謝幕禮，通知中心會keep住張收據，唔使嗌encore。`,
  ],
});

const NOTIFICATION_KIND_COPY = {
  info: { english: "Information", cantonese: "資訊" },
  success: { english: "Success", cantonese: "成功" },
  warning: { english: "Warning", cantonese: "警告" },
  error: { english: "Error", cantonese: "錯誤" },
} as const;

export const localizedNotificationKind = (
  kind: keyof typeof NOTIFICATION_KIND_COPY,
  preferences: Pick<Preferences, "language">,
  combineBilingual: (english: string, cantonese: string) => string = (english, cantonese) => `${english} · ${cantonese}`,
): string => {
  const copy = NOTIFICATION_KIND_COPY[kind];
  if (preferences.language === "yue") return copy.cantonese;
  if (preferences.language === "bilingual") return combineBilingual(copy.english, copy.cantonese);
  return copy.english;
};

const NOTIFICATION_CATEGORY_COPY: Record<NotificationCategory, { english: string; cantonese: string }> = {
  account: { english: "Account", cantonese: "帳戶" },
  mail: { english: "Mail", cantonese: "郵件" },
  delivery: { english: "Delivery", cantonese: "傳送" },
  security: { english: "Security", cantonese: "安全" },
  history: { english: "History", cantonese: "歷史" },
  system: { english: "App", cantonese: "應用程式" },
};

const localizedPair = (
  copy: { english: string; cantonese: string },
  preferences: Pick<Preferences, "language">,
  combineBilingual: (english: string, cantonese: string) => string,
): string => preferences.language === "yue"
  ? copy.cantonese
  : preferences.language === "bilingual"
    ? combineBilingual(copy.english, copy.cantonese)
    : copy.english;

export const localizedNotificationCategory = (
  category: NotificationCategory,
  preferences: Pick<Preferences, "language">,
  combineBilingual: (english: string, cantonese: string) => string = (english, cantonese) => `${english} · ${cantonese}`,
): string => localizedPair(NOTIFICATION_CATEGORY_COPY[category], preferences, combineBilingual);

export const localizedNotificationAction = (
  action: NotificationAction,
  preferences: Pick<Preferences, "language">,
  combineBilingual: (english: string, cantonese: string) => string = (english, cantonese) => `${english} · ${cantonese}`,
): string => {
  let copy: { english: string; cantonese: string };
  if (action.kind === "undo") copy = { english: "Undo restore", cantonese: "撤銷還原" };
  else if (action.kind === "retry" && action.target === "sync") copy = { english: "Retry synchronization", cantonese: "重試同步" };
  else if (action.kind === "retry" && action.target === "pending-operation") copy = { english: "Retry queued change", cantonese: "重試排隊更改" };
  else if (action.kind === "retry") copy = { english: "Retry delivery", cantonese: "重試傳送" };
  else if (action.target === "draft") copy = { english: "Open draft", cantonese: "開啟草稿" };
  else {
    copy = {
      mail: { english: "Open Mail", cantonese: "開啟郵件" },
      drafts: { english: "Open Drafts", cantonese: "開啟草稿" },
      outbox: { english: "Open Outbox", cantonese: "開啟寄件匣" },
      settings: { english: "Open Settings", cantonese: "開啟設定" },
      history: { english: "Open History", cantonese: "開啟歷史" },
      tools: { english: "Open Tools", cantonese: "開啟工具" },
    }[action.page];
  }
  return localizedPair(copy, preferences, combineBilingual);
};
