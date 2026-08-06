import { access, lstat, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { createHash, randomUUID } from "node:crypto";
import { app, dialog, safeStorage } from "electron";
import type {
  AccountDraft,
  AccountTestResult,
  AccountDiscoveryResult,
  AccountSummary,
  BootstrapState,
  ComposeDraft,
  FolderSummary,
  HistoryRecord,
  JunkAssessment,
  JunkSummary,
  MessageFilter,
  MessageFilterInput,
  MessageFilterRunSummary,
  MessageTagAssignmentMap,
  MessageTagCatalog,
  MessageDetail,
  MessageSummary,
  NotificationRecord,
  NotificationAction,
  NotificationCategory,
  Preferences,
  LocalRevision,
  LocalRevisionDiff,
  LocalHistoryPrunePreview,
  LocalHistoryPruneRequest,
  LocalHistoryPruneResult,
  LocalHistoryDeletionEvidence,
  ReleaseIdentity,
  CalendarEvent,
  CalendarEventPatch,
  Contact,
  ContactPatch,
  CreateCalendarEventInput,
  CreateContactInput,
  CreateMailingListInput,
  CreateTaskInput,
  ICalendarDuplicatePolicy,
  ICalendarExportRequest,
  ICalendarExportResult,
  ICalendarImportResult,
  MailingList,
  MailingListPatch,
  PimTransaction,
  Task,
  TaskPatch,
  TransactionFilter,
  VCardImportResult,
  SendResult,
  SyncResult,
  LocalDraftSummary,
  OutboxSummary,
  PendingOperationSummary,
  PimProviderFoundationSnapshot,
  PimProviderProfileInput,
  AttachmentSaveReview,
  AttachmentBatchSaveOutcome,
  AttachmentSaveOutcome,
  QuarantinedAttachment,
  UnifiedFolderKind,
  CachedMailSearchQuery,
  CachedMailSearchResult,
  TlsCertificateInspectionRequest,
  TlsCertificateInspectionResult,
} from "../shared/contracts.js";
import { AUTOMATIC_MAIL_QUEUE_ATTEMPT_LIMIT, LOCAL_HISTORY_RETENTION_DAYS_DEFAULT, PIM_INTERCHANGE_MAX_BYTES } from "../shared/contracts.js";
import {
  attachmentSaveReviewMatches,
  createAttachmentRiskReviewItem,
  createAttachmentSaveReview,
  type AttachmentRiskReviewItem,
} from "../shared/attachment-safety.js";
import { JsonStore } from "./storage.js";
import { DEFAULT_APPEARANCE_PREFERENCES } from "../shared/appearance.js";
import { HistoryRepository } from "./history-repository.js";
import { AccountDiscoveryService } from "./account-discovery.js";
import { PimService, runPimProviderFoundation } from "./pim/index.js";
import {
  MailService,
  sanitizeMessageContent,
  type AttachmentContent,
  type MailMoveResult,
  type RuntimeAccount,
} from "./mail-service.js";
import { assertMimeSourceSize } from "./mime-safety.js";
import { accountDraftSchema, composeDraftSchema, mailIdentityInputSchema, pimProviderProfileInputSchema, preferencesPatchSchema, preferencesSchema, quarantineIdSchema } from "./ipc-validation.js";
import { AttachmentAuthorization, inspectEditorExecutable, sameWindowsPath } from "./local-file-authorization.js";
import {
  parsePersistedState,
  type OutboxItem,
  type PendingOperation,
  type PersistedState,
  type StoredAccount,
} from "./persisted-state.js";
import {
  addMessageTag,
  applyMessageTags,
  carryTagsThroughMove,
  classifyJunk,
  editMessageTag,
  forgetAccountTags,
  forgetFolderTags,
  junkSummaryOf,
  listFilters,
  planFilterRun,
  previewMessageTagNames,
  removeFilter,
  removeMessageTag,
  reorderFilters,
  resetJunk,
  summarizeFilterPlan,
  tagAssignmentMapOf,
  tagCatalogOf,
  trainJunk,
  upsertFilter,
  type FilterRunContext,
} from "./mail-organization.js";
import { emptyMessageTagState } from "../shared/message-tags.js";
import { MESSAGE_FILTER_RUN_LIMIT } from "../shared/message-filters.js";
import {
  deleteIdentity,
  forgetAccountIdentities,
  identityForDraft,
  listIdentities,
  promoteIdentityToDefault,
  seedAccountIdentity,
  upsertIdentity,
} from "./identity-store.js";
import type { MailIdentity, MailIdentityInput } from "../shared/identities.js";
import { emptyJunkModel } from "../shared/junk-classifier.js";
import { classifySendResult, describeRecipientOutcome } from "./send-outcome.js";
import { collectCachedUnifiedMessages } from "../shared/unified-folders.js";
import { CachedMailSqliteIndex } from "./cached-mail-sqlite-index.js";
import { assertConnectionPreflight } from "../shared/connection-diagnostics.js";
import { inspectTlsCertificate } from "./tls-certificate-diagnostics.js";
import { testPop3Account } from "./pop3-test-transport.js";
import type { OAuthProviderId, OAuthSignInSnapshot } from "../shared/oauth.js";
import type { WindowsSafeStorageOAuthTokenVault } from "./oauth-token-vault.js";
import { exchangeAuthorizationCode, refreshAccessToken } from "./oauth-token-exchange.js";
import { emptyMessageCryptoProfile, unsignedMessageCryptography } from "../shared/message-cryptography.js";
import { userVisibleErrorMessage } from "../shared/user-visible-error.js";
import {
  TAB_APPEARANCE_THEME_MAX_BYTES,
  parseTabAppearanceThemeText,
  serializeTabAppearanceTheme,
  type TabAppearanceThemeDocument,
} from "../shared/tab-appearance-theme.js";

const execFileAsync = promisify(execFile);

const defaultPreferences = (): Preferences => ({
  language: "en",
  funnyEnglish: 2,
  funnyCantonese: 3,
  ...DEFAULT_APPEARANCE_PREFERENCES,
  narratorEnabled: false,
  narratorLanguage: "en",
  nativeNotificationsEnabled: false,
  historyRetentionDays: LOCAL_HISTORY_RETENTION_DAYS_DEFAULT,
});

const folderKey = (accountId: string, folderPath: string): string => `${accountId}\u0000${folderPath}`;

/** A UID is reused in a later mailbox generation, so the run-on-sync ledger key carries UIDVALIDITY. */
const syncFilterLedgerKey = (message: MessageSummary): string => `${message.id}\u0000${message.uidValidity ?? ""}`;

/** The ledger is a same-process guard only; the arrival diff against the cache is what survives a restart. */
const SYNC_FILTER_LEDGER_LIMIT = 50_000;

/** Refresh a connected OAuth account's token once it is this close to expiring, not only once it has. */
const OAUTH_REFRESH_MARGIN_MS = 2 * 60_000;
/** A completed browser sign-in with no account attached is discarded after this long, unused. */
const OAUTH_PENDING_SIGNIN_TTL_MS = 10 * 60_000;

interface PendingOAuthSignIn {
  provider: OAuthProviderId;
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
  scopes: string[];
  capturedAtMs: number;
}

const providerDisplayName = (provider: OAuthProviderId): string => (provider === "google" ? "Google" : "Microsoft");

const fileErrorCode = (error: unknown): string | undefined =>
  error instanceof Error && "code" in error ? (error as NodeJS.ErrnoException).code : undefined;

const mailErrorMessage = (error: unknown): string => userVisibleErrorMessage(error, { context: "mail" });
const publicMailError = (error: unknown): Error => new Error(mailErrorMessage(error), { cause: error });
const hasLegacyMailErrorBody = (notification: NotificationRecord): boolean =>
  notification.title === "Mail synchronization failed"
  || notification.title === "Change queued for synchronization"
  || notification.title === "Move queued for synchronization"
  || notification.title === "Message queued in Outbox";

const sameStringList = (left: string[] | undefined, right: string[] | undefined): boolean =>
  left === right || (left !== undefined && right !== undefined && left.length === right.length && left.every((value, index) => value === right[index]));

const sameDraftSnapshot = (left: ComposeDraft | undefined, right: ComposeDraft | undefined): boolean =>
  left === right ||
  (left !== undefined &&
    right !== undefined &&
    left.id === right.id &&
    left.accountId === right.accountId &&
    sameStringList(left.to, right.to) &&
    sameStringList(left.cc, right.cc) &&
    sameStringList(left.bcc, right.bcc) &&
    left.subject === right.subject &&
    left.text === right.text &&
    left.inReplyTo === right.inReplyTo &&
    sameStringList(left.references, right.references) &&
    sameStringList(left.attachments, right.attachments));

const isMailboxGenerationMismatch = (error: unknown): boolean =>
  Boolean(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "MAILBOX_GENERATION_MISMATCH");

const requireAttachmentSaveReview = (
  riskyAttachments: AttachmentRiskReviewItem[],
  review: AttachmentSaveReview | undefined,
): void => {
  const expected = { riskyAttachments };
  if (!riskyAttachments.length) {
    if (review) throw new Error("The attachment safety review is stale. Review the current attachment metadata before saving.");
    return;
  }
  if (!attachmentSaveReviewMatches(expected, review)) {
    throw new Error("Review the current risky attachment warning before choosing a save destination.");
  }
};

const demoAccount = (): AccountSummary => ({
  id: "demo",
  displayName: "Material Email Demo",
  email: "demo@material-email.local",
  incoming: { host: "demo.local", port: 993, security: "tls", username: "demo" },
  outgoing: { host: "demo.local", port: 465, security: "tls", username: "demo" },
  authMode: "password",
  kind: "demo",
  createdAt: new Date().toISOString(),
  messageCryptography: emptyMessageCryptoProfile(),
});

const demoFolders = (): FolderSummary[] => [
  { accountId: "demo", path: "Inbox", name: "Inbox", role: "inbox", unread: 2, total: 4 },
  { accountId: "demo", path: "Drafts", name: "Drafts", role: "drafts", unread: 0, total: 1 },
  { accountId: "demo", path: "Sent", name: "Sent", role: "sent", unread: 0, total: 1 },
  { accountId: "demo", path: "Archive", name: "Archive", role: "archive", unread: 0, total: 0 },
  { accountId: "demo", path: "Junk", name: "Junk", role: "junk", unread: 0, total: 0 },
  { accountId: "demo", path: "Trash", name: "Trash", role: "trash", unread: 0, total: 0 },
];

const demoMessages = (): { summaries: MessageSummary[]; details: MessageDetail[] } => {
  const rows = [
    {
      uid: 104,
      from: [{ name: "Nadia Chan", address: "nadia@example.test" }],
      subject: "Launch checklist for Friday",
      date: "2026-07-31T14:42:00.000Z",
      text: "Hi team,\n\nThe final checklist is attached to the project. Please review the accessibility and offline-sync rows before Friday morning.\n\nThanks,\nNadia",
      unread: true,
      starred: true,
    },
    {
      uid: 103,
      from: [{ name: "Kai Wong", address: "kai@example.test" }],
      subject: "Re: keyboard navigation notes",
      date: "2026-07-31T13:15:00.000Z",
      text: "The tab strip now keeps focus when items move. I also checked the narrow layout at 200% scaling.",
      unread: true,
      starred: false,
    },
    {
      uid: 102,
      from: [{ name: "Build service", address: "build@example.test" }],
      subject: "Windows package completed",
      date: "2026-07-30T22:20:00.000Z",
      text: "The Windows package completed. This demo message is local and does not represent a release or external CI result.",
      unread: false,
      starred: false,
    },
    {
      uid: 101,
      from: [{ name: "Mei Lau", address: "mei@example.test" }],
      subject: "Dim sum photo catalog",
      date: "2026-07-29T16:08:00.000Z",
      text: "The local catalog entry includes bilingual names and meaningful alt text. No network image request is needed.",
      unread: false,
      starred: false,
    },
  ];
  const summaries = rows.map(row => ({
    id: `demo:Inbox:${row.uid}`,
    accountId: "demo",
    folderPath: "Inbox",
    uid: row.uid,
    messageId: `<demo-${row.uid}@material-email.local>`,
    from: row.from,
    to: [{ name: "Material Email Demo", address: "demo@material-email.local" }],
    cc: [],
    subject: row.subject,
    date: row.date,
    preview: row.text.replace(/\s+/g, " ").slice(0, 180),
    unread: row.unread,
    starred: row.starred,
    hasAttachments: false,
    size: row.text.length,
  } satisfies MessageSummary));
  const details = summaries.map((summary, index) => {
    const text = rows[index]?.text ?? "";
    const textHtml = `<p>${text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n\n/g, "</p><p>").replace(/\n/g, "<br>")}</p>`;
    const source = index === 0
      ? `${textHtml}<p><img src="https://updates.example.invalid/mail/launch-checklist.png?demo=1" alt="Launch checklist preview"></p>`
      : textHtml;
    return {
      ...summary,
      text,
      ...sanitizeMessageContent(source),
      remoteContentAllowed: false,
      attachments: [],
      replyTo: summary.from,
      cryptography: unsignedMessageCryptography(),
    } satisfies MessageDetail;
  });
  return { summaries, details };
};

export class AppService {
  readonly #statePath: string;
  readonly #quarantinePath: string;
  readonly #store: JsonStore<PersistedState>;
  readonly #cachedMailIndex: CachedMailSqliteIndex;
  readonly #mail = new MailService();
  readonly #historyRepository: HistoryRepository;
  readonly #discovery = new AccountDiscoveryService();
  readonly #pim: PimService;
  readonly #attachmentAuthorization = new AttachmentAuthorization();
  readonly #detectedEditorPaths = new Set<string>();
  readonly #queueFlights = new Set<string>();
  readonly #syncFilteredMessages = new Set<string>();
  readonly #oauthTokenVault: WindowsSafeStorageOAuthTokenVault | null;
  #pop3TestController: AbortController | null = null;
  /**
   * A freshly exchanged token with no account attached yet — the space between a completed browser
   * sign-in and the user actually clicking Add or Test. Bounded lifetime so a completed-but-unused
   * sign-in does not sit in memory indefinitely across a long-idle session.
   */
  #pendingOAuthSignIn: PendingOAuthSignIn | null = null;
  #oauthSignInStatus: OAuthSignInSnapshot | null = null;

  constructor(userDataPath: string, options: { oauthTokenVault?: WindowsSafeStorageOAuthTokenVault } = {}) {
    this.#oauthTokenVault = options.oauthTokenVault ?? null;
    this.#statePath = path.join(userDataPath, "material-email-state-v1.json");
    this.#quarantinePath = path.join(userDataPath, "attachment-quarantine-v1");
    this.#cachedMailIndex = new CachedMailSqliteIndex(path.join(userDataPath, "cached-mail-index-v1.sqlite"));
    this.#pim = new PimService(userDataPath);
    this.#historyRepository = new HistoryRepository(path.join(userDataPath, "local-history"), parsePersistedState);
    this.#store = new JsonStore<PersistedState>(
      this.#statePath,
      () => ({
        schemaVersion: 1,
        messageTags: emptyMessageTagState(),
        messageFilters: [],
        junkModel: emptyJunkModel(),
        accounts: [],
        identities: [],
        preferences: defaultPreferences(),
        folders: {},
        messages: {},
        details: {},
        drafts: [],
        pendingOperations: [],
        outbox: [],
        notifications: [],
        history: [],
        quarantinedAttachments: [],
        approvedEditorPaths: [],
      }),
      async filePath => {
        try {
          await this.#historyRepository.snapshot(filePath);
        } catch (error) {
          console.error("Local history snapshot failed; the requested application change was preserved.", error);
        }
      },
      { validate: parsePersistedState },
    );
  }

  async bootstrap(): Promise<BootstrapState> {
    let state = await this.#store.read();
    const recovery = this.#store.takeRecoveryNotice();
    if (recovery) {
      state = await this.#store.update(next => {
        this.#record(next, "restored", "settings", "application-state", "Recovered local state after an interrupted or corrupt write", {
          recoverySource: path.basename(recovery.recoveredFrom),
          corruptOriginalPreserved: Boolean(recovery.quarantinedOriginal),
        });
        this.#notify(
          next,
          "warning",
          "Local state recovered",
          recovery.quarantinedOriginal
            ? "The primary state was invalid. The newest valid local recovery copy was restored, and the original was preserved for diagnosis."
            : "An interrupted state replacement was completed from the newest valid local recovery copy.",
        );
      });
    }
    // Accounts saved before identities existed have none, so give them their default one here
    // rather than leaving the composer without a From address on the first launch after upgrade.
    if (state.accounts.some(account => !(state.identities ?? []).some(identity => identity.accountId === account.id))) {
      state = await this.#store.update(next => {
        for (const account of next.accounts) {
          const seeded = seedAccountIdentity(next, account, () => randomUUID());
          if (seeded) {
            this.#record(next, "created", "settings", `identity:${seeded.id}`, `Created the default identity for ${account.email}`, {
              accountId: account.id,
              displayName: seeded.displayName,
              email: seeded.email,
            });
          }
        }
      });
    }
    const release = await this.#releaseIdentity();
    return {
      accounts: state.accounts.map(this.#publicAccount),
      identities: listIdentities(state),
      preferences: state.preferences,
      notifications: state.notifications.map(notification => hasLegacyMailErrorBody(notification)
        ? { ...notification, body: mailErrorMessage(notification.body) }
        : notification),
      history: state.history,
      quarantinedAttachments: state.quarantinedAttachments,
      isFirstRun: state.accounts.length === 0,
      version: app.getVersion(),
      release,
      pendingOperationCount: state.pendingOperations.length + state.outbox.length,
    };
  }

  async createDemoAccount(): Promise<AccountSummary> {
    const account = demoAccount();
    const messages = demoMessages();
    await this.#store.update(state => {
      if (!state.accounts.some(candidate => candidate.id === account.id)) state.accounts.push(account);
      seedAccountIdentity(state, account, () => randomUUID());
      state.preferences.selectedAccountId = account.id;
      state.preferences.selectedFolderPath = "Inbox";
      state.folders[account.id] = demoFolders();
      state.messages[folderKey(account.id, "Inbox")] = messages.summaries;
      for (const detail of messages.details) state.details[detail.id] = detail;
      this.#record(state, "created", "account", account.id, "Created the local demo workspace", account);
      this.#notify(state, "success", "Demo workspace ready", "This workspace is fully local. Add a real account from Settings when you are ready.", {
        category: "account",
        action: { kind: "open", target: "page", page: "settings" },
      });
    });
    return account;
  }

  async discoverAccount(email: string): Promise<AccountDiscoveryResult[]> {
    return this.#discovery.discover(email);
  }

  async inspectTlsCertificate(input: TlsCertificateInspectionRequest): Promise<TlsCertificateInspectionResult> {
    return inspectTlsCertificate(input);
  }

  cancelPop3AccountTest(): boolean {
    if (!this.#pop3TestController) return false;
    this.#pop3TestController.abort();
    return true;
  }

  async runPimProviderFoundation(input: PimProviderProfileInput): Promise<PimProviderFoundationSnapshot> {
    return runPimProviderFoundation(pimProviderProfileInputSchema.parse(input));
  }

  async addAccount(input: AccountDraft): Promise<AccountSummary> {
    const draft = accountDraftSchema.parse(input);
    if (draft.incomingProtocol === "pop3") {
      throw new Error("POP3 account saving is not available in this build. No server was contacted by this blocked Connect action, no credential was used, and no account was saved. Use Test settings for the bounded live POP3 check.");
    }
    assertConnectionPreflight(draft);
    const existing = await this.#store.read();
    if (existing.accounts.some(account => account.email.toLowerCase() === draft.email.toLowerCase())) {
      throw new Error(`An account for ${draft.email} already exists on this computer.`);
    }
    if (draft.authMode === "oauth2") {
      if (!draft.oauthProvider) throw new Error("An OAuth account draft must name its provider.");
      return this.#addOAuthAccount(draft, draft.oauthProvider);
    }
    if (!safeStorage.isEncryptionAvailable()) throw new Error("Windows credential encryption is not available on this computer.");
    const account: StoredAccount = {
      id: randomUUID(),
      displayName: draft.displayName,
      email: draft.email,
      incoming: draft.incoming,
      outgoing: draft.outgoing,
      authMode: draft.authMode,
      kind: "imap",
      createdAt: new Date().toISOString(),
      messageCryptography: emptyMessageCryptoProfile(),
      encryptedSecret: safeStorage.encryptString(draft.secret).toString("base64"),
    };
    try {
      await this.#mail.testAccount(await this.#runtimeAccount(account));
    } catch (error) {
      throw publicMailError(error);
    }
    await this.#store.update(state => {
      state.accounts.push(account);
      seedAccountIdentity(state, account, () => randomUUID());
      state.preferences.selectedAccountId = account.id;
      this.#record(state, "created", "account", account.id, `Added account ${account.email}`, this.#publicAccount(account));
      this.#notify(state, "success", "Account connected", `${account.email} passed incoming and outgoing server checks.`, {
        category: "account",
        action: { kind: "open", target: "page", page: "settings" },
      });
    });
    return this.#publicAccount(account);
  }

  /**
   * Attaches a freshly authorized sign-in to a new account. A failed connectivity test leaves the
   * sign-in available to retry, exactly as a failed password test would — it is only consumed, and
   * only written to the vault, once the account is actually being saved.
   */
  async #addOAuthAccount(draft: AccountDraft, provider: OAuthProviderId): Promise<AccountSummary> {
    const vault = this.#oauthTokenVault;
    if (!vault) throw new Error("OAuth account connections are not available in this build.");
    const account: StoredAccount = {
      id: randomUUID(),
      displayName: draft.displayName,
      email: draft.email,
      incoming: draft.incoming,
      outgoing: draft.outgoing,
      authMode: "oauth2",
      oauthProvider: provider,
      kind: "imap",
      createdAt: new Date().toISOString(),
      messageCryptography: emptyMessageCryptoProfile(),
    };
    const forTest = this.#peekPendingOAuthSignIn(provider, { consume: false });
    try {
      await this.#mail.testAccount({ ...this.#publicAccount(account), secret: forTest.accessToken });
    } catch (error) {
      throw publicMailError(error);
    }
    const consumed = this.#peekPendingOAuthSignIn(provider, { consume: true });
    await vault.saveInitial(provider, account.id, {
      accessToken: consumed.accessToken,
      refreshToken: consumed.refreshToken,
      expiresInSeconds: consumed.expiresInSeconds,
      scopes: consumed.scopes,
    });
    await this.#store.update(state => {
      state.accounts.push(account);
      seedAccountIdentity(state, account, () => randomUUID());
      state.preferences.selectedAccountId = account.id;
      this.#record(state, "created", "account", account.id, `Added account ${account.email}`, this.#publicAccount(account));
      this.#notify(state, "success", "Account connected", `${account.email} passed incoming and outgoing server checks.`, {
        category: "account",
        action: { kind: "open", target: "page", page: "settings" },
      });
    });
    return this.#publicAccount(account);
  }

  async testAccount(input: AccountDraft): Promise<AccountTestResult> {
    const draft = accountDraftSchema.parse(input);
    if (draft.authMode === "oauth2") {
      if (draft.incomingProtocol === "pop3") throw new Error("POP3 accounts do not support OAuth authentication.");
      if (!draft.oauthProvider) throw new Error("An OAuth account draft must name its provider.");
      assertConnectionPreflight(draft);
      const pending = this.#peekPendingOAuthSignIn(draft.oauthProvider, { consume: false });
      const runtime: RuntimeAccount = {
        id: "test",
        displayName: draft.displayName,
        email: draft.email,
        incoming: draft.incoming,
        outgoing: draft.outgoing,
        authMode: "oauth2",
        kind: "imap",
        createdAt: new Date().toISOString(),
        secret: pending.accessToken,
      };
      try {
        return await this.#mail.testAccount(runtime);
      } catch (error) {
        throw publicMailError(error);
      }
    }
    assertConnectionPreflight(draft);
    if (draft.incomingProtocol === "pop3") {
      if (draft.incoming.security !== "tls" && draft.incoming.security !== "starttls") {
        throw new Error("POP3 account testing requires implicit TLS or STARTTLS. No server was contacted and no credential was sent.");
      }
      if (this.#pop3TestController) throw new Error("A POP3 account test is already running. Cancel it before starting another test.");
      const controller = new AbortController();
      this.#pop3TestController = controller;
      try {
        return await testPop3Account({
          host: draft.incoming.host,
          port: draft.incoming.port,
          security: draft.incoming.security,
          username: draft.incoming.username,
          secret: draft.secret,
          messageLimit: draft.pop3.messageLimit,
        }, { signal: controller.signal });
      } catch (error) {
        throw publicMailError(error);
      } finally {
        if (this.#pop3TestController === controller) this.#pop3TestController = null;
      }
    }
    const runtime: RuntimeAccount = {
      id: "test",
      displayName: draft.displayName,
      email: draft.email,
      incoming: draft.incoming,
      outgoing: draft.outgoing,
      authMode: draft.authMode,
      kind: "imap",
      createdAt: new Date().toISOString(),
      secret: draft.secret,
    };
    try {
      return await this.#mail.testAccount(runtime);
    } catch (error) {
      throw publicMailError(error);
    }
  }

  async removeAccount(accountId: string): Promise<void> {
    await this.#store.update(async state => {
      const account = state.accounts.find(candidate => candidate.id === accountId);
      if (!account) return;
      if (account.authMode === "oauth2" && account.oauthProvider && this.#oauthTokenVault) {
        // Best-effort: an orphaned vault record for a removed account can never be refreshed
        // successfully anyway, so a failure here must not block removing the account locally.
        try {
          await this.#oauthTokenVault.forgetAccount(account.oauthProvider, accountId);
        } catch (error) {
          console.error("Forgetting the removed account's OAuth tokens failed; the account was still removed.", error);
        }
      }
      state.accounts = state.accounts.filter(candidate => candidate.id !== accountId);
      delete state.folders[accountId];
      for (const key of Object.keys(state.messages)) if (key.startsWith(`${accountId}\u0000`)) delete state.messages[key];
      for (const [key, detail] of Object.entries(state.details)) if (detail.accountId === accountId) delete state.details[key];
      state.drafts = state.drafts.filter(draft => draft.accountId !== accountId);
      state.outbox = state.outbox.filter(item => item.draft.accountId !== accountId);
      state.pendingOperations = state.pendingOperations.filter(operation => operation.accountId !== accountId);
      forgetAccountTags(state, accountId);
      forgetAccountIdentities(state, accountId);
      if (state.preferences.selectedAccountId === accountId) {
        const nextAccount = state.accounts[0];
        if (nextAccount) state.preferences.selectedAccountId = nextAccount.id;
        else delete state.preferences.selectedAccountId;
        delete state.preferences.selectedFolderPath;
      }
      this.#record(state, "deleted", "account", accountId, `Removed account ${account.email}`, this.#publicAccount(account));
      this.#notify(state, "info", "Account removed", `${account.email} was removed from this computer.`, {
        category: "account",
        action: { kind: "open", target: "page", page: "settings" },
      });
    });
  }

  async syncAccount(accountId: string): Promise<SyncResult> {
    let state = await this.#store.read();
    const stored = this.#requireAccount(state, accountId);
    if (stored.kind === "demo") {
      return {
        folders: state.folders[accountId] ?? [],
        messages: Object.entries(state.messages).filter(([key]) => key.startsWith(`${accountId}\u0000`)).flatMap(([, value]) => value),
        syncedAt: new Date().toISOString(),
      };
    }
    const account = await this.#runtimeAccount(stored);
    try {
      await this.#withQueueFlight(accountId, () => this.#replayPending(account));
      state = await this.#store.read();
      const folders = await this.#mail.listFolders(account);
      const selected = state.preferences.selectedFolderPath;
      const targets = folders.filter(folder => folder.role === "inbox" || folder.path === selected);
      const batches = await Promise.all(targets.map(async folder => [folder.path, await this.#mail.listMessages(account, folder.path)] as const));
      const syncedAt = new Date().toISOString();
      const arrived = new Map<string, MessageSummary[]>();
      await this.#store.update(draft => {
        arrived.clear();
        this.#requireAccount(draft, accountId);
        const previousFolders = draft.folders[accountId] ?? [];
        for (const folder of folders) {
          const previous = previousFolders.find(candidate => candidate.path === folder.path);
          if (!previous?.uidValidity || !folder.uidValidity || previous.uidValidity === folder.uidValidity) continue;
          delete draft.messages[folderKey(accountId, folder.path)];
          for (const [id, detail] of Object.entries(draft.details)) {
            if (detail.accountId === accountId && detail.folderPath === folder.path) delete draft.details[id];
          }
          this.#record(
            draft,
            "updated",
            "message",
            `${accountId}:${folder.path}`,
            `Reconciled ${folder.name} after the server changed UIDVALIDITY`,
            { previous: previous.uidValidity, current: folder.uidValidity },
          );
          this.#notify(
            draft,
            "warning",
            "Folder identity changed",
            `${folder.name} was safely reloaded because the mail server changed its UIDVALIDITY value. Pending operations for the old identity were preserved for explicit review and will fail closed until discarded.`,
          );
        }
        draft.folders[accountId] = folders;
        for (const [folderPath, messages] of batches) {
          const key = folderKey(accountId, folderPath);
          // Anything already cached was offered to the filters by an earlier sync, so only the new
          // rows are collected. A UIDVALIDITY reset cleared the cache above, so its rows count as new.
          const known = new Set((draft.messages[key] ?? []).map(syncFilterLedgerKey));
          arrived.set(folderPath, messages.filter(message => !known.has(syncFilterLedgerKey(message))));
          draft.messages[key] = messages;
        }
        const item = draft.accounts.find(candidate => candidate.id === accountId);
        if (item) {
          item.lastSyncAt = syncedAt;
          delete item.syncError;
        }
        this.#notify(draft, "success", "Mail synchronized", `${batches.reduce((sum, [, rows]) => sum + rows.length, 0)} messages refreshed.`, {
          category: "mail",
          action: { kind: "open", target: "page", page: "mail" },
        });
      });
      await this.#runFiltersAfterSync(accountId, arrived);
      return { folders, messages: batches.flatMap(([, rows]) => rows), syncedAt };
    } catch (error) {
      const message = mailErrorMessage(error);
      await this.#store.update(draft => {
        const item = draft.accounts.find(candidate => candidate.id === accountId);
        if (!item) return;
        item.syncError = message;
        this.#notify(draft, "error", "Mail synchronization failed", message, {
          category: "mail",
          action: { kind: "retry", target: "sync", accountId },
        });
      });
      throw publicMailError(error);
    }
  }

  async listFolders(accountId: string): Promise<FolderSummary[]> {
    const state = await this.#store.read();
    this.#requireAccount(state, accountId);
    return state.folders[accountId] ?? [];
  }

  async listMessages(accountId: string, folderPath: string): Promise<MessageSummary[]> {
    const state = await this.#store.read();
    const account = this.#requireAccount(state, accountId);
    const key = folderKey(accountId, folderPath);
    if (state.messages[key]) return state.messages[key];
    if (account.kind === "demo") return [];
    const messages = await this.#mail.listMessages(await this.#runtimeAccount(account), folderPath);
    await this.#store.update(draft => {
      this.#requireAccount(draft, accountId);
      draft.messages[key] = messages;
    });
    return messages;
  }

  async listUnifiedMessages(folder: UnifiedFolderKind): Promise<MessageSummary[]> {
    const state = await this.#store.read();
    return collectCachedUnifiedMessages(folder, {
      accountIds: state.accounts.map(account => account.id),
      folders: state.folders,
      messages: state.messages,
    });
  }

  async searchCachedMail(query: CachedMailSearchQuery): Promise<CachedMailSearchResult> {
    const state = await this.#store.read();
    return this.#cachedMailIndex.search(
      {
        accounts: state.accounts.map(this.#publicAccount),
        folders: state.folders,
        messages: state.messages,
        details: state.details,
      },
      query,
    );
  }

  async getMessage(accountId: string, folderPath: string, uid: number): Promise<MessageDetail> {
    const state = await this.#store.read();
    const account = this.#requireAccount(state, accountId);
    const id = `${accountId}:${folderPath}:${uid}`;
    const cached = state.details[id];
    if (account.kind === "demo" && cached) return cached;
    if (account.kind === "demo") throw new Error("The demo message is no longer available.");
    const { message, uidValidity } = this.#requireCurrentMessage(state, accountId, folderPath, uid);
    if (cached?.uidValidity === uidValidity) return cached;
    assertMimeSourceSize(message.size);
    const detail = {
      ...(await this.#mail.getMessage(await this.#runtimeAccount(account), folderPath, uid, uidValidity)),
      uidValidity,
    };
    await this.#store.update(draft => {
      this.#requireAccount(draft, accountId);
      this.#requireCurrentMessage(draft, accountId, folderPath, uid, uidValidity);
      draft.details[id] = detail;
      const message = draft.messages[folderKey(accountId, folderPath)]?.find(item => item.uid === uid);
      if (message) {
        message.preview = detail.preview;
        if (detail.inReplyTo) message.inReplyTo = detail.inReplyTo;
        else delete message.inReplyTo;
        if (detail.references?.length) message.references = [...detail.references];
        else delete message.references;
      }
    });
    return detail;
  }

  async setRemoteContentAllowed(accountId: string, folderPath: string, uid: number, allowed: boolean): Promise<MessageDetail> {
    const id = `${accountId}:${folderPath}:${uid}`;
    const next = await this.#store.update(state => {
      const account = this.#requireAccount(state, accountId);
      if (account.kind !== "demo") this.#requireCurrentMessage(state, accountId, folderPath, uid);
      const detail = state.details[id];
      if (!detail) throw new Error("Open the message before changing its remote-content consent.");
      if (allowed && detail.remoteContentSources.length === 0) {
        throw new Error("This message has no sanitized remote images to load.");
      }
      detail.remoteContentAllowed = allowed;
    });
    return next.details[id]!;
  }

  async saveAttachment(
    accountId: string,
    folderPath: string,
    uid: number,
    index: number,
    review?: AttachmentSaveReview,
  ): Promise<AttachmentSaveOutcome> {
    const state = await this.#store.read();
    const account = this.#requireAccount(state, accountId);
    if (account.kind === "demo") throw new Error("The demo messages do not contain downloadable attachments.");
    const { message, uidValidity } = this.#requireCurrentMessage(state, accountId, folderPath, uid);
    assertMimeSourceSize(message.size);
    const attachments = await this.#mail.getAttachments(await this.#runtimeAccount(account), folderPath, uid, uidValidity);
    const attachment = attachments[index];
    if (!attachment) throw new Error("That attachment no longer exists.");
    const currentRisk = createAttachmentRiskReviewItem(attachment, index);
    requireAttachmentSaveReview(currentRisk.level === "ordinary" ? [] : [currentRisk], review);
    if (currentRisk.level !== "ordinary") {
      const [quarantine] = await this.#quarantineAttachments(
        accountId,
        folderPath,
        uid,
        uidValidity,
        message.messageId,
        [{ attachment, index, risk: currentRisk }],
      );
      if (!quarantine) throw new Error("The attachment could not be placed in local quarantine.");
      return { status: "quarantined", quarantine };
    }
    const filename = this.#safeFilename(attachment.filename);
    const result = await dialog.showSaveDialog({ defaultPath: filename, title: "Save attachment" });
    if (result.canceled || !result.filePath) return { status: "cancelled" };
    await writeFile(result.filePath, attachment.content, { flag: "w" });
    await this.#store.update(draft => {
      this.#requireAccount(draft, accountId);
      this.#requireCurrentMessage(draft, accountId, folderPath, uid, uidValidity);
      this.#record(draft, "created", "message", `${accountId}:${folderPath}:${uid}`, `Saved attachment ${filename}`, {
        filename,
        contentType: attachment.contentType,
        size: attachment.content.length,
      });
      this.#notify(draft, "success", "Attachment saved", filename);
    });
    return { status: "saved", path: result.filePath };
  }

  async saveAllAttachments(
    accountId: string,
    folderPath: string,
    uid: number,
    review?: AttachmentSaveReview,
  ): Promise<AttachmentBatchSaveOutcome> {
    const state = await this.#store.read();
    const account = this.#requireAccount(state, accountId);
    if (account.kind === "demo") throw new Error("The demo messages do not contain downloadable attachments.");
    const { message, uidValidity } = this.#requireCurrentMessage(state, accountId, folderPath, uid);
    assertMimeSourceSize(message.size);
    const attachments = await this.#mail.getAttachments(await this.#runtimeAccount(account), folderPath, uid, uidValidity);
    const currentReview = createAttachmentSaveReview(attachments);
    requireAttachmentSaveReview(currentReview.riskyAttachments, review);
    const quarantined = await this.#quarantineAttachments(
      accountId,
      folderPath,
      uid,
      uidValidity,
      message.messageId,
      currentReview.riskyAttachments.map(risk => {
        const attachment = attachments[risk.index];
        if (!attachment) throw new Error("That attachment no longer exists.");
        return { attachment, index: risk.index, risk };
      }),
    );
    const ordinaryAttachments = attachments
      .map((attachment, index) => ({ attachment, index }))
      .filter(({ attachment }) => createAttachmentRiskReviewItem(attachment, 0).level === "ordinary");
    if (!ordinaryAttachments.length) {
      return { savedPaths: [], quarantined, ordinarySaveCancelled: false };
    }
    const result = await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"], title: "Save all attachments" });
    if (result.canceled || !result.filePaths[0]) return { savedPaths: [], quarantined, ordinarySaveCancelled: true };
    const directory = result.filePaths[0];
    await mkdir(directory, { recursive: true });
    const saved: string[] = [];
    for (const { attachment, index } of ordinaryAttachments) {
      const base = this.#safeFilename(attachment.filename || `attachment-${index + 1}`);
      const target = await this.#uniquePath(directory, base);
      await writeFile(target, attachment.content, { flag: "wx" });
      saved.push(target);
    }
    await this.#store.update(draft => {
      this.#requireAccount(draft, accountId);
      this.#requireCurrentMessage(draft, accountId, folderPath, uid, uidValidity);
      this.#record(draft, "created", "message", `${accountId}:${folderPath}:${uid}`, `Saved ${saved.length} attachments`, {
        files: saved.map(file => path.basename(file)),
      });
      this.#notify(draft, "success", "Attachments saved", `${saved.length} file${saved.length === 1 ? "" : "s"} saved.`);
    });
    return { savedPaths: saved, quarantined, ordinarySaveCancelled: false };
  }

  async releaseQuarantinedAttachment(id: string): Promise<string | null> {
    id = quarantineIdSchema.parse(id);
    const state = await this.#store.read();
    const record = state.quarantinedAttachments.find(candidate => candidate.id === id);
    if (!record) throw new Error("That quarantined attachment is no longer available.");
    const payloadPath = this.#quarantinePayloadPath(record.id);
    const payload = await readFile(payloadPath);
    const digest = createHash("sha256").update(payload).digest("hex");
    if (payload.length !== record.size || digest !== record.sha256) {
      throw new Error("The quarantined attachment changed on disk, so release was refused. Delete it or inspect the local application data manually.");
    }
    const result = await dialog.showSaveDialog({
      defaultPath: this.#safeFilename(record.filename),
      title: "Release quarantined attachment",
    });
    if (result.canceled || !result.filePath) return null;
    await writeFile(result.filePath, payload, { flag: "w" });

    const retiredPath = `${payloadPath}.released-${randomUUID()}`;
    await rename(payloadPath, retiredPath);
    try {
      await this.#store.update(draft => {
        const current = draft.quarantinedAttachments.find(candidate => candidate.id === id);
        if (!current) throw new Error("That quarantined attachment is no longer available.");
        draft.quarantinedAttachments = draft.quarantinedAttachments.filter(candidate => candidate.id !== id);
        this.#record(draft, "updated", "message", `${current.source.accountId}:${current.source.folderPath}:${current.source.uid}`, `Released quarantined attachment ${current.filename}`, {
          quarantineId: current.id,
          filename: current.filename,
          sha256: current.sha256,
          releasedTo: path.basename(result.filePath),
        });
        this.#notify(draft, "warning", "Attachment released from local quarantine", `${current.filename} was copied to the selected destination. No antivirus scan was performed.`);
      });
    } catch (error) {
      await rename(retiredPath, payloadPath).catch(() => undefined);
      throw error;
    }
    await rm(retiredPath, { force: true });
    return result.filePath;
  }

  async deleteQuarantinedAttachment(id: string): Promise<void> {
    id = quarantineIdSchema.parse(id);
    const state = await this.#store.read();
    const record = state.quarantinedAttachments.find(candidate => candidate.id === id);
    if (!record) throw new Error("That quarantined attachment is no longer available.");
    const payloadPath = this.#quarantinePayloadPath(record.id);
    const retiredPath = `${payloadPath}.deleted-${randomUUID()}`;
    let payloadMoved = false;
    try {
      await rename(payloadPath, retiredPath);
      payloadMoved = true;
    } catch (error) {
      if (fileErrorCode(error) !== "ENOENT") throw error;
    }
    try {
      await this.#store.update(draft => {
        const current = draft.quarantinedAttachments.find(candidate => candidate.id === id);
        if (!current) throw new Error("That quarantined attachment is no longer available.");
        draft.quarantinedAttachments = draft.quarantinedAttachments.filter(candidate => candidate.id !== id);
        this.#record(draft, "deleted", "message", `${current.source.accountId}:${current.source.folderPath}:${current.source.uid}`, `Deleted quarantined attachment ${current.filename}`, {
          quarantineId: current.id,
          filename: current.filename,
          sha256: current.sha256,
        });
        this.#notify(draft, "info", "Quarantined attachment deleted", `${current.filename} was removed from local quarantine.`);
      });
    } catch (error) {
      if (payloadMoved) await rename(retiredPath, payloadPath).catch(() => undefined);
      throw error;
    }
    if (payloadMoved) await rm(retiredPath, { force: true });
  }

  async setMessageFlags(
    accountId: string,
    folderPath: string,
    uid: number,
    patch: { unread?: boolean; starred?: boolean },
  ): Promise<void> {
    const state = await this.#store.read();
    const account = this.#requireAccount(state, accountId);
    let networkError = "";
    let uidValidity: string | undefined;
    if (account.kind !== "demo") {
      uidValidity = this.#requireCurrentMessage(state, accountId, folderPath, uid).uidValidity;
      try {
        await this.#mail.setFlags(await this.#runtimeAccount(account), folderPath, uid, patch, uidValidity);
      } catch (error) {
        if (isMailboxGenerationMismatch(error)) throw error;
        networkError = mailErrorMessage(error);
      }
    }
    await this.#store.update(draft => {
      this.#requireAccount(draft, accountId);
      const message = uidValidity
        ? this.#requireCurrentMessage(draft, accountId, folderPath, uid, uidValidity).message
        : draft.messages[folderKey(accountId, folderPath)]?.find(item => item.uid === uid);
      if (!message) return;
      const before = { unread: message.unread, starred: message.starred };
      if (patch.unread !== undefined) message.unread = patch.unread;
      if (patch.starred !== undefined) message.starred = patch.starred;
      const detail = draft.details[message.id];
      if (detail) Object.assign(detail, patch);
      this.#record(draft, "updated", "message", message.id, `Updated message “${message.subject}”`, before);
      if (networkError) {
        const operationId = randomUUID();
        draft.pendingOperations.push({
          id: operationId,
          accountId,
          kind: "flags",
          folderPath,
          uid,
          ...(uidValidity ? { uidValidity } : {}),
          patch,
          createdAt: new Date().toISOString(),
          attempts: 0,
          lastError: networkError,
        });
        this.#notify(draft, "warning", "Change queued for synchronization", networkError, {
          category: "mail",
          action: { kind: "retry", target: "pending-operation", accountId, operationId },
        });
      }
    });
  }

  async moveMessage(accountId: string, folderPath: string, uid: number, destination: string): Promise<void> {
    const state = await this.#store.read();
    const account = this.#requireAccount(state, accountId);
    let networkError = "";
    let uidValidity: string | undefined;
    let moveResult: MailMoveResult | undefined = account.kind === "demo" ? { destinationUid: uid } : undefined;
    if (account.kind !== "demo") {
      uidValidity = this.#requireCurrentMessage(state, accountId, folderPath, uid).uidValidity;
      try {
        moveResult = await this.#mail.moveMessage(await this.#runtimeAccount(account), folderPath, uid, destination, uidValidity);
      } catch (error) {
        if (isMailboxGenerationMismatch(error)) throw error;
        networkError = mailErrorMessage(error);
      }
    }
    await this.#store.update(draft => {
      this.#requireAccount(draft, accountId);
      const sourceKey = folderKey(accountId, folderPath);
      const message = uidValidity
        ? this.#requireCurrentMessage(draft, accountId, folderPath, uid, uidValidity).message
        : draft.messages[sourceKey]?.find(item => item.uid === uid);
      if (!message) return;
      draft.messages[sourceKey] = draft.messages[sourceKey]?.filter(item => item.uid !== uid) ?? [];
      const destinationUid = moveResult?.destinationUid;
      let moved: MessageSummary | undefined;
      if (destinationUid !== undefined) {
        moved = { ...message, id: `${accountId}:${destination}:${destinationUid}`, folderPath: destination, uid: destinationUid };
        if (moveResult?.destinationUidValidity) moved.uidValidity = moveResult.destinationUidValidity;
        else delete moved.uidValidity;
        const targetKey = folderKey(accountId, destination);
        draft.messages[targetKey] = [moved, ...(draft.messages[targetKey] ?? []).filter(item => item.uid !== destinationUid)];
      }
      delete draft.details[message.id];
      carryTagsThroughMove(
        draft,
        { accountId, folderPath, uid, ...(message.uidValidity ? { uidValidity: message.uidValidity } : {}) },
        moved ? { folderPath: destination, uid: moved.uid, ...(moved.uidValidity ? { uidValidity: moved.uidValidity } : {}) } : null,
      );
      this.#record(draft, "updated", "message", moved?.id ?? message.id, `Moved “${message.subject}” to ${destination}`, {
        from: folderPath,
        destination,
        destinationUid: destinationUid ?? null,
        destinationCacheDeferred: destinationUid === undefined,
      });
      if (networkError) {
        const operationId = randomUUID();
        draft.pendingOperations.push({
          id: operationId,
          accountId,
          kind: "move",
          folderPath,
          uid,
          ...(uidValidity ? { uidValidity } : {}),
          destination,
          createdAt: new Date().toISOString(),
          attempts: 0,
          lastError: networkError,
        });
        this.#notify(draft, "warning", "Move queued for synchronization", networkError, {
          category: "mail",
          action: { kind: "retry", target: "pending-operation", accountId, operationId },
        });
      } else if (!moved) {
        this.#notify(
          draft,
          "success",
          "Message moved",
          `“${message.subject}” moved to ${destination}. The destination will appear after that folder refreshes.`,
        );
      } else {
        this.#notify(draft, "success", "Message moved", `“${message.subject}” moved to ${destination}.`);
      }
    });
  }

  async createFolder(accountId: string, folderPath: string): Promise<FolderSummary[]> {
    const state = await this.#store.read();
    const account = this.#requireAccount(state, accountId);
    if (account.kind === "demo") throw new Error("The demonstration account has a fixed set of folders.");
    try {
      await this.#mail.createFolder(await this.#runtimeAccount(account), folderPath);
    } catch (error) {
      throw publicMailError(error);
    }
    return this.#refreshFolders(accountId, `Created folder ${folderPath}`);
  }

  async renameFolder(accountId: string, folderPath: string, name: string): Promise<FolderSummary[]> {
    const state = await this.#store.read();
    const account = this.#requireAccount(state, accountId);
    if (account.kind === "demo") throw new Error("The demonstration account has a fixed set of folders.");
    const separator = folderPath.includes("/") ? "/" : ".";
    const parent = folderPath.includes(separator) ? `${folderPath.slice(0, folderPath.lastIndexOf(separator))}${separator}` : "";
    const destination = `${parent}${name}`;
    if (destination === folderPath) return state.folders[accountId] ?? [];
    try {
      await this.#mail.renameFolder(await this.#runtimeAccount(account), folderPath, destination);
    } catch (error) {
      throw publicMailError(error);
    }
    // The server may have moved a whole subtree, so drop every cached collection beneath the old path.
    await this.#store.update(draft => {
      this.#requireAccount(draft, accountId);
      for (const key of Object.keys(draft.messages)) {
        const prefix = folderKey(accountId, folderPath);
        if (key === prefix || key.startsWith(`${prefix}${separator}`)) delete draft.messages[key];
      }
      for (const [id, detail] of Object.entries(draft.details)) {
        if (detail.accountId === accountId && (detail.folderPath === folderPath || detail.folderPath.startsWith(`${folderPath}${separator}`))) {
          delete draft.details[id];
        }
      }
      if (draft.preferences.selectedFolderPath === folderPath) draft.preferences.selectedFolderPath = destination;
    });
    return this.#refreshFolders(accountId, `Renamed folder ${folderPath} to ${destination}`);
  }

  async deleteFolder(accountId: string, folderPath: string): Promise<FolderSummary[]> {
    const state = await this.#store.read();
    const account = this.#requireAccount(state, accountId);
    if (account.kind === "demo") throw new Error("The demonstration account has a fixed set of folders.");
    const folder = (state.folders[accountId] ?? []).find(candidate => candidate.path === folderPath);
    if (folder && folder.role !== "other") {
      throw new Error(`${folder.name} is a special folder this account relies on, so it cannot be removed.`);
    }
    try {
      await this.#mail.deleteFolder(await this.#runtimeAccount(account), folderPath);
    } catch (error) {
      throw publicMailError(error);
    }
    await this.#store.update(draft => {
      this.#requireAccount(draft, accountId);
      delete draft.messages[folderKey(accountId, folderPath)];
      for (const [id, detail] of Object.entries(draft.details)) {
        if (detail.accountId === accountId && detail.folderPath === folderPath) delete draft.details[id];
      }
      forgetFolderTags(draft, accountId, folderPath);
      if (draft.preferences.selectedFolderPath === folderPath) delete draft.preferences.selectedFolderPath;
    });
    return this.#refreshFolders(accountId, `Removed folder ${folderPath}`);
  }

  async markFolderRead(accountId: string, folderPath: string): Promise<number> {
    const state = await this.#store.read();
    const account = this.#requireAccount(state, accountId);
    const key = folderKey(accountId, folderPath);
    if (account.kind === "demo") {
      let changed = 0;
      await this.#store.update(draft => {
        draft.messages[key] = (draft.messages[key] ?? []).map(message => {
          if (!message.unread) return message;
          changed += 1;
          return { ...message, unread: false };
        });
      });
      return changed;
    }
    const uidValidity = (state.folders[accountId] ?? []).find(folder => folder.path === folderPath)?.uidValidity;
    if (!uidValidity) throw new Error("Refresh this folder before marking it read: its mailbox generation is unknown.");
    let changed = 0;
    try {
      changed = await this.#mail.markFolderRead(await this.#runtimeAccount(account), folderPath, uidValidity);
    } catch (error) {
      throw publicMailError(error);
    }
    await this.#store.update(draft => {
      this.#requireAccount(draft, accountId);
      draft.messages[key] = (draft.messages[key] ?? []).map(message => (message.unread ? { ...message, unread: false } : message));
      for (const [id, detail] of Object.entries(draft.details)) {
        if (detail.accountId === accountId && detail.folderPath === folderPath && detail.unread) draft.details[id] = { ...detail, unread: false };
      }
      const folder = (draft.folders[accountId] ?? []).find(candidate => candidate.path === folderPath);
      if (folder) folder.unread = 0;
      this.#record(draft, "updated", "message", `${accountId}:${folderPath}`, `Marked ${folderPath} read`, { markedRead: changed });
    });
    return changed;
  }

  async listIdentities(): Promise<MailIdentity[]> {
    return listIdentities(await this.#store.read());
  }

  async saveIdentity(input: MailIdentityInput): Promise<MailIdentity[]> {
    const parsed = mailIdentityInputSchema.parse(input);
    let identities: MailIdentity[] = [];
    await this.#store.update(state => {
      this.#requireAccount(state, parsed.accountId);
      identities = upsertIdentity(state, parsed, () => randomUUID());
      this.#record(state, parsed.id ? "updated" : "created", "settings", `identity:${parsed.id ?? parsed.email}`, `Saved identity ${parsed.email}`, {
        accountId: parsed.accountId,
        displayName: parsed.displayName,
        email: parsed.email,
        replyTo: parsed.replyTo ?? "",
        signaturePlacement: parsed.signaturePlacement ?? "below-body",
        // The signature is the user's own prose; its length is the auditable fact, not its text.
        signatureLength: (parsed.signature ?? "").length,
      });
    });
    return identities;
  }

  async deleteIdentity(id: string): Promise<MailIdentity[]> {
    let identities: MailIdentity[] = [];
    await this.#store.update(state => {
      const identity = (state.identities ?? []).find(candidate => candidate.id === id);
      identities = deleteIdentity(state, id);
      // Drafts pointing at the removed identity fall back to the account default rather than
      // failing to send later with an id that no longer resolves.
      for (const draft of state.drafts) if (draft.identityId === id) delete draft.identityId;
      for (const item of state.outbox) if (item.draft.identityId === id) delete item.draft.identityId;
      this.#record(state, "deleted", "settings", `identity:${id}`, `Removed identity ${identity?.email ?? id}`, {
        accountId: identity?.accountId ?? "",
        email: identity?.email ?? "",
      });
    });
    return identities;
  }

  async setDefaultIdentity(id: string): Promise<MailIdentity[]> {
    let identities: MailIdentity[] = [];
    await this.#store.update(state => {
      identities = promoteIdentityToDefault(state, id);
      const identity = identities.find(candidate => candidate.id === id);
      this.#record(state, "updated", "settings", `identity:${id}`, `Made ${identity?.email ?? id} the default identity`, {
        accountId: identity?.accountId ?? "",
        email: identity?.email ?? "",
      });
    });
    return identities;
  }

  async listMessageTags(): Promise<MessageTagCatalog> {
    return tagCatalogOf(await this.#store.read());
  }

  async listMessageTagAssignments(): Promise<MessageTagAssignmentMap> {
    return tagAssignmentMapOf(await this.#store.read());
  }

  async createMessageTag(name: string, colour: string): Promise<MessageTagCatalog> {
    let catalog: MessageTagCatalog | null = null;
    await this.#store.update(draft => {
      catalog = addMessageTag(draft, name, colour);
      this.#record(draft, "created", "settings", "message-tags", `Created tag ${name}`, { name, colour });
    });
    return catalog ?? this.listMessageTags();
  }

  async updateMessageTag(id: string, patch: { name?: string; colour?: string; ordinal?: number }): Promise<MessageTagCatalog> {
    let catalog: MessageTagCatalog | null = null;
    await this.#store.update(draft => {
      catalog = editMessageTag(draft, id, patch);
      this.#record(draft, "updated", "settings", "message-tags", `Updated tag ${id}`, patch);
    });
    return catalog ?? this.listMessageTags();
  }

  async deleteMessageTag(id: string): Promise<MessageTagCatalog> {
    let catalog: MessageTagCatalog | null = null;
    await this.#store.update(draft => {
      catalog = removeMessageTag(draft, id);
      this.#record(draft, "deleted", "settings", "message-tags", `Removed tag ${id}`, { id });
    });
    return catalog ?? this.listMessageTags();
  }

  /**
   * Stores the tag change locally and, for a real account, first asks the server to keep the same
   * names as IMAP keywords. That server call is fail-closed like folder administration and
   * mark-folder-read: a rejection or an unconfirmed store throws before anything local changes, so a
   * caller never sees local tag state that claims a server sync which did not actually happen.
   */
  async setMessageTags(accountId: string, folderPath: string, uid: number, tagIds: string[]): Promise<string[]> {
    const state = await this.#store.read();
    const account = this.#requireAccount(state, accountId);
    if (account.kind !== "demo") {
      const { message, uidValidity } = this.#requireCurrentMessage(state, accountId, folderPath, uid);
      const names = previewMessageTagNames(state, message, tagIds);
      try {
        await this.#mail.setMessageKeywords(await this.#runtimeAccount(account), folderPath, uid, names, uidValidity);
      } catch (error) {
        throw publicMailError(error);
      }
    }
    let applied: string[] = [];
    await this.#store.update(draft => {
      this.#requireAccount(draft, accountId);
      const message = draft.messages[folderKey(accountId, folderPath)]?.find(item => item.uid === uid);
      if (!message) throw new Error("That message is no longer in this folder's local cache. Refresh the folder and try again.");
      applied = applyMessageTags(draft, message, tagIds);
      this.#record(draft, "updated", "message", message.id, `Tagged “${message.subject}”`, { tagIds: applied });
    });
    return applied;
  }

  async listMessageFilters(): Promise<MessageFilter[]> {
    return listFilters(await this.#store.read());
  }

  async saveMessageFilter(input: MessageFilterInput): Promise<MessageFilter[]> {
    let filters: MessageFilter[] = [];
    await this.#store.update(draft => {
      filters = upsertFilter(draft, input);
      this.#record(draft, input.id ? "updated" : "created", "settings", "message-filters", `Saved filter ${input.name}`, {
        name: input.name,
        enabled: input.enabled,
        conditionCount: input.conditions.length,
        actionCount: input.actions.length,
      });
    });
    return filters;
  }

  async deleteMessageFilter(id: string): Promise<MessageFilter[]> {
    let filters: MessageFilter[] = [];
    await this.#store.update(draft => {
      const removed = listFilters(draft).find(filter => filter.id === id);
      filters = removeFilter(draft, id);
      this.#record(draft, "deleted", "settings", "message-filters", `Removed filter ${removed?.name ?? id}`, { id });
    });
    return filters;
  }

  async reorderMessageFilters(orderedIds: string[]): Promise<MessageFilter[]> {
    let filters: MessageFilter[] = [];
    await this.#store.update(draft => {
      filters = reorderFilters(draft, orderedIds);
      this.#record(draft, "updated", "settings", "message-filters", "Reordered filters", { orderedIds });
    });
    return filters;
  }

  async previewMessageFilterRun(accountId: string, folderPath: string): Promise<MessageFilterRunSummary> {
    const state = await this.#store.read();
    const context = this.#filterContext(state, accountId, folderPath);
    const plan = planFilterRun(state, context);
    return summarizeFilterPlan(plan, context, { applied: false, appliedCount: 0, failures: [] }) as MessageFilterRunSummary;
  }

  async runMessageFilters(accountId: string, folderPath: string): Promise<MessageFilterRunSummary> {
    const state = await this.#store.read();
    const context = this.#filterContext(state, accountId, folderPath);
    const plan = planFilterRun(state, context);
    const outcome = await this.#applyFilterPlan(state, context, plan);
    const summary = summarizeFilterPlan(plan, context, { applied: true, ...outcome }) as MessageFilterRunSummary;
    if (plan.matchedCount) {
      await this.#store.update(draft => {
        this.#record(draft, "updated", "message", `${accountId}:${folderPath}`, `Ran filters on ${folderPath}`, {
          matched: plan.matchedCount,
          applied: outcome.appliedCount,
          failed: outcome.failures.length,
        });
        this.#notify(
          draft,
          outcome.failures.length ? "warning" : "success",
          "Filters finished",
          outcome.failures.length
            ? `${outcome.appliedCount} of ${plan.matchedCount} matching messages were updated. ${outcome.failures.length} could not be completed.`
            : `${outcome.appliedCount} of ${plan.matchedCount} matching messages were updated.`,
          { category: "mail", action: { kind: "open", target: "page", page: "mail" } },
        );
      });
    }
    return summary;
  }

  async getJunkSummary(): Promise<JunkSummary> {
    return junkSummaryOf(await this.#store.read());
  }

  async classifyMessageJunk(accountId: string, folderPath: string, uid: number): Promise<JunkAssessment> {
    const state = await this.#store.read();
    this.#requireAccount(state, accountId);
    const message = state.messages[folderKey(accountId, folderPath)]?.find(item => item.uid === uid);
    if (!message) throw new Error("That message is no longer in this folder's local cache. Refresh the folder and try again.");
    return classifyJunk(state, message, state.details[message.id]?.text);
  }

  async trainMessageJunk(accountId: string, folderPath: string, uid: number, label: "junk" | "good"): Promise<JunkSummary> {
    let summary: JunkSummary | null = null;
    await this.#store.update(draft => {
      this.#requireAccount(draft, accountId);
      const message = draft.messages[folderKey(accountId, folderPath)]?.find(item => item.uid === uid);
      if (!message) throw new Error("That message is no longer in this folder's local cache. Refresh the folder and try again.");
      summary = trainJunk(draft, message, label, draft.details[message.id]?.text);
      this.#record(draft, "updated", "settings", "junk-model", `Trained the junk filter as ${label}`, {
        messageId: message.id,
        label,
        junkMessageCount: summary.junkMessageCount,
        goodMessageCount: summary.goodMessageCount,
      });
    });
    return summary ?? this.getJunkSummary();
  }

  async resetJunkModel(): Promise<JunkSummary> {
    let summary: JunkSummary | null = null;
    await this.#store.update(draft => {
      summary = resetJunk(draft);
      this.#record(draft, "deleted", "settings", "junk-model", "Cleared the junk filter training", {});
      this.#notify(draft, "info", "Junk training cleared", "The local junk filter forgot everything it had learned on this computer.", {
        category: "mail",
      });
    });
    return summary ?? this.getJunkSummary();
  }

  /**
   * Applies the run-on-sync filters to the messages this synchronization actually brought in. It never
   * rethrows: filtering is layered on a completed sync, so a filter problem is reported on its own
   * rather than turning a synchronization that succeeded into one that failed.
   */
  async #runFiltersAfterSync(accountId: string, arrived: ReadonlyMap<string, MessageSummary[]>): Promise<void> {
    try {
      const state = await this.#store.read();
      if (!listFilters(state).some(filter => filter.enabled && filter.runOnSync)) return;
      let budget = MESSAGE_FILTER_RUN_LIMIT;
      let limitReached = false;
      const fresh = new Map<string, Set<string>>();
      for (const [folderPath, messages] of arrived) {
        const messageIds = new Set<string>();
        for (const message of messages) {
          const ledgerKey = syncFilterLedgerKey(message);
          if (this.#syncFilteredMessages.has(ledgerKey)) continue;
          if (budget <= 0) {
            limitReached = true;
            break;
          }
          // Recorded before the run so a concurrent sync cannot act on the same message twice.
          this.#syncFilteredMessages.add(ledgerKey);
          budget -= 1;
          messageIds.add(message.id);
        }
        if (messageIds.size) fresh.set(folderPath, messageIds);
      }
      while (this.#syncFilteredMessages.size > SYNC_FILTER_LEDGER_LIMIT) {
        const oldest = this.#syncFilteredMessages.values().next();
        if (oldest.done) break;
        this.#syncFilteredMessages.delete(oldest.value);
      }
      if (!fresh.size) return;

      let matchedCount = 0;
      let appliedCount = 0;
      const failures: string[] = [];
      for (const [folderPath, messageIds] of fresh) {
        const context = this.#filterContext(state, accountId, folderPath);
        const plan = planFilterRun(state, context, { runOnSyncOnly: true, messageIds });
        if (plan.limitReached) limitReached = true;
        if (!plan.matchedCount) continue;
        const outcome = await this.#applyFilterPlan(state, context, plan);
        matchedCount += plan.matchedCount;
        appliedCount += outcome.appliedCount;
        failures.push(...outcome.failures);
      }
      if (!matchedCount) return;

      const ceiling = limitReached ? " The run stopped at its safety ceiling; messages beyond it were not examined." : "";
      await this.#store.update(draft => {
        this.#record(draft, "updated", "message", `${accountId}:sync-filters`, `Ran filters on ${matchedCount} newly synchronized messages`, {
          accountId,
          matched: matchedCount,
          applied: appliedCount,
          failed: failures.length,
          limitReached,
        });
        this.#notify(
          draft,
          failures.length ? "warning" : "success",
          "Filters ran after synchronization",
          failures.length
            ? `${appliedCount} of ${matchedCount} newly arrived messages were updated. ${failures.length} could not be completed.${ceiling}`
            : `${appliedCount} of ${matchedCount} newly arrived messages were updated.${ceiling}`,
          { category: "mail", action: { kind: "open", target: "page", page: "mail" } },
        );
      });
    } catch (error) {
      await this.#store
        .update(draft => {
          this.#notify(draft, "warning", "Filters did not run after synchronization", mailErrorMessage(error), {
            category: "mail",
            action: { kind: "open", target: "page", page: "settings" },
          });
        })
        .catch(() => undefined);
    }
  }

  async #refreshFolders(accountId: string, label: string): Promise<FolderSummary[]> {
    const state = await this.#store.read();
    const account = this.#requireAccount(state, accountId);
    const folders = await this.#mail.listFolders(await this.#runtimeAccount(account));
    await this.#store.update(draft => {
      this.#requireAccount(draft, accountId);
      draft.folders[accountId] = folders;
      this.#record(draft, "updated", "account", accountId, label, { folderCount: folders.length });
    });
    return folders;
  }

  #filterContext(state: PersistedState, accountId: string, folderPath: string): FilterRunContext {
    const account = this.#requireAccount(state, accountId);
    return { accountId, folderPath, accountEmail: account.email, folders: state.folders[accountId] ?? [] };
  }

  /**
   * Carries out a planned run one message at a time. A message that fails leaves the remaining
   * messages alone rather than aborting the run, and every failure is reported back.
   */
  async #applyFilterPlan(
    state: PersistedState,
    context: FilterRunContext,
    plan: ReturnType<typeof planFilterRun>,
  ): Promise<{ appliedCount: number; failures: string[] }> {
    const folders = state.folders[context.accountId] ?? [];
    const roleFolder = (role: FolderSummary["role"]): string | null => folders.find(folder => folder.role === role)?.path ?? null;
    const failures: string[] = [];
    let appliedCount = 0;

    for (const entry of plan.entries) {
      const message = entry.subject.message;
      let destination: string | null = null;
      let junkLabel: "junk" | "good" | null = null;
      const flagPatch: { unread?: boolean; starred?: boolean } = {};
      const tagIds = new Set(entry.subject.tagIds);
      let tagsChanged = false;

      for (const action of entry.evaluation.effective) {
        switch (action.kind) {
          case "mark-read": flagPatch.unread = false; break;
          case "mark-unread": flagPatch.unread = true; break;
          case "star": flagPatch.starred = true; break;
          case "unstar": flagPatch.starred = false; break;
          case "add-tag": tagsChanged = !tagIds.has(action.value) || tagsChanged; tagIds.add(action.value); break;
          case "remove-tag": tagsChanged = tagIds.delete(action.value) || tagsChanged; break;
          case "move": destination = action.value; break;
          case "archive": destination = roleFolder("archive"); break;
          case "trash": destination = roleFolder("trash"); break;
          case "mark-junk": junkLabel = "junk"; destination = destination ?? roleFolder("junk"); break;
          case "mark-not-junk": junkLabel = "good"; break;
          case "stop": break;
        }
      }

      try {
        if (tagsChanged) await this.setMessageTags(context.accountId, message.folderPath, message.uid, [...tagIds]);
        if (junkLabel) await this.trainMessageJunk(context.accountId, message.folderPath, message.uid, junkLabel);
        if (flagPatch.unread !== undefined || flagPatch.starred !== undefined) {
          await this.setMessageFlags(context.accountId, message.folderPath, message.uid, flagPatch);
        }
        // The move goes last: it changes the UID the earlier steps addressed.
        if (destination && destination !== message.folderPath) {
          await this.moveMessage(context.accountId, message.folderPath, message.uid, destination);
        }
        appliedCount += 1;
      } catch (error) {
        failures.push(`${message.subject}: ${mailErrorMessage(error)}`);
      }
    }

    return { appliedCount, failures };
  }

  async sendMessage(input: ComposeDraft): Promise<SendResult> {
    const parsedDraft = composeDraftSchema.parse(input);
    const state = await this.#store.read();
    const persistedDraft = parsedDraft.id ? state.drafts.find(item => item.id === parsedDraft.id) : undefined;
    const persistedDraftSnapshot = persistedDraft ? structuredClone(persistedDraft) : undefined;
    const draft = await this.#attachmentAuthorization.authorizeDraft(parsedDraft, persistedDraft, { requireExistingFiles: true });
    const account = this.#requireAccount(state, draft.accountId);
    if (!draft.to.length && !draft.cc.length && !draft.bcc.length) throw new Error("Add at least one recipient before sending.");
    const identity = identityForDraft(state, draft);
    let result: SendResult;
    let networkError = "";
    if (account.kind === "demo") {
      result = { messageId: `<${randomUUID()}@material-email.local>`, accepted: [...draft.to, ...draft.cc, ...draft.bcc], rejected: [], queued: false };
    } else {
      try {
        result = await this.#mail.sendMessage(await this.#runtimeAccount(account), draft, identity);
      } catch (error) {
        networkError = mailErrorMessage(error);
        result = { messageId: `outbox:${randomUUID()}`, accepted: [], rejected: [], queued: true };
      }
    }
    const disposition = classifySendResult(result);
    const rejectedAll = disposition === "rejected";
    await this.#store.update(next => {
      this.#requireAccount(next, draft.accountId);
      const currentDraft = draft.id ? next.drafts.find(item => item.id === draft.id) : undefined;
      const persistedDraftUnchanged = sameDraftSnapshot(currentDraft, persistedDraftSnapshot);
      if (rejectedAll) {
        const retainedDraft = {
          ...draft,
          id: draft.id && persistedDraftUnchanged ? draft.id : randomUUID(),
        };
        const existingIndex = next.drafts.findIndex(item => item.id === retainedDraft.id);
        if (existingIndex >= 0) next.drafts[existingIndex] = retainedDraft;
        else next.drafts.push(retainedDraft);
        this.#record(next, existingIndex >= 0 ? "updated" : "created", "draft", retainedDraft.id ?? "", `Kept retryable draft “${draft.subject || "(No subject)"}” after delivery rejection`, {
          accountId: draft.accountId,
          accepted: result.accepted,
          rejected: result.rejected,
        });
        this.#notify(next, "error", "Message not sent; draft kept", `0 recipients accepted; ${result.rejected.length} rejected. Review the recipients and retry from this unchanged composer.`, {
          category: "delivery",
          action: { kind: "open", target: "draft", accountId: draft.accountId, draftId: retainedDraft.id! },
        });
        return;
      }
      if (persistedDraftUnchanged) next.drafts = next.drafts.filter(item => item.id !== draft.id);
      this.#record(next, "created", result.queued ? "draft" : "message", result.messageId, `${result.queued ? "Queued" : result.rejected.length ? "Partially sent" : "Sent"} “${draft.subject || "(No subject)"}”`, {
        accountId: draft.accountId,
        from: identity?.email ?? account.email,
        replyTo: identity?.replyTo || "",
        to: draft.to,
        cc: draft.cc,
        bcc: draft.bcc,
        subject: draft.subject,
        accepted: result.accepted,
        rejected: result.rejected,
      });
      if (result.queued) {
        next.outbox.push({ id: result.messageId, draft, createdAt: new Date().toISOString(), attempts: 0, lastError: networkError });
        this.#notify(next, "warning", "Message queued in Outbox", networkError, {
          category: "delivery",
          action: { kind: "retry", target: "outbox", accountId: draft.accountId, outboxId: result.messageId },
        });
      } else if (disposition === "partial") {
        this.#notify(next, "warning", "Message partially sent", describeRecipientOutcome(result), {
          category: "delivery",
          action: { kind: "open", target: "page", page: "mail" },
        });
      } else {
        this.#notify(next, "success", "Message sent", describeRecipientOutcome(result), {
          category: "delivery",
          action: { kind: "open", target: "page", page: "mail" },
        });
      }
    });
    return result;
  }

  async saveDraft(input: ComposeDraft): Promise<ComposeDraft> {
    const parsedDraft = composeDraftSchema.parse(input);
    const snapshot = await this.#store.read();
    this.#requireAccount(snapshot, parsedDraft.accountId);
    const persistedDraft = parsedDraft.id ? snapshot.drafts.find(item => item.id === parsedDraft.id) : undefined;
    const draft = await this.#attachmentAuthorization.authorizeDraft(parsedDraft, persistedDraft, { requireExistingFiles: false });
    const saved = { ...draft, id: draft.id ?? randomUUID() };
    await this.#store.update(state => {
      this.#requireAccount(state, saved.accountId);
      const index = state.drafts.findIndex(item => item.id === saved.id);
      if (index >= 0) state.drafts[index] = saved;
      else state.drafts.push(saved);
      this.#record(state, index >= 0 ? "updated" : "created", "draft", saved.id ?? "", `Saved draft “${saved.subject || "(No subject)"}”`, saved);
      this.#notify(state, "info", "Draft saved", "The draft is stored locally on this computer.", {
        category: "delivery",
        action: { kind: "open", target: "draft", accountId: saved.accountId, draftId: saved.id! },
      });
    });
    return saved;
  }

  async listDrafts(accountId: string): Promise<LocalDraftSummary[]> {
    const state = await this.#store.read();
    this.#requireAccount(state, accountId);
    return state.drafts.filter(item => item.accountId === accountId).map(item => ({
      id: item.id!, accountId, recipientCount: item.to.length + item.cc.length + item.bcc.length,
      subject: item.subject, preview: item.text.slice(0, 240), attachmentCount: item.attachments.length,
    }));
  }

  async getDraft(accountId: string, draftId: string): Promise<ComposeDraft> {
    const state = await this.#store.read();
    this.#requireAccount(state, accountId);
    const draft = state.drafts.find(item => item.accountId === accountId && item.id === draftId);
    if (!draft) throw new Error("That local draft no longer exists.");
    return structuredClone(draft);
  }

  async deleteDraft(accountId: string, draftId: string): Promise<boolean> {
    let removed = false;
    await this.#store.update(state => {
      this.#requireAccount(state, accountId);
      const draft = state.drafts.find(item => item.accountId === accountId && item.id === draftId);
      if (!draft) return;
      state.drafts = state.drafts.filter(item => item.id !== draftId);
      this.#record(state, "deleted", "draft", draftId, `Deleted draft “${draft.subject || "(No subject)"}”`, draft);
      this.#notify(state, "info", "Draft deleted", "The local draft was removed; server mail was untouched.");
      removed = true;
    });
    return removed;
  }

  async listPendingOperations(accountId: string): Promise<PendingOperationSummary[]> {
    const state = await this.#store.read();
    this.#requireAccount(state, accountId);
    const head = this.#queueHead(state, accountId);
    return state.pendingOperations.filter(item => item.accountId === accountId).map(item => {
      const conflictReason = this.#pendingOperationConflict(state, item);
      return {
        id: item.id,
        accountId: item.accountId,
        kind: item.kind,
        folderPath: item.folderPath,
        uid: item.uid,
        ...(item.uidValidity ? { uidValidity: item.uidValidity } : {}),
        ...(item.patch ? { patch: structuredClone(item.patch) } : {}),
        ...(item.destination ? { destination: item.destination } : {}),
        createdAt: item.createdAt,
        attempts: item.attempts,
        lastError: mailErrorMessage(item.lastError),
        automaticAttemptLimit: AUTOMATIC_MAIL_QUEUE_ATTEMPT_LIMIT,
        automaticRetryPaused: item.attempts >= AUTOMATIC_MAIL_QUEUE_ATTEMPT_LIMIT,
        isQueueHead: head?.kind === "pending" && head.id === item.id,
        ...(conflictReason ? { conflictReason } : {}),
      };
    });
  }

  async retryPendingOperation(accountId: string, operationId: string): Promise<void> {
    await this.#withQueueFlight(accountId, async () => {
      const state = await this.#store.read();
      const account = await this.#runtimeAccount(this.#requireAccount(state, accountId));
      const operation = state.pendingOperations.find(candidate => candidate.id === operationId && candidate.accountId === accountId);
      if (!operation) throw new Error("That pending mail operation no longer exists.");
      this.#assertQueueHead(state, accountId, "pending", operationId);
      const conflict = this.#pendingOperationConflict(state, operation);
      if (conflict) throw new Error(`${conflict} Discard this queued change or refresh the account before reviewing it again.`);
      try {
        await this.#performPendingOperation(account, operation);
        await this.#store.update(next => {
          this.#requireAccount(next, accountId);
          next.pendingOperations = next.pendingOperations.filter(candidate => candidate.id !== operationId);
          this.#notify(next, "success", "Queued change synchronized", "The queue head reached the mail server after one manual retry.", {
            category: "mail",
            action: { kind: "open", target: "page", page: "mail" },
          });
        });
      } catch (error) {
        await this.#recordPendingFailure(operationId, error);
        throw publicMailError(error);
      }
    });
  }

  async discardPendingOperation(accountId: string, operationId: string): Promise<void> {
    await this.#withQueueFlight(accountId, async () => {
      await this.#store.update(state => {
        this.#requireAccount(state, accountId);
        const operation = state.pendingOperations.find(candidate => candidate.id === operationId && candidate.accountId === accountId);
        if (!operation) throw new Error("That pending mail operation no longer exists.");
        state.pendingOperations = state.pendingOperations.filter(candidate => candidate.id !== operationId);
        this.#record(
          state,
          "deleted",
          "message",
          operation.id,
          `Discarded queued ${operation.kind} change for ${operation.folderPath} UID ${operation.uid}`,
          { ...operation, lastError: mailErrorMessage(operation.lastError) },
        );
        this.#notify(
          state,
          "warning",
          "Queued change discarded",
          "The server action was not performed. The next folder refresh will reconcile the local cache with the server.",
        );
      });
    });
  }

  async listOutbox(accountId: string): Promise<OutboxSummary[]> {
    const state = await this.#store.read();
    this.#requireAccount(state, accountId);
    const head = this.#queueHead(state, accountId);
    return state.outbox.filter(item => item.draft.accountId === accountId).map(item => ({
      id: item.id, accountId, recipientCount: item.draft.to.length + item.draft.cc.length + item.draft.bcc.length,
      subject: item.draft.subject, preview: item.draft.text.slice(0, 240), attachmentCount: item.draft.attachments.length,
      createdAt: item.createdAt, attempts: item.attempts, lastError: mailErrorMessage(item.lastError),
      automaticAttemptLimit: AUTOMATIC_MAIL_QUEUE_ATTEMPT_LIMIT,
      automaticRetryPaused: item.attempts >= AUTOMATIC_MAIL_QUEUE_ATTEMPT_LIMIT,
      isQueueHead: head?.kind === "outbox" && head.id === item.id,
    }));
  }

  async cancelOutbox(accountId: string, outboxId: string): Promise<ComposeDraft> {
    return this.#withQueueFlight(accountId, async () => {
      let cancelled: ComposeDraft | undefined;
      await this.#store.update(state => {
        this.#requireAccount(state, accountId);
        const item = state.outbox.find(candidate => candidate.id === outboxId && candidate.draft.accountId === accountId);
        if (!item) throw new Error("That Outbox item no longer exists.");
        cancelled = structuredClone(item.draft);
        state.outbox = state.outbox.filter(candidate => candidate.id !== outboxId);
        const existing = cancelled.id ? state.drafts.findIndex(candidate => candidate.id === cancelled!.id) : -1;
        if (existing >= 0) state.drafts[existing] = cancelled!; else state.drafts.push(cancelled!);
        this.#record(state, "updated", "draft", cancelled.id ?? "", `Moved Outbox message “${cancelled.subject || "(No subject)"}” back to drafts`, cancelled);
        this.#notify(state, "info", "Outbox item cancelled", "The message is available again as a local draft.", {
          category: "delivery",
          action: cancelled?.id ? { kind: "open", target: "draft", accountId, draftId: cancelled.id } : { kind: "open", target: "page", page: "drafts" },
        });
      });
      return cancelled!;
    });
  }

  async retryOutbox(accountId: string, outboxId: string): Promise<SendResult> {
    return this.#withQueueFlight(accountId, async () => {
      const state = await this.#store.read();
      const account = await this.#runtimeAccount(this.#requireAccount(state, accountId));
      const item = state.outbox.find(candidate => candidate.id === outboxId && candidate.draft.accountId === accountId);
      if (!item) throw new Error("That Outbox item no longer exists.");
      this.#assertQueueHead(state, accountId, "outbox", outboxId);
      return this.#deliverOutboxItem(account, item);
    });
  }

  async savePreferences(patch: Partial<Preferences>): Promise<Preferences> {
    const parsedPatch = preferencesPatchSchema.parse(patch);
    if (parsedPatch.externalEditorPath) {
      const state = await this.#store.read();
      parsedPatch.externalEditorPath = await this.#requireApprovedEditorPath(parsedPatch.externalEditorPath, state);
    }
    const next = await this.#store.update(state => {
      const before = structuredClone(state.preferences);
      const merged = preferencesSchema.parse({ ...state.preferences, ...parsedPatch });
      if (JSON.stringify(before) === JSON.stringify(merged)) return;
      state.preferences = merged;
      this.#record(state, "settings-changed", "settings", "preferences", "Changed application settings", before);
    });
    return next.preferences;
  }

  async getPreferences(): Promise<Preferences> {
    return (await this.#store.read()).preferences;
  }

  async markNotificationRead(id: string, read: boolean): Promise<void> {
    await this.#store.update(state => {
      const notification = state.notifications.find(item => item.id === id);
      if (notification) notification.read = read;
    });
  }

  async markNotificationDismissed(id: string, dismissed: boolean): Promise<void> {
    await this.#store.update(state => {
      const notification = state.notifications.find(item => item.id === id);
      if (!notification) return;
      notification.dismissed = dismissed;
      if (dismissed) notification.read = true;
    });
  }

  async clearNotifications(): Promise<void> {
    await this.#store.update(state => {
      state.notifications = [];
    });
  }

  async restoreHistory(id: string): Promise<HistoryRecord> {
    let restored!: HistoryRecord;
    await this.#store.update(state => {
      const source = state.history.find(item => item.id === id);
      if (!source) throw new Error("That revision no longer exists.");
      if (source.entityType !== "settings") throw new Error("This revision is view-only because restoring it could overwrite server-backed mail data.");
      const before = structuredClone(state.preferences);
      state.preferences = preferencesSchema.parse(source.snapshot);
      restored = this.#record(state, "restored", source.entityType, source.entityId, `Restored revision: ${source.label}`, before);
      this.#notify(state, "success", "Revision restored", "The restore was recorded as a new revision, so it can be undone.", {
        category: "history",
        action: { kind: "undo", target: "settings-revision", historyId: restored.id },
      });
    });
    return restored;
  }

  async listLocalRevisions(): Promise<LocalRevision[]> {
    return this.#historyRepository.list();
  }

  async getLocalRevisionDiff(hash: string): Promise<LocalRevisionDiff> {
    return this.#historyRepository.diff(hash);
  }

  async labelLocalRevision(hash: string, label: string): Promise<LocalRevision> {
    return this.#historyRepository.label(hash, label);
  }

  async previewLocalHistoryPrune(retentionDays: number): Promise<LocalHistoryPrunePreview> {
    return this.#historyRepository.previewPrune(retentionDays);
  }

  async pruneLocalHistory(request: LocalHistoryPruneRequest): Promise<LocalHistoryPruneResult> {
    const outcome = await this.#historyRepository.prune(request);
    await this.#store.update(state => {
      this.#record(
        state,
        "pruned",
        "history",
        "local-history-retention",
        `Pruned ${outcome.prunedRevisionCount} app-owned local revision${outcome.prunedRevisionCount === 1 ? "" : "s"} older than ${request.retentionDays} days`,
        {
          retentionDays: request.retentionDays,
          cutoffAt: outcome.cutoffAt,
          prunedRevisionCount: outcome.prunedRevisionCount,
          previousHeadHash: outcome.previousHeadHash,
          rewrittenHeadHash: outcome.currentHeadHash,
          secureDeletion: false,
        },
      );
      this.#notify(
        state,
        "success",
        "Local revision retention applied",
        `${outcome.prunedRevisionCount} eligible app-owned revision${outcome.prunedRevisionCount === 1 ? " was" : "s were"} removed from active history. The current state and labeled revisions were preserved; this is not secure deletion.`,
      );
    });
    const revisions = await this.#historyRepository.list(2_000);
    return {
      ...outcome,
      retainedRevisionCount: revisions.length,
      currentHeadHash: revisions[0]?.hash ?? outcome.currentHeadHash,
      semanticEventRecorded: true,
    };
  }

  async inspectLocalHistoryDeletion(): Promise<LocalHistoryDeletionEvidence> {
    return this.#historyRepository.inspectDeletionEvidence();
  }

  async restoreLocalRevision(hash: string): Promise<BootstrapState> {
    const source = await this.#historyRepository.read(hash);
    let candidate: PersistedState;
    try {
      candidate = parsePersistedState(JSON.parse(source) as unknown);
    } catch {
      throw new Error("That local revision does not contain a compatible Material Email state.");
    }
    await this.#store.read();
    await this.#historyRepository.snapshot(this.#statePath);
    await this.#store.replace(candidate);
    await this.#store.update(state => {
      this.#record(state, "restored", "settings", "application-state", `Restored local revision ${hash.slice(0, 12)}`, {
        sourceRevision: hash,
      });
      this.#notify(state, "success", "Local revision restored", "The previous state remains in history, and this restore created a new revision.");
    });
    return this.bootstrap();
  }

  async listContacts(): Promise<Contact[]> {
    return this.#pim.listContacts();
  }

  async searchContacts(query: string): Promise<Contact[]> {
    return this.#pim.searchContacts(query);
  }

  async createContact(input: CreateContactInput): Promise<Contact> {
    return this.#pim.createContact(input);
  }

  async updateContact(uid: string, patch: ContactPatch): Promise<Contact> {
    return this.#pim.updateContact(uid, patch);
  }

  async deleteContact(uid: string): Promise<boolean> {
    return this.#pim.deleteContact(uid);
  }

  async restoreContact(uid: string, sourceTransactionId?: string): Promise<Contact> {
    return this.#pim.restoreContact(uid, sourceTransactionId);
  }

  async importVCard(): Promise<VCardImportResult | null> {
    const result = await dialog.showOpenDialog({
      title: "Import contacts from vCard",
      properties: ["openFile"],
      filters: [{ name: "vCard contacts", extensions: ["vcf", "vcard"] }],
    });
    const filePath = result.filePaths[0];
    if (result.canceled || !filePath) return null;
    const info = await stat(filePath);
    if (info.size > 10 * 1024 * 1024) throw new Error("vCard imports are limited to 10 MiB.");
    return this.#pim.importVCard(await readFile(filePath, "utf8"));
  }

  async exportVCard(contactUids?: string[], mailingListUids?: string[]): Promise<string | null> {
    const content = await this.#pim.exportVCard(contactUids, mailingListUids);
    const result = await dialog.showSaveDialog({
      title: "Export contacts and mailing lists as vCard",
      defaultPath: "material-email-contacts-and-lists.vcf",
      filters: [{ name: "vCard contacts and lists", extensions: ["vcf"] }],
    });
    if (result.canceled || !result.filePath) return null;
    await writeFile(result.filePath, content, "utf8");
    return result.filePath;
  }

  async importICalendar(duplicatePolicy: ICalendarDuplicatePolicy): Promise<ICalendarImportResult | null> {
    const result = await dialog.showOpenDialog({
      title: "Import local calendar and tasks from iCalendar",
      properties: ["openFile"],
      filters: [{ name: "iCalendar events and tasks", extensions: ["ics"] }],
    });
    const selected = result.filePaths[0];
    if (result.canceled || !selected) return null;
    const filePath = path.resolve(selected);
    if (/^(?:\\\\|\/\/)/u.test(selected)) throw new Error("Network and UNC iCalendar files are outside the local import boundary.");
    const info = await lstat(filePath);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error("The selected iCalendar import must be a regular local file, not a link.");
    if (info.size < 1 || info.size > PIM_INTERCHANGE_MAX_BYTES) {
      throw new Error(`iCalendar imports must contain from 1 through ${PIM_INTERCHANGE_MAX_BYTES} bytes.`);
    }
    const bytes = await readFile(filePath);
    let source: string;
    try { source = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch (error) { throw new Error("The selected iCalendar file is not valid UTF-8 text.", { cause: error }); }
    return this.#pim.importICalendar(source, duplicatePolicy);
  }

  async exportICalendar(request: ICalendarExportRequest): Promise<ICalendarExportResult> {
    const bundle = await this.#pim.exportICalendar(request);
    const result = await dialog.showSaveDialog({
      title: "Export local calendar and tasks as iCalendar",
      defaultPath: "material-email-calendar-and-tasks.ics",
      filters: [{ name: "iCalendar events and tasks", extensions: ["ics"] }],
    });
    if (result.canceled || !result.filePath) return { status: "cancelled", eventCount: bundle.eventCount, taskCount: bundle.taskCount };
    const selected = /\.ics$/iu.test(result.filePath) ? result.filePath : `${result.filePath}.ics`;
    if (/^(?:\\\\|\/\/)/u.test(selected)) throw new Error("Network and UNC iCalendar files are outside the local export boundary.");
    const filePath = path.resolve(selected);
    const parent = await lstat(path.dirname(filePath));
    if (!parent.isDirectory() || parent.isSymbolicLink()) throw new Error("The iCalendar export folder must be a regular local directory, not a link.");
    const temporaryPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${randomUUID()}.next`);
    try {
      await writeFile(temporaryPath, bundle.content, { encoding: "utf8", flag: "wx", mode: 0o600 });
      await rename(temporaryPath, filePath);
    } finally {
      await rm(temporaryPath, { force: true });
    }
    return { status: "saved", eventCount: bundle.eventCount, taskCount: bundle.taskCount };
  }

  async listMailingLists(): Promise<MailingList[]> {
    return this.#pim.listMailingLists();
  }

  async listMailingListMembers(uid: string): Promise<Contact[]> {
    return this.#pim.listMailingListMembers(uid);
  }

  async createMailingList(input: CreateMailingListInput): Promise<MailingList> {
    return this.#pim.createMailingList(input);
  }

  async updateMailingList(uid: string, patch: MailingListPatch): Promise<MailingList> {
    return this.#pim.updateMailingList(uid, patch);
  }

  async deleteMailingList(uid: string): Promise<boolean> {
    return this.#pim.deleteMailingList(uid);
  }

  async restoreMailingList(uid: string, sourceTransactionId?: string): Promise<MailingList> {
    return this.#pim.restoreMailingList(uid, sourceTransactionId);
  }

  async listCalendarEvents(): Promise<CalendarEvent[]> {
    return this.#pim.listCalendarEvents();
  }

  async createCalendarEvent(input: CreateCalendarEventInput): Promise<CalendarEvent> {
    return this.#pim.createCalendarEvent(input);
  }

  async updateCalendarEvent(uid: string, patch: CalendarEventPatch): Promise<CalendarEvent> {
    return this.#pim.updateCalendarEvent(uid, patch);
  }

  async deleteCalendarEvent(uid: string): Promise<boolean> {
    return this.#pim.deleteCalendarEvent(uid);
  }

  async restoreCalendarEvent(uid: string, sourceTransactionId?: string): Promise<CalendarEvent> {
    return this.#pim.restoreCalendarEvent(uid, sourceTransactionId);
  }

  async listTasks(): Promise<Task[]> {
    return this.#pim.listTasks();
  }

  async createTask(input: CreateTaskInput): Promise<Task> {
    return this.#pim.createTask(input);
  }

  async updateTask(uid: string, patch: TaskPatch): Promise<Task> {
    return this.#pim.updateTask(uid, patch);
  }

  async deleteTask(uid: string): Promise<boolean> {
    return this.#pim.deleteTask(uid);
  }

  async restoreTask(uid: string, sourceTransactionId?: string): Promise<Task> {
    return this.#pim.restoreTask(uid, sourceTransactionId);
  }

  async listPimTransactions(filter?: TransactionFilter): Promise<PimTransaction[]> {
    return this.#pim.listTransactions(filter);
  }

  async chooseAttachments(): Promise<string[]> {
    const result = await dialog.showOpenDialog({ properties: ["openFile", "multiSelections"], title: "Attach files" });
    return result.canceled ? [] : this.#attachmentAuthorization.approveDialogSelection(result.filePaths);
  }

  async exportData(_kind: "history" | "settings" | "changelog", content: string, suggestedName: string): Promise<string | null> {
    const result = await dialog.showSaveDialog({ defaultPath: suggestedName, title: "Export Material Email data" });
    if (result.canceled || !result.filePath) return null;
    const { writeFile } = await import("node:fs/promises");
    await writeFile(result.filePath, content, "utf8");
    return result.filePath;
  }

  async exportTabAppearanceTheme(theme: TabAppearanceThemeDocument): Promise<{ fileName: string } | null> {
    const content = serializeTabAppearanceTheme(theme);
    const result = await dialog.showSaveDialog({
      defaultPath: "material-email-tab-appearance-theme.json",
      title: "Export workspace tab appearance theme",
      filters: [{ name: "Material Email appearance theme", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePath) return null;
    const selected = /\.json$/iu.test(result.filePath) ? result.filePath : `${result.filePath}.json`;
    if (/^(?:\\\\|\/\/)/u.test(selected)) throw new Error("Network and UNC appearance-theme destinations are outside the local export boundary.");
    const filePath = path.resolve(selected);
    const parent = await lstat(path.dirname(filePath));
    if (!parent.isDirectory() || parent.isSymbolicLink()) throw new Error("The appearance-theme export folder must be a regular local directory, not a link.");
    const temporaryPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${randomUUID()}.next`);
    try {
      await writeFile(temporaryPath, content, { encoding: "utf8", flag: "wx", mode: 0o600 });
      await rename(temporaryPath, filePath);
    } finally {
      await rm(temporaryPath, { force: true });
    }
    return { fileName: path.basename(filePath) };
  }

  async importTabAppearanceTheme(): Promise<{ fileName: string; theme: TabAppearanceThemeDocument } | null> {
    const result = await dialog.showOpenDialog({
      title: "Import workspace tab appearance theme",
      properties: ["openFile"],
      filters: [{ name: "Material Email appearance theme", extensions: ["json"] }],
    });
    const selected = result.filePaths[0];
    if (result.canceled || !selected) return null;
    if (!/\.json$/iu.test(selected)) throw new Error("Appearance-theme imports must use a .json file selected through the desktop dialog.");
    if (/^(?:\\\\|\/\/)/u.test(selected)) throw new Error("Network and UNC appearance-theme files are outside the local import boundary.");
    const filePath = path.resolve(selected);
    const info = await lstat(filePath);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error("The selected appearance theme must be a regular local file, not a link.");
    if (info.size < 1 || info.size > TAB_APPEARANCE_THEME_MAX_BYTES) {
      throw new Error(`Appearance-theme imports must contain from 1 through ${TAB_APPEARANCE_THEME_MAX_BYTES} bytes.`);
    }
    let source: string;
    try {
      source = new TextDecoder("utf-8", { fatal: true }).decode(await readFile(filePath));
    } catch (error) {
      throw new Error("The selected appearance theme is not valid UTF-8 text.", { cause: error });
    }
    const validation = parseTabAppearanceThemeText(source);
    if (!validation.ok) throw new Error(`The selected appearance theme was rejected: ${validation.reason}`);
    return { fileName: path.basename(filePath), theme: validation.theme };
  }

  async detectEditors(): Promise<Array<{ id: string; name: string; path: string }>> {
    const candidates = [
      {
        id: "vscode",
        name: "Visual Studio Code",
        searches: [
          { command: "code.exe", resolve: (resultPath: string) => resultPath },
          { command: "code.cmd", resolve: (resultPath: string) => path.resolve(path.dirname(resultPath), "..", "Code.exe") },
        ],
      },
      {
        id: "cursor",
        name: "Cursor",
        searches: [
          { command: "cursor.exe", resolve: (resultPath: string) => resultPath },
          { command: "cursor.cmd", resolve: (resultPath: string) => path.resolve(path.dirname(resultPath), "..", "..", "..", "Cursor.exe") },
        ],
      },
      { id: "notepadpp", name: "Notepad++", searches: [{ command: "notepad++.exe", resolve: (resultPath: string) => resultPath }] },
      { id: "notepad", name: "Notepad", searches: [{ command: "notepad.exe", resolve: (resultPath: string) => resultPath }] },
    ];
    const found: Array<{ id: string; name: string; path: string }> = [];
    this.#detectedEditorPaths.clear();
    for (const candidate of candidates) {
      for (const search of candidate.searches) {
        try {
          const { stdout } = await execFileAsync("where.exe", [search.command], { windowsHide: true });
          for (const resultPath of stdout.split(/\r?\n/).map(value => value.trim()).filter(Boolean)) {
            try {
              const resolved = await inspectEditorExecutable(search.resolve(resultPath));
              if (found.some(editor => sameWindowsPath(editor.path, resolved))) continue;
              found.push({ id: candidate.id, name: candidate.name, path: resolved });
              this.#detectedEditorPaths.add(resolved);
              break;
            } catch {
              // Ignore command shims and non-executable search results.
            }
          }
          if (found.some(editor => editor.id === candidate.id)) break;
        } catch {
          // Continue through the finite editor inventory.
        }
      }
    }
    return found;
  }

  async openExternalEditor(editorPath?: string): Promise<void> {
    const state = await this.#store.read();
    const requested = editorPath ?? state.preferences.externalEditorPath;
    let executable: string | undefined;
    if (requested) {
      try {
        executable = await this.#requireApprovedEditorPath(requested, state);
      } catch {
        // An untrusted or legacy path must be confirmed through the native picker below.
      }
    }
    if (!executable) {
      const selection = await dialog.showOpenDialog({
        title: "Choose an external editor executable",
        properties: ["openFile"],
        filters: [{ name: "Windows applications", extensions: ["exe"] }],
      });
      const selectedPath = selection.filePaths[0];
      if (selection.canceled || !selectedPath) throw new Error("No editor was launched because executable selection was cancelled.");
      executable = await inspectEditorExecutable(selectedPath);
      await this.#store.update(next => {
        if (!next.approvedEditorPaths.some(approved => sameWindowsPath(approved, executable!))) {
          next.approvedEditorPaths.push(executable!);
        }
        const before = structuredClone(next.preferences);
        next.preferences = { ...next.preferences, externalEditorPath: executable! };
        this.#record(next, "settings-changed", "settings", "preferences", "Approved an external editor executable", before);
      });
    }
    const target = app.getAppPath();
    await new Promise<void>((resolve, reject) => {
      const child = spawn(executable, [target], { detached: true, stdio: "ignore", windowsHide: true, shell: false });
      child.once("error", reject);
      child.once("spawn", () => {
        child.unref();
        resolve();
      });
    });
  }

  async #requireApprovedEditorPath(candidate: string, state: PersistedState): Promise<string> {
    const executable = await inspectEditorExecutable(candidate);
    await this.detectEditors();
    if (
      [...this.#detectedEditorPaths].some(detected => sameWindowsPath(detected, executable)) ||
      state.approvedEditorPaths.some(approved => sameWindowsPath(approved, executable))
    ) {
      return executable;
    }
    throw new Error("That executable has not been detected or approved through the native file picker.");
  }

  async #withQueueFlight<T>(accountId: string, operation: () => Promise<T>): Promise<T> {
    if (this.#queueFlights.has(accountId)) {
      throw new Error("Another queued mail operation is already running for this account. Wait for it to finish before retrying or discarding.");
    }
    this.#queueFlights.add(accountId);
    try {
      return await operation();
    } finally {
      this.#queueFlights.delete(accountId);
    }
  }

  #queueHead(state: PersistedState, accountId: string): { kind: "pending" | "outbox"; id: string } | undefined {
    const pending = state.pendingOperations.find(item => item.accountId === accountId);
    if (pending) return { kind: "pending", id: pending.id };
    const outbox = state.outbox.find(item => item.draft.accountId === accountId);
    return outbox ? { kind: "outbox", id: outbox.id } : undefined;
  }

  #assertQueueHead(state: PersistedState, accountId: string, kind: "pending" | "outbox", id: string): void {
    const head = this.#queueHead(state, accountId);
    if (!head || head.kind !== kind || head.id !== id) {
      throw new Error("Only the account queue head can be retried. Resolve or discard the earlier queued item first.");
    }
  }

  #pendingOperationConflict(state: PersistedState, operation: PendingOperation): string | undefined {
    if (!operation.uidValidity) return "This queued change has no UIDVALIDITY identity and cannot be retried safely.";
    const current = state.folders[operation.accountId]?.find(folder => folder.path === operation.folderPath)?.uidValidity;
    if (current && current !== operation.uidValidity) {
      return `The ${operation.folderPath} mailbox changed from UIDVALIDITY ${operation.uidValidity} to ${current}; UID ${operation.uid} may now identify a different message.`;
    }
    return undefined;
  }

  async #performPendingOperation(account: RuntimeAccount, operation: PendingOperation): Promise<void> {
    if (!operation.uidValidity) throw new Error("The queued operation has no mailbox UIDVALIDITY and cannot be replayed safely.");
    if (operation.kind === "flags" && operation.patch) {
      await this.#mail.setFlags(account, operation.folderPath, operation.uid, operation.patch, operation.uidValidity);
      return;
    }
    if (operation.kind === "move" && operation.destination) {
      await this.#mail.moveMessage(account, operation.folderPath, operation.uid, operation.destination, operation.uidValidity);
      return;
    }
    throw new Error("The queued operation is incomplete.");
  }

  async #recordPendingFailure(operationId: string, error: unknown): Promise<void> {
    const message = mailErrorMessage(error);
    await this.#store.update(state => {
      const item = state.pendingOperations.find(candidate => candidate.id === operationId);
      if (!item) return;
      item.attempts += 1;
      item.lastError = message;
      if (item.attempts === AUTOMATIC_MAIL_QUEUE_ATTEMPT_LIMIT) {
        this.#notify(
          state,
          "warning",
          "Automatic retries paused",
          `Queued ${item.kind} change ${item.id} reached ${AUTOMATIC_MAIL_QUEUE_ATTEMPT_LIMIT} failed attempts. Review the queue head, retry it once manually, or discard it.`,
          {
            category: "mail",
            action: { kind: "retry", target: "pending-operation", accountId: item.accountId, operationId: item.id },
          },
        );
      }
    });
  }

  async #recordOutboxFailure(outboxId: string, error: unknown): Promise<void> {
    const message = mailErrorMessage(error);
    await this.#store.update(state => {
      const item = state.outbox.find(candidate => candidate.id === outboxId);
      if (!item) return;
      item.attempts += 1;
      item.lastError = message;
      if (item.attempts === AUTOMATIC_MAIL_QUEUE_ATTEMPT_LIMIT) {
        this.#notify(
          state,
          "warning",
          "Automatic retries paused",
          `Outbox item ${item.id} reached ${AUTOMATIC_MAIL_QUEUE_ATTEMPT_LIMIT} failed attempts. Review the queue head, retry it once manually, or move it back to drafts.`,
          {
            category: "delivery",
            action: { kind: "retry", target: "outbox", accountId: item.draft.accountId, outboxId: item.id },
          },
        );
      }
    });
  }

  async #deliverOutboxItem(account: RuntimeAccount, item: OutboxItem): Promise<SendResult> {
    let sent: SendResult;
    // Resolved here rather than captured when the item was queued, so a queued message leaves with
    // the same From address an immediate send would have used.
    const identity = identityForDraft(await this.#store.read(), item.draft);
    try {
      sent = await this.#mail.sendMessage(account, item.draft, identity);
    } catch (error) {
      await this.#recordOutboxFailure(item.id, error);
      throw publicMailError(error);
    }
    const disposition = classifySendResult(sent);
    await this.#store.update(state => {
      this.#requireAccount(state, account.id);
      const queued = state.outbox.find(candidate => candidate.id === item.id && candidate.draft.accountId === account.id);
      if (!queued) throw new Error("That Outbox item changed while delivery was in flight; its local queue record was preserved for review.");
      state.outbox = state.outbox.filter(candidate => candidate.id !== item.id);
      if (disposition === "rejected") {
        const currentDraft = queued.draft.id ? state.drafts.find(candidate => candidate.id === queued.draft.id) : undefined;
        const retained = {
          ...queued.draft,
          id: queued.draft.id && (!currentDraft || sameDraftSnapshot(currentDraft, queued.draft)) ? queued.draft.id : randomUUID(),
        };
        const draftIndex = state.drafts.findIndex(candidate => candidate.id === retained.id);
        if (draftIndex >= 0) state.drafts[draftIndex] = retained;
        else state.drafts.push(retained);
        this.#record(state, draftIndex >= 0 ? "updated" : "created", "draft", retained.id ?? "", `Kept rejected Outbox message “${queued.draft.subject || "(No subject)"}” as a draft`, {
          queuedAt: queued.createdAt,
          accepted: sent.accepted,
          rejected: sent.rejected,
        });
        this.#notify(state, "error", "Outbox message not sent; draft kept", describeRecipientOutcome(sent));
        return;
      }
      this.#record(state, "updated", "message", sent.messageId, `Delivered queued message “${queued.draft.subject || "(No subject)"}”`, {
        queuedAt: queued.createdAt,
        accepted: sent.accepted,
        rejected: sent.rejected,
      });
      if (disposition === "partial") {
        this.#notify(state, "warning", "Outbox message partially sent", describeRecipientOutcome(sent));
      } else {
        this.#notify(state, "success", "Outbox message sent", describeRecipientOutcome(sent));
      }
    });
    return sent;
  }

  async #replayPending(account: RuntimeAccount): Promise<void> {
    const snapshot = await this.#store.read();
    const operations = snapshot.pendingOperations.filter(item => item.accountId === account.id);
    for (const operation of operations) {
      if (this.#pendingOperationConflict(snapshot, operation)) break;
      if (operation.attempts >= AUTOMATIC_MAIL_QUEUE_ATTEMPT_LIMIT) break;
      try {
        await this.#performPendingOperation(account, operation);
        await this.#store.update(state => {
          this.#requireAccount(state, account.id);
          state.pendingOperations = state.pendingOperations.filter(item => item.id !== operation.id);
          this.#notify(state, "success", "Queued change synchronized", `Operation from ${operation.createdAt} reached the mail server.`);
        });
      } catch (error) {
        await this.#recordPendingFailure(operation.id, error);
        break;
      }
    }

    const afterOperations = await this.#store.read();
    if (afterOperations.pendingOperations.some(item => item.accountId === account.id)) return;
    const outbox = afterOperations.outbox.filter(item => item.draft.accountId === account.id);
    for (const item of outbox) {
      if (item.attempts >= AUTOMATIC_MAIL_QUEUE_ATTEMPT_LIMIT) break;
      try {
        await this.#deliverOutboxItem(account, item);
      } catch {
        break;
      }
    }
  }

  #requireCurrentMessage(
    state: PersistedState,
    accountId: string,
    folderPath: string,
    uid: number,
    expectedUidValidity?: string,
  ): { message: MessageSummary; uidValidity: string } {
    const message = state.messages[folderKey(accountId, folderPath)]?.find(item => item.uid === uid);
    if (!message) {
      throw new Error("The message is no longer present in the current folder generation. Refresh the folder before retrying.");
    }
    const folderUidValidity = state.folders[accountId]?.find(folder => folder.path === folderPath)?.uidValidity;
    if (message.uidValidity && folderUidValidity && message.uidValidity !== folderUidValidity) {
      throw new Error("The cached message and folder UIDVALIDITY values disagree. Refresh the folder before retrying.");
    }
    const uidValidity = message.uidValidity ?? folderUidValidity;
    if (!uidValidity) {
      throw new Error("The message UIDVALIDITY is unavailable, so the server action was refused. Refresh the folder before retrying.");
    }
    if (expectedUidValidity && uidValidity !== expectedUidValidity) {
      throw new Error(
        `The message generation changed from UIDVALIDITY ${expectedUidValidity} to ${uidValidity}. Refresh the folder before retrying.`,
      );
    }
    return { message, uidValidity };
  }

  #quarantinePayloadPath(id: string): string {
    return path.join(this.#quarantinePath, `${id}.quarantine`);
  }

  async #quarantineAttachments(
    accountId: string,
    folderPath: string,
    uid: number,
    uidValidity: string,
    messageId: string | undefined,
    items: Array<{ attachment: AttachmentContent; index: number; risk: AttachmentRiskReviewItem }>,
  ): Promise<QuarantinedAttachment[]> {
    if (!items.length) return [];
    await mkdir(this.#quarantinePath, { recursive: true, mode: 0o700 });
    const currentState = await this.#store.read();
    const results = new Array<QuarantinedAttachment>(items.length);
    const created: Array<{ resultIndex: number; record: QuarantinedAttachment; payloadPath: string }> = [];

    for (const [resultIndex, item] of items.entries()) {
      if (item.risk.level === "ordinary") throw new Error("Ordinary attachments must not enter local quarantine.");
      const sha256 = createHash("sha256").update(item.attachment.content).digest("hex");
      const source = {
        accountId,
        folderPath,
        uid,
        uidValidity,
        attachmentIndex: item.index,
        ...(messageId ? { messageId } : {}),
      };
      const existing = currentState.quarantinedAttachments.find(candidate =>
        candidate.source.accountId === source.accountId &&
        candidate.source.folderPath === source.folderPath &&
        candidate.source.uid === source.uid &&
        candidate.source.uidValidity === source.uidValidity &&
        candidate.source.attachmentIndex === source.attachmentIndex &&
        candidate.filename === item.attachment.filename &&
        candidate.contentType === item.attachment.contentType &&
        candidate.sha256 === sha256,
      );
      if (existing) {
        results[resultIndex] = existing;
        continue;
      }
      const record: QuarantinedAttachment = {
        id: randomUUID(),
        filename: item.attachment.filename,
        contentType: item.attachment.contentType,
        size: item.attachment.content.length,
        sha256,
        risk: { level: item.risk.level, reasons: [...item.risk.reasons] },
        quarantinedAt: new Date().toISOString(),
        source,
      };
      const payloadPath = this.#quarantinePayloadPath(record.id);
      await writeFile(payloadPath, item.attachment.content, { flag: "wx", mode: 0o600 });
      results[resultIndex] = record;
      created.push({ resultIndex, record, payloadPath });
    }

    if (!created.length) return results;
    const acceptedIds = new Set<string>();
    try {
      await this.#store.update(draft => {
        for (const candidate of created) {
          const { record } = candidate;
          const duplicate = draft.quarantinedAttachments.find(existing =>
            existing.source.accountId === record.source.accountId &&
            existing.source.folderPath === record.source.folderPath &&
            existing.source.uid === record.source.uid &&
            existing.source.uidValidity === record.source.uidValidity &&
            existing.source.attachmentIndex === record.source.attachmentIndex &&
            existing.filename === record.filename &&
            existing.contentType === record.contentType &&
            existing.sha256 === record.sha256,
          );
          if (duplicate) {
            results[candidate.resultIndex] = duplicate;
            continue;
          }
          acceptedIds.add(record.id);
          draft.quarantinedAttachments.unshift(record);
          this.#record(draft, "created", "message", `${accountId}:${folderPath}:${uid}`, `Quarantined attachment ${record.filename}`, {
            quarantineId: record.id,
            filename: record.filename,
            contentType: record.contentType,
            size: record.size,
            sha256: record.sha256,
            risk: record.risk,
            source: record.source,
          });
        }
        if (acceptedIds.size) {
          this.#notify(
            draft,
            "warning",
            acceptedIds.size === 1 ? "Attachment placed in local quarantine" : "Attachments placed in local quarantine",
            `${acceptedIds.size} risky attachment${acceptedIds.size === 1 ? "" : "s"} require explicit release or deletion. No antivirus scan was performed.`,
          );
        }
      });
    } catch (error) {
      await Promise.all(created.map(candidate => rm(candidate.payloadPath, { force: true }).catch(() => undefined)));
      throw error;
    }
    await Promise.all(created
      .filter(candidate => !acceptedIds.has(candidate.record.id))
      .map(candidate => rm(candidate.payloadPath, { force: true })));
    return results;
  }

  #safeFilename(value: string): string {
    const normalized = path.basename(value).replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_").trim();
    return normalized || "attachment";
  }

  async #uniquePath(directory: string, filename: string): Promise<string> {
    const extension = path.extname(filename);
    const stem = path.basename(filename, extension);
    for (let suffix = 0; suffix < 10_000; suffix += 1) {
      const candidate = path.join(directory, suffix ? `${stem} (${suffix})${extension}` : filename);
      try {
        await access(candidate);
      } catch {
        return candidate;
      }
    }
    throw new Error("Could not choose a unique attachment filename.");
  }

  async #releaseIdentity(): Promise<ReleaseIdentity> {
    const fallback: ReleaseIdentity = {
      version: app.getVersion(),
      releaseDate: "",
      codeName: "Classic Har Gow · 蝦餃",
      dishId: "hk-dish-0001",
      imageAsset: "hk-dish-0001-classic-har-gow.png",
      catalogCommit: "dfb95a20e647d921242358988ada9c5436c78b3d",
    };
    try {
      const parsed = JSON.parse(await readFile(path.join(app.getAppPath(), "dist", "release-metadata.json"), "utf8")) as Partial<ReleaseIdentity>;
      if (
        typeof parsed.version === "string" &&
        typeof parsed.releaseDate === "string" &&
        typeof parsed.codeName === "string" &&
        typeof parsed.dishId === "string" &&
        typeof parsed.imageAsset === "string" &&
        typeof parsed.catalogCommit === "string"
      ) return parsed as ReleaseIdentity;
    } catch {
      // Development and first-run fallback remains factual for the source package.
    }
    return fallback;
  }

  #publicAccount = (account: StoredAccount): AccountSummary => {
    const { encryptedSecret: _secret, ...safe } = account;
    return safe.syncError ? { ...safe, syncError: mailErrorMessage(safe.syncError) } : safe;
  };

  async #runtimeAccount(account: StoredAccount): Promise<RuntimeAccount> {
    if (account.kind === "demo") return { ...account, secret: "" };
    if (account.authMode === "oauth2") return this.#runtimeOAuthAccount(account);
    if (!account.encryptedSecret) throw new Error("The account credential is missing.");
    if (!safeStorage.isEncryptionAvailable()) throw new Error("Windows credential encryption is not available on this computer.");
    return { ...this.#publicAccount(account), secret: safeStorage.decryptString(Buffer.from(account.encryptedSecret, "base64")) };
  }

  /**
   * Resolves a connected OAuth account to a runtime access token, refreshing it first when it is
   * within {@link OAUTH_REFRESH_MARGIN_MS} of expiring. The mail service already treats `secret` as
   * the access token whenever `authMode` is `oauth2` (its XOAUTH2 path), so this is the only place
   * that needs to know a token can expire.
   */
  async #runtimeOAuthAccount(account: StoredAccount): Promise<RuntimeAccount> {
    const vault = this.#oauthTokenVault;
    if (!vault) throw new Error("OAuth account connections are not available in this build.");
    const provider = account.oauthProvider;
    if (!provider) throw new Error("This account has no recorded OAuth provider. Remove and reconnect it.");
    const record = await vault.read(provider, account.id);
    if (!record) throw new Error(`Reconnect ${account.email}: its sign-in has expired or was cleared from this computer.`);
    if (Date.parse(record.expiresAt) - Date.now() > OAUTH_REFRESH_MARGIN_MS) {
      return { ...this.#publicAccount(account), secret: record.accessToken };
    }
    const registration = vault.registration(provider);
    if (!registration) throw new Error(`This build no longer has an OAuth registration for ${provider}. Remove and reconnect ${account.email}.`);
    let rotated: Awaited<ReturnType<typeof refreshAccessToken>>;
    try {
      rotated = await refreshAccessToken({
        provider,
        tokenEndpoint: registration.tokenEndpoint,
        clientId: registration.clientId,
        refreshToken: record.refreshToken,
        scopes: record.scopes,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "an unknown error";
      throw new Error(`Reconnect ${account.email}: refreshing its sign-in failed (${reason}).`);
    }
    await vault.rotate(provider, account.id, {
      accessToken: rotated.accessToken,
      ...(rotated.refreshToken ? { refreshToken: rotated.refreshToken } : {}),
      expiresInSeconds: rotated.expiresInSeconds,
      // A refresh response that omits scope (some providers do, when it is unchanged) keeps what
      // was already recorded rather than silently narrowing it to nothing.
      scopes: rotated.scopes.length ? rotated.scopes : record.scopes,
    });
    return { ...this.#publicAccount(account), secret: rotated.accessToken };
  }

  /**
   * Called once, right after a browser round trip lands a code — never over IPC, and never with
   * the code, verifier, or redirect URI exposed to the renderer. Performs the actual exchange this
   * app's PKCE/loopback foundation deliberately does not do on its own, and holds the result as an
   * unattached sign-in until the user adds or tests an account with it.
   */
  async completeOAuthSignIn(grant: { provider: OAuthProviderId; code: string; codeVerifier: string; redirectUri: string }): Promise<void> {
    this.#pendingOAuthSignIn = null;
    this.#oauthSignInStatus = { provider: grant.provider, phase: "exchanging", failure: null, accountHint: null };
    const vault = this.#oauthTokenVault;
    if (!vault) {
      this.#oauthSignInStatus = { provider: grant.provider, phase: "failed", failure: "OAuth account connections are not available in this build.", accountHint: null };
      return;
    }
    const registration = vault.registration(grant.provider);
    if (!registration) {
      this.#oauthSignInStatus = { provider: grant.provider, phase: "failed", failure: "This build has no OAuth registration for that provider.", accountHint: null };
      return;
    }
    try {
      const result = await exchangeAuthorizationCode({
        provider: grant.provider,
        tokenEndpoint: registration.tokenEndpoint,
        clientId: registration.clientId,
        code: grant.code,
        redirectUri: grant.redirectUri,
        codeVerifier: grant.codeVerifier,
      });
      this.#pendingOAuthSignIn = {
        provider: grant.provider,
        accessToken: result.accessToken,
        // exchangeAuthorizationCode already refuses a response with no refresh token.
        refreshToken: result.refreshToken!,
        expiresInSeconds: result.expiresInSeconds,
        scopes: result.scopes,
        capturedAtMs: Date.now(),
      };
      // A non-secret prefill hint only; see OAuthSignInAccountHint. The renderer never treats this
      // as proof of who is signed in.
      this.#oauthSignInStatus = { provider: grant.provider, phase: "ready", failure: null, accountHint: result.accountHint };
    } catch (error) {
      this.#oauthSignInStatus = { provider: grant.provider, phase: "failed", failure: error instanceof Error ? error.message : "The sign-in could not be completed.", accountHint: null };
    }
  }

  getOAuthSignInStatus(): OAuthSignInSnapshot | null {
    return this.#oauthSignInStatus;
  }

  /**
   * Returns the pending sign-in for `provider` without consuming it (so Test can be pressed more
   * than once), refusing a missing, mismatched, or stale one. `consume: true` clears it afterward —
   * used only by account creation, so a token cannot be attached to two different accounts.
   */
  #peekPendingOAuthSignIn(provider: OAuthProviderId, options: { consume: boolean }): PendingOAuthSignIn {
    const pending = this.#pendingOAuthSignIn;
    if (!pending || pending.provider !== provider) {
      throw new Error(`Sign in with ${providerDisplayName(provider)} before connecting this account.`);
    }
    if (Date.now() - pending.capturedAtMs > OAUTH_PENDING_SIGNIN_TTL_MS) {
      this.#pendingOAuthSignIn = null;
      throw new Error(`That ${providerDisplayName(provider)} sign-in has expired. Sign in again.`);
    }
    if (options.consume) this.#pendingOAuthSignIn = null;
    return pending;
  }

  #requireAccount(state: PersistedState, accountId: string): StoredAccount {
    const account = state.accounts.find(candidate => candidate.id === accountId);
    if (!account) throw new Error("The selected account no longer exists.");
    return account;
  }

  #notify(
    state: PersistedState,
    kind: NotificationRecord["kind"],
    title: string,
    body: string,
    options: { category?: NotificationCategory; action?: NotificationAction } = {},
  ): NotificationRecord {
    const item: NotificationRecord = {
      id: randomUUID(),
      kind,
      category: options.category ?? "system",
      title,
      body,
      createdAt: new Date().toISOString(),
      read: false,
      dismissed: false,
      ...(options.action ? { action: options.action } : {}),
    };
    state.notifications.unshift(item);
    state.notifications = state.notifications.slice(0, 500);
    return item;
  }

  #record(
    state: PersistedState,
    kind: HistoryRecord["kind"],
    entityType: HistoryRecord["entityType"],
    entityId: string,
    label: string,
    snapshot: unknown,
  ): HistoryRecord {
    const item: HistoryRecord = { id: randomUUID(), kind, entityType, entityId, label, createdAt: new Date().toISOString(), snapshot };
    state.history.unshift(item);
    state.history = state.history.slice(0, 2_000);
    return item;
  }
}
