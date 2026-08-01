import { describe, expect, it } from "vitest";
import type { AccountSummary, FolderSummary, MessageDetail, MessageSummary } from "../src/shared/contracts";
import {
  CACHED_MAIL_INDEX_DOCUMENT_LIMIT,
  createCachedMailIndex,
  searchCachedMailIndex,
} from "../src/shared/cached-mail-index";

const account = (id: string, name: string): AccountSummary => ({
  id,
  displayName: name,
  email: `${id}@example.test`,
  incoming: { host: "demo.local", port: 993, security: "tls", username: id },
  outgoing: { host: "demo.local", port: 465, security: "tls", username: id },
  authMode: "password",
  kind: "demo",
  createdAt: "2026-08-01T00:00:00.000Z",
});

const folder = (accountId: string, path: string): FolderSummary => ({
  accountId,
  path,
  name: path === "Inbox" ? "Inbox" : "Receipts",
  role: path === "Inbox" ? "inbox" : "archive",
  unread: 0,
  total: 1,
});

const message = (accountId: string, folderPath: string, uid: number, subject: string, date: string): MessageSummary => ({
  id: `${accountId}:${folderPath}:${uid}`,
  accountId,
  folderPath,
  uid,
  messageId: `<${accountId}-${uid}@example.test>`,
  from: [{ name: "Sender", address: "sender@example.test" }],
  to: [{ name: "User", address: `${accountId}@example.test` }],
  cc: [],
  subject,
  date,
  preview: `${subject} preview`,
  unread: false,
  starred: false,
  hasAttachments: false,
  size: 100,
});

const detail = (summary: MessageSummary, text: string): MessageDetail => ({
  ...summary,
  text,
  html: `<p>${text}</p>`,
  remoteContentHtml: `<p>${text}</p>`,
  remoteContentSources: [],
  remoteContentAllowed: false,
  attachments: [],
  replyTo: summary.from,
});

describe("bounded cached mail index", () => {
  it("normalizes plain search and returns account, folder, conversation, and body-snippet attribution", () => {
    const alpha = account("alpha", "Alpha Account");
    const bravo = account("bravo", "Bravo Account");
    const root = message("alpha", "Inbox", 1, "Ｒｅｃｅｉｐｔ 4471", "2026-08-01T10:00:00.000Z");
    const reply = { ...message("bravo", "Receipts", 2, "Re: Receipt 4471", "2026-08-01T11:00:00.000Z"), inReplyTo: root.messageId! };
    const index = createCachedMailIndex({
      accounts: [alpha, bravo],
      folders: { alpha: [folder("alpha", "Inbox")], bravo: [folder("bravo", "Receipts")] },
      messages: { "alpha\u0000Inbox": [root], "bravo\u0000Receipts": [reply] },
      details: { [reply.id]: detail(reply, "A cached body-only phrase: steamer basket approved.") },
    });

    const subjectResult = searchCachedMailIndex(index, { mode: "plain", pattern: "receipt 4471", flags: "i", limit: 10 });
    expect(subjectResult.hits).toHaveLength(2);
    expect(subjectResult.hits[0]).toMatchObject({
      account: { displayName: "Bravo Account", email: "bravo@example.test" },
      folder: { name: "Receipts", role: "archive" },
      conversation: { subject: "Receipt 4471", messageCount: 2 },
    });
    expect(subjectResult.hits[0]?.matchedFields).toContain("subject");

    const bodyResult = searchCachedMailIndex(index, { mode: "plain", pattern: "steamer basket", flags: "i", limit: 10 });
    expect(bodyResult.hits).toHaveLength(1);
    expect(bodyResult.hits[0]?.matchedFields).toContain("body");
    expect(bodyResult.hits[0]?.snippet).toContain("cached body-only phrase");
  });

  it("uses the shared bounded JavaScript regex rules and caps returned hits without hiding the total", () => {
    const alpha = account("alpha", "Alpha Account");
    const rows = [1, 2, 3].map(uid => message("alpha", "Inbox", uid, `Invoice-${uid}`, `2026-08-01T1${uid}:00:00.000Z`));
    const index = createCachedMailIndex({
      accounts: [alpha],
      folders: { alpha: [folder("alpha", "Inbox")] },
      messages: { "alpha\u0000Inbox": rows },
      details: {},
    });
    const result = searchCachedMailIndex(index, { mode: "regex", pattern: "^Invoice-[1-3]$", flags: "i", limit: 1 });
    expect(result.hits).toHaveLength(1);
    expect(result.totalMatched).toBe(3);
    expect(result.resultLimit).toBe(1);
    expect(() => searchCachedMailIndex(index, { mode: "regex", pattern: "(a+)+", flags: "i", limit: 10 })).toThrow(/nested quantifier/i);
  });

  it("rejects orphan attribution and stops indexing at the explicit document ceiling", () => {
    const alpha = account("alpha", "Alpha Account");
    const rows = Array.from({ length: CACHED_MAIL_INDEX_DOCUMENT_LIMIT + 1 }, (_value, index) =>
      message("alpha", "Inbox", index + 1, `Bounded ${index + 1}`, "2026-08-01T10:00:00.000Z"));
    const index = createCachedMailIndex({
      accounts: [alpha],
      folders: { alpha: [folder("alpha", "Inbox")] },
      messages: {
        "alpha\u0000Inbox": rows,
        "removed\u0000Inbox": [message("removed", "Inbox", 1, "Orphan", "2026-08-01T12:00:00.000Z")],
      },
      details: {},
    });
    expect(index.documents).toHaveLength(CACHED_MAIL_INDEX_DOCUMENT_LIMIT);
    expect(index.documentLimitReached).toBe(true);
    const result = searchCachedMailIndex(index, { mode: "plain", pattern: "Bounded", flags: "i", limit: 200 });
    expect(result.totalMatched).toBe(CACHED_MAIL_INDEX_DOCUMENT_LIMIT);
    expect(result.hits).toHaveLength(200);
    expect(result.documentLimitReached).toBe(true);
  });
});
