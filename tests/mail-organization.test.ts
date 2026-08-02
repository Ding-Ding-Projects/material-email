import { describe, expect, it } from "vitest";
import { parsePersistedState, type PersistedState } from "../src/main/persisted-state";
import {
  addMessageTag,
  applyMessageTags,
  buildFilterSubjects,
  cachedMessages,
  carryTagsThroughMove,
  classifyJunk,
  editMessageTag,
  forgetAccountTags,
  forgetFolderTags,
  junkSummaryOf,
  listFilters,
  planFilterRun,
  removeFilter,
  removeMessageTag,
  reorderFilters,
  resetJunk,
  summarizeFilterPlan,
  tagAssignmentMapOf,
  tagCatalogOf,
  tagIdsForMessage,
  trainJunk,
  upsertFilter,
  type FilterRunContext,
} from "../src/main/mail-organization";
import { JUNK_TRAINING_MINIMUM } from "../src/shared/junk-classifier";
import type { MessageFilterInput, MessageSummary } from "../src/shared/contracts";

const SEPARATOR = "\u0000";

const message = (overrides: Partial<MessageSummary> = {}): MessageSummary => ({
  id: "account-1:INBOX:42",
  accountId: "account-1",
  folderPath: "INBOX",
  uid: 42,
  uidValidity: "9001",
  from: [{ name: "Prize Desk", address: "payout@lottery-payout.example" }],
  to: [{ name: "Mat", address: "mat@example.com" }],
  cc: [],
  subject: "Claim your prize now",
  date: "2026-08-01T09:00:00.000Z",
  preview: "Click to claim your unclaimed winnings.",
  unread: true,
  starred: false,
  hasAttachments: false,
  size: 4_096,
  ...overrides,
});

const baseState = (messages: MessageSummary[] = [message()]): PersistedState => {
  const grouped: Record<string, MessageSummary[]> = {};
  for (const item of messages) {
    const key = `${item.accountId}${SEPARATOR}${item.folderPath}`;
    grouped[key] = [...(grouped[key] ?? []), item];
  }
  return parsePersistedState({
    schemaVersion: 1,
    accounts: [],
    preferences: {
      language: "en",
      funnyEnglish: 2,
      funnyCantonese: 3,
      theme: "system",
      density: "comfortable",
      accent: "#6750A4",
      fontFamily: "Segoe UI Variable",
      fontScale: 1,
      fontWeight: 400,
      narratorEnabled: false,
      narratorLanguage: "en",
    },
    folders: {
      "account-1": [
        { accountId: "account-1", path: "INBOX", name: "Inbox", role: "inbox", unread: 1, total: 1, uidValidity: "9001" },
        { accountId: "account-1", path: "Archive", name: "Archive", role: "archive", unread: 0, total: 0, uidValidity: "9002" },
      ],
    },
    messages: grouped,
    details: {},
    drafts: [],
    pendingOperations: [],
    outbox: [],
    notifications: [],
    history: [],
  });
};

const context: FilterRunContext = {
  accountId: "account-1",
  folderPath: "INBOX",
  accountEmail: "mat@example.com",
  folders: [
    { accountId: "account-1", path: "INBOX", name: "Inbox", role: "inbox", unread: 1, total: 1 },
    { accountId: "account-1", path: "Archive", name: "Archive", role: "archive", unread: 0, total: 0 },
  ],
};

const filterInput = (overrides: Partial<MessageFilterInput> = {}): MessageFilterInput => ({
  name: "Lottery noise",
  enabled: true,
  match: "all",
  runOnSync: true,
  accountId: null,
  conditions: [{ field: "from", operator: "contains", value: "lottery-payout.example", caseSensitive: false }],
  actions: [{ kind: "add-tag", value: "later" }],
  ...overrides,
});

describe("persisted organization state", () => {
  it("gives older state the built-in tags, no filters, and an untrained junk model", () => {
    const state = baseState();
    expect(state.messageTags.catalog.map(tag => tag.id)).toEqual(["important", "work", "personal", "to-do", "later"]);
    expect(state.messageFilters).toEqual([]);
    expect(state.junkModel).toEqual({ schemaVersion: 1, junkMessageCount: 0, goodMessageCount: 0, tokens: {} });
  });

  it("drops a stored tag assignment whose definition no longer exists", () => {
    const parsed = parsePersistedState({
      ...baseState(),
      messageTags: {
        catalog: [{ id: "work", name: "Work", colour: "#1565c0", ordinal: 0, builtIn: true }],
        assignments: { [`account-1${SEPARATOR}INBOX${SEPARATOR}9001${SEPARATOR}42`]: ["work", "deleted-tag"] },
      },
    });
    expect(parsed.messageTags.assignments[`account-1${SEPARATOR}INBOX${SEPARATOR}9001${SEPARATOR}42`]).toEqual(["work"]);
  });

  it("reads cached messages by account and folder", () => {
    const state = baseState([message(), message({ id: "account-1:Archive:7", folderPath: "Archive", uid: 7 })]);
    expect(cachedMessages(state)).toHaveLength(2);
    expect(cachedMessages(state, "account-1", "Archive").map(item => item.uid)).toEqual([7]);
    expect(cachedMessages(state, "account-2")).toEqual([]);
  });
});

