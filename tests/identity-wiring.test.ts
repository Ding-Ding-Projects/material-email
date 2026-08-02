import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountDraft, ComposeDraft, MailIdentity, SendResult } from "../src/shared/contracts";
import { parsePersistedState } from "../src/main/persisted-state";

const serviceMocks = vi.hoisted(() => ({
  testAccount: vi.fn(),
  sendMessage: vi.fn(),
  historySnapshot: vi.fn(),
}));

vi.mock("electron", () => ({
  app: { getAppPath: () => process.cwd(), getVersion: () => "0.1.0-test" },
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value, "utf8"),
    decryptString: (value: Buffer) => value.toString("utf8"),
  },
}));

vi.mock("../src/main/history-repository.js", () => ({
  HistoryRepository: class {
    snapshot(filePath: string): Promise<void> {
      return serviceMocks.historySnapshot(filePath);
    }
  },
}));

// The demo workspace parses its bundled messages through this module's real sanitizer, so only the
// transport class is replaced here.
vi.mock("../src/main/mail-service.js", async importOriginal => ({
  ...(await importOriginal<typeof import("../src/main/mail-service")>()),
  MailService: class {
    testAccount(account: unknown): Promise<unknown> { return serviceMocks.testAccount(account); }
    sendMessage(account: unknown, draft: unknown, identity: unknown): Promise<SendResult> {
      return serviceMocks.sendMessage(account, draft, identity);
    }
  },
}));

import { AppService } from "../src/main/app-service";

const accountDraft: AccountDraft = {
  displayName: "Identity Test",
  email: "identity@example.test",
  incoming: { host: "imap.example.test", port: 993, security: "tls", username: "identity@example.test" },
  outgoing: { host: "smtp.example.test", port: 465, security: "tls", username: "identity@example.test" },
  authMode: "password",
  secret: "fixture-only-secret",
};

const secondAccountDraft: AccountDraft = {
  ...accountDraft,
  displayName: "Second Identity Test",
  email: "second@example.test",
  incoming: { ...accountDraft.incoming, username: "second@example.test" },
  outgoing: { ...accountDraft.outgoing, username: "second@example.test" },
};

const compose = (accountId: string, overrides: Partial<ComposeDraft> = {}): ComposeDraft => ({
  accountId,
  to: ["recipient@example.test"],
  cc: [],
  bcc: [],
  subject: "Identity wiring",
  text: "The From address comes from the resolved identity.",
  attachments: [],
  ...overrides,
});

const accepted = (messageId: string): SendResult => ({
  messageId,
  accepted: ["recipient@example.test"],
  rejected: [],
  queued: false,
});

const forAccount = (identities: readonly MailIdentity[], accountId: string): MailIdentity[] =>
  identities.filter(identity => identity.accountId === accountId);

interface StoredIdentityState {
  identities?: MailIdentity[];
  drafts: ComposeDraft[];
  outbox: Array<{ draft: ComposeDraft }>;
}

