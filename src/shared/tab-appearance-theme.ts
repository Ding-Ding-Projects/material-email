export const TAB_APPEARANCE_THEME_FORMAT = "material-email-tab-appearance-theme" as const;
export const TAB_APPEARANCE_THEME_VERSION = 1 as const;
export const TAB_APPEARANCE_THEME_MAX_BYTES = 256 * 1024;
export const TAB_APPEARANCE_PRESET_LIBRARY_MAX_BYTES = 128 * 1024;
export const TAB_APPEARANCE_PRESET_LIMIT = 24;
export const TAB_APPEARANCE_PRESET_NAME_LIMIT = 48;
export const TAB_APPEARANCE_THEME_NAME_LIMIT = 80;

export const TAB_APPEARANCE_THEME_TAB_IDS = [
  "mail",
  "drafts",
  "outbox",
  "contacts",
  "calendar",
  "tasks",
  "settings",
  "changelog",
  "history",
  "notifications",
  "tools",
] as const;

export type TabAppearanceThemeTabId = (typeof TAB_APPEARANCE_THEME_TAB_IDS)[number];

export interface TabAppearanceThemeStyle {
  accent?: string;
  background?: string;
  foreground?: string;
  fontSize?: number;
  fontWeight?: number;
  radius?: number;
}

export interface UserTabAppearancePreset {
  id: string;
  name: string;
  style: TabAppearanceThemeStyle;
}

export interface TabAppearancePresetLibrary {
  version: typeof TAB_APPEARANCE_THEME_VERSION;
  presets: UserTabAppearancePreset[];
}

export interface TabAppearanceThemeDocument {
  format: typeof TAB_APPEARANCE_THEME_FORMAT;
  version: typeof TAB_APPEARANCE_THEME_VERSION;
  name: string;
  tabStyles: Partial<Record<TabAppearanceThemeTabId, TabAppearanceThemeStyle>>;
  presets: UserTabAppearancePreset[];
}

export interface BuiltInTabAppearancePreset {
  id: string;
  label: { en: string; yue: string };
  style: Required<TabAppearanceThemeStyle>;
}

export const BUILT_IN_TAB_APPEARANCE_PRESETS: readonly BuiltInTabAppearancePreset[] = [
  {
    id: "material-violet",
    label: { en: "Material Violet", yue: "Material 紫" },
    style: { accent: "#6750A4", background: "#EADDFF", foreground: "#21005D", fontSize: 14, fontWeight: 600, radius: 18 },
  },
  {
    id: "quiet-slate",
    label: { en: "Quiet Slate", yue: "靜靜灰" },
    style: { accent: "#475569", background: "#E2E8F0", foreground: "#1E293B", fontSize: 14, fontWeight: 600, radius: 12 },
  },
  {
    id: "high-contrast",
    label: { en: "High Contrast", yue: "高對比" },
    style: { accent: "#FFD600", background: "#000000", foreground: "#FFFFFF", fontSize: 15, fontWeight: 700, radius: 4 },
  },
] as const;

type ThemeValidationFailure = { ok: false; reason: string };
export type TabAppearanceThemeValidation = { ok: true; theme: TabAppearanceThemeDocument } | ThemeValidationFailure;

const COLOR_PATTERN = /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/iu;
const PRESET_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/iu;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u;
const STYLE_KEYS = new Set(["accent", "background", "foreground", "fontSize", "fontWeight", "radius"]);
const THEME_KEYS = new Set(["format", "version", "name", "tabStyles", "presets"]);
const PRESET_KEYS = new Set(["id", "name", "style"]);
const validTabIds = new Set<string>(TAB_APPEARANCE_THEME_TAB_IDS);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasOnlyKeys = (value: Record<string, unknown>, keys: ReadonlySet<string>): boolean =>
  Object.keys(value).every(key => keys.has(key));

const normalizedName = (value: unknown, maximum: number): string | undefined => {
  if (typeof value !== "string" || CONTROL_CHARACTER_PATTERN.test(value)) return undefined;
  const name = value.normalize("NFC").trim().replace(/\s+/gu, " ");
  return name && name.length <= maximum ? name : undefined;
};

const normalizedColor = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const color = value.trim().toUpperCase();
  return COLOR_PATTERN.test(color) ? color : undefined;
};

const exactNumber = (value: unknown, minimum: number, maximum: number): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum ? value : undefined;

export const validateTabAppearanceThemeStyle = (value: unknown): TabAppearanceThemeStyle | undefined => {
  if (!isRecord(value) || !hasOnlyKeys(value, STYLE_KEYS)) return undefined;
  const style: TabAppearanceThemeStyle = {};
  for (const key of Object.keys(value)) {
    if (key === "accent" || key === "background" || key === "foreground") {
      const color = normalizedColor(value[key]);
      if (!color) return undefined;
      style[key] = color;
    } else if (key === "fontSize") {
      const number = exactNumber(value[key], 11, 22);
      if (number === undefined) return undefined;
      style.fontSize = number;
    } else if (key === "fontWeight") {
      const number = exactNumber(value[key], 300, 800);
      if (number === undefined) return undefined;
      style.fontWeight = number;
    } else if (key === "radius") {
      const number = exactNumber(value[key], 0, 28);
      if (number === undefined) return undefined;
      style.radius = number;
    }
  }
  return Object.keys(style).length ? style : undefined;
};

