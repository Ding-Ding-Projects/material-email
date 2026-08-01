import type {
  CalendarEvent,
  CalendarEventPatch,
  Contact,
  ContactPatch,
  CreateCalendarEventInput,
  CreateContactInput,
  CreateMailingListInput,
  CreateTaskInput,
  MailingList,
  MailingListPatch,
  PimTransaction,
  Task,
  TaskPatch,
  TransactionFilter,
  VCardImportResult,
} from "../main/pim/types.js";
import type { AttachmentRiskAssessment, AttachmentSaveReview } from "./attachment-safety.js";
import type { ExternalLinkReason, ExternalLinkRisk } from "./external-link-safety.js";
import type {
  OAuthAuthorizationSnapshot,
  OAuthProviderId,
  OAuthTokenVaultActionResult,
  OAuthTokenVaultSnapshot,
} from "./oauth.js";
import type { MessageCryptoProfile, MessageCryptographyAssessment } from "./message-cryptography.js";

export type {
  CalendarEvent,
  CalendarEventPatch,
  Contact,
  ContactPatch,
  CreateCalendarEventInput,
  CreateContactInput,
  CreateMailingListInput,
  CreateTaskInput,
  MailingList,
  MailingListPatch,
  PimTransaction,
  Task,
  TaskPatch,
  TransactionFilter,
  VCardImportResult,
};
export type {
  AttachmentRiskAssessment,
  AttachmentRiskLevel,
  AttachmentRiskReason,
  AttachmentRiskReviewItem,
  AttachmentSaveReview,
} from "./attachment-safety.js";
export type { ExternalLinkAssessment, ExternalLinkReason, ExternalLinkRisk } from "./external-link-safety.js";
export type {
  OAuthAuthorizationFailure,
  OAuthAuthorizationPhase,
  OAuthAuthorizationSnapshot,
  OAuthProviderAvailability,
  OAuthProviderId,
  OAuthRemoteRevocationOutcome,
  OAuthTokenVaultActionResult,
  OAuthTokenVaultFailure,
  OAuthTokenVaultProviderSnapshot,
  OAuthTokenVaultProviderState,
  OAuthTokenVaultSnapshot,
} from "./oauth.js";
export type {
  MessageCryptoAssessmentReason,
  MessageCryptoCapability,
  MessageCryptoContainer,
  MessageCryptoIdentityMetadata,
  MessageCryptoProfile,
  MessageCryptoProtocol,
  MessageCryptographyAssessment,
  MessageCryptoTrustState,
} from "./message-cryptography.js";

export type LanguageMode = "en" | "yue" | "bilingual";
export type ThemeMode = "light" | "dark" | "system";
export type DensityMode = "compact" | "comfortable" | "relaxed";
export type MailSecurity = "tls" | "starttls" | "plain";
export type AuthMode = "password" | "oauth2";
export type IncomingMailProtocol = "imap" | "pop3";
export type Pop3TransportMode = "local-demo" | "live-network";

export const POP3_MESSAGE_LIMIT_MIN = 1;
export const POP3_MESSAGE_LIMIT_MAX = 50;

export interface Pop3AccountOptions {
  transport: Pop3TransportMode;
  retrievalMode: "new-only";
  leaveOnServer: true;
  messageLimit: number;
}

export type Pop3SessionState = "idle" | "connecting" | "authorization" | "transaction" | "update" | "disconnected" | "unsupported";
export type Pop3SessionEvent = "start" | "greeting" | "demo-authorized" | "retrieve-list" | "quit" | "disconnect" | "reject-live-network";

export interface Pop3StateTransition {
  sequence: number;
  from: Pop3SessionState;
  event: Pop3SessionEvent;
  to: Pop3SessionState;
}

export type Pop3CapabilityName = "UIDL" | "TOP" | "STLS" | "PIPELINING" | "DELE";

export interface Pop3CapabilityStatus {
  name: Pop3CapabilityName;
  available: boolean;
  used: boolean;
}

export interface Pop3DemoMessage {
  uidl: string;
  subject: string;
  octets: number;
}

export interface Pop3FoundationSnapshot {
  transport: Pop3TransportMode;
  state: Pop3SessionState;
  capabilities: Pop3CapabilityStatus[];
  transitions: Pop3StateTransition[];
  messages: Pop3DemoMessage[];
  serverContacted: false;
  credentialsUsed: false;
  deletionAttempted: false;
  fullSynchronization: false;
  boundary: "local-demo-only" | "live-network-unsupported";
}

