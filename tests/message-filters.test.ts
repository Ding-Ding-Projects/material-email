import { describe, expect, it } from "vitest";
import {
  MESSAGE_FILTER_RUN_LIMIT,
  MessageFilterError,
  collapseMessageFilterActions,
  evaluateMessageFilters,
  messageFilterMatches,
  messageFilterOperators,
  planMessageFilterRun,
  validateMessageFilter,
  type MessageFilter,
  type MessageFilterAction,
  type MessageFilterCondition,
  type MessageFilterSubject,
} from "../src/shared/message-filters.js";
import type { MessageSummary } from "../src/shared/contracts.js";

const NOW = Date.parse("2026-08-02T12:00:00.000Z");

const message = (overrides: Partial<MessageSummary> = {}): MessageSummary => ({
  id: "account-1:INBOX:42",
  accountId: "account-1",
  folderPath: "INBOX",
  uid: 42,
  uidValidity: "9001",
  from: [{ name: "Dim Sum Daily", address: "news@dimsum.example" }],
  to: [{ name: "Mat", address: "mat@example.com" }],
  cc: [],
  subject: "Weekly har gow report",
  date: "2026-08-01T09:00:00.000Z",
  preview: "This week the bamboo steamers ran hot.",
  unread: true,
  starred: false,
  hasAttachments: false,
  size: 4_096,
  ...overrides,
});

const subject = (overrides: Partial<MessageFilterSubject> = {}): MessageFilterSubject => ({
  message: message(),
  accountEmail: "mat@example.com",
  folderName: "Inbox",
  tagIds: [],
  ...overrides,
});

const condition = (overrides: Partial<MessageFilterCondition> = {}): MessageFilterCondition => ({
  field: "from",
  operator: "contains",
  value: "dimsum.example",
  caseSensitive: false,
  ...overrides,
});

const filter = (overrides: Partial<MessageFilter> = {}): MessageFilter => ({
  id: "filter-1",
  name: "Newsletters",
  enabled: true,
  ordinal: 0,
  match: "all",
  runOnSync: true,
  accountId: null,
  conditions: [condition()],
  actions: [{ kind: "add-tag", value: "later" }],
  ...overrides,
});

