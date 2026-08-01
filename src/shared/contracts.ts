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

export type LanguageMode = "en" | "yue" | "bilingual";
export type ThemeMode = "light" | "dark" | "system";
export type DensityMode = "compact" | "comfortable" | "relaxed";
export type MailSecurity = "tls" | "starttls" | "plain";
export type AuthMode = "password" | "oauth2";

export interface ServerSettings {
  host: string;
  port: number;
  security: MailSecurity;
  username: string;
}

export interface AccountDraft {
  displayName: string;
  email: string;
  incoming: ServerSettings;
  outgoing: ServerSettings;
  authMode: AuthMode;
  secret: string;
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

export interface Address {
  name: string;
  address: string;
}

export interface AttachmentSummary {
  filename: string;
  contentType: string;
  size: number;
  contentId?: string;
}

export interface MessageSummary {
  id: string;
  accountId: string;
  folderPath: string;
  uid: number;
  uidValidity?: string;
  messageId?: string;
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

export interface MessageDetail extends MessageSummary {
  text: string;
  html: string;
  attachments: AttachmentSummary[];
  replyTo: Address[];
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

export interface OutboxSummary {
  id: string;
  accountId: string;
  recipientCount: number;
  subject: string;
  preview: string;
  attachmentCount: number;
  createdAt: string;
  attempts: number;
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
  kind: "created" | "updated" | "deleted" | "restored" | "undone" | "imported" | "settings-changed";
  entityType: "account" | "message" | "draft" | "contact" | "calendar" | "task" | "settings";
  entityId: string;
  label: string;
  createdAt: string;
  snapshot: unknown;
}

export interface LocalRevision {
  hash: string;
  createdAt: string;
  subject: string;
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

export interface MaterialEmailApi {
  onMailto(callback: (url: string) => void): () => void;
  bootstrap(): Promise<BootstrapState>;
  chooseAttachments(): Promise<string[]>;
  createDemoAccount(): Promise<AccountSummary>;
  discoverAccount(email: string): Promise<AccountDiscoveryResult[]>;
  addAccount(draft: AccountDraft): Promise<AccountSummary>;
  testAccount(draft: AccountDraft): Promise<{ incoming: true; outgoing: true }>;
  removeAccount(accountId: string): Promise<void>;
  syncAccount(accountId: string): Promise<SyncResult>;
  listFolders(accountId: string): Promise<FolderSummary[]>;
  listMessages(accountId: string, folderPath: string): Promise<MessageSummary[]>;
  getMessage(accountId: string, folderPath: string, uid: number): Promise<MessageDetail>;
  saveAttachment(accountId: string, folderPath: string, uid: number, index: number): Promise<string | null>;
  saveAllAttachments(accountId: string, folderPath: string, uid: number): Promise<string[]>;
  setMessageFlags(accountId: string, folderPath: string, uid: number, patch: { unread?: boolean; starred?: boolean }): Promise<void>;
  moveMessage(accountId: string, folderPath: string, uid: number, destination: string): Promise<void>;
  sendMessage(draft: ComposeDraft): Promise<SendResult>;
  saveDraft(draft: ComposeDraft): Promise<ComposeDraft>;
  listDrafts(accountId: string): Promise<LocalDraftSummary[]>;
  getDraft(accountId: string, draftId: string): Promise<ComposeDraft>;
  deleteDraft(accountId: string, draftId: string): Promise<boolean>;
  listOutbox(accountId: string): Promise<OutboxSummary[]>;
  cancelOutbox(accountId: string, outboxId: string): Promise<ComposeDraft>;
  retryOutbox(accountId: string, outboxId: string): Promise<SendResult>;
  savePreferences(patch: Partial<Preferences>): Promise<Preferences>;
  nativeNotification(kind: NotificationRecord["kind"]): Promise<boolean>;
  markNotificationRead(id: string, read: boolean): Promise<void>;
  clearNotifications(): Promise<void>;
  restoreHistory(id: string): Promise<HistoryRecord>;
  listLocalRevisions(): Promise<LocalRevision[]>;
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