export const AUTOMATIC_MAIL_QUEUE_ATTEMPT_LIMIT = 3;
export const LOCAL_HISTORY_RETENTION_DAYS_MIN = 30;
export const LOCAL_HISTORY_RETENTION_DAYS_MAX = 3_650;
export const LOCAL_HISTORY_RETENTION_DAYS_DEFAULT = 365;

export interface ServerSettings {
  host: string;
  port: number;
  security: MailSecurity;
  username: string;
}

interface AccountDraftBase {
  displayName: string;
  email: string;
  incoming: ServerSettings;
  outgoing: ServerSettings;
  authMode: AuthMode;
  secret: string;
}

export type AccountDraft =
  | (AccountDraftBase & { incomingProtocol?: "imap"; pop3?: never })
  | (AccountDraftBase & { incomingProtocol: "pop3"; pop3: Pop3AccountOptions });

export interface TlsCertificateInspectionRequest {
  endpoint: "incoming" | "outgoing";
  host: string;
  port: number;
  security: MailSecurity;
}

export type TlsCertificateAuthorizationIssue =
  | "hostname-mismatch"
  | "expired"
  | "not-yet-valid"
  | "revoked"
  | "untrusted-chain"
  | "invalid-signature"
  | "unknown";

export interface TlsCertificateChainSummary {
  position: number;
  certificateId: string;
  issuerId: string | null;
  validFrom: string | null;
  validTo: string | null;
  publicKeyAlgorithm: string;
  publicKeyBits?: number;
  selfSigned: boolean;
}

export interface TlsCertificateInspectionResult {
  outcome: "inspected" | "not-applicable";
  endpoint: "incoming" | "outgoing";
  transport: "implicit-tls" | "starttls" | "plain";
  inspectedAt: string;
  timeoutMs: number;
  authorized: boolean | null;
  hostnameMatch: boolean | null;
  authorizationIssue: TlsCertificateAuthorizationIssue | null;
  protocol: string | null;
  cipher: string | null;
  chain: TlsCertificateChainSummary[];
  chainComplete: boolean;
  chainTruncated: boolean;
}

export interface AccountDiscoveryResult {
  source: "dns-srv" | "provider-preset" | "conventional";
  displayName: string;
  email: string;
  incoming: ServerSettings;
  outgoing: ServerSettings;
  authModes: AuthMode[];
}

export interface AccountSummary {
  id: string;
  displayName: string;
  email: string;
  incoming: ServerSettings;
  outgoing: ServerSettings;
  authMode: AuthMode;
  kind: "imap" | "demo";
  createdAt: string;
  lastSyncAt?: string;
  syncError?: string;
  messageCryptography?: MessageCryptoProfile;
}

export interface FolderSummary {
  accountId: string;
  path: string;
  name: string;
  role: "inbox" | "sent" | "drafts" | "archive" | "junk" | "trash" | "other";
  unread: number;
  total: number;
  uidValidity?: string;
}

export type UnifiedFolderKind = "inbox" | "starred" | "unread";

export interface Address {
  name: string;
  address: string;
}

export interface AttachmentSummary {
  filename: string;
  contentType: string;
  size: number;
  risk: AttachmentRiskAssessment;
  contentId?: string;
}

export interface QuarantinedAttachmentSource {
  accountId: string;
  folderPath: string;
  uid: number;
  uidValidity: string;
  attachmentIndex: number;
  messageId?: string;
}

export interface QuarantinedAttachment {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  sha256: string;
  risk: AttachmentRiskAssessment & { level: "caution" | "dangerous" };
  quarantinedAt: string;
  source: QuarantinedAttachmentSource;
}

export type AttachmentSaveOutcome =
  | { status: "cancelled" }
  | { status: "saved"; path: string }
  | { status: "quarantined"; quarantine: QuarantinedAttachment };

export interface AttachmentBatchSaveOutcome {
  savedPaths: string[];
  quarantined: QuarantinedAttachment[];
  ordinarySaveCancelled: boolean;
}

export interface MessageSummary {
  id: string;
  accountId: string;
  folderPath: string;
  uid: number;
  uidValidity?: string;
  messageId?: string;
  inReplyTo?: string;
  references?: string[];
  from: Address[];
  to: Address[];
  cc: Address[];
  subject: string;
  date: string;
  preview: string;
  unread: boolean;
  starred: boolean;
  hasAttachments: boolean;
  size: number;
}

export interface RemoteContentSource {
  kind: "image";
  origin: string;
  hostname: string;
  protocol: "http:" | "https:";
}

