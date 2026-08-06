import { randomUUID } from "node:crypto";
import type {
  FolderSummary,
  JunkSummary,
  MessageFilter,
  MessageFilterInput,
  MessageSummary,
  MessageTagAssignmentMap,
  MessageTagCatalog,
} from "../shared/contracts.js";
import {
  MESSAGE_FILTER_ACTION_LIMIT,
  MESSAGE_FILTER_CONDITION_LIMIT,
  MESSAGE_FILTER_LIMIT,
  MESSAGE_FILTER_NAME_LIMIT,
  MessageFilterError,
  planMessageFilterRun,
  sortMessageFilters,
  validateMessageFilter,
  type MessageFilterRunPlan,
  type MessageFilterSubject,
} from "../shared/message-filters.js";
import {
  MessageTagError,
  createMessageTag,
  deleteMessageTag,
  emptyMessageTagState,
  forgetMessageTags,
  messageTagKey,
  messageTagKeyAccountId,
  messageTagKeyFolderPath,
  messageTagUsageCounts,
  retagMovedMessage,
  setMessageTags,
  sortMessageTags,
  updateMessageTag,
  type MessageTagState,
} from "../shared/message-tags.js";
import {
  JUNK_SCORE_THRESHOLD_DEFAULT,
  assessJunk,
  emptyJunkModel,
  junkModelSummary,
  junkSampleFromMessage,
  trainJunkModel,
  type JunkAssessment,
  type JunkModel,
} from "../shared/junk-classifier.js";
import type { PersistedState } from "./persisted-state.js";

const FILTER_PREVIEW_ENTRY_LIMIT = 200;

/** Cached collections are keyed `accountId\u0000folderPath`; this mirrors app-service's folderKey. */
const CACHE_KEY_SEPARATOR = "\u0000";

export const messageTagStateOf = (state: PersistedState): MessageTagState => state.messageTags ?? emptyMessageTagState();

export const junkModelOf = (state: PersistedState): JunkModel => state.junkModel ?? emptyJunkModel();

export const cachedMessages = (state: PersistedState, accountId?: string, folderPath?: string): MessageSummary[] => {
  const rows: MessageSummary[] = [];
  for (const [key, messages] of Object.entries(state.messages)) {
    const separator = key.indexOf(CACHE_KEY_SEPARATOR);
    if (separator <= 0) continue;
    const keyAccount = key.slice(0, separator);
    const keyFolder = key.slice(separator + 1);
    if (accountId !== undefined && keyAccount !== accountId) continue;
    if (folderPath !== undefined && keyFolder !== folderPath) continue;
    rows.push(...messages);
  }
  return rows;
};

export const tagCatalogOf = (state: PersistedState): MessageTagCatalog => {
  const tags = messageTagStateOf(state);
  return { tags: sortMessageTags(tags.catalog), usage: messageTagUsageCounts(tags) };
};

/**
 * Maps every cached message to the tags applied to it. The renderer works in message identifiers,
 * so the mailbox-generation-bound storage key never leaves the main process.
 */
export const tagAssignmentMapOf = (state: PersistedState): MessageTagAssignmentMap => {
  const tags = messageTagStateOf(state);
  const map: MessageTagAssignmentMap = {};
  for (const message of cachedMessages(state)) {
    const applied = tags.assignments[messageTagKey(message.accountId, message.folderPath, message.uid, message.uidValidity)];
    if (applied?.length) map[message.id] = [...applied];
  }
  return map;
};

export const tagIdsForMessage = (state: PersistedState, message: MessageSummary): string[] => [
  ...(messageTagStateOf(state).assignments[messageTagKey(message.accountId, message.folderPath, message.uid, message.uidValidity)] ?? []),
];

export const addMessageTag = (draft: PersistedState, name: string, colour: string): MessageTagCatalog => {
  const current = messageTagStateOf(draft);
  const tag = createMessageTag(current.catalog, { name, colour });
  draft.messageTags = { catalog: sortMessageTags([...current.catalog, tag]), assignments: current.assignments };
  return tagCatalogOf(draft);
};

export const editMessageTag = (
  draft: PersistedState,
  id: string,
  patch: { name?: string; colour?: string; ordinal?: number },
): MessageTagCatalog => {
  const current = messageTagStateOf(draft);
  draft.messageTags = { catalog: updateMessageTag(current.catalog, id, patch), assignments: current.assignments };
  return tagCatalogOf(draft);
};