describe("message filter conditions", () => {
  it("offers only the comparisons each field kind supports", () => {
    expect(messageFilterOperators("subject")).toContain("regex");
    expect(messageFilterOperators("size")).toEqual(expect.arrayContaining(["greater-than", "less-than"]));
    expect(messageFilterOperators("size")).not.toContain("contains");
    expect(messageFilterOperators("attachments")).toEqual(expect.arrayContaining(["is", "is-not"]));
    expect(messageFilterOperators("tag")).not.toContain("regex");
  });

  it("matches sender, recipient, subject, and folder text", () => {
    expect(messageFilterMatches(filter(), subject(), NOW)).toBe(true);
    expect(messageFilterMatches(filter({ conditions: [condition({ field: "subject", value: "har gow" })] }), subject(), NOW)).toBe(true);
    expect(messageFilterMatches(filter({ conditions: [condition({ field: "recipient", value: "mat@example.com" })] }), subject(), NOW)).toBe(true);
    expect(messageFilterMatches(filter({ conditions: [condition({ field: "folder", value: "Inbox" })] }), subject(), NOW)).toBe(true);
  });

  it("honours case sensitivity for text comparisons", () => {
    const sensitive = filter({ conditions: [condition({ field: "subject", value: "HAR GOW", caseSensitive: true })] });
    expect(messageFilterMatches(sensitive, subject(), NOW)).toBe(false);
    const insensitive = filter({ conditions: [condition({ field: "subject", value: "HAR GOW", caseSensitive: false })] });
    expect(messageFilterMatches(insensitive, subject(), NOW)).toBe(true);
  });

  it("reads the body when one is supplied and falls back to the preview when it is not", () => {
    const bodyFilter = filter({ conditions: [condition({ field: "body", value: "siu mai" })] });
    expect(messageFilterMatches(bodyFilter, subject(), NOW)).toBe(false);
    expect(messageFilterMatches(bodyFilter, subject({ body: "Also a note about siu mai." }), NOW)).toBe(true);
  });

  it("compares size and age numerically", () => {
    expect(messageFilterMatches(filter({ conditions: [condition({ field: "size", operator: "greater-than", value: "1024" })] }), subject(), NOW)).toBe(true);
    expect(messageFilterMatches(filter({ conditions: [condition({ field: "size", operator: "less-than", value: "1024" })] }), subject(), NOW)).toBe(false);
    expect(messageFilterMatches(filter({ conditions: [condition({ field: "age-days", operator: "greater-than", value: "0" })] }), subject(), NOW)).toBe(true);
    expect(messageFilterMatches(filter({ conditions: [condition({ field: "age-days", operator: "greater-than", value: "30" })] }), subject(), NOW)).toBe(false);
  });

  it("compares attachment, read, and star state as booleans", () => {
    expect(messageFilterMatches(filter({ conditions: [condition({ field: "read-state", operator: "is", value: "false" })] }), subject(), NOW)).toBe(true);
    expect(messageFilterMatches(filter({ conditions: [condition({ field: "star-state", operator: "is", value: "true" })] }), subject(), NOW)).toBe(false);
    const withAttachment = subject({ message: message({ hasAttachments: true }) });
    expect(messageFilterMatches(filter({ conditions: [condition({ field: "attachments", operator: "is", value: "true" })] }), withAttachment, NOW)).toBe(true);
  });

  it("matches on applied tags", () => {
    const tagged = subject({ tagIds: ["work"] });
    expect(messageFilterMatches(filter({ conditions: [condition({ field: "tag", operator: "is", value: "work" })] }), tagged, NOW)).toBe(true);
    expect(messageFilterMatches(filter({ conditions: [condition({ field: "tag", operator: "is-not", value: "work" })] }), tagged, NOW)).toBe(false);
  });

  it("supports regular-expression conditions and treats an unsafe pattern as no match", () => {
    const valid = filter({ conditions: [condition({ field: "subject", operator: "regex", value: "^weekly\\s+har" })] });
    expect(messageFilterMatches(valid, subject(), NOW)).toBe(true);
    const unsafe = filter({ conditions: [condition({ field: "subject", operator: "regex", value: "(a+)+$" })] });
    expect(messageFilterMatches(unsafe, subject(), NOW)).toBe(false);
  });

  it("combines conditions with match-all and match-any", () => {
    const conditions = [condition({ field: "subject", value: "har gow" }), condition({ field: "subject", value: "char siu" })];
    expect(messageFilterMatches(filter({ match: "all", conditions }), subject(), NOW)).toBe(false);
    expect(messageFilterMatches(filter({ match: "any", conditions }), subject(), NOW)).toBe(true);
  });

  it("restricts an account-scoped filter to that account", () => {
    const scoped = filter({ accountId: "account-2" });
    expect(messageFilterMatches(scoped, subject(), NOW)).toBe(false);
    expect(messageFilterMatches(filter({ accountId: "account-1" }), subject(), NOW)).toBe(true);
  });
});

describe("message filter validation", () => {
  it("requires a name, a condition, and an action", () => {
    expect(() => validateMessageFilter(filter({ name: "  " }))).toThrow(/needs a name/u);
    expect(() => validateMessageFilter(filter({ conditions: [] }))).toThrow(/at least one condition/u);
    expect(() => validateMessageFilter(filter({ actions: [] }))).toThrow(/at least one action/u);
  });

  it("rejects an operator the field does not support", () => {
    expect(() => validateMessageFilter(filter({ conditions: [condition({ field: "size", operator: "contains" })] }))).toThrow(MessageFilterError);
  });

  it("rejects malformed numeric, boolean, and regular-expression values", () => {
    expect(() => validateMessageFilter(filter({ conditions: [condition({ field: "size", operator: "greater-than", value: "many" })] }))).toThrow(/non-negative number/u);
    expect(() => validateMessageFilter(filter({ conditions: [condition({ field: "attachments", operator: "is", value: "maybe" })] }))).toThrow(/true or false/u);
    expect(() => validateMessageFilter(filter({ conditions: [condition({ field: "subject", operator: "regex", value: "(" })] }))).toThrow(MessageFilterError);
    expect(() => validateMessageFilter(filter({ conditions: [condition({ field: "subject", operator: "regex", value: "(a+)+$" })] }))).toThrow(/unresponsive/u);
  });

  it("requires a target for actions that move or tag, but not for plain ones", () => {
    expect(() => validateMessageFilter(filter({ actions: [{ kind: "move", value: "  " }] }))).toThrow(/needs a target/u);
    expect(() => validateMessageFilter(filter({ actions: [{ kind: "mark-read", value: "" }] }))).not.toThrow();
  });
});

