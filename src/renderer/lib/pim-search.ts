import { localizedTone, type LocalizedTonePreferences, type LocalizedToneScale } from "./localization.js";
import { normalizeFlags, regexLimits, validatePattern, type MatcherOptions } from "./regex.js";

export const PIM_SEARCH_KEYS = [
  "contacts",
  "mailing-lists",
  "calendar-events",
  "tasks",
  "pim-history",
  "mailing-list-members-editor",
] as const;

export type PimSearchKey = typeof PIM_SEARCH_KEYS[number];
export type PersistedPimSearch = MatcherOptions;
export type PersistedPimSearches = Record<PimSearchKey, PersistedPimSearch>;
export type PimSearchSemanticState = "idle" | "invalid" | "matches" | "no-match";

export const PIM_SEARCH_STORAGE_KEY = "material-email.pim-searches.v1";

export const isPimSearchKey = (value: string): value is PimSearchKey =>
  PIM_SEARCH_KEYS.includes(value as PimSearchKey);

export const defaultPimSearch = (): PersistedPimSearch => ({
  mode: "plain",
  pattern: "",
  flags: "i",
});

export const defaultPimSearches = (): PersistedPimSearches => Object.fromEntries(
  PIM_SEARCH_KEYS.map(key => [key, defaultPimSearch()]),
) as PersistedPimSearches;

const parseEntry = (value: unknown): PersistedPimSearch => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return defaultPimSearch();
  const candidate = value as Record<string, unknown>;
  return {
    mode: candidate.mode === "regex" ? "regex" : "plain",
    pattern: typeof candidate.pattern === "string" ? candidate.pattern.slice(0, regexLimits.pattern) : "",
    flags: typeof candidate.flags === "string" ? normalizeFlags(candidate.flags) : "i",
  };
};

export const parsePimSearches = (stored: string | null): PersistedPimSearches => {
  if (!stored) return defaultPimSearches();
  try {
    const parsed = JSON.parse(stored) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return defaultPimSearches();
    const source = parsed as Record<string, unknown>;
    return Object.fromEntries(PIM_SEARCH_KEYS.map(key => [key, parseEntry(source[key])])) as PersistedPimSearches;
  } catch {
    return defaultPimSearches();
  }
};

export const serializePimSearches = (searches: PersistedPimSearches): string => JSON.stringify(
  Object.fromEntries(PIM_SEARCH_KEYS.map(key => {
    const search = searches[key];
    return [key, {
      mode: search.mode === "regex" ? "regex" : "plain",
      pattern: search.pattern.slice(0, regexLimits.pattern),
      flags: normalizeFlags(search.flags),
    } satisfies PersistedPimSearch];
  })),
);

export const classifyPimSearch = (
  search: MatcherOptions,
  matchingCount: number,
): PimSearchSemanticState => {
  if (!search.pattern) return "idle";
  if (search.mode === "regex" && !validatePattern(search).valid) return "invalid";
  return matchingCount > 0 ? "matches" : "no-match";
};

const SEARCH_SCOPE_COPY: Record<PimSearchKey, {
  singular: string;
  plural: string;
  cantonese: string;
  noMatchEnglish: string;
  noMatchCantonese: string;
}> = {
  contacts: {
    singular: "contact",
    plural: "contacts",
    cantonese: "聯絡人",
    noMatchEnglish: "No contact name, email, phone, organization, or notes matched.",
    noMatchCantonese: "聯絡人名稱、電郵、電話、機構同備註都冇配對。",
  },
  "mailing-lists": {
    singular: "mailing list",
    plural: "mailing lists",
    cantonese: "郵件群組",
    noMatchEnglish: "No mailing-list name, nickname, description, or member identifier matched.",
    noMatchCantonese: "郵件群組名稱、暱稱、描述同成員識別碼都冇配對。",
  },
  "calendar-events": {
    singular: "event",
    plural: "events",
    cantonese: "事件",
    noMatchEnglish: "No event title, location, description, status, or category matched.",
    noMatchCantonese: "事件標題、地點、描述、狀態同類別都冇配對。",
  },
  tasks: {
    singular: "task",
    plural: "tasks",
    cantonese: "工作",
    noMatchEnglish: "No task title, description, status, priority, or category matched.",
    noMatchCantonese: "工作標題、描述、狀態、優先次序同類別都冇配對。",
  },
  "pim-history": {
    singular: "transaction",
    plural: "transactions",
    cantonese: "交易",
    noMatchEnglish: "No action, record type, name, or stable identifier matched in the current filter scope.",
    noMatchCantonese: "目前篩選範圍內嘅操作、記錄類型、名稱同穩定識別碼都冇配對。",
  },
  "mailing-list-members-editor": {
    singular: "available contact",
    plural: "available contacts",
    cantonese: "可選聯絡人",
    noMatchEnglish: "No available contact name, email, phone, organization, or notes matched.",
    noMatchCantonese: "可選聯絡人名稱、電郵、電話、機構同備註都冇配對。",
  },
};

