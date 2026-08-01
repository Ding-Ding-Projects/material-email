import { describe, expect, it } from "vitest";
import type { AccountDraft, AttachmentSaveReview, ComposeDraft } from "../src/shared/contracts";
import { ipcPayloadSchemas, parseIpcArgs } from "../src/main/ipc-validation";

const accountDraft = (): AccountDraft => ({
  displayName: "Demo User",
  email: "demo@example.test",
  incoming: { host: "imap.example.test", port: 993, security: "tls", username: "demo@example.test" },
  outgoing: { host: "smtp.example.test", port: 587, security: "starttls", username: "demo@example.test" },
  authMode: "password",
  secret: "fixture-secret",
});

const composeDraft = (): ComposeDraft => ({
  accountId: "account-1",
  to: ["friend@example.test"],
  cc: [],
  bcc: [],
  subject: "Hello",
  text: "A bounded message body.",
  attachments: [],
});

const riskyAttachmentReview = (): AttachmentSaveReview => ({
  riskyAttachments: [{
    index: 2,
    filename: "invoice.pdf.exe",
    contentType: "application/pdf",
    level: "dangerous",
    reasons: ["windows-executable", "double-extension", "mime-extension-mismatch"],
  }],
});

describe("non-PIM IPC validation", () => {
  it("accepts only the three bounded unified-folder identifiers", () => {
    expect(ipcPayloadSchemas.unifiedFolder.parse(["inbox"])).toEqual(["inbox"]);
    expect(ipcPayloadSchemas.unifiedFolder.parse(["starred"])).toEqual(["starred"]);
    expect(ipcPayloadSchemas.unifiedFolder.parse(["unread"])).toEqual(["unread"]);
    expect(() => ipcPayloadSchemas.unifiedFolder.parse(["all-mail"])).toThrow();
  });

  it("bounds cached-mail plain and regex search requests", () => {
    expect(ipcPayloadSchemas.cachedMailSearch.parse([{ mode: "plain", pattern: "receipt", flags: "i", limit: 100 }])).toHaveLength(1);
    expect(ipcPayloadSchemas.cachedMailSearch.parse([{ mode: "regex", pattern: "^Receipt", flags: "imu", limit: 200 }])).toHaveLength(1);
    expect(() => ipcPayloadSchemas.cachedMailSearch.parse([{ mode: "regex", pattern: "x", flags: "g", limit: 10 }])).toThrow();
    expect(() => ipcPayloadSchemas.cachedMailSearch.parse([{ mode: "plain", pattern: "x", flags: "i", limit: 201 }])).toThrow();
  });

  it("accepts a bounded account request and rejects unknown fields at every object layer", () => {
    expect(ipcPayloadSchemas.accountDraft.parse([accountDraft()])[0].email).toBe("demo@example.test");
    expect(() => ipcPayloadSchemas.accountDraft.parse([{ ...accountDraft(), unexpected: true }])).toThrow();
    expect(() =>
      ipcPayloadSchemas.accountDraft.parse([
        { ...accountDraft(), incoming: { ...accountDraft().incoming, unexpected: true } },
      ]),
    ).toThrow();
  });

  it("bounds compose content and requires absolute picker-shaped attachment paths", () => {
    expect(ipcPayloadSchemas.composeDraft.parse([composeDraft()])).toHaveLength(1);
    expect(() => ipcPayloadSchemas.composeDraft.parse([{ ...composeDraft(), subject: "hello\r\nBcc: injected@example.test" }])).toThrow();
    expect(() => ipcPayloadSchemas.composeDraft.parse([{ ...composeDraft(), attachments: ["relative-secret.txt"] }])).toThrow();
    expect(() => ipcPayloadSchemas.composeDraft.parse([{ ...composeDraft(), to: Array(501).fill("friend@example.test") }])).toThrow();
  });

  it("rejects invalid UIDs, empty flag patches, export traversal, and extra arguments", () => {
    expect(() => ipcPayloadSchemas.accountFolderMessage.parse(["account-1", "Inbox", 0])).toThrow();
    expect(() => ipcPayloadSchemas.messageFlags.parse(["account-1", "Inbox", 1, {}])).toThrow();
    expect(() => ipcPayloadSchemas.exportData.parse(["history", "content", "..\\history.md"])).toThrow();
    expect(() => parseIpcArgs("account:remove", ipcPayloadSchemas.accountId, ["account-1", "smuggled"])).toThrow(
      "Invalid account:remove IPC payload",
    );
    expect(ipcPayloadSchemas.revisionLabel.parse(["a".repeat(40), "Before cleanup · 清理之前"])).toEqual([
      "a".repeat(40),
      "Before cleanup · 清理之前",
    ]);
    expect(() => ipcPayloadSchemas.revisionLabel.parse(["a".repeat(40), "line one\nline two"])).toThrow();
    expect(() => ipcPayloadSchemas.revisionLabel.parse(["a".repeat(40), "x".repeat(121)])).toThrow();
  });

  it("accepts only credential-free bounded TLS certificate inspection requests", () => {
    expect(ipcPayloadSchemas.tlsCertificateInspection.parse([{
      endpoint: "incoming",
      host: "imap.example.test",
      port: 993,
      security: "tls",
    }])).toHaveLength(1);
    expect(() => ipcPayloadSchemas.tlsCertificateInspection.parse([{
      endpoint: "outgoing",
      host: "smtp.example.test",
      port: 587,
      security: "starttls",
      username: "must-not-cross-this-ipc",
      secret: "must-not-cross-this-ipc",
    }])).toThrow();
    expect(() => ipcPayloadSchemas.tlsCertificateInspection.parse([{
      endpoint: "incoming",
      host: "imap.example.test",
      port: 0,
      security: "tls",
    }])).toThrow();
  });

  it("accepts only fixed-length opaque external-link request IDs", () => {
    expect(ipcPayloadSchemas.externalLinkRequest.parse(["abcdefghijklmnopqrstuvwxyzABCDEF"])).toEqual(["abcdefghijklmnopqrstuvwxyzABCDEF"]);
    for (const candidate of ["short", "a".repeat(31), "a".repeat(33), `${"a".repeat(31)}!`]) {
      expect(() => ipcPayloadSchemas.externalLinkRequest.parse([candidate])).toThrow();
    }
    expect(() => ipcPayloadSchemas.externalLinkRequest.parse(["a".repeat(32), "smuggled"])).toThrow();
  });

  it("strictly validates risky attachment review acknowledgements", () => {
    expect(ipcPayloadSchemas.saveAttachment.parse(["account-1", "Inbox", 8, 2, riskyAttachmentReview()])).toHaveLength(5);
    expect(ipcPayloadSchemas.saveAllAttachments.parse(["account-1", "Inbox", 8, riskyAttachmentReview()])).toHaveLength(4);
    expect(ipcPayloadSchemas.saveAttachment.parse(["account-1", "Inbox", 8, 2])).toHaveLength(4);
    expect(ipcPayloadSchemas.quarantineItem.parse(["11111111-1111-4111-8111-111111111111"])).toHaveLength(1);
    expect(() => ipcPayloadSchemas.quarantineItem.parse(["../payload"])).toThrow();
    expect(() => ipcPayloadSchemas.saveAttachment.parse([
      "account-1",
      "Inbox",
      8,
      2,
      { riskyAttachments: [{ ...riskyAttachmentReview().riskyAttachments[0], reasons: [] }] },
    ])).toThrow();
    expect(() => ipcPayloadSchemas.saveAttachment.parse([
      "account-1",
      "Inbox",
      8,
      2,
      { riskyAttachments: [{ ...riskyAttachmentReview().riskyAttachments[0], level: "ordinary" }] },
    ])).toThrow();
    expect(() => ipcPayloadSchemas.saveAttachment.parse([
      "account-1",
      "Inbox",
      8,
      2,
      { ...riskyAttachmentReview(), unreviewed: true },
    ])).toThrow();
    expect(() => ipcPayloadSchemas.saveAllAttachments.parse(["account-1", "Inbox", 8, { riskyAttachments: [] }])).toThrow();
    expect(() => ipcPayloadSchemas.saveAttachment.parse(["account-1", "Inbox", 8, 2, riskyAttachmentReview(), "surplus"])).toThrow();
  });

  it("strictly validates preference names, values, and native editor paths", () => {
    expect(ipcPayloadSchemas.preferences.parse([{ theme: "dark", funnyEnglish: 5 }])).toEqual([{ theme: "dark", funnyEnglish: 5, nativeNotificationsEnabled: false, historyRetentionDays: 365 }]);
    expect(ipcPayloadSchemas.historyPrunePreview.parse([30])).toEqual([30]);
    expect(() => ipcPayloadSchemas.historyPrunePreview.parse([29])).toThrow();
    expect(() => ipcPayloadSchemas.historyPrunePreview.parse([3_651])).toThrow();
    expect(ipcPayloadSchemas.historyPrune.parse([{
      retentionDays: 365,
      cutoffAt: "2025-08-01T12:00:00.000Z",
      expectedHeadHash: "a".repeat(40),
      expectedEligibleHashes: ["b".repeat(40)],
    }])).toHaveLength(1);
    expect(() => ipcPayloadSchemas.historyPrune.parse([{
      retentionDays: 365,
      cutoffAt: "2025-08-01T12:00:00.000Z",
      expectedHeadHash: "a".repeat(40),
      expectedEligibleHashes: ["b".repeat(40), "b".repeat(40)],
    }])).toThrow();
    expect(() => ipcPayloadSchemas.preferences.parse([{ funnyEnglish: 6 }])).toThrow();
    expect(() => ipcPayloadSchemas.preferences.parse([{ inventedSetting: true }])).toThrow();
    expect(ipcPayloadSchemas.editorOpen.parse([undefined])).toEqual([undefined]);
    expect(() => ipcPayloadSchemas.editorOpen.parse(["notepad.exe"])).toThrow();
  });

  it("accepts only an explicit boolean remote-content decision for a bounded message identity", () => {
    expect(ipcPayloadSchemas.remoteContentConsent.parse(["account-1", "Inbox", 8, true])).toEqual(["account-1", "Inbox", 8, true]);
    expect(() => ipcPayloadSchemas.remoteContentConsent.parse(["account-1", "Inbox", 8, "true"])).toThrow();
    expect(() => ipcPayloadSchemas.remoteContentConsent.parse(["account-1", "Inbox", 0, true])).toThrow();
    expect(() => ipcPayloadSchemas.remoteContentConsent.parse(["account-1", "Inbox", 8, true, "surplus"])).toThrow();
  });

  it("does not echo a rejected account secret in validation errors", () => {
    const secret = "do-not-echo-this-value".repeat(1_000);
    let message = "";
    try {
      parseIpcArgs("account:add", ipcPayloadSchemas.accountDraft, [{ ...accountDraft(), secret }]);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("Invalid account:add IPC payload");
    expect(message).not.toContain(secret.slice(0, 40));
  });
});