describe("AppService identity wiring", () => {
  let directory = "";

  beforeEach(() => {
    vi.clearAllMocks();
    serviceMocks.testAccount.mockResolvedValue({ incoming: true, outgoing: true });
    serviceMocks.historySnapshot.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
    directory = "";
  });

  const statePath = (): string => path.join(directory, "material-email-state-v1.json");

  const readState = async (): Promise<StoredIdentityState> =>
    JSON.parse(await readFile(statePath(), "utf8")) as StoredIdentityState;

  const createService = async (): Promise<{ service: AppService; accountId: string }> => {
    directory = await mkdtemp(path.join(os.tmpdir(), "material-email-identity-"));
    const service = new AppService(directory);
    const account = await service.addAccount(accountDraft);
    return { service, accountId: account.id };
  };

  it("seeds exactly one default identity when an account is added", async () => {
    const { service, accountId } = await createService();

    expect(await service.listIdentities()).toEqual([
      expect.objectContaining({
        accountId,
        displayName: "Identity Test",
        email: "identity@example.test",
        replyTo: "",
        organization: "",
        signature: "",
        signaturePlacement: "below-body",
        isDefault: true,
        ordinal: 0,
      }),
    ]);
  });

  it("seeds the demo workspace its own default identity without disturbing the added account", async () => {
    const { service, accountId } = await createService();

    await service.createDemoAccount();

    const identities = await service.listIdentities();
    expect(forAccount(identities, "demo")).toEqual([
      expect.objectContaining({ accountId: "demo", email: "demo@material-email.local", isDefault: true, ordinal: 0 }),
    ]);
    expect(forAccount(identities, accountId)).toHaveLength(1);
  });

  it("backfills one default identity for an account persisted before identities existed", async () => {
    const { service, accountId } = await createService();
    const seededId = (await service.listIdentities())[0]!.id;
    const persisted = JSON.parse(await readFile(statePath(), "utf8")) as Record<string, unknown>;
    delete persisted.identities;
    await writeFile(statePath(), JSON.stringify(persisted), "utf8");

    const restarted = new AppService(directory);
    const first = await restarted.bootstrap();
    expect(first.identities).toEqual([
      expect.objectContaining({ accountId, email: "identity@example.test", isDefault: true, ordinal: 0 }),
    ]);
    // A recovered backup copy would carry the original identity, so the new id proves a real backfill.
    expect(first.identities[0]?.id).not.toBe(seededId);

    // A second launch must find the backfill already done rather than seeding another identity.
    const second = await restarted.bootstrap();
    expect(second.identities).toEqual([expect.objectContaining({ id: first.identities[0]?.id })]);
    expect((await readState()).identities).toHaveLength(1);
  });

  it("creates an identity and then updates it in place", async () => {
    const { service, accountId } = await createService();

    const created = await service.saveIdentity({
      accountId,
      displayName: "Identity Test (Work)",
      email: "work@example.test",
      replyTo: "replies@example.test",
      organization: "Ding Ding Projects",
      signature: "Mat\nDing Ding Projects",
      signaturePlacement: "below-quote",
    });
    const second = forAccount(created, accountId).find(identity => identity.email === "work@example.test");
    expect(created).toHaveLength(2);
    expect(second).toMatchObject({
      displayName: "Identity Test (Work)",
      replyTo: "replies@example.test",
      organization: "Ding Ding Projects",
      signature: "Mat\nDing Ding Projects",
      signaturePlacement: "below-quote",
      isDefault: false,
      ordinal: 1,
    });

    const updated = await service.saveIdentity({
      id: second!.id,
      accountId,
      displayName: "Identity Test (Renamed)",
      email: "work@example.test",
      signature: "Mat",
    });
    expect(updated).toHaveLength(2);
    expect(updated.find(identity => identity.id === second!.id)).toMatchObject({
      displayName: "Identity Test (Renamed)",
      signature: "Mat",
      isDefault: false,
      ordinal: 1,
    });
  });

  it("leaves a second identity non-default until setDefaultIdentity moves the default", async () => {
    const { service, accountId } = await createService();
    const seeded = (await service.listIdentities())[0]!;
    const created = await service.saveIdentity({ accountId, displayName: "Identity Test (Work)", email: "work@example.test" });
    const second = created.find(identity => identity.email === "work@example.test")!;
    expect(second.isDefault).toBe(false);

    const promoted = await service.setDefaultIdentity(second.id);

    expect(forAccount(promoted, accountId).filter(identity => identity.isDefault)).toEqual([
      expect.objectContaining({ id: second.id }),
    ]);
    expect(promoted.find(identity => identity.id === seeded.id)?.isDefault).toBe(false);
  });

  it("promotes a sibling when the default is deleted and refuses the account's last identity", async () => {
    const { service, accountId } = await createService();
    const seeded = (await service.listIdentities())[0]!;
    const created = await service.saveIdentity({ accountId, displayName: "Identity Test (Work)", email: "work@example.test" });
    const second = created.find(identity => identity.email === "work@example.test")!;

    const remaining = await service.deleteIdentity(seeded.id);
    expect(remaining).toEqual([expect.objectContaining({ id: second.id, isDefault: true })]);

    await expect(service.deleteIdentity(second.id)).rejects.toThrow(/at least one identity/u);
    expect(await service.listIdentities()).toEqual([expect.objectContaining({ id: second.id, isDefault: true })]);
  });

  it("clears the deleted identity's stale identityId from drafts and outbox items", async () => {
    const { service, accountId } = await createService();
    const created = await service.saveIdentity({ accountId, displayName: "Identity Test (Work)", email: "work@example.test" });
    const second = created.find(identity => identity.email === "work@example.test")!;
    await service.saveDraft(compose(accountId, { id: "saved-draft", identityId: second.id }));
    serviceMocks.sendMessage.mockRejectedValueOnce(new Error("Fixture SMTP offline"));
    await service.sendMessage(compose(accountId, { id: "queued-draft", identityId: second.id }));
    const before = await readState();
    expect(before.drafts[0]?.identityId).toBe(second.id);
    expect(before.outbox[0]?.draft.identityId).toBe(second.id);

    await service.deleteIdentity(second.id);

    const after = await readState();
    expect(after.drafts[0]).toMatchObject({ id: "saved-draft" });
    expect(after.drafts[0]).not.toHaveProperty("identityId");
    expect(after.outbox[0]?.draft).toMatchObject({ id: "queued-draft" });
    expect(after.outbox[0]?.draft).not.toHaveProperty("identityId");
  });

  it("forgets a removed account's identities and leaves another account's untouched", async () => {
    const { service, accountId } = await createService();
    const other = await service.addAccount(secondAccountDraft);
    await service.saveIdentity({ accountId: other.id, displayName: "Second (Work)", email: "second-work@example.test" });
    expect(forAccount(await service.listIdentities(), other.id)).toHaveLength(2);

    await service.removeAccount(accountId);

    const remaining = await service.listIdentities();
    expect(forAccount(remaining, accountId)).toEqual([]);
    expect(forAccount(remaining, other.id)).toHaveLength(2);
    expect(remaining.filter(identity => identity.isDefault)).toHaveLength(1);
  });

  it("sends from the account default when the draft names no identity", async () => {
    const { service, accountId } = await createService();
    const seeded = (await service.listIdentities())[0]!;
    serviceMocks.sendMessage.mockResolvedValueOnce(accepted("<default-identity@example.test>"));

    await service.sendMessage(compose(accountId));

    expect(serviceMocks.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ id: accountId }),
      expect.objectContaining({ accountId }),
      expect.objectContaining({ id: seeded.id, email: "identity@example.test" }),
    );
  });

  it("sends from the identity the draft names", async () => {
    const { service, accountId } = await createService();
    const created = await service.saveIdentity({
      accountId,
      displayName: "Identity Test (Work)",
      email: "work@example.test",
      replyTo: "replies@example.test",
    });
    const second = created.find(identity => identity.email === "work@example.test")!;
    serviceMocks.sendMessage.mockResolvedValueOnce(accepted("<named-identity@example.test>"));

    await service.sendMessage(compose(accountId, { identityId: second.id }));

    expect(serviceMocks.sendMessage.mock.calls[0]?.[2]).toMatchObject({
      id: second.id,
      email: "work@example.test",
      replyTo: "replies@example.test",
      isDefault: false,
    });
  });

  it("sends from the account default when the draft names another account's identity", async () => {
    const { service, accountId } = await createService();
    const seeded = (await service.listIdentities())[0]!;
    const other = await service.addAccount(secondAccountDraft);
    const foreign = forAccount(await service.listIdentities(), other.id)[0]!;
    serviceMocks.sendMessage.mockResolvedValueOnce(accepted("<foreign-identity@example.test>"));

    await service.sendMessage(compose(accountId, { identityId: foreign.id }));

    expect(serviceMocks.sendMessage.mock.calls[0]?.[2]).toMatchObject({ id: seeded.id, email: "identity@example.test" });
    expect(serviceMocks.sendMessage.mock.calls[0]?.[2]).not.toMatchObject({ id: foreign.id });
  });
});

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

