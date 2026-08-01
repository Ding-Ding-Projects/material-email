import { normalizeFlags, regexLimits, type MatchMode } from "./regex.js";

export const TAB_DISCOVERY_SEARCH_KEYS = [
  "tabs-current",
  "tabs-group",
  "tab-groups",
  "tabs-master",
] as const;

export type TabDiscoverySearchKey = typeof TAB_DISCOVERY_SEARCH_KEYS[number];

export interface PersistedTabDiscoverySearch {
  mode: MatchMode;
  pattern: string;
  flags: string;
}

export type PersistedTabDiscoverySearches = Record<TabDiscoverySearchKey, PersistedTabDiscoverySearch>;

export const TAB_DISCOVERY_SEARCH_STORAGE_KEY = "material-email.tab-discovery-searches.v1";

export const isTabDiscoverySearchKey = (value: string): value is TabDiscoverySearchKey =>
  TAB_DISCOVERY_SEARCH_KEYS.includes(value as TabDiscoverySearchKey);

export const defaultTabDiscoverySearch = (): PersistedTabDiscoverySearch => ({
  mode: "plain",
  pattern: "",
  flags: "i",
});

export const defaultTabDiscoverySearches = (): PersistedTabDiscoverySearches => Object.fromEntries(
  TAB_DISCOVERY_SEARCH_KEYS.map(key => [key, defaultTabDiscoverySearch()]),
) as PersistedTabDiscoverySearches;

const parseEntry = (value: unknown): PersistedTabDiscoverySearch => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return defaultTabDiscoverySearch();
  const candidate = value as Record<string, unknown>;
  return {
    mode: candidate.mode === "regex" ? "regex" : "plain",
    pattern: typeof candidate.pattern === "string" ? candidate.pattern.slice(0, regexLimits.pattern) : "",
    flags: typeof candidate.flags === "string" ? normalizeFlags(candidate.flags) : "i",
  };
};

export const parseTabDiscoverySearches = (stored: string | null): PersistedTabDiscoverySearches => {
  if (!stored) return defaultTabDiscoverySearches();
  try {
    const parsed = JSON.parse(stored) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return defaultTabDiscoverySearches();
    const source = parsed as Record<string, unknown>;
    return Object.fromEntries(
      TAB_DISCOVERY_SEARCH_KEYS.map(key => [key, parseEntry(source[key])]),
    ) as PersistedTabDiscoverySearches;
  } catch {
    return defaultTabDiscoverySearches();
  }
};

export const serializeTabDiscoverySearches = (
  searches: PersistedTabDiscoverySearches,
): string => JSON.stringify(Object.fromEntries(
  TAB_DISCOVERY_SEARCH_KEYS.map(key => {
    const search = searches[key];
    return [key, {
      mode: search.mode === "regex" ? "regex" : "plain",
      pattern: search.pattern.slice(0, regexLimits.pattern),
      flags: normalizeFlags(search.flags),
    } satisfies PersistedTabDiscoverySearch];
  }),
));
