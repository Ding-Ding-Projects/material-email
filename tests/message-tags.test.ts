import { describe, expect, it } from "vitest";
import {
  BUILT_IN_MESSAGE_TAGS,
  MESSAGE_TAGS_PER_MESSAGE_LIMIT,
  MESSAGE_TAG_CATALOG_LIMIT,
  MessageTagError,
  createMessageTag,
  deleteMessageTag,
  emptyMessageTagState,
  forgetMessageTags,
  messageTagKey,
  messageTagKeyAccountId,
  messageTagUsageCounts,
  messageTagsFor,
  normalizeMessageTagColour,
  normalizeMessageTagName,
  retagMovedMessage,
  setMessageTags,
  toggleMessageTag,
  updateMessageTag,
  type MessageTag,
} from "../src/shared/message-tags.js";

const key = messageTagKey("account-1", "INBOX", 42, "9001");

describe("message tag catalog", () => {
  it("ships the built-in tags with stable identifiers and ordering", () => {
    const state = emptyMessageTagState();
    expect(state.catalog.map(tag => tag.id)).toEqual(["important", "work", "personal", "to-do", "later"]);
    expect(state.catalog.every(tag => tag.builtIn)).toBe(true);
    expect(BUILT_IN_MESSAGE_TAGS.every(tag => /^#[0-9a-f]{6}$/u.test(tag.colour))).toBe(true);
  });

  it("normalizes names and expands short colours", () => {
    expect(normalizeMessageTagName("  Quarterly    Report  ")).toBe("Quarterly Report");
    expect(normalizeMessageTagColour("#ABC")).toBe("#aabbcc");
    expect(normalizeMessageTagColour("#1565C0")).toBe("#1565c0");
    expect(normalizeMessageTagColour("rgb(1,2,3)")).toBeNull();
  });

  it("creates a tag with a slugged identifier and the next ordinal", () => {
    const state = emptyMessageTagState();
    const tag = createMessageTag(state.catalog, { name: "Dim Sum Orders", colour: "#00695C" });
    expect(tag).toMatchObject({ id: "dim-sum-orders", name: "Dim Sum Orders", colour: "#00695c", ordinal: 5, builtIn: false });
  });

  it("keeps identifiers unique when two names slug the same way", () => {
    let catalog: MessageTag[] = [...emptyMessageTagState().catalog];
    catalog = [...catalog, createMessageTag(catalog, { name: "Team!", colour: "#111111" })];
    const second = createMessageTag(catalog, { name: "Team?", colour: "#222222" });
    expect(second.id).toBe("team-2");
  });

  it("rejects blank names, duplicate names, and invalid colours", () => {
    const state = emptyMessageTagState();
    expect(() => createMessageTag(state.catalog, { name: "   ", colour: "#111111" })).toThrow(MessageTagError);
    expect(() => createMessageTag(state.catalog, { name: "work", colour: "#111111" })).toThrow(/already exists/u);
    expect(() => createMessageTag(state.catalog, { name: "Fresh", colour: "blue" })).toThrow(/hexadecimal/u);
  });

  it("stops at the catalog ceiling", () => {
    let catalog: MessageTag[] = [...emptyMessageTagState().catalog];
    while (catalog.length < MESSAGE_TAG_CATALOG_LIMIT) {
      catalog = [...catalog, createMessageTag(catalog, { name: `Tag ${catalog.length}`, colour: "#333333" })];
    }
    expect(() => createMessageTag(catalog, { name: "One too many", colour: "#333333" })).toThrow(/at most/u);
  });

  it("renames and recolours a built-in tag but refuses to delete it", () => {
    const state = emptyMessageTagState();
    const renamed = updateMessageTag(state.catalog, "work", { name: "Office", colour: "#004d40" });
    expect(renamed.find(tag => tag.id === "work")).toMatchObject({ name: "Office", colour: "#004d40", builtIn: true });
    expect(() => deleteMessageTag(state, "work")).toThrow(/built-in/iu);
  });

  it("removes a custom tag from the catalog and from every message", () => {
    const state = emptyMessageTagState();
    const custom = createMessageTag(state.catalog, { name: "Receipts", colour: "#5d4037" });
    const withTag = toggleMessageTag({ catalog: [...state.catalog, custom], assignments: {} }, key, custom.id, true);
    const tagged = toggleMessageTag(withTag, key, "work", true);
    expect(messageTagsFor(tagged, key).map(tag => tag.id)).toEqual(["work", "receipts"]);

    const deleted = deleteMessageTag(tagged, custom.id);
    expect(deleted.catalog.some(tag => tag.id === custom.id)).toBe(false);
    expect(messageTagsFor(deleted, key).map(tag => tag.id)).toEqual(["work"]);
  });
});

describe("message tag assignments", () => {
  it("stores tags in catalog order and drops unknown identifiers", () => {
    const state = setMessageTags(emptyMessageTagState(), key, ["later", "important", "does-not-exist"]);
    expect(state.assignments[key]).toEqual(["important", "later"]);
  });

  it("removes the entry entirely when the last tag is cleared", () => {
    const tagged = toggleMessageTag(emptyMessageTagState(), key, "important", true);
    const cleared = toggleMessageTag(tagged, key, "important", false);
    expect(Object.keys(cleared.assignments)).toEqual([]);
  });

  it("bounds the number of tags on one message", () => {
    let state = emptyMessageTagState();
    for (let index = 0; index < MESSAGE_TAGS_PER_MESSAGE_LIMIT + 5; index += 1) {
      const tag = createMessageTag(state.catalog, { name: `Extra ${index}`, colour: "#424242" });
      state = { catalog: [...state.catalog, tag], assignments: state.assignments };
    }
    const all = setMessageTags(state, key, state.catalog.map(tag => tag.id));
    expect(all.assignments[key]).toHaveLength(MESSAGE_TAGS_PER_MESSAGE_LIMIT);
  });

  it("rejects toggling a tag that is not in the catalog", () => {
    expect(() => toggleMessageTag(emptyMessageTagState(), key, "ghost", true)).toThrow(MessageTagError);
  });

  it("follows a message to the destination key after a move", () => {
    const tagged = toggleMessageTag(emptyMessageTagState(), key, "to-do", true);
    const destination = messageTagKey("account-1", "Archive", 7, "3300");
    const moved = retagMovedMessage(tagged, key, destination);
    expect(moved.assignments[key]).toBeUndefined();
    expect(moved.assignments[destination]).toEqual(["to-do"]);
  });

  it("drops tags when the server could not attribute the moved message", () => {
    const tagged = toggleMessageTag(emptyMessageTagState(), key, "to-do", true);
    expect(Object.keys(retagMovedMessage(tagged, key, null).assignments)).toEqual([]);
  });

  it("forgets assignments for a removed account without touching the catalog", () => {
    const tagged = toggleMessageTag(emptyMessageTagState(), key, "personal", true);
    const other = messageTagKey("account-2", "INBOX", 1, "1");
    const both = toggleMessageTag(tagged, other, "personal", true);
    const pruned = forgetMessageTags(both, candidate => messageTagKeyAccountId(candidate) === "account-1");
    expect(Object.keys(pruned.assignments)).toEqual([other]);
    expect(pruned.catalog).toHaveLength(5);
  });

  it("counts tag usage across messages without double counting duplicates", () => {
    let state = toggleMessageTag(emptyMessageTagState(), key, "important", true);
    state = toggleMessageTag(state, messageTagKey("account-1", "INBOX", 43, "9001"), "important", true);
    expect(messageTagUsageCounts(state)).toMatchObject({ important: 2, work: 0 });
  });

  it("separates messages that share a UID across mailbox generations", () => {
    const older = messageTagKey("account-1", "INBOX", 42, "9000");
    expect(older).not.toBe(key);
    const state = toggleMessageTag(emptyMessageTagState(), older, "later", true);
    expect(messageTagsFor(state, key)).toEqual([]);
  });
});
