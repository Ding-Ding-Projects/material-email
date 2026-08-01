import type { Contact, ContactAddress, ContactEmail, ContactPhone, CreateContactInput, CreateMailingListInput, MailingList } from "./types.js";
import { contactEmailSchema, createContactSchema, createMailingListSchema } from "./types.js";

const MAX_VCARD_BYTES = 5 * 1024 * 1024;
const MAX_VCARDS = 10_000;

interface VCardProperty {
  name: string;
  params: Map<string, string[]>;
  value: string;
}

export interface ParsedVCardBundle {
  contacts: CreateContactInput[];
  mailingLists: ParsedVCardMailingList[];
}

export type ParsedVCardMailingList = CreateMailingListInput & { memberEmailAddresses: string[] };

export class VCardParseError extends Error {
  override readonly name = "VCardParseError";
}

const escapeText = (value: string): string =>
  value.replace(/\\/g, "\\\\").replace(/\r\n|\r|\n/g, "\\n").replace(/;/g, "\\;").replace(/,/g, "\\,");

const unescapeText = (value: string): string =>
  value.replace(/\\([\\,;nN])/g, (_match, escaped: string) => (escaped.toLowerCase() === "n" ? "\n" : escaped));

const decodeQuotedPrintable = (value: string, charset: string): string => {
  const bytes: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === "=" && /^[0-9A-F]{2}$/i.test(value.slice(index + 1, index + 3))) {
      bytes.push(Number.parseInt(value.slice(index + 1, index + 3), 16));
      index += 2;
      continue;
    }
    bytes.push(...new TextEncoder().encode(value[index] ?? ""));
  }
  try {
    return new TextDecoder(charset, { fatal: true }).decode(Uint8Array.from(bytes));
  } catch (error) {
    throw new VCardParseError(`A quoted-printable vCard value uses unsupported or invalid ${charset} text.`, { cause: error });
  }
};

const decodedPropertyValue = (property: VCardProperty): string => {
  const encodings = property.params.get("ENCODING")?.map(value => value.toUpperCase()) ?? [];
  if (!encodings.length) return property.value;
  if (!encodings.every(value => value === "QUOTED-PRINTABLE")) {
    throw new VCardParseError(`Unsupported vCard text encoding ${encodings.join(", ")}.`);
  }
  const charsets = property.params.get("CHARSET") ?? ["UTF-8"];
  if (charsets.length !== 1) throw new VCardParseError("A quoted-printable vCard value must declare at most one character set.");
  return decodeQuotedPrintable(property.value, charsets[0] ?? "UTF-8");
};

const propertyText = (property: VCardProperty): string => unescapeText(decodedPropertyValue(property));

const splitUnescaped = (value: string, delimiter: string): string[] => {
  const parts: string[] = [];
  let current = "";
  let escaped = false;
  let quoted = false;
  for (const character of value) {
    if (escaped) {
      current += `\\${character}`;
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === '"') {
      quoted = !quoted;
      current += character;
      continue;
    }
    if (character === delimiter && !quoted) {
      parts.push(current);
      current = "";
      continue;
    }
    current += character;
  }
  if (escaped) current += "\\";
  parts.push(current);
  return parts;
};

const foldLine = (line: string): string => {
  const folded: string[] = [];
  let current = "";
  let limit = 75;
  for (const character of line) {
    if (Buffer.byteLength(current + character, "utf8") > limit) {
      folded.push(current);
      current = ` ${character}`;
      limit = 75;
    } else {
      current += character;
    }
  }
  folded.push(current);
  return folded.join("\r\n");
};

const quoteParameter = (value: string): string => {
  if (/^[A-Za-z0-9-]+$/.test(value)) return value;
  return `"${value.replace(/["\r\n]/g, "'")}"`;
};

const propertyLine = (name: string, value: string, types: readonly string[] = [], preferred = false): string => {
  const parameters: string[] = [];
  if (types.length) parameters.push(`TYPE=${types.map(quoteParameter).join(",")}`);
  if (preferred) parameters.push("PREF=1");
  return foldLine(`${name}${parameters.length ? `;${parameters.join(";")}` : ""}:${value}`);
};

const structuredText = (values: readonly (string | undefined)[]): string => values.map(value => escapeText(value ?? "")).join(";");

