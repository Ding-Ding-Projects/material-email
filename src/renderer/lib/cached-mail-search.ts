import type { MatchMode } from "./regex";

export const CACHED_MAIL_SEARCH_MODE_STORAGE_KEY = "material-email.cached-mail-search-mode.v1";

export interface CachedMailResultCountCopy {
  english: string;
  cantonese: string;
}

export const parseCachedMailSearchMode = (stored: string | null): MatchMode => stored === "regex" ? "regex" : "plain";

export const serializeCachedMailSearchMode = (mode: MatchMode): string => mode;

const boundedCount = (value: number): number => Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;

export const cachedMailResultCountCopy = (shownValue: number, totalValue: number): CachedMailResultCountCopy => {
  const total = boundedCount(totalValue);
  const shown = Math.min(boundedCount(shownValue), total);
  const englishNumber = new Intl.NumberFormat("en-CA");
  const cantoneseNumber = new Intl.NumberFormat("zh-HK");
  const englishShown = englishNumber.format(shown);
  const englishTotal = englishNumber.format(total);
  const cantoneseShown = cantoneseNumber.format(shown);
  const cantoneseTotal = cantoneseNumber.format(total);

  if (shown < total) {
    return {
      english: `Showing ${englishShown} of ${englishTotal} cached-mail results`,
      cantonese: `顯示 ${cantoneseShown} / ${cantoneseTotal} 個快取郵件結果`,
    };
  }

  return {
    english: `${englishTotal} cached-mail result${total === 1 ? "" : "s"}`,
    cantonese: `${cantoneseTotal} 個快取郵件結果`,
  };
};
