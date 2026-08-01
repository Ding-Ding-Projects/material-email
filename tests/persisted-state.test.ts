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
    expect(parsePersistedState(minimalState()).preferences.historyRetentionDays).toBe(365);
  });

  it("migrates notification category and dismissal state while dropping legacy executable commands", () => {
    const notification = {
      id: "notification-1",
      kind: "warning",
      title: "Stored before structured actions",
      body: "The record remains reviewable.",
      createdAt: "2026-08-01T12:00:00.000Z",
      read: true,
      action: { label: "Run arbitrary command", command: "anything" },
    };
    const [parsed] = parsePersistedState({ ...minimalState(), notifications: [notification] }).notifications;

    expect(parsed).toMatchObject({ category: "system", dismissed: false, read: true });
    expect(parsed?.action).toBeUndefined();
  });

  it("retains bounded structured notification actions and persisted read/dismiss state", () => {
    const notification = {
      id: "notification-2",
      kind: "error",
      category: "delivery",
      title: "Delivery paused",
      body: "Retry remains available.",
      createdAt: "2026-08-01T12:00:00.000Z",
      read: true,
      dismissed: true,
      action: { kind: "retry", target: "outbox", accountId: "account-1", outboxId: "outbox-1" },
    };
    const [parsed] = parsePersistedState({ ...minimalState(), notifications: [notification] }).notifications;

    expect(parsed).toEqual(notification);
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
      cryptography: {
        protocol: null,
        container: "none",
        state: "unsigned",
        reason: "no-cryptographic-container",
        signatureVerification: "not-performed",
        contentDecryption: "not-performed",
      },
    });
  });

  it("migrates accounts to an empty metadata-only cryptography profile", () => {
    const parsed = parsePersistedState({
      ...minimalState(),
      accounts: [{
        id: "demo",
        displayName: "Demo",
        email: "demo@example.test",
        incoming: { host: "demo.local", port: 993, security: "tls", username: "demo" },
        outgoing: { host: "demo.local", port: 465, security: "tls", username: "demo" },
        authMode: "password",
        kind: "demo",
        createdAt: "2026-07-31T00:00:00.000Z",
      }],
    });

    expect(parsed.accounts[0]?.messageCryptography).toEqual({ schemaVersion: 1, identities: [] });
  });

  it("rejects plaintext cryptographic material and verified metadata before persistence", () => {
    const account = {
      id: "demo",
      displayName: "Demo",
      email: "demo@example.test",
      incoming: { host: "demo.local", port: 993, security: "tls", username: "demo" },
      outgoing: { host: "demo.local", port: 465, security: "tls", username: "demo" },
      authMode: "password",
      kind: "demo",
      createdAt: "2026-07-31T00:00:00.000Z",
      messageCryptography: {
        schemaVersion: 1,
        identities: [{
          id: "fixture",
          protocol: "openpgp",
          email: "demo@example.test",
          displayName: "Fixture metadata",
          fingerprint: "0123456789ABCDEF0123456789ABCDEF01234567",
          trust: "unverified",
          source: "local-metadata",
          secretStorage: "none",
          privateKey: "plaintext-fixture-private-key",
        }],
      },
    };
    expect(() => parsePersistedState({ ...minimalState(), accounts: [account] })).toThrow(/key material and secrets are never accepted/i);
    const verified = structuredClone(account);
    delete (verified.messageCryptography.identities[0] as { privateKey?: string }).privateKey;
    verified.messageCryptography.identities[0]!.trust = "verified";
    expect(() => parsePersistedState({ ...minimalState(), accounts: [verified] })).toThrow(/cannot claim cryptographic verification/i);
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