const memberUri = (uid: string): string =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uid)
    ? `urn:uuid:${uid}`
    : `urn:material-email:${encodeURIComponent(uid)}`;

export const serializeContactVCard = (contact: Contact): string => {
  const lines = [
    "BEGIN:VCARD",
    "VERSION:4.0",
    propertyLine("UID", escapeText(contact.uid)),
    propertyLine("FN", escapeText(contact.displayName)),
    propertyLine("N", structuredText([contact.name.family, contact.name.given, contact.name.additional, contact.name.prefix, contact.name.suffix])),
  ];
  if (contact.nickname) lines.push(propertyLine("NICKNAME", escapeText(contact.nickname)));
  for (const email of contact.emails) lines.push(propertyLine("EMAIL", escapeText(email.value), email.types, email.preferred));
  for (const phone of contact.phones) lines.push(propertyLine("TEL", escapeText(phone.value), phone.types, phone.preferred));
  for (const address of contact.addresses) {
    lines.push(
      propertyLine(
        "ADR",
        structuredText([
          address.poBox,
          address.extended,
          address.street,
          address.locality,
          address.region,
          address.postalCode,
          address.country,
        ]),
        address.types,
        address.preferred,
      ),
    );
  }
  if (contact.organization) lines.push(propertyLine("ORG", escapeText(contact.organization)));
  if (contact.title) lines.push(propertyLine("TITLE", escapeText(contact.title)));
  if (contact.notes) lines.push(propertyLine("NOTE", escapeText(contact.notes)));
  lines.push(propertyLine("REV", contact.updatedAt), "END:VCARD");
  return `${lines.join("\r\n")}\r\n`;
};

export const serializeMailingListVCard = (mailingList: MailingList): string => {
  const lines = [
    "BEGIN:VCARD",
    "VERSION:4.0",
    propertyLine("UID", escapeText(mailingList.uid)),
    "KIND:group",
    propertyLine("FN", escapeText(mailingList.name)),
  ];
  if (mailingList.nickname) lines.push(propertyLine("NICKNAME", escapeText(mailingList.nickname)));
  if (mailingList.description) lines.push(propertyLine("NOTE", escapeText(mailingList.description)));
  for (const uid of mailingList.memberUids) lines.push(propertyLine("MEMBER", memberUri(uid)));
  lines.push(propertyLine("REV", mailingList.updatedAt), "END:VCARD");
  return `${lines.join("\r\n")}\r\n`;
};

export const serializeVCardBundle = (contacts: readonly Contact[], mailingLists: readonly MailingList[] = []): string =>
  [...contacts.map(serializeContactVCard), ...mailingLists.map(serializeMailingListVCard)].join("");

const parseProperty = (line: string): VCardProperty => {
  let separator = -1;
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') quoted = !quoted;
    if (character === ":" && !quoted) {
      separator = index;
      break;
    }
  }
  if (separator < 1) throw new VCardParseError("A vCard property is missing its value separator.");
  const head = line.slice(0, separator);
  const segments = splitUnescaped(head, ";");
  const rawName = segments.shift() ?? "";
  const name = (rawName.includes(".") ? rawName.slice(rawName.lastIndexOf(".") + 1) : rawName).toUpperCase();
  const params = new Map<string, string[]>();
  for (const segment of segments) {
    const equals = segment.indexOf("=");
    const key = (equals < 0 ? "TYPE" : segment.slice(0, equals)).toUpperCase();
    const rawValues = equals < 0 ? segment : segment.slice(equals + 1);
    const values = splitUnescaped(rawValues, ",").map(value => value.replace(/^"|"$/g, ""));
    params.set(key, [...(params.get(key) ?? []), ...values]);
  }
  return { name, params, value: line.slice(separator + 1) };
};

const unfold = (source: string): string[] => {
  const physical = source.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const logical: string[] = [];
  for (const line of physical) {
    if (logical.length && /(?:^|;)ENCODING=QUOTED-PRINTABLE(?:;|:)/i.test(logical.at(-1) ?? "") && logical.at(-1)?.endsWith("=")) {
      logical[logical.length - 1] = `${logical.at(-1)?.slice(0, -1) ?? ""}${/^[ \t]/.test(line) ? line.slice(1) : line}`;
    }
    else if (/^[ \t]/.test(line) && logical.length) logical[logical.length - 1] += line.slice(1);
    else logical.push(line);
  }
  return logical;
};

