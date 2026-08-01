import { describe, expect, it } from "vitest";
import { parsePersistedState } from "../src/main/persisted-state";

const minimalState = () => ({
  schemaVersion: 1 as const,
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
    dimSumEnabled: true,
    narratorEnabled: false,
    narratorLanguage: "en",
  },
  folders: {},
  messages: {},
  details: {},
  drafts: [],
  pendingOperations: [],
  outbox: [],
  notifications: [],
  history: [],
});

describe("persisted application state schema", () => {
  it("migrates the main-only editor approval list into older version-1 state", () => {
    expect(parsePersistedState(minimalState()).approvedEditorPaths).toEqual([]);
    expect(parsePersistedState(minimalState()).quarantinedAttachments).toEqual([]);
  });

  it("migrates cached message details to default-deny remote-content fields", () => {
    const detail = {
      id: "demo:Inbox:1",
      accountId: "demo",
      folderPath: "Inbox",
      uid: 1,
      from: [{ name: "Sender", address: "sender@example.test" }],
      to: [{ name: "Demo", address: "demo@example.test" }],
      cc: [],
      subject: "Old cached detail",
      date: "2026-07-31T00:00:00.000Z",
      preview: "Stored before remote-content controls existed.",
      unread: false,
      starred: false,
      hasAttachments: false,
      size: 48,
      text: "Stored before remote-content controls existed.",
      html: "<p>Stored before remote-content controls existed.</p>",
      attachments: [],
      replyTo: [{ name: "Sender", address: "sender@example.test" }],
    };
    const parsed = parsePersistedState({ ...minimalState(), details: { [detail.id]: detail } });

    expect(parsed.details[detail.id]).toMatchObject({
      remoteContentHtml: "",
      remoteContentSources: [],
      remoteContentAllowed: false,
    });
  });

  it("rejects unknown fields and renderer-shaped executable paths", () => {
    expect(() => parsePersistedState({ ...minimalState(), unknown: true })).toThrow();
    expect(() =>
      parsePersistedState({
        ...minimalState(),
        preferences: { ...minimalState().preferences, externalEditorPath: "notepad.exe" },
      }),
    ).toThrow();
  });

  it("rejects stored network accounts without encrypted credentials", () => {
    expect(() =>
      parsePersistedState({
        ...minimalState(),
        accounts: [
          {
            id: "account-1",
            displayName: "Mail User",
            email: "mail@example.test",
            incoming: { host: "imap.example.test", port: 993, security: "tls", username: "mail@example.test" },
            outgoing: { host: "smtp.example.test", port: 465, security: "tls", username: "mail@example.test" },
            authMode: "password",
            kind: "imap",
            createdAt: "2026-07-31T00:00:00.000Z",
          },
        ],
      }),
    ).toThrow("encrypted credential");
  });
});