describe("message filter evaluation", () => {
  it("skips disabled filters", () => {
    expect(evaluateMessageFilters([filter({ enabled: false })], subject(), NOW).matched).toBe(false);
  });

  it("runs filters in ordinal order and stops at a stop action", () => {
    const first = filter({ id: "a", ordinal: 1, actions: [{ kind: "star", value: "" }, { kind: "stop", value: "" }] });
    const second = filter({ id: "b", ordinal: 2, actions: [{ kind: "mark-read", value: "" }] });
    const zeroth = filter({ id: "c", ordinal: 0, actions: [{ kind: "add-tag", value: "work" }] });
    const evaluation = evaluateMessageFilters([second, first, zeroth], subject(), NOW);
    expect(evaluation.outcomes.map(outcome => outcome.filterId)).toEqual(["c", "a"]);
    expect(evaluation.effective).toEqual([{ kind: "add-tag", value: "work" }, { kind: "star", value: "" }]);
  });

  it("lets the last decision win for contradictory actions", () => {
    const collapsed = collapseMessageFilterActions([
      { kind: "mark-read", value: "" },
      { kind: "star", value: "" },
      { kind: "mark-unread", value: "" },
    ]);
    expect(collapsed).toEqual([{ kind: "star", value: "" }, { kind: "mark-unread", value: "" }]);
  });

  it("keeps only the final destination when several filters move a message", () => {
    const collapsed = collapseMessageFilterActions([
      { kind: "move", value: "Receipts" },
      { kind: "add-tag", value: "work" },
      { kind: "archive", value: "" },
    ]);
    expect(collapsed).toEqual([{ kind: "add-tag", value: "work" }, { kind: "archive", value: "" }]);
  });

  it("drops a tag that a later filter removes and de-duplicates repeats", () => {
    const collapsed = collapseMessageFilterActions([
      { kind: "add-tag", value: "later" },
      { kind: "add-tag", value: "later" },
      { kind: "remove-tag", value: "later" },
    ]);
    expect(collapsed).toEqual([{ kind: "remove-tag", value: "later" }]);
  });

  it("never emits a stop action as work to perform", () => {
    const evaluation = evaluateMessageFilters([filter({ actions: [{ kind: "stop", value: "" }] })], subject(), NOW);
    expect(evaluation.matched).toBe(true);
    expect(evaluation.effective).toEqual([]);
  });
});

describe("message filter run planning", () => {
  it("plans only the messages that match and produce work", () => {
    const subjects = [
      subject(),
      subject({ message: message({ id: "account-1:INBOX:43", uid: 43, from: [{ name: "Mum", address: "mum@example.com" }] }) }),
    ];
    const plan = planMessageFilterRun([filter()], subjects, { now: NOW });
    expect(plan.consideredCount).toBe(2);
    expect(plan.matchedCount).toBe(1);
    expect(plan.entries[0]?.subject.message.uid).toBe(42);
    expect(plan.limitReached).toBe(false);
  });

  it("only includes run-on-sync filters when a sync asks for them", () => {
    const manualOnly = filter({ runOnSync: false });
    expect(planMessageFilterRun([manualOnly], [subject()], { now: NOW, runOnSyncOnly: true }).matchedCount).toBe(0);
    expect(planMessageFilterRun([manualOnly], [subject()], { now: NOW }).matchedCount).toBe(1);
  });

  it("bounds a run and reports that it was bounded", () => {
    const subjects = Array.from({ length: MESSAGE_FILTER_RUN_LIMIT + 10 }, (_value, index) =>
      subject({ message: message({ id: `account-1:INBOX:${index}`, uid: index + 1 }) }),
    );
    const plan = planMessageFilterRun([filter()], subjects, { now: NOW });
    expect(plan.consideredCount).toBe(MESSAGE_FILTER_RUN_LIMIT);
    expect(plan.limitReached).toBe(true);
  });

  it("produces the same plan twice, so a preview matches the run it previews", () => {
    const subjects = [subject()];
    const actions: MessageFilterAction[] = [{ kind: "add-tag", value: "later" }, { kind: "mark-read", value: "" }];
    const rule = filter({ actions });
    expect(planMessageFilterRun([rule], subjects, { now: NOW })).toEqual(planMessageFilterRun([rule], subjects, { now: NOW }));
  });
});