export interface MessageDetail extends MessageSummary {
  text: string;
  html: string;
  remoteContentHtml: string;
  remoteContentSources: RemoteContentSource[];
  remoteContentAllowed: boolean;
  attachments: AttachmentSummary[];
  replyTo: Address[];
  cryptography: MessageCryptographyAssessment;
}

export interface CachedMailSearchQuery {
  mode: "plain" | "regex";
  pattern: string;
  flags: string;
  limit: number;
}

export type CachedMailSearchField = "subject" | "addresses" | "preview" | "body" | "account" | "folder" | "conversation";

export interface CachedMailSearchHit {
  message: MessageSummary;
  snippet: string;
  matchedFields: CachedMailSearchField[];
  account: { id: string; displayName: string; email: string };
  folder: { path: string; name: string; role: FolderSummary["role"] };
  conversation: { id: string; subject: string; messageCount: number };
}

export interface CachedMailSearchResult {
  hits: CachedMailSearchHit[];
  totalMatched: number;
  indexedDocumentCount: number;
  documentLimit: number;
  documentLimitReached: boolean;
  resultLimit: number;
}

export interface ComposeDraft {
  id?: string;
  accountId: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  text: string;
  inReplyTo?: string;
  references?: string[];
  attachments: string[];
}

export interface LocalDraftSummary {
  id: string;
  accountId: string;
  recipientCount: number;
  subject: string;
  preview: string;
  attachmentCount: number;
  savedAt?: string;
}

export interface MailQueueRetryState {
  attempts: number;
  automaticAttemptLimit: number;
  automaticRetryPaused: boolean;
  isQueueHead: boolean;
}

export interface PendingOperationSummary extends MailQueueRetryState {
  id: string;
  accountId: string;
  kind: "flags" | "move";
  folderPath: string;
  uid: number;
  uidValidity?: string;
  patch?: { unread?: boolean; starred?: boolean };
  destination?: string;
  createdAt: string;
  lastError: string;
  conflictReason?: string;
}

export interface OutboxSummary extends MailQueueRetryState {
  id: string;
  accountId: string;
  recipientCount: number;
  subject: string;
  preview: string;
  attachmentCount: number;
  createdAt: string;
  lastError: string;
}

export interface SendResult {
  messageId: string;
  accepted: string[];
  rejected: string[];
  queued: boolean;
}

export interface Preferences {
  language: LanguageMode;
  funnyEnglish: 1 | 2 | 3 | 4 | 5;
  funnyCantonese: 1 | 2 | 3 | 4 | 5;
  theme: ThemeMode;
  density: DensityMode;
  accent: string;
  fontFamily: string;
  fontScale: number;
  fontWeight: number;
  dimSumEnabled: boolean;
  narratorEnabled: boolean;
  narratorLanguage: LanguageMode;
  nativeNotificationsEnabled: boolean;
  historyRetentionDays: number;
  externalEditorPath?: string;
  selectedAccountId?: string;
  selectedFolderPath?: string;
}

export interface NotificationRecord {
  id: string;
  kind: "info" | "success" | "warning" | "error";
  title: string;
  body: string;
  createdAt: string;
  read: boolean;
  action?: { label: string; command: string };
}

export interface HistoryRecord {
  id: string;
  kind: "created" | "updated" | "deleted" | "restored" | "undone" | "imported" | "settings-changed" | "pruned";
  entityType: "account" | "message" | "draft" | "contact" | "calendar" | "task" | "settings" | "history";
  entityId: string;
  label: string;
  createdAt: string;
  snapshot: unknown;
}

export interface LocalRevision {
  hash: string;
  createdAt: string;
  subject: string;
  label: string;
  isLabeled: boolean;
}

export interface LocalRevisionDiffLine {
  kind: "added" | "removed" | "context" | "hunk" | "metadata";
  text: string;
}

export interface LocalRevisionDiff {
  revision: LocalRevision;
  parentHash?: string;
  lines: LocalRevisionDiffLine[];
  truncated: boolean;
}

export interface LocalHistoryPrunePreview {
  retentionDays: number;
  cutoffAt: string;
  headHash: string | null;
  totalRevisionCount: number;
  eligibleRevisions: LocalRevision[];
  protectedCurrentCount: number;
  protectedLabeledCount: number;
  protectedRecentCount: number;
  blockedNonAppOwnedCount: number;
  canPrune: boolean;
}

