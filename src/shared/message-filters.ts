import type { MessageSummary } from "./contracts.js";
import { createMatcher, validatePattern } from "./regex.js";

export const MESSAGE_FILTER_LIMIT = 200;
export const MESSAGE_FILTER_CONDITION_LIMIT = 20;
export const MESSAGE_FILTER_ACTION_LIMIT = 20;
export const MESSAGE_FILTER_NAME_LIMIT = 120;
export const MESSAGE_FILTER_VALUE_LIMIT = 2_048;
/** A single run never touches more than this many messages, so a wide rule cannot stall a sync. */
export const MESSAGE_FILTER_RUN_LIMIT = 5_000;

export type MessageFilterField =
  | "from"
  | "to"
  | "cc"
  | "recipient"
  | "subject"
  | "body"
  | "account"
  | "folder"
  | "tag"
  | "size"
  | "age-days"
  | "attachments"
  | "read-state"
  | "star-state";

export type MessageFilterOperator =
  | "contains"
  | "not-contains"
  | "is"
  | "is-not"
  | "starts-with"
  | "ends-with"
  | "regex"
  | "greater-than"
  | "less-than";

export type MessageFilterActionKind =
  | "mark-read"
  | "mark-unread"
  | "star"
  | "unstar"
  | "add-tag"
  | "remove-tag"
  | "move"
  | "archive"
  | "trash"
  | "mark-junk"
  | "mark-not-junk"
  | "stop";

export interface MessageFilterCondition {
  field: MessageFilterField;
  operator: MessageFilterOperator;
  value: string;
  caseSensitive: boolean;
}

export interface MessageFilterAction {
  kind: MessageFilterActionKind;
  value: string;
}

export interface MessageFilter {
  id: string;
  name: string;
  enabled: boolean;
  ordinal: number;
  match: "all" | "any";
  runOnSync: boolean;
  accountId: string | null;
  conditions: readonly MessageFilterCondition[];
  actions: readonly MessageFilterAction[];
}

/** Everything a condition can read. Body text is optional: list rows only carry a preview. */
export interface MessageFilterSubject {
  message: MessageSummary;
  accountEmail: string;
  folderName: string;
  tagIds: readonly string[];
  body?: string;
}

export interface MessageFilterOutcome {
  filterId: string;
  filterName: string;
  actions: readonly MessageFilterAction[];
  stopped: boolean;
}

export interface MessageFilterEvaluation {
  matched: boolean;
  outcomes: readonly MessageFilterOutcome[];
  /** Actions collapsed into the order they should be applied, with later contradictions removed. */
  effective: readonly MessageFilterAction[];
}

const TEXT_FIELDS = new Set<MessageFilterField>(["from", "to", "cc", "recipient", "subject", "body", "account", "folder"]);
const NUMERIC_FIELDS = new Set<MessageFilterField>(["size", "age-days"]);
const BOOLEAN_FIELDS = new Set<MessageFilterField>(["attachments", "read-state", "star-state"]);
const TEXT_OPERATORS = new Set<MessageFilterOperator>(["contains", "not-contains", "is", "is-not", "starts-with", "ends-with", "regex"]);
const NUMERIC_OPERATORS = new Set<MessageFilterOperator>(["greater-than", "less-than", "is", "is-not"]);
const BOOLEAN_OPERATORS = new Set<MessageFilterOperator>(["is", "is-not"]);
const TAG_OPERATORS = new Set<MessageFilterOperator>(["is", "is-not"]);
const VALUELESS_ACTIONS = new Set<MessageFilterActionKind>([
  "mark-read",
  "mark-unread",
  "star",
  "unstar",
  "archive",
  "trash",
  "mark-junk",
  "mark-not-junk",
  "stop",
]);

