import { createHash } from "node:crypto";
import { inspectPimInterchange, normalizePimInterchangeForExport, PimInterchangeBoundaryError } from "./provider-foundation.js";
import {
  createCalendarEventSchema,
  createTaskSchema,
  type Alarm,
  type Attendee,
  type CalendarEvent,
  type CreateCalendarEventInput,
  type CreateTaskInput,
  type Recurrence,
  type Task,
  type TemporalValue,
} from "./types.js";

interface ICalendarProperty {
  name: string;
  params: Map<string, string[]>;
  value: string;
}

interface ICalendarComponent {
  name: string;
  properties: ICalendarProperty[];
  children: ICalendarComponent[];
}

export interface ParsedICalendarBundle {
  events: CreateCalendarEventInput[];
  tasks: CreateTaskInput[];
}

export class ICalendarParseError extends Error {
  override readonly name = "ICalendarParseError";
}

const fail = (message: string, cause?: unknown): never => {
  throw new ICalendarParseError(message, cause === undefined ? undefined : { cause });
};

const splitUnescaped = (value: string, delimiter: string): string[] => {
  const parts: string[] = [];
  let current = "";
  let escaped = false;
  let quoted = false;
  for (const character of value) {
    if (escaped) {
      current += `\\${character}`;
      escaped = false;
    } else if (character === "\\") {
      escaped = true;
    } else if (character === '"') {
      quoted = !quoted;
      current += character;
    } else if (character === delimiter && !quoted) {
      parts.push(current);
      current = "";
    } else {
      current += character;
    }
  }
  if (escaped) current += "\\";
  parts.push(current);
  return parts;
};

const unescapeText = (value: string): string =>
  value.replace(/\\([\\,;nN])/gu, (_match, escaped: string) => (escaped.toLowerCase() === "n" ? "\n" : escaped));

const escapeText = (value: string): string =>
  value.replace(/\\/gu, "\\\\").replace(/\r\n|\r|\n/gu, "\\n").replace(/;/gu, "\\;").replace(/,/gu, "\\,");

const unfold = (source: string): string[] => {
  const physical = source.replace(/^\uFEFF/u, "").replace(/\r\n?/gu, "\n").split("\n");
  const logical: string[] = [];
  for (const line of physical) {
    if (/^[ \t]/u.test(line)) {
      if (!logical.length || !logical.at(-1)) fail("A folded iCalendar line has no property to continue.");
      logical[logical.length - 1] += line.slice(1);
    } else if (line) {
      logical.push(line);
    }
  }
  return logical;
};

const parseProperty = (line: string): ICalendarProperty => {
  let separator = -1;
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] === '"') quoted = !quoted;
    if (line[index] === ":" && !quoted) { separator = index; break; }
  }
  if (separator < 1) return fail("An iCalendar property is missing its value separator.");
  const segments = splitUnescaped(line.slice(0, separator), ";");
  const name = (segments.shift() ?? "").toUpperCase();
  if (!/^[A-Z][A-Z0-9-]*$/u.test(name)) return fail("An iCalendar property name is malformed.");
  const params = new Map<string, string[]>();
  for (const segment of segments) {
    const equals = segment.indexOf("=");
    if (equals < 1) return fail(`The ${name} property contains a malformed parameter.`);
    const key = segment.slice(0, equals).toUpperCase();
    if (!/^[A-Z][A-Z0-9-]*$/u.test(key)) return fail(`The ${name} property contains a malformed parameter name.`);
    const values = splitUnescaped(segment.slice(equals + 1), ",").map(value => value.replace(/^"|"$/gu, ""));
    if (!values.length || values.some(value => !value)) return fail(`The ${name} property contains an empty parameter value.`);
    params.set(key, [...(params.get(key) ?? []), ...values]);
  }
  return { name, params, value: line.slice(separator + 1) };
};