describe("tag operations over persisted state", () => {
  it("creates a tag and reports usage counts", () => {
    const state = baseState();
    const catalog = addMessageTag(state, "Receipts", "#5D4037");
    expect(catalog.tags.map(tag => tag.id)).toContain("receipts");
    expect(catalog.usage.receipts).toBe(0);
  });

  it("maps applied tags back to message identifiers for the renderer", () => {
    const state = baseState();
    applyMessageTags(state, message(), ["work", "later"]);
    expect(tagAssignmentMapOf(state)).toEqual({ "account-1:INBOX:42": ["work", "later"] });
    expect(tagIdsForMessage(state, message())).toEqual(["work", "later"]);
  });

  it("keeps a tag on a message the server moved and re-identified", () => {
    const state = baseState();
    applyMessageTags(state, message(), ["to-do"]);
    carryTagsThroughMove(
      state,
      { accountId: "account-1", folderPath: "INBOX", uid: 42, uidValidity: "9001" },
      { folderPath: "Archive", uid: 7, uidValidity: "9002" },
    );
    expect(tagIdsForMessage(state, message({ folderPath: "Archive", uid: 7, uidValidity: "9002" }))).toEqual(["to-do"]);
    expect(tagIdsForMessage(state, message())).toEqual([]);
  });

  it("drops tags when a move produced no destination identity", () => {
    const state = baseState();
    applyMessageTags(state, message(), ["to-do"]);
    carryTagsThroughMove(state, { accountId: "account-1", folderPath: "INBOX", uid: 42, uidValidity: "9001" }, null);
    expect(Object.keys(state.messageTags.assignments)).toEqual([]);
  });

  it("forgets only the removed account's or folder's tags", () => {
    const state = baseState([message(), message({ id: "account-2:INBOX:1", accountId: "account-2", uid: 1 })]);
    applyMessageTags(state, message(), ["work"]);
    applyMessageTags(state, message({ accountId: "account-2", uid: 1 }), ["work"]);
    forgetAccountTags(state, "account-1");
    expect(Object.keys(state.messageTags.assignments)).toHaveLength(1);

    applyMessageTags(state, message(), ["work"]);
    forgetFolderTags(state, "account-1", "INBOX");
    expect(Object.keys(state.messageTags.assignments)).toHaveLength(1);
  });

  it("removes a custom tag from the catalog and every message at once", () => {
    const state = baseState();
    addMessageTag(state, "Receipts", "#5D4037");
    applyMessageTags(state, message(), ["receipts", "work"]);
    removeMessageTag(state, "receipts");
    expect(tagIdsForMessage(state, message())).toEqual(["work"]);
  });

  it("recolours a built-in tag without disturbing assignments", () => {
    const state = baseState();
    applyMessageTags(state, message(), ["work"]);
    const catalog = editMessageTag(state, "work", { colour: "#004D40" });
    expect(catalog.tags.find(tag => tag.id === "work")?.colour).toBe("#004d40");
    expect(tagIdsForMessage(state, message())).toEqual(["work"]);
  });

  it("counts a tag once per message that carries it", () => {
    const state = baseState([message(), message({ id: "account-1:INBOX:43", uid: 43 })]);
    applyMessageTags(state, message(), ["work"]);
    applyMessageTags(state, message({ uid: 43 }), ["work"]);
    expect(tagCatalogOf(state).usage.work).toBe(2);
  });
});