export class MessageFilterError extends Error {
  readonly code:
    | "FILTER_NAME_REQUIRED"
    | "FILTER_CONDITION_REQUIRED"
    | "FILTER_ACTION_REQUIRED"
    | "FILTER_OPERATOR_UNSUPPORTED"
    | "FILTER_VALUE_REQUIRED"
    | "FILTER_VALUE_INVALID"
    | "FILTER_PATTERN_INVALID"
    | "FILTER_LIMIT_REACHED"
    | "FILTER_NOT_FOUND";

  constructor(code: MessageFilterError["code"], message: string) {
    super(message);
    this.name = "MessageFilterError";
    this.code = code;
  }
}

export const messageFilterFieldKind = (field: MessageFilterField): "text" | "numeric" | "boolean" | "tag" => {
  if (TEXT_FIELDS.has(field)) return "text";
  if (NUMERIC_FIELDS.has(field)) return "numeric";
  if (BOOLEAN_FIELDS.has(field)) return "boolean";
  return "tag";
};

const operatorsFor = (field: MessageFilterField): ReadonlySet<MessageFilterOperator> => {
  switch (messageFilterFieldKind(field)) {
    case "text": return TEXT_OPERATORS;
    case "numeric": return NUMERIC_OPERATORS;
    case "boolean": return BOOLEAN_OPERATORS;
    case "tag": return TAG_OPERATORS;
  }
};

export const messageFilterOperators = (field: MessageFilterField): MessageFilterOperator[] => [...operatorsFor(field)];

export const validateMessageFilterCondition = (condition: MessageFilterCondition): void => {
  if (!operatorsFor(condition.field).has(condition.operator)) {
    throw new MessageFilterError(
      "FILTER_OPERATOR_UNSUPPORTED",
      `The ${condition.field} condition does not support the ${condition.operator} comparison.`,
    );
  }
  const kind = messageFilterFieldKind(condition.field);
  const value = condition.value.trim();
  if (kind === "numeric") {
    const parsed = Number(value);
    if (!value || !Number.isFinite(parsed) || parsed < 0) {
      throw new MessageFilterError("FILTER_VALUE_INVALID", `The ${condition.field} condition needs a non-negative number.`);
    }
    return;
  }
  if (kind === "boolean") {
    if (value !== "true" && value !== "false") {
      throw new MessageFilterError("FILTER_VALUE_INVALID", `The ${condition.field} condition needs either true or false.`);
    }
    return;
  }
  if (!value) throw new MessageFilterError("FILTER_VALUE_REQUIRED", `The ${condition.field} condition needs a value.`);
  if (condition.operator === "regex") {
    const validation = validatePattern({ mode: "regex", pattern: value, flags: condition.caseSensitive ? "u" : "iu" });
    if (!validation.valid) throw new MessageFilterError("FILTER_PATTERN_INVALID", validation.message);
  }
};

export const validateMessageFilterAction = (action: MessageFilterAction): void => {
  if (VALUELESS_ACTIONS.has(action.kind)) return;
  if (!action.value.trim()) throw new MessageFilterError("FILTER_VALUE_REQUIRED", `The ${action.kind} action needs a target.`);
};

export const validateMessageFilter = (filter: MessageFilter): void => {
  if (!filter.name.trim()) throw new MessageFilterError("FILTER_NAME_REQUIRED", "A filter needs a name.");
  if (!filter.conditions.length) throw new MessageFilterError("FILTER_CONDITION_REQUIRED", "A filter needs at least one condition.");
  if (!filter.actions.length) throw new MessageFilterError("FILTER_ACTION_REQUIRED", "A filter needs at least one action.");
  for (const condition of filter.conditions.slice(0, MESSAGE_FILTER_CONDITION_LIMIT)) validateMessageFilterCondition(condition);
  for (const action of filter.actions.slice(0, MESSAGE_FILTER_ACTION_LIMIT)) validateMessageFilterAction(action);
};

const addressText = (addresses: readonly { name: string; address: string }[]): string =>
  addresses.map(entry => (entry.name ? `${entry.name} <${entry.address}>` : entry.address)).join(", ");

