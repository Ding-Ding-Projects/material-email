import type { MessageSummary } from "./contracts.js";

export const MESSAGE_TAG_NAME_LIMIT = 64;
export const MESSAGE_TAG_CATALOG_LIMIT = 64;
export const MESSAGE_TAGS_PER_MESSAGE_LIMIT = 20;
export const MESSAGE_TAG_ASSIGNMENT_LIMIT = 20_000;

const TAG_KEY_SEPARATOR = "\u0000";
const COLOUR_PATTERN = /^#[0-9a-f]{6}$/u;

export interface MessageTag {
  id: string;
  name: string;
  colour: string;
  ordinal: number;
  builtIn: boolean;
}

/** One message's tag identifiers, keyed by {@link messageTagKey}. */
export type MessageTagAssignments = Readonly<Record<string, readonly string[]>>;

export interface MessageTagState {
  catalog: readonly MessageTag[];
  assignments: MessageTagAssignments;
}

export const BUILT_IN_MESSAGE_TAGS: readonly MessageTag[] = Object.freeze([
  { id: "important", name: "Important", colour: "#c62828", ordinal: 0, builtIn: true },
  { id: "work", name: "Work", colour: "#1565c0", ordinal: 1, builtIn: true },
  { id: "personal", name: "Personal", colour: "#2e7d32", ordinal: 2, builtIn: true },
  { id: "to-do", name: "To Do", colour: "#ef6c00", ordinal: 3, builtIn: true },
  { id: "later", name: "Later", colour: "#6a1b9a", ordinal: 4, builtIn: true },
].map(tag => Object.freeze(tag)));

export const builtInMessageTags = (): MessageTag[] => BUILT_IN_MESSAGE_TAGS.map(tag => ({ ...tag }));

export const emptyMessageTagState = (): MessageTagState => ({ catalog: builtInMessageTags(), assignments: {} });

/**
 * A message's tag key. Tags follow a message across a move, so the key is bound to the mailbox
 * generation that produced the UID rather than to the folder path alone.
 */
export const messageTagKey = (accountId: string, folderPath: string, uid: number, uidValidity?: string): string =>
  [accountId, folderPath, uidValidity ?? "", String(uid)].join(TAG_KEY_SEPARATOR);

export const messageTagKeyFor = (message: Pick<MessageSummary, "accountId" | "folderPath" | "uid" | "uidValidity">): string =>
  messageTagKey(message.accountId, message.folderPath, message.uid, message.uidValidity);

/** The account a tag key belongs to, or null when the key is not one this build produced. */
export const messageTagKeyAccountId = (key: string): string | null => {
  const parts = key.split(TAG_KEY_SEPARATOR);
  return parts.length === 4 && parts[0] ? parts[0] : null;
};

/** The folder a tag key belongs to, or null when the key is not one this build produced. */
export const messageTagKeyFolderPath = (key: string): string | null => {
  const parts = key.split(TAG_KEY_SEPARATOR);
  return parts.length === 4 && parts[1] !== undefined ? parts[1] : null;
};

export const normalizeMessageTagName = (value: string): string =>
  value.normalize("NFKC").replace(/\s+/gu, " ").trim().slice(0, MESSAGE_TAG_NAME_LIMIT);

export const normalizeMessageTagColour = (value: string): string | null => {
  const candidate = value.trim().toLowerCase();
  const expanded = /^#[0-9a-f]{3}$/u.test(candidate)
    ? `#${[...candidate.slice(1)].map(character => `${character}${character}`).join("")}`
    : candidate;
  return COLOUR_PATTERN.test(expanded) ? expanded : null;
};

export const messageTagId = (name: string): string => {
  const slug = normalizeMessageTagName(name)
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, MESSAGE_TAG_NAME_LIMIT);
  return slug || "tag";
};

const uniqueTagId = (candidate: string, taken: ReadonlySet<string>): string => {
  if (!taken.has(candidate)) return candidate;
  for (let suffix = 2; suffix <= MESSAGE_TAG_CATALOG_LIMIT + 1; suffix += 1) {
    const next = `${candidate}-${suffix}`;
    if (!taken.has(next)) return next;
  }
  return `${candidate}-${taken.size + 1}`;
};

export const sortMessageTags = (tags: readonly MessageTag[]): MessageTag[] =>
  [...tags].sort((left, right) => left.ordinal - right.ordinal || left.name.localeCompare(right.name) || left.id.localeCompare(right.id));

export class MessageTagError extends Error {
  readonly code: "TAG_NAME_REQUIRED" | "TAG_COLOUR_INVALID" | "TAG_LIMIT_REACHED" | "TAG_NAME_TAKEN" | "TAG_NOT_FOUND" | "TAG_BUILT_IN";

  constructor(code: MessageTagError["code"], message: string) {
    super(message);
    this.name = "MessageTagError";
    this.code = code;
  }
}

const assertName = (name: string): string => {
  const normalized = normalizeMessageTagName(name);
  if (!normalized) throw new MessageTagError("TAG_NAME_REQUIRED", "A tag needs a name.");
  return normalized;
};

const assertColour = (colour: string): string => {
  const normalized = normalizeMessageTagColour(colour);
  if (!normalized) throw new MessageTagError("TAG_COLOUR_INVALID", "A tag colour must be a six-digit hexadecimal value such as #1565c0.");
  return normalized;
};

const assertNameAvailable = (catalog: readonly MessageTag[], name: string, exceptId?: string): void => {
  const folded = name.toLocaleLowerCase("en-US");
  if (catalog.some(tag => tag.id !== exceptId && tag.name.toLocaleLowerCase("en-US") === folded)) {
    throw new MessageTagError("TAG_NAME_TAKEN", `A tag named ${name} already exists.`);
  }
};