const parseComponents = (source: string): ICalendarComponent => {
  const roots: ICalendarComponent[] = [];
  const stack: ICalendarComponent[] = [];
  for (const line of unfold(source)) {
    const property = parseProperty(line);
    if (property.name === "BEGIN") {
      const component: ICalendarComponent = { name: property.value.toUpperCase(), properties: [], children: [] };
      if (stack.length) stack.at(-1)!.children.push(component); else roots.push(component);
      stack.push(component);
    } else if (property.name === "END") {
      if (stack.pop()?.name !== property.value.toUpperCase()) fail(`The ${property.value || "unnamed"} iCalendar component is not balanced.`);
    } else {
      if (!stack.length) fail("An iCalendar property appears outside a component.");
      stack.at(-1)!.properties.push(property);
    }
  }
  if (stack.length || roots.length !== 1 || roots[0]?.name !== "VCALENDAR") fail("The document must contain one balanced VCALENDAR component.");
  return roots[0]!;
};

const propertiesNamed = (component: ICalendarComponent, name: string): ICalendarProperty[] =>
  component.properties.filter(property => property.name === name);

const optionalProperty = (component: ICalendarComponent, name: string): ICalendarProperty | undefined => {
  const properties = propertiesNamed(component, name);
  if (properties.length > 1) fail(`${component.name} may contain at most one ${name} property.`);
  return properties[0];
};

const requiredProperty = (component: ICalendarComponent, name: string): ICalendarProperty => {
  const property = optionalProperty(component, name);
  if (!property?.value) return fail(`${component.name} requires one non-empty ${name} property.`);
  return property;
};