const textFor = (field: MessageFilterField, subject: MessageFilterSubject): string => {
  const { message } = subject;
  switch (field) {
    case "from": return addressText(message.from);
    case "to": return addressText(message.to);
    case "cc": return addressText(message.cc);
    case "recipient": return [addressText(message.to), addressText(message.cc)].filter(Boolean).join(", ");
    case "subject": return message.subject;
    case "body": return subject.body ?? message.preview;
    case "account": return subject.accountEmail;
    case "folder": return `${subject.folderName} ${message.folderPath}`;
    default: return "";
  }
};

const numberFor = (field: MessageFilterField, subject: MessageFilterSubject, now: number): number => {
  if (field === "size") return subject.message.size;
  const parsed = Date.parse(subject.message.date);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, (now - parsed) / 86_400_000);
};

const booleanFor = (field: MessageFilterField, subject: MessageFilterSubject): boolean => {
  if (field === "attachments") return subject.message.hasAttachments;
  if (field === "read-state") return !subject.message.unread;
  return subject.message.starred;
};

const compareText = (condition: MessageFilterCondition, haystack: string): boolean => {
  const bounded = haystack.slice(0, 50_000);
  const needle = condition.value.trim().slice(0, MESSAGE_FILTER_VALUE_LIMIT);
  if (condition.operator === "regex") {
    return createMatcher({ mode: "regex", pattern: needle, flags: condition.caseSensitive ? "u" : "iu" })(bounded);
  }
  const left = condition.caseSensitive ? bounded : bounded.toLocaleLowerCase("en-US");
  const right = condition.caseSensitive ? needle : needle.toLocaleLowerCase("en-US");
  switch (condition.operator) {
    case "contains": return left.includes(right);
    case "not-contains": return !left.includes(right);
    case "is": return left.trim() === right;
    case "is-not": return left.trim() !== right;
    case "starts-with": return left.trimStart().startsWith(right);
    case "ends-with": return left.trimEnd().endsWith(right);
    default: return false;
  }
};

export const evaluateMessageFilterCondition = (
  condition: MessageFilterCondition,
  subject: MessageFilterSubject,
  now: number,
): boolean => {
  switch (messageFilterFieldKind(condition.field)) {
    case "text":
      return compareText(condition, textFor(condition.field, subject));
    case "numeric": {
      const actual = numberFor(condition.field, subject, now);
      const expected = Number(condition.value.trim());
      if (!Number.isFinite(expected)) return false;
      switch (condition.operator) {
        case "greater-than": return actual > expected;
        case "less-than": return actual < expected;
        case "is": return Math.trunc(actual) === Math.trunc(expected);
        case "is-not": return Math.trunc(actual) !== Math.trunc(expected);
        default: return false;
      }
    }
    case "boolean": {
      const actual = booleanFor(condition.field, subject);
      const expected = condition.value.trim() === "true";
      return condition.operator === "is" ? actual === expected : actual !== expected;
    }
    case "tag": {
      const has = subject.tagIds.includes(condition.value.trim());
      return condition.operator === "is" ? has : !has;
    }
  }
};

export const messageFilterMatches = (filter: MessageFilter, subject: MessageFilterSubject, now: number): boolean => {
  if (filter.accountId && filter.accountId !== subject.message.accountId) return false;
  const conditions = filter.conditions.slice(0, MESSAGE_FILTER_CONDITION_LIMIT);
  if (!conditions.length) return false;
  const results = conditions.map(condition => {
    try {
      return evaluateMessageFilterCondition(condition, subject, now);
    } catch {
      return false;
    }
  });
  return filter.match === "all" ? results.every(Boolean) : results.some(Boolean);
};

const CONTRADICTIONS: Readonly<Record<string, string>> = {
  "mark-read": "mark-unread",
  "mark-unread": "mark-read",
  star: "unstar",
  unstar: "star",
  "mark-junk": "mark-not-junk",
  "mark-not-junk": "mark-junk",
};

