import { describe, expect, it } from "vitest";
import {
  CACHED_MAIL_SEARCH_MODE_STORAGE_KEY,
  cachedMailResultCountCopy,
  parseCachedMailSearchMode,
  serializeCachedMailSearchMode,
} from "../../src/renderer/lib/cached-mail-search";

describe("cached mail search renderer helpers", () => {
  it("persists only the validated plain or regex mode", () => {
    expect(CACHED_MAIL_SEARCH_MODE_STORAGE_KEY).toBe("material-email.cached-mail-search-mode.v1");
    expect(parseCachedMailSearchMode(null)).toBe("plain");
    expect(parseCachedMailSearchMode("plain")).toBe("plain");
    expect(parseCachedMailSearchMode("regex")).toBe("regex");
    expect(parseCachedMailSearchMode('{"mode":"regex","pattern":"private"}')).toBe("plain");
    expect(serializeCachedMailSearchMode("plain")).toBe("plain");
    expect(serializeCachedMailSearchMode("regex")).toBe("regex");
  });

  it("localizes singular, empty, complete, and capped result counts", () => {
    expect(cachedMailResultCountCopy(0, 0)).toEqual({
      english: "0 cached-mail results",
      cantonese: "0 個快取郵件結果",
    });
    expect(cachedMailResultCountCopy(1, 1)).toEqual({
      english: "1 cached-mail result",
      cantonese: "1 個快取郵件結果",
    });
    expect(cachedMailResultCountCopy(24, 24).english).toBe("24 cached-mail results");
    expect(cachedMailResultCountCopy(100, 2_345)).toEqual({
      english: "Showing 100 of 2,345 cached-mail results",
      cantonese: "顯示 100 / 2,345 個快取郵件結果",
    });
  });

  it("bounds malformed service counts before presenting them", () => {
    expect(cachedMailResultCountCopy(12, 3).english).toBe("3 cached-mail results");
    expect(cachedMailResultCountCopy(Number.NaN, Number.POSITIVE_INFINITY).english).toBe("0 cached-mail results");
  });
});