export const removeMessageTag = (draft: PersistedState, id: string): MessageTagCatalog => {
  draft.messageTags = deleteMessageTag(messageTagStateOf(draft), id);
  return tagCatalogOf(draft);
};

export const applyMessageTags = (
  draft: PersistedState,
  message: Pick<MessageSummary, "accountId" | "folderPath" | "uid" | "uidValidity">,
  tagIds: readonly string[],
): string[] => {
  const key = messageTagKey(message.accountId, message.folderPath, message.uid, message.uidValidity);
  const next = setMessageTags(messageTagStateOf(draft), key, tagIds);
  draft.messageTags = next;
  return [...(next.assignments[key] ?? [])];
};

/**
 * The catalogue names {@link applyMessageTags} would leave on a message, computed without mutating
 * persisted state. A caller uses this to know exactly what to ask the mail server to keep as IMAP
 * keywords before committing the same change locally.
 */
export const previewMessageTagNames = (
  state: PersistedState,
  message: Pick<MessageSummary, "accountId" | "folderPath" | "uid" | "uidValidity">,
  tagIds: readonly string[],
): string[] => {
  const key = messageTagKey(message.accountId, message.folderPath, message.uid, message.uidValidity);
  const current = messageTagStateOf(state);
  const next = setMessageTags(current, key, tagIds);
  const applied = next.assignments[key] ?? [];
  return applied.map(id => current.catalog.find(tag => tag.id === id)?.name).filter((name): name is string => Boolean(name));
};

export const carryTagsThroughMove = (
  draft: PersistedState,
  from: { accountId: string; folderPath: string; uid: number; uidValidity?: string },
  to: { folderPath: string; uid?: number; uidValidity?: string } | null,
): void => {
  const fromKey = messageTagKey(from.accountId, from.folderPath, from.uid, from.uidValidity);
  const toKey = to && to.uid !== undefined
    ? messageTagKey(from.accountId, to.folderPath, to.uid, to.uidValidity)
    : null;
  draft.messageTags = retagMovedMessage(messageTagStateOf(draft), fromKey, toKey);
};

export const forgetAccountTags = (draft: PersistedState, accountId: string): void => {
  draft.messageTags = forgetMessageTags(messageTagStateOf(draft), key => messageTagKeyAccountId(key) === accountId);
};

export const forgetFolderTags = (draft: PersistedState, accountId: string, folderPath: string): void => {
  draft.messageTags = forgetMessageTags(
    messageTagStateOf(draft),
    key => messageTagKeyAccountId(key) === accountId && messageTagKeyFolderPath(key) === folderPath,
  );
};

export const listFilters = (state: PersistedState): MessageFilter[] => sortMessageFilters(state.messageFilters ?? []);

export const upsertFilter = (draft: PersistedState, input: MessageFilterInput): MessageFilter[] => {
  const existing = listFilters(draft);
  const name = input.name.trim().slice(0, MESSAGE_FILTER_NAME_LIMIT);
  const current = input.id ? existing.find(filter => filter.id === input.id) : undefined;
  if (input.id && !current) throw new MessageFilterError("FILTER_NOT_FOUND", "That filter no longer exists.");
  if (!current && existing.length >= MESSAGE_FILTER_LIMIT) {
    throw new MessageFilterError("FILTER_LIMIT_REACHED", `Material Email keeps at most ${MESSAGE_FILTER_LIMIT} filters.`);
  }
  const candidate: MessageFilter = {
    id: current?.id ?? randomUUID(),
    name,
    enabled: input.enabled,
    ordinal: current?.ordinal ?? existing.reduce((highest, filter) => Math.max(highest, filter.ordinal), -1) + 1,
    match: input.match,
    runOnSync: input.runOnSync,
    accountId: input.accountId,
    conditions: input.conditions.slice(0, MESSAGE_FILTER_CONDITION_LIMIT),
    actions: input.actions.slice(0, MESSAGE_FILTER_ACTION_LIMIT),
  };
  validateMessageFilter(candidate);
  draft.messageFilters = sortMessageFilters([...existing.filter(filter => filter.id !== candidate.id), candidate]);
  return listFilters(draft);
};

export const removeFilter = (draft: PersistedState, id: string): MessageFilter[] => {
  const existing = listFilters(draft);
  if (!existing.some(filter => filter.id === id)) throw new MessageFilterError("FILTER_NOT_FOUND", "That filter no longer exists.");
  draft.messageFilters = existing.filter(filter => filter.id !== id).map((filter, index) => ({ ...filter, ordinal: index }));
  return listFilters(draft);
};