export interface LocalHistoryPruneRequest {
  retentionDays: number;
  cutoffAt: string;
  expectedHeadHash: string;
  expectedEligibleHashes: string[];
}

export interface LocalHistoryPruneResult {
  prunedRevisionCount: number;
  retainedRevisionCount: number;
  previousHeadHash: string;
  currentHeadHash: string;
  cutoffAt: string;
  semanticEventRecorded: boolean;
}

export interface LocalHistoryDeletionEvidence {
  generatedAt: string;
  policy: "active-history-pruning-only";
  gitVersion: string;
  activeRevisionCount: number;
  activeLabeledRevisionCount: number;
  reflogOnlyRevisionCount: number;
  mainReflogPresent: boolean;
  looseObjectCount: number;
  looseObjectSizeKiB: number;
  packedObjectCount: number;
  packCount: number;
  packSizeKiB: number;
  prunePackableObjectCount: number;
  garbageObjectCount: number;
  garbageSizeKiB: number;
  cryptographicErasureProvided: false;
  reflogExpiryPerformed: false;
  gitGarbageCollectionPerformed: false;
  backupCopiesAudited: false;
  storageMediaAudited: false;
}

export interface ReleaseIdentity {
  version: string;
  releaseDate: string;
  codeName: string;
  dishId: string;
  imageAsset: string;
  catalogCommit: string;
}

export interface BootstrapState {
  accounts: AccountSummary[];
  preferences: Preferences;
  notifications: NotificationRecord[];
  history: HistoryRecord[];
  quarantinedAttachments: QuarantinedAttachment[];
  isFirstRun: boolean;
  version: string;
  release: ReleaseIdentity;
  pendingOperationCount: number;
}

export interface SyncResult {
  folders: FolderSummary[];
  messages: MessageSummary[];
  syncedAt: string;
}

export interface ExternalLinkReviewRequest {
  requestId: string;
  normalizedUrl: string;
  hostname: string;
  risk: ExternalLinkRisk;
  reasons: ExternalLinkReason[];
  expiresAt: number;
}

