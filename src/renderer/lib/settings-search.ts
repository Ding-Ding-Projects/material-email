import { normalizeFlags, regexLimits, type MatchMode } from "./regex.js";

export interface PersistedSettingsSearch {
  mode: MatchMode;
  pattern: string;
  flags: string;
}

export const SETTINGS_SEARCH_STORAGE_KEY = "material-email.settings-search.v1";

export const defaultSettingsSearch = (): PersistedSettingsSearch => ({
  mode: "plain",
  pattern: "",
  flags: "i",
});

export const parseSettingsSearch = (stored: string | null): PersistedSettingsSearch => {
  if (!stored) return defaultSettingsSearch();
  try {
    const parsed = JSON.parse(stored) as Record<string, unknown>;
    return {
      mode: parsed.mode === "regex" ? "regex" : "plain",
      pattern: typeof parsed.pattern === "string" ? parsed.pattern.slice(0, regexLimits.pattern) : "",
      flags: typeof parsed.flags === "string" ? normalizeFlags(parsed.flags) : "i",
    };
  } catch {
    return defaultSettingsSearch();
  }
};

export const serializeSettingsSearch = (search: PersistedSettingsSearch): string => JSON.stringify({
  mode: search.mode === "regex" ? "regex" : "plain",
  pattern: search.pattern.slice(0, regexLimits.pattern),
  flags: normalizeFlags(search.flags),
} satisfies PersistedSettingsSearch);
