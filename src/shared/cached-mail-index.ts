import type {
  AccountSummary,
  CachedMailSearchField,
  CachedMailSearchHit,
  CachedMailSearchQuery,
  CachedMailSearchResult,
  FolderSummary,
  MessageDetail,
  MessageSummary,
} from "./contracts.js";
import { groupCachedConversations } from "./conversations.js";
import { createMatcher, validatePattern } from "./regex.js";

export const CACHED_MAIL_INDEX_DOCUMENT_LIMIT = 2_000;
export const CACHED_MAIL_INDEX_RESULT_LIMIT = 200;
export const CACHED_MAIL_INDEX_BODY_CHARACTERS = 4_096;
const CACHE_KEY_SEPARATOR = "\u0000";

export interface CachedMailIndexSource {
  accounts: readonly AccountSummary[];
  folders: Readonly<Record<string, readonly FolderSummary[]>>;
  messages: Readonly<Record<string, readonly MessageSummary[]>>;
  details: Readonly<Record<string, MessageDetail>>;
}

interface IndexedField {
  key: CachedMailSearchField;
  raw: string;
  normalized: string;
}

/**
 * Exported so a derived on-disk index (see `src/main/cached-mail-sqlite-index.ts`) can persist
 * and reload exactly this shape without re-deriving it — the SQLite cache stores each document's
 * `JSON.stringify` verbatim, so a round trip through it is byte-identical to building fresh.
 */
export interface CachedMailIndexDocument {
  message: MessageSummary;
  snippet: string;
  account: CachedMailSearchHit["account"];
  folder: CachedMailSearchHit["folder"];
  conversation: CachedMailSearchHit["conversation"];
  fields: IndexedField[];
}

export interface CachedMailIndex {
  documents: readonly CachedMailIndexDocument[];
  documentLimitReached: boolean;
}

const normalizedText = (value: string, caseInsensitive = true): string => {
  const normalized = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  return caseInsensitive ? normalized.toLocaleLowerCase("en-US") : normalized;
};

const addressText = (message: MessageSummary): string =>
  [...message.from, ...message.to, ...message.cc].map(address => `${address.name} ${address.address}`).join("\n");

const dateValue = (message: MessageSummary): number => {
  const parsed = Date.parse(message.date);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
};

const cacheParts = (key: string): { accountId: string; folderPath: string } | null => {
  const separator = key.indexOf(CACHE_KEY_SEPARATOR);
  if (separator <= 0 || separator === key.length - 1) return null;
  return { accountId: key.slice(0, separator), folderPath: key.slice(separator + 1) };
};

export const createCachedMailIndex = (source: CachedMailIndexSource): CachedMailIndex => {
  const accounts = new Map(source.accounts.map(account => [account.id, account]));
  const folders = new Map<string, FolderSummary>();
  for (const account of source.accounts) {
    for (const folder of source.folders[account.id] ?? []) folders.set(`${account.id}${CACHE_KEY_SEPARATOR}${folder.path}`, folder);
  }
  const selected: Array<{ message: MessageSummary; account: AccountSummary; folder: FolderSummary; body: string }> = [];
  const identities = new Set<string>();
  let documentLimitReached = false;

  outer: for (const [key, messages] of Object.entries(source.messages).sort(([left], [right]) => left.localeCompare(right))) {
    const parts = cacheParts(key);
    const account = parts ? accounts.get(parts.accountId) : undefined;
    const folder = parts ? folders.get(key) : undefined;
    if (!parts || !account || !folder) continue;
    for (const message of [...messages].sort((left, right) => dateValue(right) - dateValue(left) || left.id.localeCompare(right.id))) {
      if (message.accountId !== parts.accountId || message.folderPath !== parts.folderPath || identities.has(message.id)) continue;
      if (selected.length >= CACHED_MAIL_INDEX_DOCUMENT_LIMIT) {
        documentLimitReached = true;
        break outer;
      }
      identities.add(message.id);
      selected.push({ message, account, folder, body: source.details[message.id]?.text.slice(0, CACHED_MAIL_INDEX_BODY_CHARACTERS) ?? "" });
    }
  }

  const conversations = groupCachedConversations(selected.map(item => item.message)).conversations;
  const conversationByMessage = new Map<string, CachedMailSearchHit["conversation"]>();
  for (const conversation of conversations) {
    const attribution = { id: conversation.id, subject: conversation.subject, messageCount: conversation.messages.length };
    for (const message of conversation.messages) conversationByMessage.set(message.id, attribution);
  }
  const documents = selected.map(({ message, account, folder, body }) => {
    const conversation = conversationByMessage.get(message.id) ?? { id: `message:${message.id}`, subject: message.subject, messageCount: 1 };
    const rawFields: Array<[CachedMailSearchField, string]> = [
      ["subject", message.subject],
      ["addresses", addressText(message)],
      ["preview", message.preview],
      ["body", body],
      ["account", `${account.displayName}\n${account.email}`],
      ["folder", `${folder.name}\n${folder.path}`],
      ["conversation", conversation.subject],
    ];
    return {
      message,
      snippet: (body || message.preview).slice(0, 500),
      account: { id: account.id, displayName: account.displayName, email: account.email },
      folder: { path: folder.path, name: folder.name, role: folder.role },
      conversation,
      fields: rawFields.map(([key, raw]) => ({ key, raw, normalized: normalizedText(raw) })),
    } satisfies CachedMailIndexDocument;
  }).sort((left, right) => dateValue(right.message) - dateValue(left.message) || left.message.id.localeCompare(right.message.id));
  return { documents, documentLimitReached };
};

export const searchCachedMailIndex = (index: CachedMailIndex, query: CachedMailSearchQuery): CachedMailSearchResult => {
  const validation = validatePattern(query);
  if (!validation.valid) throw new Error(validation.message);
  const resultLimit = Math.max(1, Math.min(Math.trunc(query.limit), CACHED_MAIL_INDEX_RESULT_LIMIT));
  const caseInsensitive = validation.normalizedFlags.includes("i");
  const matcher = query.mode === "plain"
    ? createMatcher({ ...query, pattern: normalizedText(query.pattern, caseInsensitive), flags: validation.normalizedFlags })
    : createMatcher({ ...query, flags: validation.normalizedFlags });
  const hits: CachedMailSearchHit[] = [];
  let totalMatched = 0;
  for (const document of index.documents) {
    const matchedFields = document.fields
      .filter(field => matcher(query.mode === "plain" ? (caseInsensitive ? field.normalized : normalizedText(field.raw, false)) : field.raw))
      .map(field => field.key);
    if (!matchedFields.length) continue;
    totalMatched += 1;
    if (hits.length < resultLimit) {
      hits.push({
        message: document.message,
        snippet: document.snippet,
        matchedFields,
        account: document.account,
        folder: document.folder,
        conversation: document.conversation,
      });
    }
  }
  return {
    hits,
    totalMatched,
    indexedDocumentCount: index.documents.length,
    documentLimit: CACHED_MAIL_INDEX_DOCUMENT_LIMIT,
    documentLimitReached: index.documentLimitReached,
    resultLimit,
  };
};
