import { describe, expect, it } from "vitest";
import type { MessageSummary } from "../src/shared/contracts";
import {
  CACHED_CONVERSATION_MESSAGE_LIMIT,
  conversationSubject,
  groupCachedConversations,
  normalizedConversationSubject,
  normalizedMessageReference,
} from "../src/shared/conversations";

const message = (
  id: string,
  subject: string,
  date: string,
  reference: Partial<Pick<MessageSummary, "messageId" | "inReplyTo" | "references">> = {},
): MessageSummary => ({
  id,
  accountId: id.split(":")[0] ?? "account",
  folderPath: "Inbox",
  uid: Number(id.split(":").at(-1)) || 1,
  ...reference,
  from: [{ name: "Sender", address: "sender@example.test" }],
  to: [],
  cc: [],
  subject,
  date,
  preview: subject,
  unread: id.endsWith(":2"),
  starred: false,
  hasAttachments: false,
  size: 100,
});

describe("cached conversation grouping", () => {
  it("normalizes repeated reply/forward prefixes and bounded message references", () => {
    expect(conversationSubject("  Re: FWD[2]:  Quarterly   Plan ")).toBe("Quarterly Plan");
    expect(normalizedConversationSubject("ＲＥ:  Quarterly Plan")).toBe("quarterly plan");
    expect(normalizedMessageReference(" <ROOT@Example.TEST> ")).toBe("root@example.test");
    expect(normalizedMessageReference("not a message id")).toBeNull();
  });

  it("connects cached rows by normalized subject and explicit reference chains, then sorts deterministically", () => {
    const root = message("alpha:Inbox:1", "Quarterly Plan", "2026-08-01T10:00:00.000Z", { messageId: "<root@example.test>" });
    const reply = message("bravo:Inbox:2", "Re: Quarterly Plan", "2026-08-01T11:00:00.000Z", {
      messageId: "<reply@example.test>",
      inReplyTo: "<ROOT@example.test>",
    });
    const renamed = message("alpha:Inbox:3", "Fwd: Renamed plan", "2026-08-01T12:00:00.000Z", {
      messageId: "<renamed@example.test>",
      references: ["<root@example.test>", "<reply@example.test>"],
    });
    const later = message("alpha:Inbox:4", "Independent", "2026-08-01T13:00:00.000Z");

    const grouped = groupCachedConversations([reply, later, root, renamed]);
    expect(grouped.limited).toBe(false);
    expect(grouped.conversations).toHaveLength(2);
    expect(grouped.conversations[0]?.messages.map(item => item.id)).toEqual([later.id]);
    expect(grouped.conversations[1]).toMatchObject({
      subject: "Renamed plan",
      unreadCount: 1,
      accountIds: ["alpha", "bravo"],
    });
    expect(grouped.conversations[1]?.messages.map(item => item.id)).toEqual([renamed.id, reply.id, root.id]);
  });

  it("joins siblings that share a missing reference but keeps no-subject rows separate without one", () => {
    const siblingA = message("alpha:Inbox:1", "First wording", "2026-08-01T10:00:00.000Z", { inReplyTo: "<missing@example.test>" });
    const siblingB = message("bravo:Inbox:2", "Second wording", "2026-08-01T11:00:00.000Z", { references: ["<missing@example.test>"] });
    const noSubjectA = message("alpha:Inbox:3", "(No subject)", "2026-08-01T09:00:00.000Z");
    const noSubjectB = message("alpha:Inbox:4", "Re: (No subject)", "2026-08-01T08:00:00.000Z");

    const groups = groupCachedConversations([siblingA, siblingB, noSubjectA, noSubjectB]).conversations;
    expect(groups.map(group => group.messages.length).sort()).toEqual([1, 1, 2]);
  });

  it("fails open to individual rows above the explicit in-memory grouping limit", () => {
    const rows = Array.from({ length: CACHED_CONVERSATION_MESSAGE_LIMIT + 1 }, (_value, index) =>
      message(`alpha:Inbox:${index + 1}`, "Same subject", "2026-08-01T10:00:00.000Z"));
    const grouped = groupCachedConversations(rows);
    expect(grouped.limited).toBe(true);
    expect(grouped.conversations).toHaveLength(rows.length);
    expect(grouped.conversations.every(conversation => conversation.messages.length === 1)).toBe(true);
  });
});