describe("filter storage and planning", () => {
  it("assigns an identifier and ordinal on create, and keeps them on update", () => {
    const state = baseState();
    const created = upsertFilter(state, filterInput());
    const id = created[0]?.id ?? "";
    expect(id).toMatch(/^[0-9a-f-]{36}$/u);
    expect(created[0]?.ordinal).toBe(0);

    const updated = upsertFilter(state, filterInput({ id, name: "Lottery noise (revised)" }));
    expect(updated).toHaveLength(1);
    expect(updated[0]).toMatchObject({ id, name: "Lottery noise (revised)", ordinal: 0 });
  });

  it("rejects an update for a filter that no longer exists", () => {
    expect(() => upsertFilter(baseState(), filterInput({ id: "missing" }))).toThrow(/no longer exists/u);
  });

  it("rejects an invalid rule before it reaches storage", () => {
    const state = baseState();
    expect(() => upsertFilter(state, filterInput({ conditions: [{ field: "size", operator: "greater-than", value: "lots", caseSensitive: false }] })))
      .toThrow(/non-negative number/u);
    expect(listFilters(state)).toEqual([]);
  });

  it("renumbers ordinals after a removal so the order stays dense", () => {
    const state = baseState();
    upsertFilter(state, filterInput({ name: "One" }));
    upsertFilter(state, filterInput({ name: "Two" }));
    upsertFilter(state, filterInput({ name: "Three" }));
    const middle = listFilters(state)[1]?.id ?? "";
    const remaining = removeFilter(state, middle);
    expect(remaining.map(filter => filter.ordinal)).toEqual([0, 1]);
    expect(remaining.map(filter => filter.name)).toEqual(["One", "Three"]);
  });

  it("reorders by the identifiers given and appends anything not mentioned", () => {
    const state = baseState();
    upsertFilter(state, filterInput({ name: "One" }));
    upsertFilter(state, filterInput({ name: "Two" }));
    upsertFilter(state, filterInput({ name: "Three" }));
    const [first, second, third] = listFilters(state);
    const reordered = reorderFilters(state, [third?.id ?? "", first?.id ?? "", "unknown-id"]);
    expect(reordered.map(filter => filter.name)).toEqual(["Three", "One", "Two"]);
    expect(reordered.map(filter => filter.ordinal)).toEqual([0, 1, 2]);
    expect(second).toBeDefined();
  });

  it("builds subjects that carry account, folder, and tag context", () => {
    const state = baseState();
    applyMessageTags(state, message(), ["work"]);
    const subjects = buildFilterSubjects(state, context);
    expect(subjects).toHaveLength(1);
    expect(subjects[0]).toMatchObject({ accountEmail: "mat@example.com", folderName: "Inbox", tagIds: ["work"] });
    expect(subjects[0]?.body).toBeUndefined();
  });

  it("plans the matching messages and summarizes them without applying anything", () => {
    const state = baseState([message(), message({ id: "account-1:INBOX:43", uid: 43, from: [{ name: "Mum", address: "mum@example.com" }] })]);
    upsertFilter(state, filterInput());
    const plan = planFilterRun(state, context);
    expect(plan.matchedCount).toBe(1);
    const summary = summarizeFilterPlan(plan, context, { applied: false, appliedCount: 0, failures: [] });
    expect(summary).toMatchObject({ applied: false, consideredCount: 2, matchedCount: 1, appliedCount: 0, entriesTruncated: false });
    expect(summary.entries[0]).toMatchObject({ messageId: "account-1:INBOX:42", filterNames: ["Lottery noise"] });
    expect(summary.entries[0]?.actions).toEqual([{ kind: "add-tag", value: "later" }]);
  });

  it("honours the run-on-sync flag when a sync asks for it", () => {
    const state = baseState();
    upsertFilter(state, filterInput({ runOnSync: false }));
    expect(planFilterRun(state, context, { runOnSyncOnly: true }).matchedCount).toBe(0);
    expect(planFilterRun(state, context).matchedCount).toBe(1);
  });
});

describe("junk model over persisted state", () => {
  it("starts untrained and says so", () => {
    const state = baseState();
    expect(junkSummaryOf(state)).toMatchObject({ ready: false, serverAssisted: false, junkMessageCount: 0 });
    expect(classifyJunk(state, message()).verdict).toBe("untrained");
  });

  it("learns from marked messages and then classifies a similar one", () => {
    const state = baseState();
    for (let index = 0; index < JUNK_TRAINING_MINIMUM + 3; index += 1) {
      trainJunk(state, message({ subject: `Claim your prize now ${index}` }), "junk", "Unclaimed lottery winnings await your reply.");
      trainJunk(
        state,
        message({ subject: `Steamer roster ${index}`, from: [{ name: "Mei", address: "mei@dimsum-kitchen.example" }] }),
        "good",
        "Har gow and siu mai schedule for the morning service.",
      );
    }
    expect(junkSummaryOf(state).ready).toBe(true);
    expect(classifyJunk(state, message(), "Unclaimed lottery winnings await your reply.").verdict).toBe("junk");
  });

  it("forgets everything on reset", () => {
    const state = baseState();
    trainJunk(state, message(), "junk");
    expect(junkSummaryOf(state).junkMessageCount).toBe(1);
    expect(resetJunk(state)).toMatchObject({ junkMessageCount: 0, goodMessageCount: 0, tokenCount: 0, ready: false });
  });

  it("keeps classification local", () => {
    expect(junkSummaryOf(baseState()).serverAssisted).toBe(false);
  });
});
