export interface ChangelogEntry {
  version: string;
  date: string;
  title: string;
  codeName?: string;
  image?: string;
  changes: Array<{ category: string; detail: string }>;
}

export interface ParsedDate {
  raw: string;
  isoDate: string | null;
  error: "partial" | "format" | "calendar" | null;
}

export interface DateRange {
  from: ParsedDate;
  to: ParsedDate;
  valid: boolean;
  error: "inverted" | null;
}

export interface ChangelogDateInputs {
  from: string;
  to: string;
}

export type ChangelogDatePreset = "all" | "last-30-days" | "this-month" | "this-year";

export interface ChangelogCalendarDay {
  day: number;
  isoDate: string;
}

interface SessionStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const CHANGELOG_DATE_SESSION_KEY = "material-email.changelog-date-range.v1";
export const CHANGELOG_DATE_INPUT_LIMIT = 32;

const canonical = (year: number, month: number, day: number): string | null => {
  const date = new Date(Date.UTC(year, month - 1, day));
  return year >= 1
    && year <= 9999
    && date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
    ? `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
    : null;
};

const boundedDateInput = (value: unknown): string =>
  typeof value === "string" ? value.slice(0, CHANGELOG_DATE_INPUT_LIMIT) : "";

export const localIsoDate = (date = new Date()): string =>
  `${String(date.getFullYear()).padStart(4, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

export const readChangelogDateInputs = (
  storage: SessionStorageLike,
  key = CHANGELOG_DATE_SESSION_KEY,
): ChangelogDateInputs => {
  try {
    const raw = storage.getItem(key);
    if (!raw) return { from: "", to: "" };
    const parsed = JSON.parse(raw) as Partial<ChangelogDateInputs>;
    return { from: boundedDateInput(parsed.from), to: boundedDateInput(parsed.to) };
  } catch {
    return { from: "", to: "" };
  }
};

export const persistChangelogDateInputs = (
  storage: SessionStorageLike,
  inputs: ChangelogDateInputs,
  key = CHANGELOG_DATE_SESSION_KEY,
): boolean => {
  try {
    storage.setItem(key, JSON.stringify({
      from: boundedDateInput(inputs.from),
      to: boundedDateInput(inputs.to),
    }));
    return true;
  } catch {
    return false;
  }
};

export const parseDateInput = (raw: string, locale = "en-CA"): ParsedDate => {
  const text = raw.trim();
  if (!text) return { raw, isoDate: null, error: null };

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(text);
  if (iso) {
    const value = canonical(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    return { raw, isoDate: value, error: value ? null : "calendar" };
  }

  if (/^[\d\s./-]+$/u.test(text) && (text.match(/\d+/gu)?.length ?? 0) < 3) {
    return { raw, isoDate: null, error: "partial" };
  }

  const parts = text.match(/\d+/gu);
  if (!parts || parts.length !== 3) return { raw, isoDate: null, error: "format" };

  const order = new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    timeZone: "UTC",
  }).formatToParts(new Date(Date.UTC(2020, 10, 22)))
    .map(part => part.type)
    .filter((part): part is "year" | "month" | "day" => ["year", "month", "day"].includes(part));
  const values = new Map(order.map((part, index) => [part, parts[index] ?? ""]));
  if (!/^\d{4}$/u.test(values.get("year") ?? "")
    || !/^\d{1,2}$/u.test(values.get("month") ?? "")
    || !/^\d{1,2}$/u.test(values.get("day") ?? "")) {
    return { raw, isoDate: null, error: "format" };
  }

  const value = canonical(
    Number(values.get("year")),
    Number(values.get("month")),
    Number(values.get("day")),
  );
  return { raw, isoDate: value, error: value ? null : "calendar" };
};

export const validateDateRange = (fromRaw: string, toRaw: string, locale = "en-CA"): DateRange => {
  const from = parseDateInput(fromRaw, locale);
  const to = parseDateInput(toRaw, locale);
  const error = from.isoDate && to.isoDate && from.isoDate > to.isoDate ? "inverted" : null;
  return { from, to, valid: !from.error && !to.error && !error, error };
};

export const changelogDateRangeForPreset = (
  preset: ChangelogDatePreset,
  today = localIsoDate(),
): ChangelogDateInputs => {
  const parsedToday = parseDateInput(today);
  if (!parsedToday.isoDate) return { from: "", to: "" };
  if (preset === "all") return { from: "", to: "" };

  const [year, month, day] = parsedToday.isoDate.split("-").map(Number) as [number, number, number];
  if (preset === "this-month") {
    return { from: `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-01`, to: parsedToday.isoDate };
  }
  if (preset === "this-year") {
    return { from: `${String(year).padStart(4, "0")}-01-01`, to: parsedToday.isoDate };
  }

  const start = new Date(Date.UTC(year, month - 1, day));
  start.setUTCDate(start.getUTCDate() - 29);
  return { from: start.toISOString().slice(0, 10), to: parsedToday.isoDate };
};

export const shiftChangelogMonth = (isoMonth: string, delta: number): string => {
  const match = /^(\d{4})-(\d{2})$/u.exec(isoMonth);
  if (!match || !Number.isInteger(delta)) return isoMonth;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (year < 1 || year > 9999 || month < 1 || month > 12) return isoMonth;
  const shifted = Math.min(9999 * 12 - 1, Math.max(0, (year - 1) * 12 + month - 1 + delta));
  return `${String(Math.floor(shifted / 12) + 1).padStart(4, "0")}-${String(shifted % 12 + 1).padStart(2, "0")}`;
};

export const changelogCalendarWeeks = (isoMonth: string): Array<Array<ChangelogCalendarDay | null>> => {
  const match = /^(\d{4})-(\d{2})$/u.exec(isoMonth);
  if (!match) return [];
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (year < 1 || year > 9999 || month < 1 || month > 12) return [];
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells: Array<ChangelogCalendarDay | null> = Array.from({ length: firstWeekday }, () => null);
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push({
      day,
      isoDate: `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    });
  }
  while (cells.length % 7) cells.push(null);
  const weeks: Array<Array<ChangelogCalendarDay | null>> = [];
  for (let index = 0; index < cells.length; index += 7) weeks.push(cells.slice(index, index + 7));
  return weeks;
};

const searchableEntryText = (entry: ChangelogEntry): string =>
  `${entry.version}\n${entry.date}\n${entry.title}\n${entry.changes.map(change => `${change.category} ${change.detail}`).join("\n")}`;

export const filterChangelogEntries = (
  entries: readonly ChangelogEntry[],
  query: string,
  matches: ((text: string) => boolean) | null,
  from: string | null,
  to: string | null,
): ChangelogEntry[] => entries.filter(entry => {
  if (query && (!matches || !matches(searchableEntryText(entry)))) return false;
  if ((from || to) && !entry.date) return false;
  return (!from || entry.date >= from) && (!to || entry.date <= to);
});

export const changelogMarkdown = (
  entries: readonly ChangelogEntry[],
  query: string,
  from: string | null,
  to: string | null,
): string => [
  "# Material Email changelog",
  "",
  `Search: ${query || "(none)"}`,
  `Date range: ${from ?? "(earliest)"} through ${to ?? "(latest)"}`,
  "",
  ...entries.flatMap(entry => [
    `## ${entry.version} — ${entry.title}`,
    "",
    `Released: ${entry.date || "Not recorded"}`,
    "",
    ...entry.changes.map(change => `- **${change.category}:** ${change.detail}`),
    "",
  ]),
].join("\n");