const compactDate = (value: string, label: string): string => {
  if (!/^\d{8}$/u.test(value)) return fail(`${label} must use YYYYMMDD for a calendar date.`);
  const normalized = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  const date = new Date(`${normalized}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== normalized) return fail(`${label} is not a real calendar date.`);
  return normalized;
};

interface WallClockParts { year: number; month: number; day: number; hour: number; minute: number; second: number }

const wallClockAt = (instant: number, timeZone: string): WallClockParts => {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    calendar: "gregory",
    numberingSystem: "latn",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const values = Object.fromEntries(formatter.formatToParts(new Date(instant)).map(part => [part.type, part.value]));
  return {
    year: Number(values.year), month: Number(values.month), day: Number(values.day),
    hour: Number(values.hour), minute: Number(values.minute), second: Number(values.second),
  };
};

const wallClockUtcValue = (parts: WallClockParts): number =>
  Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);

const zonedDateTime = (parts: WallClockParts, timeZone: string, label: string): string => {
  let guess = wallClockUtcValue(parts);
  try {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const observed = wallClockAt(guess, timeZone);
      const adjustment = wallClockUtcValue(parts) - wallClockUtcValue(observed);
      if (adjustment === 0) break;
      guess += adjustment;
    }
    if (wallClockUtcValue(wallClockAt(guess, timeZone)) !== wallClockUtcValue(parts)) {
      return fail(`${label} names a wall-clock time that does not exist in ${timeZone}.`);
    }
  } catch (error) {
    return fail(`${label} uses an unsupported time zone ${timeZone}.`, error);
  }
  return new Date(guess).toISOString();
};

const parseTemporal = (property: ICalendarProperty, label: string, inheritedTimeZone?: string): TemporalValue => {
  const values = property.params.get("VALUE") ?? [];
  if (values.length > 1) return fail(`${label} declares more than one VALUE parameter.`);
  const kind = values[0]?.toUpperCase();
  const timeZones = property.params.get("TZID") ?? (inheritedTimeZone ? [inheritedTimeZone] : []);
  if (timeZones.length > 1) return fail(`${label} declares more than one TZID parameter.`);
  if (kind === "DATE" || (!kind && /^\d{8}$/u.test(property.value))) {
    if (timeZones.length) return fail(`${label} cannot combine VALUE=DATE with TZID.`);
    return { kind: "date", value: compactDate(property.value, label) };
  }
  if (kind && kind !== "DATE-TIME") return fail(`${label} uses unsupported VALUE=${kind}.`);
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z|[+-]\d{4})?$/u.exec(property.value);
  if (!match) return fail(`${label} must use an iCalendar DATE-TIME with second precision.`);
  const parts: WallClockParts = {
    year: Number(match[1]), month: Number(match[2]), day: Number(match[3]),
    hour: Number(match[4]), minute: Number(match[5]), second: Number(match[6]),
  };
  if (Object.values(parts).some(value => !Number.isInteger(value)) || parts.month < 1 || parts.month > 12 || parts.day < 1 || parts.day > 31 || parts.hour > 23 || parts.minute > 59 || parts.second > 59) {
    return fail(`${label} is not a valid date-time.`);
  }
  const suffix = match[7];
  let value: string;
  let timeZone: string | undefined;
  if (suffix === "Z") {
    value = new Date(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}Z`).toISOString();
  } else if (suffix) {
    const offset = `${suffix.slice(0, 3)}:${suffix.slice(3)}`;
    value = new Date(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}${offset}`).toISOString();
  } else {
    timeZone = timeZones[0] ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    value = zonedDateTime(parts, timeZone, label);
  }
  if (!Number.isFinite(Date.parse(value))) return fail(`${label} is not a real date-time.`);
  return timeZone ? { kind: "date-time", value, timeZone } : { kind: "date-time", value };
};

const parseInteger = (property: ICalendarProperty | undefined, label: string, minimum: number, maximum: number, fallback: number): number => {
  if (!property) return fallback;
  if (!/^-?\d+$/u.test(property.value)) return fail(`${label} must be an integer.`);
  const value = Number(property.value);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) return fail(`${label} must be from ${minimum} through ${maximum}.`);
  return value;
};

const parseRecurrence = (component: ICalendarComponent, start?: TemporalValue): Recurrence | undefined => {
  const rule = optionalProperty(component, "RRULE");
  const rdates = propertiesNamed(component, "RDATE");
  const exdates = propertiesNamed(component, "EXDATE");
  if (!rule && !rdates.length && !exdates.length) return undefined;
  if (!rule) return fail(`${component.name} uses recurrence dates without an RRULE.`);
  const fields = new Map<string, string>();
  for (const part of rule.value.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1) return fail("RRULE contains a malformed field.");
    const key = part.slice(0, separator).toUpperCase();
    if (fields.has(key)) return fail(`RRULE repeats ${key}.`);
    fields.set(key, part.slice(separator + 1));
  }
  const frequency = fields.get("FREQ")?.toLowerCase();
  if (!frequency || !["daily", "weekly", "monthly", "yearly"].includes(frequency)) return fail("RRULE requires a supported FREQ value.");
  const supported = new Set(["FREQ", "INTERVAL", "COUNT", "UNTIL", "BYDAY", "BYMONTHDAY", "WKST"]);
  const unsupported = [...fields.keys()].filter(key => !supported.has(key));
  if (unsupported.length) return fail(`RRULE fields are unsupported: ${unsupported.join(", ")}.`);
  const integerField = (name: string, minimum: number, maximum: number): number | undefined => {
    const raw = fields.get(name);
    if (raw === undefined) return undefined;
    if (!/^\d+$/u.test(raw)) return fail(`RRULE ${name} must be an integer.`);
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) return fail(`RRULE ${name} is outside its supported bounds.`);
    return value;
  };
  const interval = integerField("INTERVAL", 1, 10_000) ?? 1;
  const count = integerField("COUNT", 1, 1_000_000);
  const untilRaw = fields.get("UNTIL");
  const until = untilRaw
    ? parseTemporal({ name: "UNTIL", params: new Map(start?.kind === "date" ? [["VALUE", ["DATE"]]] : []), value: untilRaw }, "RRULE UNTIL", start?.kind === "date-time" ? start.timeZone : undefined)
    : undefined;
  if (count !== undefined && until) return fail("RRULE COUNT and UNTIL are mutually exclusive.");
  const weekdays = fields.get("BYDAY")?.split(",").map(value => value.toUpperCase());
  if (weekdays?.some(value => !["MO", "TU", "WE", "TH", "FR", "SA", "SU"].includes(value))) return fail("RRULE BYDAY contains an unsupported weekday or ordinal.");
  const monthDays = fields.get("BYMONTHDAY")?.split(",").map(value => Number(value));
  if (monthDays?.some(value => !Number.isInteger(value) || value === 0 || value < -31 || value > 31)) return fail("RRULE BYMONTHDAY contains an invalid day.");
  const weekStart = fields.get("WKST")?.toUpperCase();
  if (weekStart && !["MO", "TU", "WE", "TH", "FR", "SA", "SU"].includes(weekStart)) return fail("RRULE WKST contains an unsupported weekday.");
  const recurrenceDates = (properties: ICalendarProperty[], label: string): TemporalValue[] => properties.flatMap(property =>
    splitUnescaped(property.value, ",").map(value => parseTemporal({ ...property, value }, label, start?.kind === "date-time" ? start.timeZone : undefined)),
  );
  return {
    frequency: frequency as Recurrence["frequency"], interval, count, until,
    byWeekday: weekdays as Recurrence["byWeekday"], byMonthDay: monthDays,
    weekStart: weekStart as Recurrence["weekStart"],
    additionalDates: recurrenceDates(rdates, "RDATE"),
    exceptionDates: recurrenceDates(exdates, "EXDATE"),
  };
};

const parseAttendee = (property: ICalendarProperty, organizer = false): Attendee => {
  if (!/^mailto:/iu.test(property.value)) return fail(`${property.name} must use a mailto URI.`);
  let email: string;
  try { email = decodeURIComponent(property.value.slice(7)); } catch (error) { return fail(`${property.name} contains an invalid mailto URI.`, error); }
  const one = (name: string): string | undefined => {
    const values = property.params.get(name) ?? [];
    if (values.length > 1) return fail(`${property.name} declares more than one ${name} value.`);
    return values[0];
  };
  const roleMap: Record<string, Attendee["role"]> = {
    "REQ-PARTICIPANT": "required", "OPT-PARTICIPANT": "optional", CHAIR: "chair", "NON-PARTICIPANT": "non-participant",
  };
  const statusMap: Record<string, Attendee["participationStatus"]> = {
    "NEEDS-ACTION": "needs-action", ACCEPTED: "accepted", DECLINED: "declined", TENTATIVE: "tentative", DELEGATED: "delegated",
  };
  const roleRaw = one("ROLE")?.toUpperCase();
  const statusRaw = one("PARTSTAT")?.toUpperCase();
  if (roleRaw && !roleMap[roleRaw]) return fail(`${property.name} uses unsupported ROLE=${roleRaw}.`);
  if (statusRaw && !statusMap[statusRaw]) return fail(`${property.name} uses unsupported PARTSTAT=${statusRaw}.`);
  const rsvpRaw = one("RSVP")?.toUpperCase();
  if (rsvpRaw && rsvpRaw !== "TRUE" && rsvpRaw !== "FALSE") return fail(`${property.name} RSVP must be TRUE or FALSE.`);
  return {
    email,
    name: one("CN") ? unescapeText(one("CN")!) : undefined,
    role: organizer ? "chair" : (roleMap[roleRaw ?? ""] ?? "required"),
    participationStatus: organizer ? "accepted" : (statusMap[statusRaw ?? ""] ?? "needs-action"),
    rsvp: rsvpRaw === "TRUE",
  };
};

const alarmUid = (eventUid: string, index: number): string => {
  const candidate = `${eventUid}-alarm-${index + 1}`;
  return candidate.length <= 255 ? candidate : `alarm-${createHash("sha256").update(candidate).digest("hex")}`;
};

const parseRelativeMinutes = (value: string): number => {
  const match = /^(-)?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/u.exec(value);
  if (!match) return fail("VALARM TRIGGER uses an unsupported duration.");
  const seconds = (((Number(match[2] ?? 0) * 7 + Number(match[3] ?? 0)) * 24 + Number(match[4] ?? 0)) * 60 + Number(match[5] ?? 0)) * 60 + Number(match[6] ?? 0);
  if (!seconds || seconds % 60 !== 0) return fail("VALARM TRIGGER must be a non-zero whole-minute duration.");
  return (match[1] ? -1 : 1) * (seconds / 60);
};

const parseAlarm = (component: ICalendarComponent, eventUid: string, index: number): Alarm => {
  const action = requiredProperty(component, "ACTION").value.toUpperCase();
  if (action !== "DISPLAY" && action !== "AUDIO") return fail(`VALARM uses unsupported ACTION=${action}.`);
  const trigger = requiredProperty(component, "TRIGGER");
  const valueType = trigger.params.get("VALUE")?.[0]?.toUpperCase();
  const parsedTrigger = valueType === "DATE-TIME"
    ? { kind: "absolute" as const, at: parseTemporal(trigger, "VALARM TRIGGER").value }
    : { kind: "relative" as const, minutes: parseRelativeMinutes(trigger.value) };
  if (parsedTrigger.kind === "absolute" && !/^\d{4}-\d{2}-\d{2}T/u.test(parsedTrigger.at)) return fail("An absolute VALARM trigger must be a date-time.");
  const description = optionalProperty(component, "DESCRIPTION");
  return { uid: alarmUid(eventUid, index), action: action.toLowerCase() as Alarm["action"], trigger: parsedTrigger, description: description ? unescapeText(description.value) : undefined };
};

const textProperty = (component: ICalendarComponent, name: string): string | undefined => {
  const property = optionalProperty(component, name);
  return property ? unescapeText(property.value) : undefined;
};

const categories = (component: ICalendarComponent): string[] =>
  propertiesNamed(component, "CATEGORIES").flatMap(property => splitUnescaped(property.value, ",").map(unescapeText).filter(Boolean));

const parseEvent = (component: ICalendarComponent): CreateCalendarEventInput => {
  const uid = unescapeText(requiredProperty(component, "UID").value);
  const start = parseTemporal(requiredProperty(component, "DTSTART"), "VEVENT DTSTART");
  const end = parseTemporal(requiredProperty(component, "DTEND"), "VEVENT DTEND", start.kind === "date-time" ? start.timeZone : undefined);
  const organizerProperty = optionalProperty(component, "ORGANIZER");
  const status = optionalProperty(component, "STATUS")?.value.toLowerCase() ?? "confirmed";
  const transparency = optionalProperty(component, "TRANSP")?.value.toLowerCase() ?? "opaque";
  if (!["tentative", "confirmed", "cancelled"].includes(status)) return fail(`VEVENT uses unsupported STATUS=${status}.`);
  if (!["opaque", "transparent"].includes(transparency)) return fail(`VEVENT uses unsupported TRANSP=${transparency}.`);
  return createCalendarEventSchema.parse({
    uid,
    title: unescapeText(requiredProperty(component, "SUMMARY").value),
    description: textProperty(component, "DESCRIPTION"),
    location: textProperty(component, "LOCATION"),
    start,
    end,
    recurrence: parseRecurrence(component, start),
    organizer: organizerProperty ? parseAttendee(organizerProperty, true) : undefined,
    attendees: propertiesNamed(component, "ATTENDEE").map(property => parseAttendee(property)),
    alarms: component.children.filter(child => child.name === "VALARM").map((alarm, index) => parseAlarm(alarm, uid, index)),
    categories: categories(component),
    status,
    transparency,
  });
};

const parseTask = (component: ICalendarComponent): CreateTaskInput => {
  if (component.children.length) return fail("VTODO child components are outside the local task boundary.");
  const entryProperty = optionalProperty(component, "DTSTART");
  const entry = entryProperty ? parseTemporal(entryProperty, "VTODO DTSTART") : undefined;
  const dueProperty = optionalProperty(component, "DUE");
  const due = dueProperty ? parseTemporal(dueProperty, "VTODO DUE", entry?.kind === "date-time" ? entry.timeZone : undefined) : undefined;
  const completedProperty = optionalProperty(component, "COMPLETED");
  const completed = completedProperty ? parseTemporal(completedProperty, "VTODO COMPLETED") : undefined;
  if (completed?.kind === "date") return fail("VTODO COMPLETED must be a date-time.");
  const status = optionalProperty(component, "STATUS")?.value.toLowerCase() ?? "needs-action";
  if (!["needs-action", "in-progress", "completed", "cancelled"].includes(status)) return fail(`VTODO uses unsupported STATUS=${status}.`);
  const sequence = optionalProperty(component, "SEQUENCE");
  const lastModified = optionalProperty(component, "LAST-MODIFIED");
  return createTaskSchema.parse({
    uid: unescapeText(requiredProperty(component, "UID").value),
    title: unescapeText(requiredProperty(component, "SUMMARY").value),
    description: textProperty(component, "DESCRIPTION"),
    status,
    entry,
    due,
    priority: parseInteger(optionalProperty(component, "PRIORITY"), "VTODO PRIORITY", 0, 9, 0),
    percentComplete: parseInteger(optionalProperty(component, "PERCENT-COMPLETE"), "VTODO PERCENT-COMPLETE", 0, 100, status === "completed" ? 100 : 0),
    completedAt: completed?.value,
    categories: categories(component),
    recurrence: parseRecurrence(component, entry ?? due),
    sourceRevision: sequence ? `SEQUENCE:${sequence.value}` : lastModified ? `LAST-MODIFIED:${lastModified.value}` : undefined,
  });
};

export const parseICalendarBundle = (source: string): ParsedICalendarBundle => {
  try {
    inspectPimInterchange("icalendar", source);
    const calendar = parseComponents(source);
    const directNames = new Set(["VEVENT", "VTODO", "VTIMEZONE"]);
    if (calendar.children.some(component => !directNames.has(component.name))) fail("VCALENDAR contains an unsupported direct child component.");
    for (const component of calendar.children.filter(child => child.name === "VEVENT")) {
      if (component.children.some(child => child.name !== "VALARM")) fail("VEVENT contains an unsupported child component.");
    }
    return {
      events: calendar.children.filter(component => component.name === "VEVENT").map(parseEvent),
      tasks: calendar.children.filter(component => component.name === "VTODO").map(parseTask),
    };
  } catch (error) {
    if (error instanceof ICalendarParseError) throw error;
    if (error instanceof PimInterchangeBoundaryError) throw new ICalendarParseError(error.message, { cause: error });
    return fail("The iCalendar document contains a field that cannot be imported safely.", error);
  }
};

const foldLine = (line: string): string => {
  const lines: string[] = [];
  let current = "";
  for (const character of line) {
    if (Buffer.byteLength(current + character, "utf8") > 75) {
      lines.push(current);
      current = ` ${character}`;
    } else current += character;
  }
  lines.push(current);
  return lines.join("\r\n");
};

const line = (name: string, value: string, parameters: readonly string[] = []): string =>
  foldLine(`${name}${parameters.length ? `;${parameters.join(";")}` : ""}:${value}`);

const compactUtc = (value: string): string => new Date(value).toISOString().replace(/[-:]/gu, "").replace(/\.\d{3}Z$/u, "Z");

const temporalLine = (name: string, temporal: TemporalValue): string => temporal.kind === "date"
  ? line(name, temporal.value.replace(/-/gu, ""), ["VALUE=DATE"])
  : line(name, compactUtc(temporal.value));

const recurrenceLines = (recurrence: Recurrence | undefined): string[] => {
  if (!recurrence) return [];
  const parts = [`FREQ=${recurrence.frequency.toUpperCase()}`];
  if (recurrence.interval !== 1) parts.push(`INTERVAL=${recurrence.interval}`);
  if (recurrence.count !== undefined) parts.push(`COUNT=${recurrence.count}`);
  if (recurrence.until) parts.push(`UNTIL=${recurrence.until.kind === "date" ? recurrence.until.value.replace(/-/gu, "") : compactUtc(recurrence.until.value)}`);
  if (recurrence.byWeekday?.length) parts.push(`BYDAY=${recurrence.byWeekday.join(",")}`);
  if (recurrence.byMonthDay?.length) parts.push(`BYMONTHDAY=${recurrence.byMonthDay.join(",")}`);
  if (recurrence.weekStart) parts.push(`WKST=${recurrence.weekStart}`);
  return [
    line("RRULE", parts.join(";")),
    ...recurrence.additionalDates.map(value => temporalLine("RDATE", value)),
    ...recurrence.exceptionDates.map(value => temporalLine("EXDATE", value)),
  ];
};

const attendeeLine = (name: "ORGANIZER" | "ATTENDEE", attendee: Attendee): string => {
  const parameters: string[] = [];
  if (attendee.name) parameters.push(`CN="${attendee.name.replace(/["\r\n]/gu, "'")}"`);
  if (name === "ATTENDEE") {
    const role: Record<Attendee["role"], string> = { required: "REQ-PARTICIPANT", optional: "OPT-PARTICIPANT", chair: "CHAIR", "non-participant": "NON-PARTICIPANT" };
    parameters.push(`ROLE=${role[attendee.role]}`, `PARTSTAT=${attendee.participationStatus.toUpperCase()}`, `RSVP=${attendee.rsvp ? "TRUE" : "FALSE"}`);
  }
  return line(name, `mailto:${attendee.email}`, parameters);
};

