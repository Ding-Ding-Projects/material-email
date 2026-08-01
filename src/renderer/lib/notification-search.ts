import { normalizeFlags, regexLimits, type MatchMode } from "./regex.js";

export interface PersistedNotificationSearch {
  mode: MatchMode;
  pattern: string;
  flags: string;
}

export const NOTIFICATION_SEARCH_STORAGE_KEY = "material-email.notification-search.v1";

export const defaultNotificationSearch = (): PersistedNotificationSearch => ({
  mode: "plain",
  pattern: "",
  flags: "i",
});

export const parseNotificationSearch = (stored: string | null): PersistedNotificationSearch => {
  if (!stored) return defaultNotificationSearch();
  try {
    const parsed = JSON.parse(stored) as Record<string, unknown>;
    return {
      mode: parsed.mode === "regex" ? "regex" : "plain",
      pattern: typeof parsed.pattern === "string" ? parsed.pattern.slice(0, regexLimits.pattern) : "",
      flags: typeof parsed.flags === "string" ? normalizeFlags(parsed.flags) : "i",
    };
  } catch {
    return defaultNotificationSearch();
  }
};

export const serializeNotificationSearch = (search: PersistedNotificationSearch): string => JSON.stringify({
  mode: search.mode === "regex" ? "regex" : "plain",
  pattern: search.pattern.slice(0, regexLimits.pattern),
  flags: normalizeFlags(search.flags),
} satisfies PersistedNotificationSearch);