const normalizePreset = (value: unknown): UserTabAppearancePreset | undefined => {
  if (!isRecord(value) || !hasOnlyKeys(value, PRESET_KEYS)) return undefined;
  const id = typeof value.id === "string" && PRESET_ID_PATTERN.test(value.id) ? value.id : undefined;
  const name = normalizedName(value.name, TAB_APPEARANCE_PRESET_NAME_LIMIT);
  const style = validateTabAppearanceThemeStyle(value.style);
  return id && name && style ? { id, name, style } : undefined;
};

export const createUserTabAppearancePreset = (
  id: string,
  name: unknown,
  style: unknown,
): UserTabAppearancePreset | undefined => normalizePreset({ id, name, style });

export const normalizeTabAppearancePresetLibrary = (value: unknown): TabAppearancePresetLibrary => {
  if (!isRecord(value) || value.version !== TAB_APPEARANCE_THEME_VERSION || !Array.isArray(value.presets)) {
    return { version: TAB_APPEARANCE_THEME_VERSION, presets: [] };
  }
  const presets: UserTabAppearancePreset[] = [];
  const ids = new Set<string>();
  for (const candidate of value.presets.slice(0, TAB_APPEARANCE_PRESET_LIMIT * 4)) {
    const preset = normalizePreset(candidate);
    if (!preset || ids.has(preset.id)) continue;
    ids.add(preset.id);
    presets.push(preset);
    if (presets.length === TAB_APPEARANCE_PRESET_LIMIT) break;
  }
  return { version: TAB_APPEARANCE_THEME_VERSION, presets };
};

export const parseTabAppearancePresetLibrary = (raw: string | null): TabAppearancePresetLibrary => {
  if (!raw || raw.length > TAB_APPEARANCE_PRESET_LIBRARY_MAX_BYTES) {
    return { version: TAB_APPEARANCE_THEME_VERSION, presets: [] };
  }
  try {
    return normalizeTabAppearancePresetLibrary(JSON.parse(raw) as unknown);
  } catch {
    return { version: TAB_APPEARANCE_THEME_VERSION, presets: [] };
  }
};

export const validateTabAppearanceThemeDocument = (value: unknown): TabAppearanceThemeValidation => {
  if (!isRecord(value) || !hasOnlyKeys(value, THEME_KEYS)) return { ok: false, reason: "The theme must contain only the supported top-level fields." };
  if (value.format !== TAB_APPEARANCE_THEME_FORMAT || value.version !== TAB_APPEARANCE_THEME_VERSION) {
    return { ok: false, reason: "The theme format or version is not supported." };
  }
  const name = normalizedName(value.name, TAB_APPEARANCE_THEME_NAME_LIMIT);
  if (!name) return { ok: false, reason: "The theme name is missing or invalid." };
  if (!isRecord(value.tabStyles) || Object.keys(value.tabStyles).some(id => !validTabIds.has(id))) {
    return { ok: false, reason: "The theme contains an unknown tab identifier." };
  }
  const tabStyles: TabAppearanceThemeDocument["tabStyles"] = {};
  for (const [id, candidate] of Object.entries(value.tabStyles)) {
    const style = validateTabAppearanceThemeStyle(candidate);
    if (!style) return { ok: false, reason: `The appearance values for tab “${id}” are invalid.` };
    tabStyles[id as TabAppearanceThemeTabId] = style;
  }
  if (!Array.isArray(value.presets) || value.presets.length > TAB_APPEARANCE_PRESET_LIMIT) {
    return { ok: false, reason: `A theme can contain at most ${TAB_APPEARANCE_PRESET_LIMIT} saved presets.` };
  }
  const presets: UserTabAppearancePreset[] = [];
  const ids = new Set<string>();
  for (const candidate of value.presets) {
    const preset = normalizePreset(candidate);
    if (!preset || ids.has(preset.id)) return { ok: false, reason: "A saved preset is invalid or duplicated." };
    ids.add(preset.id);
    presets.push(preset);
  }
  if (!Object.keys(tabStyles).length && !presets.length) return { ok: false, reason: "The theme does not contain tab styles or saved presets." };
  return {
    ok: true,
    theme: { format: TAB_APPEARANCE_THEME_FORMAT, version: TAB_APPEARANCE_THEME_VERSION, name, tabStyles, presets },
  };
};

export const parseTabAppearanceThemeText = (source: string): TabAppearanceThemeValidation => {
  if (!source || new TextEncoder().encode(source).byteLength > TAB_APPEARANCE_THEME_MAX_BYTES) {
    return { ok: false, reason: `Theme files must contain from 1 through ${TAB_APPEARANCE_THEME_MAX_BYTES} UTF-8 bytes.` };
  }
  try {
    return validateTabAppearanceThemeDocument(JSON.parse(source) as unknown);
  } catch {
    return { ok: false, reason: "The selected theme is not valid JSON." };
  }
};

export const serializeTabAppearanceTheme = (value: unknown): string => {
  const validation = validateTabAppearanceThemeDocument(value);
  if (!validation.ok) throw new Error(validation.reason);
  const source = `${JSON.stringify(validation.theme, null, 2)}\n`;
  if (new TextEncoder().encode(source).byteLength > TAB_APPEARANCE_THEME_MAX_BYTES) throw new Error("The validated theme is too large to export.");
  return source;
};