export interface MaterialEmailApi {
  onMailto(callback: (url: string) => void): () => void;
  onExternalLinkReview(callback: (request: ExternalLinkReviewRequest) => void): () => void;
  confirmExternalLink(requestId: string): Promise<void>;
  cancelExternalLink(requestId: string): Promise<boolean>;
  bootstrap(): Promise<BootstrapState>;
  chooseAttachments(): Promise<string[]>;
  createDemoAccount(): Promise<AccountSummary>;
  discoverAccount(email: string): Promise<AccountDiscoveryResult[]>;
  getOAuthAuthorizationStatus(): Promise<OAuthAuthorizationSnapshot>;
  startOAuthAuthorization(provider: OAuthProviderId): Promise<OAuthAuthorizationSnapshot>;
  cancelOAuthAuthorization(): Promise<OAuthAuthorizationSnapshot>;
  getOAuthTokenVaultStatus(): Promise<OAuthTokenVaultSnapshot>;
  clearOAuthTokenVault(provider: OAuthProviderId): Promise<OAuthTokenVaultActionResult>;
  revokeOAuthTokenVault(provider: OAuthProviderId): Promise<OAuthTokenVaultActionResult>;
  inspectTlsCertificate(request: TlsCertificateInspectionRequest): Promise<TlsCertificateInspectionResult>;
  runPop3Foundation(options: Pop3AccountOptions): Promise<Pop3FoundationSnapshot>;
  addAccount(draft: AccountDraft): Promise<AccountSummary>;
  testAccount(draft: AccountDraft): Promise<{ incoming: true; outgoing: true }>;
  removeAccount(accountId: string): Promise<void>;
  syncAccount(accountId: string): Promise<SyncResult>;
  listFolders(accountId: string): Promise<FolderSummary[]>;
  listMessages(accountId: string, folderPath: string): Promise<MessageSummary[]>;
  listUnifiedMessages(folder: UnifiedFolderKind): Promise<MessageSummary[]>;
  searchCachedMail(query: CachedMailSearchQuery): Promise<CachedMailSearchResult>;
  getMessage(accountId: string, folderPath: string, uid: number): Promise<MessageDetail>;
  setRemoteContentAllowed(accountId: string, folderPath: string, uid: number, allowed: boolean): Promise<MessageDetail>;
  saveAttachment(accountId: string, folderPath: string, uid: number, index: number, review?: AttachmentSaveReview): Promise<AttachmentSaveOutcome>;
  saveAllAttachments(accountId: string, folderPath: string, uid: number, review?: AttachmentSaveReview): Promise<AttachmentBatchSaveOutcome>;
  releaseQuarantinedAttachment(id: string): Promise<string | null>;
  deleteQuarantinedAttachment(id: string): Promise<void>;
  setMessageFlags(accountId: string, folderPath: string, uid: number, patch: { unread?: boolean; starred?: boolean }): Promise<void>;
  moveMessage(accountId: string, folderPath: string, uid: number, destination: string): Promise<void>;
  sendMessage(draft: ComposeDraft): Promise<SendResult>;
  saveDraft(draft: ComposeDraft): Promise<ComposeDraft>;
  listDrafts(accountId: string): Promise<LocalDraftSummary[]>;
  getDraft(accountId: string, draftId: string): Promise<ComposeDraft>;
  deleteDraft(accountId: string, draftId: string): Promise<boolean>;
  listPendingOperations(accountId: string): Promise<PendingOperationSummary[]>;
  retryPendingOperation(accountId: string, operationId: string): Promise<void>;
  discardPendingOperation(accountId: string, operationId: string): Promise<void>;
  listOutbox(accountId: string): Promise<OutboxSummary[]>;
  cancelOutbox(accountId: string, outboxId: string): Promise<ComposeDraft>;
  retryOutbox(accountId: string, outboxId: string): Promise<SendResult>;
  savePreferences(patch: Partial<Preferences>): Promise<Preferences>;
  nativeNotification(kind: NotificationRecord["kind"]): Promise<boolean>;
  markNotificationRead(id: string, read: boolean): Promise<void>;
  clearNotifications(): Promise<void>;
  restoreHistory(id: string): Promise<HistoryRecord>;
  listLocalRevisions(): Promise<LocalRevision[]>;
  getLocalRevisionDiff(hash: string): Promise<LocalRevisionDiff>;
  labelLocalRevision(hash: string, label: string): Promise<LocalRevision>;
  previewLocalHistoryPrune(retentionDays: number): Promise<LocalHistoryPrunePreview>;
  pruneLocalHistory(request: LocalHistoryPruneRequest): Promise<LocalHistoryPruneResult>;
  inspectLocalHistoryDeletion(): Promise<LocalHistoryDeletionEvidence>;
  restoreLocalRevision(hash: string): Promise<BootstrapState>;
  listContacts(): Promise<Contact[]>;
  searchContacts(query: string): Promise<Contact[]>;
  createContact(input: CreateContactInput): Promise<Contact>;
  updateContact(uid: string, patch: ContactPatch): Promise<Contact>;
  deleteContact(uid: string): Promise<boolean>;
  restoreContact(uid: string, sourceTransactionId?: string): Promise<Contact>;
  importVCard(): Promise<VCardImportResult | null>;
  exportVCard(contactUids?: string[], mailingListUids?: string[]): Promise<string | null>;
  listMailingLists(): Promise<MailingList[]>;
  listMailingListMembers(uid: string): Promise<Contact[]>;
  createMailingList(input: CreateMailingListInput): Promise<MailingList>;
  updateMailingList(uid: string, patch: MailingListPatch): Promise<MailingList>;
  deleteMailingList(uid: string): Promise<boolean>;
  restoreMailingList(uid: string, sourceTransactionId?: string): Promise<MailingList>;
  listCalendarEvents(): Promise<CalendarEvent[]>;
  createCalendarEvent(input: CreateCalendarEventInput): Promise<CalendarEvent>;
  updateCalendarEvent(uid: string, patch: CalendarEventPatch): Promise<CalendarEvent>;
  deleteCalendarEvent(uid: string): Promise<boolean>;
  restoreCalendarEvent(uid: string, sourceTransactionId?: string): Promise<CalendarEvent>;
  listTasks(): Promise<Task[]>;
  createTask(input: CreateTaskInput): Promise<Task>;
  updateTask(uid: string, patch: TaskPatch): Promise<Task>;
  deleteTask(uid: string): Promise<boolean>;
  restoreTask(uid: string, sourceTransactionId?: string): Promise<Task>;
  listPimTransactions(filter?: TransactionFilter): Promise<PimTransaction[]>;
  exportData(kind: "history" | "settings" | "changelog", content: string, suggestedName: string): Promise<string | null>;
  detectEditors(): Promise<Array<{ id: string; name: string; path: string }>>;
  openExternalEditor(path?: string): Promise<void>;
  minimize(): Promise<void>;
  maximize(): Promise<boolean>;
  close(): Promise<void>;
}