export const createMessageTag = (catalog: readonly MessageTag[], input: { name: string; colour: string }): MessageTag => {
  if (catalog.length >= MESSAGE_TAG_CATALOG_LIMIT) {
    throw new MessageTagError("TAG_LIMIT_REACHED", `Material Email keeps at most ${MESSAGE_TAG_CATALOG_LIMIT} tags.`);
  }
  const name = assertName(input.name);
  assertNameAvailable(catalog, name);
  const colour = assertColour(input.colour);
  const ordinal = catalog.reduce((highest, tag) => Math.max(highest, tag.ordinal), -1) + 1;
  return { id: uniqueTagId(messageTagId(name), new Set(catalog.map(tag => tag.id))), name, colour, ordinal, builtIn: false };
};

export const updateMessageTag = (
  catalog: readonly MessageTag[],
  id: string,
  patch: { name?: string; colour?: string; ordinal?: number },
): MessageTag[] => {
  const existing = catalog.find(tag => tag.id === id);
  if (!existing) throw new MessageTagError("TAG_NOT_FOUND", "That tag no longer exists.");
  const name = patch.name === undefined ? existing.name : assertName(patch.name);
  if (patch.name !== undefined) assertNameAvailable(catalog, name, id);
  const colour = patch.colour === undefined ? existing.colour : assertColour(patch.colour);
  const ordinal = patch.ordinal === undefined || !Number.isSafeInteger(patch.ordinal)
    ? existing.ordinal
    : Math.max(0, Math.min(MESSAGE_TAG_CATALOG_LIMIT, patch.ordinal));
  return sortMessageTags(catalog.map(tag => (tag.id === id ? { ...tag, name, colour, ordinal } : tag)));
};

export const deleteMessageTag = (state: MessageTagState, id: string): MessageTagState => {
  const existing = state.catalog.find(tag => tag.id === id);
  if (!existing) throw new MessageTagError("TAG_NOT_FOUND", "That tag no longer exists.");
  if (existing.builtIn) throw new MessageTagError("TAG_BUILT_IN", "Built-in tags can be renamed or recoloured, but not removed.");
  const assignments: Record<string, string[]> = {};
  for (const [key, ids] of Object.entries(state.assignments)) {
    const remaining = ids.filter(value => value !== id);
    if (remaining.length) assignments[key] = remaining;
  }
  return { catalog: state.catalog.filter(tag => tag.id !== id), assignments };
};

export const messageTagsFor = (state: MessageTagState, key: string): MessageTag[] => {
  const ids = new Set(state.assignments[key] ?? []);
  return sortMessageTags(state.catalog.filter(tag => ids.has(tag.id)));
};

export const setMessageTags = (state: MessageTagState, key: string, tagIds: readonly string[]): MessageTagState => {
  const known = new Set(state.catalog.map(tag => tag.id));
  const ordered = sortMessageTags(state.catalog.filter(tag => tagIds.includes(tag.id) && known.has(tag.id))).map(tag => tag.id);
  const bounded = ordered.slice(0, MESSAGE_TAGS_PER_MESSAGE_LIMIT);
  const assignments: Record<string, readonly string[]> = { ...state.assignments };
  if (bounded.length) assignments[key] = bounded;
  else delete assignments[key];
  return { catalog: state.catalog, assignments: boundAssignments(assignments) };
};

export const toggleMessageTag = (state: MessageTagState, key: string, tagId: string, applied: boolean): MessageTagState => {
  if (!state.catalog.some(tag => tag.id === tagId)) throw new MessageTagError("TAG_NOT_FOUND", "That tag no longer exists.");
  const current = state.assignments[key] ?? [];
  const next = applied ? [...new Set([...current, tagId])] : current.filter(value => value !== tagId);
  return setMessageTags(state, key, next);
};

/**
 * Moves a message's tags to the key its new mailbox generation produced. A move that the server
 * could not attribute (no destination UID) drops the assignment rather than tagging a stranger.
 */
export const retagMovedMessage = (state: MessageTagState, fromKey: string, toKey: string | null): MessageTagState => {
  const ids = state.assignments[fromKey];
  if (!ids) return state;
  const assignments: Record<string, readonly string[]> = { ...state.assignments };
  delete assignments[fromKey];
  if (toKey) assignments[toKey] = ids;
  return { catalog: state.catalog, assignments: boundAssignments(assignments) };
};

export const forgetMessageTags = (state: MessageTagState, predicate: (key: string) => boolean): MessageTagState => {
  const assignments: Record<string, readonly string[]> = {};
  for (const [key, ids] of Object.entries(state.assignments)) if (!predicate(key)) assignments[key] = ids;
  return { catalog: state.catalog, assignments };
};

const boundAssignments = (assignments: Record<string, readonly string[]>): MessageTagAssignments => {
  const entries = Object.entries(assignments);
  if (entries.length <= MESSAGE_TAG_ASSIGNMENT_LIMIT) return assignments;
  return Object.fromEntries(entries.slice(entries.length - MESSAGE_TAG_ASSIGNMENT_LIMIT));
};

export const messageTagUsageCounts = (state: MessageTagState): Record<string, number> => {
  const counts: Record<string, number> = Object.fromEntries(state.catalog.map(tag => [tag.id, 0]));
  for (const ids of Object.values(state.assignments)) {
    for (const id of new Set(ids)) if (id in counts) counts[id] = (counts[id] ?? 0) + 1;
  }
  return counts;
};