/**
 * Collapses matched actions in filter order: the last decision wins for contradictory pairs, one
 * destination-changing action survives, and duplicate tag operations are removed.
 */
export const collapseMessageFilterActions = (actions: readonly MessageFilterAction[]): MessageFilterAction[] => {
  const collapsed: MessageFilterAction[] = [];
  for (const action of actions) {
    if (action.kind === "stop") continue;
    const opposite = CONTRADICTIONS[action.kind];
    const isDestination = action.kind === "move" || action.kind === "archive" || action.kind === "trash";
    for (let index = collapsed.length - 1; index >= 0; index -= 1) {
      const existing = collapsed[index];
      if (!existing) continue;
      const sameAction = existing.kind === action.kind && existing.value === action.value;
      const contradicts = opposite !== undefined && existing.kind === opposite;
      const destinationClash = isDestination && (existing.kind === "move" || existing.kind === "archive" || existing.kind === "trash");
      const tagClash =
        (action.kind === "add-tag" && existing.kind === "remove-tag" && existing.value === action.value)
        || (action.kind === "remove-tag" && existing.kind === "add-tag" && existing.value === action.value);
      if (sameAction || contradicts || destinationClash || tagClash) collapsed.splice(index, 1);
    }
    collapsed.push(action);
  }
  return collapsed;
};

export const sortMessageFilters = (filters: readonly MessageFilter[]): MessageFilter[] =>
  [...filters].sort((left, right) => left.ordinal - right.ordinal || left.name.localeCompare(right.name) || left.id.localeCompare(right.id));

export const evaluateMessageFilters = (
  filters: readonly MessageFilter[],
  subject: MessageFilterSubject,
  now = Date.now(),
): MessageFilterEvaluation => {
  const outcomes: MessageFilterOutcome[] = [];
  const collected: MessageFilterAction[] = [];
  for (const filter of sortMessageFilters(filters).slice(0, MESSAGE_FILTER_LIMIT)) {
    if (!filter.enabled || !messageFilterMatches(filter, subject, now)) continue;
    const actions = filter.actions.slice(0, MESSAGE_FILTER_ACTION_LIMIT);
    const stopped = actions.some(action => action.kind === "stop");
    outcomes.push({ filterId: filter.id, filterName: filter.name, actions, stopped });
    for (const action of actions) {
      if (action.kind === "stop") break;
      collected.push(action);
    }
    if (stopped) break;
  }
  return { matched: outcomes.length > 0, outcomes, effective: collapseMessageFilterActions(collected) };
};

export interface MessageFilterRunEntry {
  subject: MessageFilterSubject;
  evaluation: MessageFilterEvaluation;
}

export interface MessageFilterRunPlan {
  entries: readonly MessageFilterRunEntry[];
  consideredCount: number;
  matchedCount: number;
  limitReached: boolean;
}

/** Builds the plan for a run without performing any of it, so a preview and a run agree exactly. */
export const planMessageFilterRun = (
  filters: readonly MessageFilter[],
  subjects: readonly MessageFilterSubject[],
  options: { now?: number; runOnSyncOnly?: boolean } = {},
): MessageFilterRunPlan => {
  const now = options.now ?? Date.now();
  const applicable = filters.filter(filter => (options.runOnSyncOnly ? filter.runOnSync : true));
  const bounded = subjects.slice(0, MESSAGE_FILTER_RUN_LIMIT);
  const entries: MessageFilterRunEntry[] = [];
  for (const subject of bounded) {
    const evaluation = evaluateMessageFilters(applicable, subject, now);
    if (evaluation.matched && evaluation.effective.length) entries.push({ subject, evaluation });
  }
  return {
    entries,
    consideredCount: bounded.length,
    matchedCount: entries.length,
    limitReached: subjects.length > MESSAGE_FILTER_RUN_LIMIT,
  };
};