const boundedCount = (value: number): number => Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;

export const pimSearchStatusToneScale = (
  key: PimSearchKey,
  matchingCount: number,
  totalCount: number,
): LocalizedToneScale => {
  const matching = boundedCount(matchingCount);
  const total = boundedCount(totalCount);
  const scope = SEARCH_SCOPE_COPY[key];
  const englishFacts = `Showing ${matching} of ${total} ${total === 1 ? scope.singular : scope.plural}.`;
  const cantoneseFacts = `顯示 ${total} 個${scope.cantonese}入面嘅 ${matching} 個。`;
  return {
    english: [
      englishFacts,
      `${englishFacts} This local search changes no PIM records.`,
      `${englishFacts} The local filter leaves every PIM record unchanged.`,
      `${englishFacts} The local search has sorted the cards without moving any records.`,
      `${englishFacts} The tiny local search sieve has finished; every PIM record stayed put.`,
    ],
    cantonese: [
      cantoneseFacts,
      `${cantoneseFacts} 呢個本機搜尋唔會更改任何 PIM 記錄。`,
      `${cantoneseFacts} 本機篩選完成，所有 PIM 記錄保持不變。`,
      `${cantoneseFacts} 本機搜尋執好卡片，冇搬走任何記錄。`,
      `${cantoneseFacts} 迷你本機搜尋篩仔收工，所有 PIM 記錄都企定定。`,
    ],
  };
};

export const localizedPimSearchStatus = (
  key: PimSearchKey,
  matchingCount: number,
  totalCount: number,
  preferences: LocalizedTonePreferences,
  combineBilingual?: (english: string, cantonese: string) => string,
): string => localizedTone(preferences, pimSearchStatusToneScale(key, matchingCount, totalCount), combineBilingual);

export const pimSearchNoMatchToneScale = (key: PimSearchKey): LocalizedToneScale => {
  const scope = SEARCH_SCOPE_COPY[key];
  return {
    english: [
      `${scope.noMatchEnglish} Edit or clear this local search.`,
      `${scope.noMatchEnglish} Edit or clear this local search and try again.`,
      `${scope.noMatchEnglish} Adjust the local search and the records will step back into view.`,
      `${scope.noMatchEnglish} Tune the local search—the records have not wandered off.`,
      `${scope.noMatchEnglish} Tune the local search; the records are backstage, not on holiday.`,
    ],
    cantonese: [
      `${scope.noMatchCantonese} 請修改或者清除呢個本機搜尋。`,
      `${scope.noMatchCantonese} 修改或者清除呢個本機搜尋再試。`,
      `${scope.noMatchCantonese} 調整本機搜尋，啲記錄就會再行返出嚟。`,
      `${scope.noMatchCantonese} 調校一下本機搜尋——啲記錄冇走失。`,
      `${scope.noMatchCantonese} 調校一下本機搜尋；啲記錄只係喺後台，未去放假。`,
    ],
  };
};

export const localizedPimSearchNoMatch = (
  key: PimSearchKey,
  preferences: LocalizedTonePreferences,
  combineBilingual?: (english: string, cantonese: string) => string,
): string => localizedTone(preferences, pimSearchNoMatchToneScale(key), combineBilingual);
