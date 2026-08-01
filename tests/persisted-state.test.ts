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