const durationFromMinutes = (minutes: number): string => {
  const sign = minutes < 0 ? "-" : "";
  const absolute = Math.abs(minutes);
  const days = Math.floor(absolute / 1_440);
  const hours = Math.floor((absolute % 1_440) / 60);
  const remaining = absolute % 60;
  return `${sign}P${days ? `${days}D` : ""}${hours || remaining ? `T${hours ? `${hours}H` : ""}${remaining ? `${remaining}M` : ""}` : ""}`;
};

const alarmLines = (alarm: Alarm, fallbackDescription: string): string[] => [
  "BEGIN:VALARM",
  line("ACTION", alarm.action.toUpperCase()),
  alarm.trigger.kind === "relative"
    ? line("TRIGGER", durationFromMinutes(alarm.trigger.minutes))
    : line("TRIGGER", compactUtc(alarm.trigger.at), ["VALUE=DATE-TIME"]),
  ...(alarm.description || alarm.action === "display" ? [line("DESCRIPTION", escapeText(alarm.description ?? fallbackDescription))] : []),
  "END:VALARM",
];

const eventLines = (event: CalendarEvent): string[] => [
  "BEGIN:VEVENT",
  line("UID", escapeText(event.uid)),
  line("DTSTAMP", compactUtc(event.updatedAt)),
  temporalLine("DTSTART", event.start),
  temporalLine("DTEND", event.end),
  line("SUMMARY", escapeText(event.title)),
  ...(event.description ? [line("DESCRIPTION", escapeText(event.description))] : []),
  ...(event.location ? [line("LOCATION", escapeText(event.location))] : []),
  line("STATUS", event.status.toUpperCase()),
  line("TRANSP", event.transparency.toUpperCase()),
  ...(event.categories.length ? [line("CATEGORIES", event.categories.map(escapeText).join(","))] : []),
  ...(event.organizer ? [attendeeLine("ORGANIZER", event.organizer)] : []),
  ...event.attendees.map(attendee => attendeeLine("ATTENDEE", attendee)),
  ...recurrenceLines(event.recurrence),
  ...event.alarms.flatMap(alarm => alarmLines(alarm, event.title)),
  "END:VEVENT",
];

