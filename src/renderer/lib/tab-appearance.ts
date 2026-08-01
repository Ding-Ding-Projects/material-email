export const TAB_STYLE_KEYS = ["accent", "background", "foreground", "fontSize", "fontWeight", "radius"] as const;

export type TabStyleKey = (typeof TAB_STYLE_KEYS)[number];

export interface TabStyle {
  accent: string;
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
  accent: "#6750A4",
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

export interface TabColorChannels {
  hex: string;
  red: number;
  green: number;
  blue: number;
  hue: number;
  saturation: number;
  lightness: number;
  alpha: number;
}

const roundTo = (value: number, places: number): number => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

const alphaSuffix = (source: unknown): string => normalizeTabColor(source)?.slice(7) ?? "";

export const translateTabColor = (value: unknown): TabColorChannels | undefined => {
  const hex = normalizeTabColor(value);
  if (!hex) return undefined;
  const red = Number.parseInt(hex.slice(1, 3), 16);
  const green = Number.parseInt(hex.slice(3, 5), 16);
  const blue = Number.parseInt(hex.slice(5, 7), 16);
  const alpha = hex.length === 9 ? Number.parseInt(hex.slice(7, 9), 16) / 255 : 1;
  const redUnit = red / 255;
  const greenUnit = green / 255;
  const blueUnit = blue / 255;
  const maximum = Math.max(redUnit, greenUnit, blueUnit);
  const minimum = Math.min(redUnit, greenUnit, blueUnit);
  const delta = maximum - minimum;
  const lightnessUnit = (maximum + minimum) / 2;
  let hue = 0;
  let saturationUnit = 0;
  if (delta !== 0) {
    saturationUnit = delta / (1 - Math.abs(2 * lightnessUnit - 1));
    if (maximum === redUnit) hue = 60 * (((greenUnit - blueUnit) / delta) % 6);
    else if (maximum === greenUnit) hue = 60 * (((blueUnit - redUnit) / delta) + 2);
    else hue = 60 * (((redUnit - greenUnit) / delta) + 4);
    if (hue < 0) hue += 360;
  }
  return {
    hex,
    red,
    green,
    blue,
    hue: roundTo(hue, 1),
    saturation: roundTo(saturationUnit * 100, 1),
    lightness: roundTo(lightnessUnit * 100, 1),
    alpha: roundTo(alpha, 3),
  };
};

const byteToHex = (value: number): string => Math.round(value).toString(16).padStart(2, "0").toUpperCase();

export const tabColorFromRgb = (
  red: number,
  green: number,
  blue: number,
  preserveAlphaFrom?: unknown,
): string | undefined => {
  if (![red, green, blue].every(channel => Number.isFinite(channel) && channel >= 0 && channel <= 255)) return undefined;
  return `#${byteToHex(red)}${byteToHex(green)}${byteToHex(blue)}${alphaSuffix(preserveAlphaFrom)}`;
};

export const tabColorFromHsl = (
  hue: number,
  saturation: number,
  lightness: number,
  preserveAlphaFrom?: unknown,
): string | undefined => {
  if (!Number.isFinite(hue) || hue < 0 || hue > 360
    || !Number.isFinite(saturation) || saturation < 0 || saturation > 100
    || !Number.isFinite(lightness) || lightness < 0 || lightness > 100) return undefined;
  const normalizedHue = hue === 360 ? 0 : hue;
  const saturationUnit = saturation / 100;
  const lightnessUnit = lightness / 100;
  const chroma = (1 - Math.abs(2 * lightnessUnit - 1)) * saturationUnit;
  const hueSegment = normalizedHue / 60;
  const secondary = chroma * (1 - Math.abs((hueSegment % 2) - 1));
  let redUnit = 0;
  let greenUnit = 0;
  let blueUnit = 0;
  if (hueSegment < 1) [redUnit, greenUnit] = [chroma, secondary];
  else if (hueSegment < 2) [redUnit, greenUnit] = [secondary, chroma];
  else if (hueSegment < 3) [greenUnit, blueUnit] = [chroma, secondary];
  else if (hueSegment < 4) [greenUnit, blueUnit] = [secondary, chroma];
  else if (hueSegment < 5) [redUnit, blueUnit] = [secondary, chroma];
  else [redUnit, blueUnit] = [chroma, secondary];
  const match = lightnessUnit - chroma / 2;
  return tabColorFromRgb(
    (redUnit + match) * 255,
    (greenUnit + match) * 255,
    (blueUnit + match) * 255,
    preserveAlphaFrom,
  );
};

const compositeChannel = (foreground: number, alpha: number, background: number): number =>
  foreground * alpha + background * (1 - alpha);

const relativeLuminance = (red: number, green: number, blue: number): number => {
  const linear = (channel: number): number => {
    const normalized = channel / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue);
};

export const tabColorContrastRatio = (foreground: unknown, background: unknown): number | undefined => {
  const foregroundChannels = translateTabColor(foreground);
  const backgroundChannels = translateTabColor(background);
  if (!foregroundChannels || !backgroundChannels) return undefined;
  const backgroundRed = compositeChannel(backgroundChannels.red, backgroundChannels.alpha, 255);
  const backgroundGreen = compositeChannel(backgroundChannels.green, backgroundChannels.alpha, 255);
  const backgroundBlue = compositeChannel(backgroundChannels.blue, backgroundChannels.alpha, 255);
  const foregroundRed = compositeChannel(foregroundChannels.red, foregroundChannels.alpha, backgroundRed);
  const foregroundGreen = compositeChannel(foregroundChannels.green, foregroundChannels.alpha, backgroundGreen);
  const foregroundBlue = compositeChannel(foregroundChannels.blue, foregroundChannels.alpha, backgroundBlue);
  const foregroundLuminance = relativeLuminance(foregroundRed, foregroundGreen, foregroundBlue);
  const backgroundLuminance = relativeLuminance(backgroundRed, backgroundGreen, backgroundBlue);
  return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05)
    / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
};

export const normalizeTabStyleOverrides = (value: unknown): TabStyleOverrides | undefined => {
  if (!isRecord(value)) return undefined;
  const normalized: TabStyleOverrides = {};
  const accent = normalizeTabColor(value.accent);
  const background = normalizeTabColor(value.background);
  const foreground = normalizeTabColor(value.foreground);
  const fontSize = boundedNumber(value.fontSize, 11, 22);
  const fontWeight = boundedNumber(value.fontWeight, 300, 800);
  const radius = boundedNumber(value.radius, 0, 28);
  if (accent !== undefined) normalized.accent = accent;
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
  if (key === "accent" || key === "background" || key === "foreground") {
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
