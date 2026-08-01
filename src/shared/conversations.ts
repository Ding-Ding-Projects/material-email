import type { MessageSummary } from "./contracts.js";

export const CACHED_CONVERSATION_MESSAGE_LIMIT = 2_000;
export const CACHED_CONVERSATION_REFERENCE_LIMIT = 100;
const CACHED_CONVERSATION_SUBJECT_LIMIT = 4_096;

export interface CachedConversation {
  id: string;
  subject: string;
  messages: MessageSummary[];
  unreadCount: number;
  accountIds: string[];
}

export interface CachedConversationGrouping {
  conversations: CachedConversation[];
  limited: boolean;
}

const replyPrefix = /^(?:re|fw|fwd)\s*(?:\[\d{1,4}\])?\s*:\s*/iu;

export const conversationSubject = (subject: string): string => {
  let value = subject.normalize("NFKC").slice(0, CACHED_CONVERSATION_SUBJECT_LIMIT).trim().replace(/\s+/gu, " ");
  for (let count = 0; count < 20; count += 1) {
    const next = value.replace(replyPrefix, "").trim();
    if (next === value) break;
    value = next;
  }
  return value;
};

export const normalizedConversationSubject = (subject: string): string => conversationSubject(subject).toLocaleLowerCase("en-US");

export const normalizedMessageReference = (value: string): string | null => {
  const trimmed = value.normalize("NFKC").trim();
  if (!trimmed || trimmed.length > 4_096) return null;
  const bracketed = /^<([^<>\s]+)>$/u.exec(trimmed)?.[1];
  const candidate = (bracketed ?? trimmed).trim();
  if (!candidate || /\s/u.test(candidate)) return null;
  return candidate.toLocaleLowerCase("en-US");
};

const dateValue = (message: MessageSummary): number => {
  const parsed = Date.parse(message.date);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
};

const newestFirst = (left: MessageSummary, right: MessageSummary): number =>
  dateValue(right) - dateValue(left) || left.id.localeCompare(right.id);

const singleton = (message: MessageSummary): CachedConversation => ({
  id: `message:${message.id}`,
  subject: conversationSubject(message.subject) || message.subject,
  messages: [message],
  unreadCount: message.unread ? 1 : 0,
  accountIds: [message.accountId],
});

const referenceTokens = (message: MessageSummary): string[] => {
  const values = [message.messageId, message.inReplyTo, ...(message.references ?? []).slice(0, CACHED_CONVERSATION_REFERENCE_LIMIT)];
  return [...new Set(values.flatMap(value => {
    if (!value) return [];
    const normalized = normalizedMessageReference(value);
    return normalized ? [normalized] : [];
  }))];
};

export const groupCachedConversations = (messages: readonly MessageSummary[]): CachedConversationGrouping => {
  if (messages.length > CACHED_CONVERSATION_MESSAGE_LIMIT) {
    return { conversations: messages.map(singleton), limited: true };
  }
  const parents = messages.map((_message, index) => index);
  const find = (start: number): number => {
    let root = start;
    while ((parents[root] ?? root) !== root) root = parents[root] ?? root;
    let current = start;
    while ((parents[current] ?? current) !== current) {
      const next = parents[current] ?? current;
      parents[current] = root;
      current = next;
    }
    return root;
  };
  const union = (left: number, right: number): void => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parents[rightRoot] = leftRoot;
  };
  const subjects = new Map<string, number>();
  const references = new Map<string, number>();

  messages.forEach((message, index) => {
    const subject = normalizedConversationSubject(message.subject);
    if (subject && subject !== "(no subject)") {
      const existing = subjects.get(subject);
      if (existing === undefined) subjects.set(subject, index);
      else union(existing, index);
    }
    for (const token of referenceTokens(message)) {
      const existing = references.get(token);
      if (existing === undefined) references.set(token, index);
      else union(existing, index);
    }
  });

  const components = new Map<number, MessageSummary[]>();
  messages.forEach((message, index) => {
    const root = find(index);
    const component = components.get(root);
    if (component) component.push(message);
    else components.set(root, [message]);
  });

  const conversations = [...components.values()].map(component => {
    const sorted = component.sort(newestFirst);
    const newest = sorted[0];
    if (!newest) throw new Error("A cached conversation cannot be empty.");
    return {
      id: `conversation:${component.map(message => message.id).sort()[0] ?? newest.id}`,
      subject: conversationSubject(newest.subject) || newest.subject,
      messages: sorted,
      unreadCount: sorted.filter(message => message.unread).length,
      accountIds: [...new Set(sorted.map(message => message.accountId))].sort(),
    } satisfies CachedConversation;
  });
  conversations.sort((left, right) => newestFirst(left.messages[0]!, right.messages[0]!) || left.id.localeCompare(right.id));
  return { conversations, limited: false };
};