const taskLines = (task: Task): string[] => [
  "BEGIN:VTODO",
  line("UID", escapeText(task.uid)),
  line("DTSTAMP", compactUtc(task.updatedAt)),
  line("SEQUENCE", String(Math.max(0, task.revision - 1))),
  line("SUMMARY", escapeText(task.title)),
  ...(task.description ? [line("DESCRIPTION", escapeText(task.description))] : []),
  line("STATUS", task.status.toUpperCase()),
  ...(task.entry ? [temporalLine("DTSTART", task.entry)] : []),
  ...(task.due ? [temporalLine("DUE", task.due)] : []),
  line("PRIORITY", String(task.priority)),
  line("PERCENT-COMPLETE", String(task.percentComplete)),
  ...(task.completedAt ? [line("COMPLETED", compactUtc(task.completedAt))] : []),
  ...(task.categories.length ? [line("CATEGORIES", task.categories.map(escapeText).join(","))] : []),
  ...recurrenceLines(task.recurrence),
  "END:VTODO",
];

export const serializeICalendarBundle = (events: readonly CalendarEvent[], tasks: readonly Task[]): string => {
  if (events.length + tasks.length < 1) throw new ICalendarParseError("Select at least one local event or task to export.");
  const source = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Material Email//Local PIM 1.0//EN",
    "CALSCALE:GREGORIAN",
    ...events.flatMap(eventLines),
    ...tasks.flatMap(taskLines),
    "END:VCALENDAR",
  ].join("\r\n");
  return normalizePimInterchangeForExport("icalendar", `${source}\r\n`);
};