export const reorderFilters = (draft: PersistedState, orderedIds: readonly string[]): MessageFilter[] => {
  const existing = listFilters(draft);
  const byId = new Map(existing.map(filter => [filter.id, filter]));
  const ordered: MessageFilter[] = [];
  for (const id of orderedIds) {
    const filter = byId.get(id);
    if (!filter || ordered.some(candidate => candidate.id === id)) continue;
    ordered.push(filter);
    byId.delete(id);
  }
  // Anything the caller did not mention keeps its relative order behind the ones that were listed.
  ordered.push(...existing.filter(filter => byId.has(filter.id)));
  draft.messageFilters = ordered.map((filter, index) => ({ ...filter, ordinal: index }));
  return listFilters(draft);
};

export interface FilterRunContext {
  accountId: string;
  folderPath: string;
  accountEmail: string;
  folders: readonly FolderSummary[];
}

export const buildFilterSubjects = (
  state: PersistedState,
  context: FilterRunContext,
  options: { messageIds?: ReadonlySet<string> } = {},
): MessageFilterSubject[] => {
  const folderName = context.folders.find(folder => folder.path === context.folderPath)?.name ?? context.folderPath;
  const wanted = options.messageIds;
  return cachedMessages(state, context.accountId, context.folderPath).filter(message => !wanted || wanted.has(message.id)).map(message => {
    const detail = state.details[message.id];
    const body = detail?.text;
    return {
      message,
      accountEmail: context.accountEmail,
      folderName,
      tagIds: tagIdsForMessage(state, message),
      ...(body ? { body } : {}),
    } satisfies MessageFilterSubject;
  });
};

export const planFilterRun = (
  state: PersistedState,
  context: FilterRunContext,
  options: { runOnSyncOnly?: boolean; now?: number; messageIds?: ReadonlySet<string> } = {},
): MessageFilterRunPlan => {
  const { messageIds, ...run } = options;
  return planMessageFilterRun(listFilters(state), buildFilterSubjects(state, context, messageIds ? { messageIds } : {}), run);
};

export const summarizeFilterPlan = (
  plan: MessageFilterRunPlan,
  context: Pick<FilterRunContext, "accountId" | "folderPath">,
  outcome: { applied: boolean; appliedCount: number; failures: readonly string[] },
): {
  applied: boolean;
  accountId: string;
  folderPath: string;
  consideredCount: number;
  matchedCount: number;
  appliedCount: number;
  limitReached: boolean;
  entries: Array<{ messageId: string; subject: string; sender: string; filterNames: string[]; actions: Array<{ kind: string; value: string }> }>;
  entriesTruncated: boolean;
  failures: string[];
} => ({
  applied: outcome.applied,
  accountId: context.accountId,
  folderPath: context.folderPath,
  consideredCount: plan.consideredCount,
  matchedCount: plan.matchedCount,
  appliedCount: outcome.appliedCount,
  limitReached: plan.limitReached,
  entries: plan.entries.slice(0, FILTER_PREVIEW_ENTRY_LIMIT).map(entry => ({
    messageId: entry.subject.message.id,
    subject: entry.subject.message.subject,
    sender: entry.subject.message.from[0]?.address ?? "",
    filterNames: entry.evaluation.outcomes.map(item => item.filterName),
    actions: entry.evaluation.effective.map(action => ({ kind: action.kind, value: action.value })),
  })),
  entriesTruncated: plan.entries.length > FILTER_PREVIEW_ENTRY_LIMIT,
  failures: [...outcome.failures],
});

export const junkSummaryOf = (state: PersistedState): JunkSummary => ({
  ...junkModelSummary(junkModelOf(state)),
  threshold: JUNK_SCORE_THRESHOLD_DEFAULT,
  serverAssisted: false,
});

export const classifyJunk = (state: PersistedState, message: MessageSummary, body?: string): JunkAssessment =>
  assessJunk(junkModelOf(state), junkSampleFromMessage(message, body));

export const trainJunk = (
  draft: PersistedState,
  message: MessageSummary,
  label: "junk" | "good",
  body?: string,
): JunkSummary => {
  draft.junkModel = trainJunkModel(junkModelOf(draft), junkSampleFromMessage(message, body), label);
  return junkSummaryOf(draft);
};

export const resetJunk = (draft: PersistedState): JunkSummary => {
  draft.junkModel = emptyJunkModel();
  return junkSummaryOf(draft);
};

export { MessageFilterError, MessageTagError };
