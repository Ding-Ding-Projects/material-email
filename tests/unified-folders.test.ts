import { describe, expect, it } from "vitest";
import type { FolderSummary, MessageSummary } from "../src/shared/contracts";
import { collectCachedUnifiedMessages, selectStableMessageId } from "../src/shared/unified-folders";

const summary = (
  accountId: string,
  folderPath: string,
  uid: number,
  date: string,
  flags: { unread?: boolean; starred?: boolean } = {},
): MessageSummary => ({
  id: `${accountId}:${folderPath}:${uid}`,
  accountId,
  folderPath,
  uid,
  from: [{ name: `${accountId} sender`, address: `${accountId}@example.test` }],
  to: [],
  cc: [],
  subject: `${accountId} ${folderPath} ${uid}`,
  date,
  preview: "Cached summary only",
  unread: flags.unread ?? false,
  starred: flags.starred ?? false,
  hasAttachments: false,
  size: 100,
});

const folder = (accountId: string, path: string, role: FolderSummary["role"]): FolderSummary => ({
  accountId,
  path,
  name: path,
  role,
  unread: 0,
  total: 1,
});

describe("cached unified folders", () => {
  const alphaInbox = summary("alpha", "Inbox", 1, "2026-08-01T10:00:00.000Z", { unread: true });
  const alphaArchive = summary("alpha", "Archive", 2, "2026-08-01T12:00:00.000Z", { starred: true });
  const bravoInbox = summary("bravo", "Primary", 1, "2026-08-01T11:00:00.000Z", { unread: true, starred: true });
  const cache = {
    accountIds: ["alpha", "bravo"],
    folders: {
      alpha: [folder("alpha", "Inbox", "inbox"), folder("alpha", "Archive", "archive")],
      bravo: [folder("bravo", "Primary", "inbox")],
    },
    messages: {
      "alpha\u0000Inbox": [alphaInbox, alphaInbox],
      "alpha\u0000Archive": [alphaArchive],
      "bravo\u0000Primary": [bravoInbox],
      "removed\u0000Inbox": [summary("removed", "Inbox", 1, "2026-08-01T13:00:00.000Z", { unread: true, starred: true })],
      "alpha\u0000Wrong": [summary("bravo", "Wrong", 3, "2026-08-01T14:00:00.000Z", { unread: true, starred: true })],
    },
  };

  it("aggregates only coherent cached summaries for current accounts and sorts deterministically", () => {
    expect(collectCachedUnifiedMessages("inbox", cache).map(message => message.id)).toEqual([bravoInbox.id, alphaInbox.id]);
    expect(collectCachedUnifiedMessages("starred", cache).map(message => message.id)).toEqual([alphaArchive.id, bravoInbox.id]);
    expect(collectCachedUnifiedMessages("unread", cache).map(message => message.id)).toEqual([bravoInbox.id, alphaInbox.id]);
  });

  it("keeps a composite selection through reorder and falls back near its previous index", () => {
    const first = [alphaArchive, bravoInbox, alphaInbox];
    expect(selectStableMessageId([alphaInbox, alphaArchive, bravoInbox], bravoInbox.id, 1)).toBe(bravoInbox.id);
    expect(selectStableMessageId([alphaArchive, alphaInbox], bravoInbox.id, first.indexOf(bravoInbox))).toBe(alphaInbox.id);
    expect(selectStableMessageId([], bravoInbox.id, 1)).toBeNull();
  });
});