const storedIdentity = (overrides: Partial<MailIdentity> = {}): MailIdentity => ({
  id: "identity-1",
  accountId: "account-1",
  displayName: "Mat Day",
  email: "mat@example.com",
  replyTo: "",
  organization: "",
  signature: "",
  signaturePlacement: "below-body",
  isDefault: true,
  ordinal: 0,
  ...overrides,
});

describe("persisted identity state", () => {
  it("round-trips stored identities unchanged", () => {
    const identities = [
      storedIdentity({ replyTo: "replies@example.com", organization: "Ding Ding Projects", signature: "Mat\nDing Ding Projects" }),
      storedIdentity({ id: "identity-2", email: "mat@work.example", signaturePlacement: "below-quote", isDefault: false, ordinal: 1 }),
    ];

    expect(parsePersistedState({ ...minimalState(), identities }).identities).toEqual(identities);
  });

  it("collapses two defaults on one account and promotes an account left with none", () => {
    const parsed = parsePersistedState({
      ...minimalState(),
      identities: [
        storedIdentity(),
        storedIdentity({ id: "identity-2", email: "mat@work.example", ordinal: 1 }),
        storedIdentity({ id: "identity-3", accountId: "account-2", email: "mat@second.example", isDefault: false }),
      ],
    });

    expect(parsed.identities.filter(identity => identity.accountId === "account-1" && identity.isDefault)).toEqual([
      expect.objectContaining({ id: "identity-1" }),
    ]);
    expect(parsed.identities.find(identity => identity.id === "identity-2")?.isDefault).toBe(false);
    expect(parsed.identities.find(identity => identity.id === "identity-3")?.isDefault).toBe(true);
  });
});