const preferred = (property: VCardProperty): boolean =>
  property.params.get("PREF")?.includes("1") === true || property.params.get("TYPE")?.some(value => value.toLowerCase() === "pref") === true;

const propertyTypes = (property: VCardProperty): string[] =>
  [...new Set((property.params.get("TYPE") ?? []).map(value => value.toLowerCase()).filter(value => value !== "pref"))];

const first = (properties: readonly VCardProperty[], name: string): VCardProperty | undefined => properties.find(property => property.name === name);
const all = (properties: readonly VCardProperty[], name: string): VCardProperty[] => properties.filter(property => property.name === name);

const deduplicate = <Value>(values: readonly Value[], key: (value: Value) => string): Value[] => {
  const seen = new Set<string>();
  return values.filter(value => {
    const normalized = key(value).toLowerCase();
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
};

const parseEmail = (property: VCardProperty): ContactEmail => ({
  value: propertyText(property).replace(/^mailto:/i, ""),
  types: propertyTypes(property),
  preferred: preferred(property),
});

const parsePhone = (property: VCardProperty): ContactPhone => ({
  value: propertyText(property).replace(/^tel:/i, ""),
  types: propertyTypes(property),
  preferred: preferred(property),
});

const parseAddress = (property: VCardProperty): ContactAddress => {
  const components = splitUnescaped(decodedPropertyValue(property), ";").map(unescapeText);
  const result: Record<string, unknown> = { types: propertyTypes(property), preferred: preferred(property) };
  const keys = ["poBox", "extended", "street", "locality", "region", "postalCode", "country"] as const;
  for (const [index, key] of keys.entries()) {
    const value = components[index];
    if (value) result[key] = value;
  }
  return result as ContactAddress;
};

const normalizePreferred = <Value extends { preferred: boolean }>(values: Value[]): Value[] => {
  let found = false;
  return values.map(value => {
    if (!value.preferred || !found) {
      if (value.preferred) found = true;
      return value;
    }
    return { ...value, preferred: false };
  });
};

const contactFromProperties = (properties: readonly VCardProperty[]): CreateContactInput => {
  const uid = first(properties, "UID");
  const nameProperty = first(properties, "N");
  const nameParts = splitUnescaped(nameProperty ? decodedPropertyValue(nameProperty) : "", ";").map(unescapeText);
  const nameEntries = ["family", "given", "additional", "prefix", "suffix"] as const;
  const name: Record<string, string> = {};
  for (const [index, key] of nameEntries.entries()) {
    const value = nameParts[index];
    if (value) name[key] = value;
  }
  const emails = normalizePreferred(deduplicate(all(properties, "EMAIL").map(parseEmail), value => value.value));
  const phones = normalizePreferred(deduplicate(all(properties, "TEL").map(parsePhone), value => value.value));
  const organizationProperty = first(properties, "ORG");
  const organization = organizationProperty ? propertyText(organizationProperty) : undefined;
  const fallbackName = [name.prefix, name.given, name.additional, name.family, name.suffix].filter(Boolean).join(" ") || emails[0]?.value.split("@")[0] || organization;
  const candidate: Record<string, unknown> = {
    displayName: propertyText(first(properties, "FN")!) || fallbackName || "Unnamed contact",
    name,
    emails,
    phones,
    addresses: all(properties, "ADR").map(parseAddress),
  };
  if (uid?.value) candidate.uid = propertyText(uid);
  const nickname = first(properties, "NICKNAME");
  const title = first(properties, "TITLE");
  const notes = first(properties, "NOTE");
  if (nickname) candidate.nickname = propertyText(nickname);
  if (organization) candidate.organization = organization;
  if (title) candidate.title = propertyText(title);
  if (notes) candidate.notes = propertyText(notes);
  return createContactSchema.parse(candidate);
};

type MemberReference = { kind: "uid" | "email"; value: string };

const memberReference = (property: VCardProperty): MemberReference => {
  const value = propertyText(property);
  if (/^urn:uuid:/i.test(value)) return { kind: "uid", value: value.slice("urn:uuid:".length) };
  if (/^urn:material-email:/i.test(value)) {
    try {
      return { kind: "uid", value: decodeURIComponent(value.slice("urn:material-email:".length)) };
    } catch {
      throw new VCardParseError("A mailing-list member UID is not valid percent-encoding.");
    }
  }
  if (/^mailto:/i.test(value)) {
    try {
      const address = decodeURIComponent(value.slice("mailto:".length).split("?", 1)[0] ?? "");
      return { kind: "email", value: contactEmailSchema.parse({ value: address }).value };
    } catch (error) {
      throw new VCardParseError("A mailing-list mailto member is not a valid email address.", { cause: error });
    }
  }
  throw new VCardParseError(`Unsupported mailing-list MEMBER URI ${value}.`);
};

const mailingListFromProperties = (properties: readonly VCardProperty[]): ParsedVCardMailingList => {
  const uidProperty = first(properties, "UID");
  const references = all(properties, "MEMBER").map(memberReference);
  const candidate: Record<string, unknown> = {
    name: propertyText(first(properties, "FN")!),
    memberUids: deduplicate(references.filter(reference => reference.kind === "uid").map(reference => reference.value), value => value),
  };
  if (uidProperty) candidate.uid = propertyText(uidProperty);
  const nickname = first(properties, "NICKNAME");
  const description = first(properties, "NOTE");
  if (nickname) candidate.nickname = propertyText(nickname);
  if (description) candidate.description = propertyText(description);
  return {
    ...createMailingListSchema.parse(candidate),
    memberEmailAddresses: deduplicate(
      references.filter(reference => reference.kind === "email").map(reference => reference.value),
      value => value,
    ),
  };
};

export const parseVCardBundle = (source: string): ParsedVCardBundle => {
  if (Buffer.byteLength(source, "utf8") > MAX_VCARD_BYTES) throw new VCardParseError("The vCard input exceeds the 5 MiB local import limit.");
  const cards: VCardProperty[][] = [];
  let current: VCardProperty[] | null = null;
  for (const rawLine of unfold(source)) {
    const line = rawLine.trimEnd();
    if (!line) continue;
    if (line.toUpperCase() === "BEGIN:VCARD") {
      if (current) throw new VCardParseError("Nested vCards are not supported.");
      current = [];
      continue;
    }
    if (line.toUpperCase() === "END:VCARD") {
      if (!current) throw new VCardParseError("A vCard ended without beginning.");
      cards.push(current);
      if (cards.length > MAX_VCARDS) throw new VCardParseError("The vCard input contains too many cards.");
      current = null;
      continue;
    }
    if (current) current.push(parseProperty(line));
    else throw new VCardParseError("Text outside a vCard block is not supported.");
  }
  if (current) throw new VCardParseError("A vCard block is missing END:VCARD.");
  if (!cards.length) throw new VCardParseError("No vCard records were found.");

  const contacts: CreateContactInput[] = [];
  const mailingLists: ParsedVCardMailingList[] = [];
  const contactUids = new Set<string>();
  const listUids = new Set<string>();
  for (const properties of cards) {
    const versions = all(properties, "VERSION");
    if (versions.length !== 1) throw new VCardParseError("Each vCard must contain exactly one VERSION property.");
    const version = decodedPropertyValue(versions[0]!);
    if (version !== "3.0" && version !== "4.0") throw new VCardParseError(`Unsupported vCard version ${version}.`);
    if (all(properties, "UID").length > 1) throw new VCardParseError("A vCard cannot contain more than one UID property.");
    if (all(properties, "FN").length !== 1) throw new VCardParseError("Each vCard must contain exactly one FN property.");
    if (all(properties, "KIND").length > 1) throw new VCardParseError("A vCard cannot contain more than one KIND property.");
    const kind = first(properties, "KIND");
    const isGroup = kind ? decodedPropertyValue(kind).toLowerCase() === "group" : false;
    if (isGroup) {
      const mailingList = mailingListFromProperties(properties);
      if (mailingList.uid && listUids.has(mailingList.uid)) throw new VCardParseError(`Duplicate mailing-list UID ${mailingList.uid}.`);
      if (mailingList.uid) listUids.add(mailingList.uid);
      mailingLists.push(mailingList);
    } else {
      const contact = contactFromProperties(properties);
      if (contact.uid && contactUids.has(contact.uid)) throw new VCardParseError(`Duplicate contact UID ${contact.uid}.`);
      if (contact.uid) contactUids.add(contact.uid);
      contacts.push(contact);
    }
  }
  return { contacts, mailingLists };
};
