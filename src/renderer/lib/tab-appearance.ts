export const TAB_STYLE_KEYS = ["background", "foreground", "fontSize", "fontWeight", "radius"] as const;

export type TabStyleKey = (typeof TAB_STYLE_KEYS)[number];

export interface TabStyle {
  background: string;
  foreground: string;
  fontSize: number;
  fontWeight: number;
  radius: number;
}

export type TabStyleOverrides = Partial<TabStyle>;

export interface TabPreferences<TabId extends string = string> {
  order: TabId[];
  pinned: TabId[];
  closed: TabId[];
  styles: Partial<Record<TabId, TabStyleOverrides>>;
}

export const TAB_STYLE_PREVIEW_DEFAULTS: Readonly<TabStyle> = {
  background: "#EADDFF",
  foreground: "#21005D",
  fontSize: 14,
  fontWeight: 600,
  radius: 18,
};

const COLOR_PATTERN = /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/iu;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const uniqueValidIds = <TabId extends string>(value: unknown, validIds: ReadonlySet<TabId>): TabId[] => {
  if (!Array.isArray(value)) return [];
  const result: TabId[] = [];
  for (const candidate of value) {
    if (typeof candidate !== "string" || !validIds.has(candidate as TabId) || result.includes(candidate as TabId)) continue;
    result.push(candidate as TabId);
  }
  return result;
};

const boundedNumber = (value: unknown, minimum: number, maximum: number): number | undefined => {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.min(maximum, Math.max(minimum, value));
};

export const normalizeTabColor = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toUpperCase();
  return COLOR_PATTERN.test(normalized) ? normalized : undefined;
};

export const normalizeTabStyleOverrides = (value: unknown): TabStyleOverrides | undefined => {
  if (!isRecord(value)) return undefined;
  const normalized: TabStyleOverrides = {};
  const background = normalizeTabColor(value.background);
  const foreground = normalizeTabColor(value.foreground);
  const fontSize = boundedNumber(value.fontSize, 11, 22);
  const fontWeight = boundedNumber(value.fontWeight, 300, 800);
  const radius = boundedNumber(value.radius, 0, 28);
  if (background !== undefined) normalized.background = background;
  if (foreground !== undefined) normalized.foreground = foreground;
  if (fontSize !== undefined) normalized.fontSize = fontSize;
  if (fontWeight !== undefined) normalized.fontWeight = fontWeight;
  if (radius !== undefined) normalized.radius = radius;
  return Object.keys(normalized).length ? normalized : undefined;
};

export const resolveTabStyle = (overrides: TabStyleOverrides | undefined): TabStyle => ({
  ...TAB_STYLE_PREVIEW_DEFAULTS,
  ...normalizeTabStyleOverrides(overrides),
});

export const setTabStyleProperty = (
  current: TabStyleOverrides | undefined,
  key: TabStyleKey,
  value: string | number,
): TabStyleOverrides => {
  const next = { ...(normalizeTabStyleOverrides(current) ?? {}) };
  if (key === "background" || key === "foreground") {
    const color = normalizeTabColor(value);
    if (color !== undefined) next[key] = color;
    return next;
  }
  const numeric = typeof value === "number" ? value : Number(value);
  const normalized = key === "fontSize"
    ? boundedNumber(numeric, 11, 22)
    : key === "fontWeight"
      ? boundedNumber(numeric, 300, 800)
      : boundedNumber(numeric, 0, 28);
  if (normalized !== undefined) next[key] = normalized;
  return next;
};

export const resetTabStyleProperty = (
  current: TabStyleOverrides | undefined,
  key: TabStyleKey,
): TabStyleOverrides | undefined => {
  const next = { ...(normalizeTabStyleOverrides(current) ?? {}) };
  delete next[key];
  return Object.keys(next).length ? next : undefined;
};

export const normalizeTabPreferences = <TabId extends string>(
  value: unknown,
  allIds: readonly TabId[],
  fallback: TabPreferences<TabId>,
): TabPreferences<TabId> => {
  if (!isRecord(value)) return structuredClone(fallback);
  const validIds = new Set(allIds);
  const order = uniqueValidIds(value.order, validIds);
  for (const id of allIds) if (!order.includes(id)) order.push(id);
  const pinned = uniqueValidIds(value.pinned, validIds);
  const closed = uniqueValidIds(value.closed, validIds).filter(id => !pinned.includes(id));
  const styles: Partial<Record<TabId, TabStyleOverrides>> = {};
  if (isRecord(value.styles)) {
    for (const id of allIds) {
      const style = normalizeTabStyleOverrides(value.styles[id]);
      if (style) styles[id] = style;
    }
  }
  return { order, pinned, closed, styles };
};

export const parseTabPreferences = <TabId extends string>(
  raw: string | null,
  allIds: readonly TabId[],
  fallback: TabPreferences<TabId>,
): TabPreferences<TabId> => {
  if (!raw) return structuredClone(fallback);
  try {
    return normalizeTabPreferences(JSON.parse(raw), allIds, fallback);
  } catch {
    return structuredClone(fallback);
  }
};
