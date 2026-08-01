import { describe, expect, it } from "vitest";
import type { AccountDraft, ComposeDraft } from "../src/shared/contracts";
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

describe("non-PIM IPC validation", () => {
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
  });

  it("strictly validates preference names, values, and native editor paths", () => {
    expect(ipcPayloadSchemas.preferences.parse([{ theme: "dark", funnyEnglish: 5 }])).toEqual([{ theme: "dark", funnyEnglish: 5 }]);
    expect(() => ipcPayloadSchemas.preferences.parse([{ funnyEnglish: 6 }])).toThrow();
    expect(() => ipcPayloadSchemas.preferences.parse([{ inventedSetting: true }])).toThrow();
    expect(ipcPayloadSchemas.editorOpen.parse([undefined])).toEqual([undefined]);
    expect(() => ipcPayloadSchemas.editorOpen.parse(["notepad.exe"])).toThrow();
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
