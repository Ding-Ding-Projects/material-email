import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MailService, type RuntimeAccount } from "../src/main/mail-service";
import { ImapFixture } from "./helpers/imap-fixture";

describe("IMAP integration", () => {
  let fixture: ImapFixture;
  let account: RuntimeAccount;

  beforeEach(async () => {
    fixture = new ImapFixture();
    const port = await fixture.listen();
    account = {
      id: "imap-test",
      displayName: "Demo User",
      email: "demo@example.test",
      incoming: { host: "127.0.0.1", port, security: "plain", username: "demo@example.test" },
      outgoing: { host: "127.0.0.1", port: 1, security: "plain", username: "demo@example.test" },
      authMode: "password",
      kind: "imap",
      createdAt: new Date().toISOString(),
      secret: "fixture-password",
    };
  });

  afterEach(async () => fixture.close());

  it("discovers folders, fetches summaries and source, changes flags, and moves by UID", async () => {
    const service = new MailService();
    const folders = await service.listFolders(account);
    const inbox = folders.find(folder => folder.role === "inbox")!;
    const sent = folders.find(folder => folder.role === "sent")!;
    expect(inbox).toEqual(expect.objectContaining({ role: "inbox", total: 1, unread: 1, uidValidity: "777" }));
    expect(sent).toEqual(expect.objectContaining({ role: "sent", total: 0, unread: 0, uidValidity: "888" }));

    const messages = await service.listMessages(account, inbox.path);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual(expect.objectContaining({ uid: 1, uidValidity: "777", subject: "IMAP socket fixture", unread: true }));

    const detail = await service.getMessage(account, inbox.path, 1, inbox.uidValidity!);
    expect(detail.text).toContain("real local IMAP socket");
    expect(detail.messageId).toBe("<imap-fixture@example.test>");

    await service.setFlags(account, inbox.path, 1, { unread: false, starred: true }, inbox.uidValidity!);
    const updated = await service.listMessages(account, inbox.path);
    expect(updated[0]).toEqual(expect.objectContaining({ unread: false, starred: true }));

    await expect(service.moveMessage(account, inbox.path, 1, sent.path, inbox.uidValidity!)).resolves.toEqual({
      destinationUid: 1,
      destinationUidValidity: "888",
    });
    expect(await service.listMessages(account, inbox.path)).toEqual([]);
    expect(fixture.commands.some(command => /UID MOVE 1/i.test(command))).toBe(true);
  });
});
