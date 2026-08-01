import type { FolderSummary, MessageSummary, UnifiedFolderKind } from "./contracts.js";

export interface UnifiedFolderCache {
  accountIds: readonly string[];
  folders: Readonly<Record<string, readonly FolderSummary[]>>;
  messages: Readonly<Record<string, readonly MessageSummary[]>>;
}

const CACHE_KEY_SEPARATOR = "\u0000";

const cacheKeyParts = (key: string): { accountId: string; folderPath: string } | null => {
  const separator = key.indexOf(CACHE_KEY_SEPARATOR);
  if (separator <= 0 || separator === key.length - 1) return null;
  return { accountId: key.slice(0, separator), folderPath: key.slice(separator + 1) };
};

const messageDate = (message: MessageSummary): number => {
  const parsed = Date.parse(message.date);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
};

export const collectCachedUnifiedMessages = (
  folder: UnifiedFolderKind,
  cache: UnifiedFolderCache,
): MessageSummary[] => {
  const accountIds = new Set(cache.accountIds);
  const inboxCollections = new Set(
    cache.accountIds.flatMap(accountId =>
      (cache.folders[accountId] ?? [])
        .filter(candidate => candidate.role === "inbox")
        .map(candidate => `${accountId}${CACHE_KEY_SEPARATOR}${candidate.path}`),
    ),
  );
  const unique = new Map<string, MessageSummary>();

  for (const [key, messages] of Object.entries(cache.messages).sort(([left], [right]) => left.localeCompare(right))) {
    const parts = cacheKeyParts(key);
    if (!parts || !accountIds.has(parts.accountId)) continue;
    if (folder === "inbox" && !inboxCollections.has(key)) continue;
    for (const message of messages) {
      if (message.accountId !== parts.accountId || message.folderPath !== parts.folderPath) continue;
      if (folder === "starred" && !message.starred) continue;
      if (folder === "unread" && !message.unread) continue;
      if (!unique.has(message.id)) unique.set(message.id, message);
    }
  }

  return [...unique.values()].sort((left, right) => {
    const dateDifference = messageDate(right) - messageDate(left);
    return dateDifference || left.id.localeCompare(right.id);
  });
};

export const selectStableMessageId = (
  messages: readonly MessageSummary[],
  previousMessageId: string | null,
  previousIndex = 0,
): string | null => {
  if (!messages.length) return null;
  if (previousMessageId && messages.some(message => message.id === previousMessageId)) return previousMessageId;
  const boundedIndex = Math.max(0, Math.min(previousIndex, messages.length - 1));
  return messages[boundedIndex]?.id ?? null;
};
