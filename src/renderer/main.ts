import type {
  AccountDraft,
  AccountDiscoveryResult,
  AccountSummary,
  AttachmentRiskReason,
  AttachmentSaveReview,
  AttachmentSummary,
  BootstrapState,
  CalendarEvent,
  CalendarEventPatch,
  ComposeDraft,
  Contact,
  ContactPatch,
  CreateCalendarEventInput,
  CreateContactInput,
  CreateMailingListInput,
  CreateTaskInput,
  ICalendarDuplicatePolicy,
  ICalendarExportRequest,
  FolderSummary,
  HistoryRecord,
  LocalRevision,
  LocalRevisionDiff,
  LocalHistoryPrunePreview,
  LocalHistoryPruneRequest,
  LocalHistoryDeletionEvidence,
  LocalDraftSummary,
  OutboxSummary,
  OAuthAuthorizationSnapshot,
  OAuthProviderId,
  OAuthTokenVaultSnapshot,
  PendingOperationSummary,
  PimProviderFoundationSnapshot,
  PimProviderProfileInput,
  Pop3AccountOptions,
  Pop3FoundationSnapshot,
  MailingList,
  MailingListPatch,
  MessageDetail,
  MessageSummary,
  NotificationRecord,
  PimTransaction,
  Preferences,
  QuarantinedAttachment,
  Task,
  TaskPatch,
  TransactionFilter,
  ExternalLinkReviewRequest,
  UnifiedFolderKind,
  CachedMailSearchHit,
  CachedMailSearchResult,
  TlsCertificateAuthorizationIssue,
  TlsCertificateInspectionResult,
} from "../shared/contracts";
import {
  AUTOMATIC_MAIL_QUEUE_ATTEMPT_LIMIT,
  LOCAL_HISTORY_RETENTION_DAYS_DEFAULT,
  LOCAL_HISTORY_RETENTION_DAYS_MAX,
  LOCAL_HISTORY_RETENTION_DAYS_MIN,
  PIM_INTERCHANGE_MAX_BYTES,
  POP3_MESSAGE_LIMIT_MAX,
  POP3_MESSAGE_LIMIT_MIN,
} from "../shared/contracts";
import { icon, type IconName } from "./lib/icons";
import { DEFAULT_APPEARANCE } from "./lib/appearance";
import {
  TAB_STYLE_KEYS,
  normalizeTabColor,
  parseTabPreferences,
  resetTabStyleProperty,
  resolveTabStyle,
  setTabStyleProperty,
  type TabPreferences,
  type TabStyleKey,
} from "./lib/tab-appearance";
import type { TabStyleOverrides } from "./lib/tab-appearance";
import { classifyRendererDelivery, shouldKeepComposerOpen } from "./lib/delivery";
import {
  CHANGELOG_DATE_INPUT_LIMIT,
  changelogCalendarWeeks,
  changelogDateRangeForPreset,
  changelogMarkdown,
  filterChangelogEntries,
  localIsoDate,
  persistChangelogDateInputs,
  readChangelogDateInputs,
  shiftChangelogMonth,
  validateDateRange,
  type ChangelogDatePreset,
  type ChangelogDateInputs,
  type ChangelogEntry,
} from "./lib/changelog";
import {
  createMatcher,
  evaluateSample,
  normalizeFlags,
  regexLimits,
  validatePattern,
  type MatchMode,
} from "./lib/regex";
import { deletionEvidenceDescription, diffLineDescription, filterHistoryRecords, filterLocalRevisions, retentionPreviewDescription } from "./lib/local-history";
import { filterPaletteCommands } from "./lib/command-search";
import { selectStableMessageId } from "../shared/unified-folders";
import { CACHED_CONVERSATION_MESSAGE_LIMIT, groupCachedConversations, type CachedConversation } from "../shared/conversations";
import {
  diagnoseMailConnection,
  type ConnectionDiagnostic,
  type MailConnectionSettings,
} from "../shared/connection-diagnostics";
import {
  MESSAGE_CRYPTO_CAPABILITIES,
  emptyMessageCryptoProfile,
  formatMessageCryptoFingerprint,
  parseMessageCryptoProfile,
  unsignedMessageCryptography,
  type MessageCryptoProtocol,
  type MessageCryptographyAssessment,
} from "../shared/message-cryptography";

type PageId = "mail" | "drafts" | "outbox" | "contacts" | "calendar" | "tasks" | "settings" | "changelog" | "history" | "notifications" | "tools";
type ToastKind = NotificationRecord["kind"];
type SetupContext = "first-run" | "settings";

interface TabDefinition {
  id: PageId;
  en: string;
  yue: string;
  icon: IconName;
  group: "workspace" | "records" | "system";
}

interface SearchModel {
  mode: MatchMode;
  pattern: string;
  flags: string;
  sample: string;
  builderOpen: boolean;
}

interface LocalToast {
  id: string;
  kind: ToastKind;
  title: string;
  body: string;
}

interface ComposerState {
  draft: ComposeDraft;
  showCopies: boolean;
  minimized: boolean;
  cleanBaseline: string;
}

type ComposerMode = "new" | "reply" | "forward";

interface MailtoComposition {
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
}

interface DimSumDish {
  id: string;
  name: { en: string; zhHant: string };
  file: string;
  sha256: string;
  catalogCommit: string;
}

interface ContextMenuState {
  tabId: PageId;
  x: number;
  y: number;
}

interface AppearanceEditorState {
  tabId: PageId;
  x: number;
  y: number;
}

type ConfirmationState =
  | { kind: "remove-account"; accountId: string; label: string }
  | { kind: "clear-oauth-token-vault"; provider: OAuthProviderId; label: string }
  | { kind: "revoke-oauth-token-vault"; provider: OAuthProviderId; label: string }
  | { kind: "clear-notifications" }
  | { kind: "restore-local"; hash: string; label: string }
  | { kind: "prune-local-history"; preview: LocalHistoryPrunePreview }
  | { kind: "discard-compose" }
  | { kind: "replace-compose"; mode: ComposerMode; mailto?: MailtoComposition }
  | { kind: "discard-pim-editor"; label: string }
  | { kind: "replace-pim-editor"; entityKind: PimEntityKind; uid: string | null; returnFocusKey: string | null }
  | { kind: "send-empty-subject" }
  | { kind: "discard-pending-operation"; accountId: string; operationId: string; label: string }
  | { kind: "delete-pim"; entityKind: PimEntityKind; uid: string; label: string }
  | { kind: "bulk-close-tabs"; tabIds: PageId[]; inverse: boolean }
  | { kind: "save-risky-attachments"; target: number | "all"; review: AttachmentSaveReview }
  | { kind: "release-quarantined-attachment"; item: QuarantinedAttachment }
  | { kind: "delete-quarantined-attachment"; item: QuarantinedAttachment }
  | { kind: "external-link"; request: ExternalLinkReviewRequest };

interface FiltersState {
  historyFrom: string;
  historyTo: string;
  historyActions: Set<HistoryRecord["kind"]>;
}

interface ChangelogCalendarState {
  open: boolean;
  visibleMonth: string;
  focusDate: string;
  selecting: "start" | "end";
}

type ContactsView = "people" | "lists" | "activity";
type PimEntityKind = PimTransaction["entityKind"];

type PimEditorState =
  | { kind: "contact"; uid: string | null }
  | { kind: "mailing-list"; uid: string | null }
  | { kind: "calendar-event"; uid: string | null }
  | { kind: "task"; uid: string | null };

interface PimFilterState {
  actions: Set<PimTransaction["action"]>;
  kinds: Set<PimEntityKind>;
  from: string;
  to: string;
}

interface RendererState {
  phase: "loading" | "ready" | "error";
  fatalError: string;
  bootstrap: BootstrapState | null;
  setupOpen: boolean;
  setupContext: SetupContext;
  activeTab: PageId;
  accountId: string | null;
  folderPath: string | null;
  unifiedFolder: UnifiedFolderKind | null;
  folders: FolderSummary[];
  messages: MessageSummary[];
  detail: MessageDetail | null;
  selectedMessageId: string | null;
  busy: Set<string>;
  searches: Record<string, SearchModel>;
  mailSearchResult: CachedMailSearchResult | null;
  mailSearchResultKey: string;
  mailSearchPending: boolean;
  mailSearchError: string;
  toasts: LocalToast[];
  compose: ComposerState | null;
  editors: Array<{ id: string; name: string; path: string }>;
  discoveries: AccountDiscoveryResult[];
  selectedDiscovery: AccountDiscoveryResult | null;
  setupEmail: string;
  oauthAuthorization: OAuthAuthorizationSnapshot;
  oauthProvider: OAuthProviderId;
  oauthTokenVault: OAuthTokenVaultSnapshot;
  localRevisions: LocalRevision[];
  localRevisionsLoaded: boolean;
  localRevisionsError: string;
  selectedLocalRevisionHash: string | null;
  localRevisionDiff: LocalRevisionDiff | null;
  localRevisionDiffError: string;
  localHistoryPrunePreview: LocalHistoryPrunePreview | null;
  localHistoryPruneError: string;
  localHistoryDeletionEvidence: LocalHistoryDeletionEvidence | null;
  localHistoryDeletionError: string;
  tabPreferences: TabPreferences<PageId>;
  tabManagerOpen: boolean;
  contextMenu: ContextMenuState | null;
  appearanceEditor: AppearanceEditorState | null;
  commandPaletteOpen: boolean;
  confirmation: ConfirmationState | null;
  filters: FiltersState;
  historyCalendar: ChangelogCalendarState;
  changelogDates: ChangelogDateInputs;
  changelogCalendar: ChangelogCalendarState;
  bulkInverse: boolean;
  bulkIncludePinned: boolean;
  selectedTabGroup: TabDefinition["group"];
  dimSumVisible: boolean;
  dimSumDish: DimSumDish | null;
  pendingMailto: string | null;
  contacts: Contact[];
  contactSearchResults: Contact[] | null;
  mailingLists: MailingList[];
  calendarEvents: CalendarEvent[];
  tasks: Task[];
  selectedCalendarEventUids: Set<string>;
  selectedTaskUids: Set<string>;
  icsDuplicatePolicy: ICalendarDuplicatePolicy;
  pimTransactions: PimTransaction[];
  pimHistoryResults: PimTransaction[] | null;
  pimLoaded: boolean;
  pimLoadError: string;
  contactsView: ContactsView;
  selectedMailingListUid: string | null;
  selectedMailingListMembers: Contact[];
  pimEditor: PimEditorState | null;
  pimDraftMemberUids: Set<string> | null;
  pimEditorBaseline: string | null;
  pimEditorDirty: boolean;
  pimEditorReturnFocusKey: string | null;
  pimEditorLastFocusKey: string | null;
  pimEditorLastFocusName: string | null;
  confirmationReturnFocusKey: string | null;
  pimFilters: PimFilterState;
  pimProviderProfile: PimProviderProfileInput;
  pimProviderSnapshot: PimProviderFoundationSnapshot | null;
  localDrafts: LocalDraftSummary[];
  pendingOperations: PendingOperationSummary[];
  outboxItems: OutboxSummary[];
}

const TAB_DEFINITIONS: readonly TabDefinition[] = [
  { id: "mail", en: "Mail", yue: "郵件", icon: "mail", group: "workspace" },
  { id: "drafts", en: "Drafts", yue: "草稿", icon: "archive", group: "workspace" },
  { id: "outbox", en: "Outbox", yue: "寄件匣", icon: "send", group: "workspace" },
  { id: "contacts", en: "Contacts", yue: "聯絡人", icon: "account", group: "workspace" },
  { id: "calendar", en: "Calendar", yue: "日曆", icon: "calendar", group: "workspace" },
  { id: "tasks", en: "Tasks", yue: "工作", icon: "check", group: "workspace" },
  { id: "settings", en: "Settings", yue: "設定", icon: "settings", group: "system" },
  { id: "changelog", en: "Changelog", yue: "更新記錄", icon: "info", group: "records" },
  { id: "history", en: "History", yue: "歷史記錄", icon: "history", group: "records" },
  { id: "notifications", en: "Notifications", yue: "通知", icon: "notifications", group: "system" },
  { id: "tools", en: "Tools", yue: "工具", icon: "tools", group: "system" },
] as const;

const ALL_TAB_IDS = TAB_DEFINITIONS.map(tab => tab.id);
const TAB_STORAGE_KEY = "material-email.renderer-tabs.v1";
const HISTORY_DATE_SESSION_KEY = "material-email.history-date-range.v1";

const DEFAULT_PREFERENCES: Preferences = {
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
  nativeNotificationsEnabled: false,
  historyRetentionDays: LOCAL_HISTORY_RETENTION_DAYS_DEFAULT,
};

const DEFAULT_OAUTH_AUTHORIZATION: OAuthAuthorizationSnapshot = {
  phase: "idle",
  provider: null,
  expiresAt: null,
  failure: null,
  providers: [
    { id: "google", name: "Google", configured: false },
    { id: "microsoft", name: "Microsoft", configured: false },
  ],
};

const DEFAULT_OAUTH_TOKEN_VAULT: OAuthTokenVaultSnapshot = {
  protection: "windows-safe-storage",
  available: false,
  failure: "encryption-unavailable",
  providers: [
    { id: "google", name: "Google", registered: false, state: "unavailable", recordCount: 0, generation: 0, expiresAt: null, canClear: false, canRevoke: false },
    { id: "microsoft", name: "Microsoft", registered: false, state: "unavailable", recordCount: 0, generation: 0, expiresAt: null, canClear: false, canRevoke: false },
  ],
};

const defaultTabs = (): TabPreferences<PageId> => ({
  order: [...ALL_TAB_IDS],
  pinned: ["mail"],
  closed: [],
  styles: {},
});

const readTabPreferences = (): TabPreferences<PageId> => {
  return parseTabPreferences(localStorage.getItem(TAB_STORAGE_KEY), ALL_TAB_IDS, defaultTabs());
};

const initialHistoryDates = readChangelogDateInputs(sessionStorage, HISTORY_DATE_SESSION_KEY);

const state: RendererState = {
  phase: "loading",
  fatalError: "",
  bootstrap: null,
  setupOpen: false,
  setupContext: "first-run",
  activeTab: "mail",
  accountId: null,
  folderPath: null,
  unifiedFolder: null,
  folders: [],
  messages: [],
  detail: null,
  selectedMessageId: null,
  busy: new Set(),
  searches: {},
  mailSearchResult: null,
  mailSearchResultKey: "",
  mailSearchPending: false,
  mailSearchError: "",
  toasts: [],
  compose: null,
  editors: [],
  discoveries: [],
  selectedDiscovery: null,
  setupEmail: "",
  oauthAuthorization: DEFAULT_OAUTH_AUTHORIZATION,
  oauthProvider: "google",
  oauthTokenVault: DEFAULT_OAUTH_TOKEN_VAULT,
  localRevisions: [],
  localRevisionsLoaded: false,
  localRevisionsError: "",
  selectedLocalRevisionHash: null,
  localRevisionDiff: null,
  localRevisionDiffError: "",
  localHistoryPrunePreview: null,
  localHistoryPruneError: "",
  localHistoryDeletionEvidence: null,
  localHistoryDeletionError: "",
  tabPreferences: readTabPreferences(),
  tabManagerOpen: false,
  contextMenu: null,
  appearanceEditor: null,
  commandPaletteOpen: false,
  confirmation: null,
  filters: { historyFrom: initialHistoryDates.from, historyTo: initialHistoryDates.to, historyActions: new Set() },
  historyCalendar: {
    open: false,
    visibleMonth: localIsoDate().slice(0, 7),
    focusDate: localIsoDate(),
    selecting: "start",
  },
  changelogDates: readChangelogDateInputs(sessionStorage),
  changelogCalendar: {
    open: false,
    visibleMonth: localIsoDate().slice(0, 7),
    focusDate: localIsoDate(),
    selecting: "start",
  },
  bulkInverse: false,
  bulkIncludePinned: false,
  selectedTabGroup: "workspace",
  dimSumVisible: false,
  dimSumDish: null,
  pendingMailto: null,
  contacts: [],
  contactSearchResults: null,
  mailingLists: [],
  calendarEvents: [],
  tasks: [],
  selectedCalendarEventUids: new Set(),
  selectedTaskUids: new Set(),
  icsDuplicatePolicy: "skip",
  pimTransactions: [],
  pimHistoryResults: null,
  pimLoaded: false,
  pimLoadError: "",
  contactsView: "people",
  selectedMailingListUid: null,
  selectedMailingListMembers: [],
  pimEditor: null,
  pimDraftMemberUids: null,
  pimEditorBaseline: null,
  pimEditorDirty: false,
  pimEditorReturnFocusKey: null,
  pimEditorLastFocusKey: null,
  pimEditorLastFocusName: null,
  confirmationReturnFocusKey: null,
  pimFilters: { actions: new Set(), kinds: new Set(), from: "", to: "" },
  pimProviderProfile: { kind: "caldav", endpointUrl: "", authMode: "none" },
  pimProviderSnapshot: null,
  localDrafts: [],
  pendingOperations: [],
  outboxItems: [],
};

const app = document.querySelector<HTMLDivElement>("#app");
const toastRegion = document.querySelector<HTMLElement>("#toast-region");
const assertiveStatus = document.querySelector<HTMLElement>("#assertive-status");
if (!app || !toastRegion || !assertiveStatus) throw new Error("The renderer mount points are missing.");

const api = window.materialEmail;
const toastTimers = new Map<string, number>();
let preferenceSaveInFlight = false;
let pendingPreferencePatch: Partial<Preferences> = {};
let narrationQueue: Array<{ text: string; language: "en" | "yue" }> = [];
let narratorSpeaking = false;
let draggedTab: PageId | null = null;
let disposeMailtoActivation: (() => void) | null = null;
let disposeExternalLinkReview: (() => void) | null = null;
let mailNavigationSequence = 0;
let accountRequestSequence = 0;
let folderRequestSequence = 0;
let syncRequestSequence = 0;
let messageRequestSequence = 0;
let readerDocumentRevision = 0;
let pimSaveSequence = 0;
let pimLoadPromise: Promise<void> | null = null;
let contactSearchTimer: number | null = null;
let contactSearchSequence = 0;
let mailSearchTimer: number | null = null;
let mailSearchSequence = 0;
let localRevisionDiffSequence = 0;
let pendingFocusKey: string | null = null;
let confirmationNeedsInitialFocus = false;
let tabContextNeedsInitialFocus = false;
let appearanceEditorNeedsInitialFocus = false;
let oauthStatusPollTimer: number | null = null;

const preferences = (): Preferences => state.bootstrap?.preferences ?? DEFAULT_PREFERENCES;

const escapeHtml = (value: string | number): string =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const BILINGUAL_START = "\uE000";
const BILINGUAL_MIDDLE = "\uE001";
const BILINGUAL_END = "\uE002";
const BILINGUAL_PATTERN = /\uE000([^\uE000-\uE002]*)\uE001([^\uE000-\uE002]*)\uE002/gu;

const selectBilingualText = (value: string, language: "en" | "yue"): string => {
  let next = value;
  while (next.includes(BILINGUAL_START)) {
    const replaced = next.replace(BILINGUAL_PATTERN, (_pair, english: string, cantonese: string) => language === "en" ? english : cantonese);
    if (replaced === next) break;
    next = replaced;
  }
  return next;
};

const bilingualText = (english: string, cantonese: string): string =>
  `${BILINGUAL_START}${selectBilingualText(english, "en")}${BILINGUAL_MIDDLE}${selectBilingualText(cantonese, "yue")}${BILINGUAL_END}`;

const visibleBilingualText = (value: string): string =>
  value.replace(BILINGUAL_PATTERN, (_pair, english: string, cantonese: string) => `${english} · ${cantonese}`);

const tx = (english: string, cantonese: string): string => {
  const mode = preferences().language;
  if (mode === "yue") return cantonese;
  if (mode === "bilingual") return bilingualText(english, cantonese);
  return english;
};

const tone = (english: readonly [string, string, string, string, string], cantonese: readonly [string, string, string, string, string]): string => {
  const prefs = preferences();
  const en = english[prefs.funnyEnglish - 1] ?? english[0];
  const yue = cantonese[prefs.funnyCantonese - 1] ?? cantonese[0];
  if (prefs.language === "yue") return yue;
  if (prefs.language === "bilingual") return bilingualText(en, yue);
  return en;
};

const applyBilingualSemantics = (root: ParentNode): void => {
  if (preferences().language !== "bilingual") return;
  for (const element of root.querySelectorAll<HTMLElement>("*")) {
    for (const attribute of [...element.attributes]) {
      if (!attribute.value.includes(BILINGUAL_START)) continue;
      const usePrimaryLanguage = attribute.name.startsWith("aria-") || attribute.name === "alt" || attribute.name === "title";
      element.setAttribute(
        attribute.name,
        usePrimaryLanguage ? selectBilingualText(attribute.value, "en") : visibleBilingualText(attribute.value),
      );
    }
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const localizedNodes: Text[] = [];
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (node instanceof Text && node.data.includes(BILINGUAL_START)) localizedNodes.push(node);
  }
  for (const node of localizedNodes) {
    const fragment = document.createDocumentFragment();
    const pattern = new RegExp(BILINGUAL_PATTERN.source, "gu");
    let cursor = 0;
    for (const match of node.data.matchAll(pattern)) {
      const index = match.index ?? 0;
      if (index > cursor) fragment.append(node.data.slice(cursor, index));
      const pair = document.createElement("span");
      pair.className = "localized-pair";
      const english = document.createElement("span");
      english.lang = "en";
      english.textContent = match[1] ?? "";
      const separator = document.createElement("span");
      separator.className = "localized-pair__separator";
      separator.setAttribute("aria-hidden", "true");
      separator.textContent = " · ";
      const cantonese = document.createElement("span");
      cantonese.lang = "zh-HK";
      cantonese.textContent = match[2] ?? "";
      pair.append(english, separator, cantonese);
      fragment.append(pair);
      cursor = index + match[0].length;
    }
    if (cursor < node.data.length) fragment.append(node.data.slice(cursor));
    node.replaceWith(fragment);
  }
};

const tabDefinition = (id: PageId): TabDefinition => TAB_DEFINITIONS.find(tab => tab.id === id) ?? TAB_DEFINITIONS[0]!;

const searchFor = (key: string): SearchModel => {
  const existing = state.searches[key];
  if (existing) return existing;
  const created: SearchModel = { mode: "plain", pattern: "", flags: "i", sample: "", builderOpen: false };
  state.searches[key] = created;
  return created;
};

const persistTabs = (): void => {
  localStorage.setItem(TAB_STORAGE_KEY, JSON.stringify(state.tabPreferences));
};

const safeColor = (value: string, fallback: string): string => CSS.supports("color", value) ? value : fallback;

const accentTextColor = (value: string): string => {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value);
  if (!match) return "#ffffff";
  const channels = match.slice(1).map(channel => Number.parseInt(channel ?? "00", 16) / 255).map(channel => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  const luminance = (channels[0] ?? 0) * 0.2126 + (channels[1] ?? 0) * 0.7152 + (channels[2] ?? 0) * 0.0722;
  return luminance > 0.45 ? "#17131d" : "#ffffff";
};

const applyPreferences = (): void => {
  const prefs = preferences();
  document.documentElement.dataset.theme = prefs.theme;
  document.documentElement.dataset.density = prefs.density;
  document.documentElement.lang = prefs.language === "yue" ? "zh-HK" : "en";
  document.documentElement.style.setProperty("--accent", safeColor(prefs.accent, "#6750A4"));
  document.documentElement.style.setProperty("--on-accent", accentTextColor(prefs.accent));
  document.documentElement.style.setProperty("--ui-font", `"${prefs.fontFamily.replaceAll('"', "")}", "Microsoft JhengHei UI", sans-serif`);
  document.documentElement.style.setProperty("--font-scale", String(Math.min(1.5, Math.max(0.8, prefs.fontScale))));
  document.documentElement.style.setProperty("--font-weight", String(Math.min(700, Math.max(300, prefs.fontWeight))));
};

const formatDate = (value: string, includeTime = true): string => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return value;
  const locale = preferences().language === "yue" ? "zh-HK" : "en-CA";
  return new Intl.DateTimeFormat(locale, includeTime
    ? { dateStyle: "medium", timeStyle: "short" }
    : { dateStyle: "medium" }).format(parsed);
};

const formatBytes = (bytes: number): string => {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
};

const displayAddress = (address: { name: string; address: string }): string => address.name || address.address;
const addressLine = (items: Array<{ name: string; address: string }>): string => items.map(displayAddress).join(", ");

const errorMessage = (error: unknown): string => {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(/^Error invoking remote method '[^']+': Error:\s*/i, "").trim() || "An unknown error occurred.";
};

const announce = (message: string): void => {
  const accessibleMessage = preferences().language === "bilingual" ? selectBilingualText(message, "en") : message;
  assertiveStatus.textContent = "";
  requestAnimationFrame(() => {
    assertiveStatus.textContent = accessibleMessage;
  });
};

const runNarrator = (): void => {
  if (narratorSpeaking || !preferences().narratorEnabled || narrationQueue.length === 0 || !("speechSynthesis" in window)) return;
  const next = narrationQueue.shift();
  if (!next) return;
  narratorSpeaking = true;
  const utterance = new SpeechSynthesisUtterance(next.text);
  utterance.lang = next.language === "yue" ? "zh-HK" : "en-CA";
  const voices = window.speechSynthesis.getVoices();
  const selected = voices.find(voice => voice.lang.toLowerCase() === utterance.lang.toLowerCase())
    ?? voices.find(voice => voice.lang.toLowerCase().startsWith(next.language === "yue" ? "zh-hk" : "en"));
  if (selected) utterance.voice = selected;
  const finish = (): void => {
    narratorSpeaking = false;
    runNarrator();
  };
  utterance.addEventListener("end", finish, { once: true });
  utterance.addEventListener("error", finish, { once: true });
  window.speechSynthesis.speak(utterance);
};

const narrate = (english: string, cantonese: string): void => {
  if (!preferences().narratorEnabled) return;
  const language = preferences().narratorLanguage;
  narrationQueue = [];
  if (language === "en" || language === "bilingual") narrationQueue.push({ text: english, language: "en" });
  if (language === "yue" || language === "bilingual") narrationQueue.push({ text: cantonese, language: "yue" });
  runNarrator();
};

const dismissToast = (id: string): void => {
  state.toasts = state.toasts.filter(toast => toast.id !== id);
  const timer = toastTimers.get(id);
  if (timer !== undefined) window.clearTimeout(timer);
  toastTimers.delete(id);
  renderToasts();
};

const pushToast = (kind: ToastKind, title: string, body: string, cantoneseTitle = title, cantoneseBody = body): void => {
  const item: LocalToast = { id: crypto.randomUUID(), kind, title: tx(title, cantoneseTitle), body: tx(body, cantoneseBody) };
  state.toasts = [...state.toasts.slice(-3), item];
  renderToasts();
  if (kind === "error") announce(`${item.title}. ${item.body}`);
  narrate(`${title}. ${body}`, `${cantoneseTitle}。${cantoneseBody}`);
  if (preferences().nativeNotificationsEnabled) void api.nativeNotification(kind).catch(() => undefined);
  if (kind === "info" || kind === "success") {
    const timer = window.setTimeout(() => dismissToast(item.id), kind === "success" ? 5_000 : 7_000);
    toastTimers.set(item.id, timer);
  }
};

const renderToasts = (): void => {
  toastRegion.innerHTML = state.toasts.map(toast => `
    <article class="toast toast--${toast.kind}" data-toast-id="${escapeHtml(toast.id)}" tabindex="0">
      <span class="toast__icon">${icon(toast.kind === "success" ? "check" : toast.kind === "warning" ? "warning" : toast.kind === "error" ? "error" : "info")}</span>
      <div class="toast__copy"><strong>${escapeHtml(toast.title)}</strong><p>${escapeHtml(toast.body)}</p></div>
      <button class="icon-button" type="button" data-dismiss-toast="${escapeHtml(toast.id)}" aria-label="${escapeHtml(tx("Dismiss notification", "關閉通知"))}">${icon("close")}</button>
    </article>`).join("");
  applyBilingualSemantics(toastRegion);
};

const activeAccount = (): AccountSummary | null => state.bootstrap?.accounts.find(account => account.id === state.accountId) ?? null;
const currentMailSearchKey = (): string => {
  const model = searchFor("mail");
  return JSON.stringify([model.mode, model.pattern, normalizeFlags(model.flags)]);
};
const mailSearchIsActive = (): boolean => {
  const model = searchFor("mail");
  return Boolean(model.pattern) && validatePattern(model).valid;
};
const currentMailSearchResult = (): CachedMailSearchResult | null =>
  mailSearchIsActive() && state.mailSearchResultKey === currentMailSearchKey() ? state.mailSearchResult : null;
const searchHitForMessage = (id: string): CachedMailSearchHit | null =>
  currentMailSearchResult()?.hits.find(hit => hit.message.id === id) ?? null;
const activeMessage = (): MessageSummary | null => mailSearchIsActive()
  ? searchHitForMessage(state.selectedMessageId ?? "")?.message ?? null
  : state.messages.find(message => message.id === state.selectedMessageId) ?? null;
const folderByRole = (role: FolderSummary["role"]): FolderSummary | null => state.folders.find(folder => folder.role === role) ?? null;
const unifiedFolderLabel = (folder: UnifiedFolderKind): string => folder === "inbox"
  ? tx("Unified Inbox", "統一收件匣")
  : folder === "starred"
    ? tx("Starred", "已加星號")
    : tx("Unread", "未讀");
const messageBelongsToCurrentView = (message: MessageSummary): boolean => mailSearchIsActive()
  ? Boolean(searchHitForMessage(message.id))
  : state.unifiedFolder
    ? state.messages.some(candidate => candidate.id === message.id)
    : state.accountId === message.accountId && state.folderPath === message.folderPath;
const isBusy = (key?: string): boolean => key ? state.busy.has(key) : state.busy.size > 0;

const withBusy = async (key: string, operation: () => Promise<void>): Promise<void> => {
  if (state.busy.has(key)) return;
  state.busy.add(key);
  render();
  try {
    await operation();
  } catch (error) {
    pushToast("error", "Action failed", errorMessage(error), "操作失敗", `出咗問題：${errorMessage(error)}`);
  } finally {
    state.busy.delete(key);
    render();
  }
};

const refreshMetadata = async (isCurrent: () => boolean = () => true): Promise<boolean> => {
  const fresh = await api.bootstrap();
  if (!isCurrent()) return false;
  state.bootstrap = fresh;
  applyPreferences();
  return true;
};

const pimTransactionFilter = (): TransactionFilter => {
  const filters = state.pimFilters;
  const from = filters.from ? new Date(`${filters.from}T00:00:00`).toISOString() : undefined;
  const to = filters.to ? new Date(`${filters.to}T23:59:59.999`).toISOString() : undefined;
  return {
    ...(filters.actions.size ? { actions: [...filters.actions] } : {}),
    ...(filters.kinds.size ? { entityKinds: [...filters.kinds] } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  };
};

const loadMailingListMembers = async (uid: string): Promise<void> => {
  state.selectedMailingListUid = uid;
  state.selectedMailingListMembers = [];
  await withBusy("mailing-list-members", async () => {
    state.selectedMailingListMembers = await api.listMailingListMembers(uid);
  });
};

const reloadPimHistory = async (): Promise<void> => {
  await withBusy("pim-history", async () => {
    state.pimHistoryResults = await api.listPimTransactions(pimTransactionFilter());
  });
};

const refreshPimData = async (): Promise<void> => {
  const [contacts, mailingLists, calendarEvents, tasks, transactions] = await Promise.all([
    api.listContacts(),
    api.listMailingLists(),
    api.listCalendarEvents(),
    api.listTasks(),
    api.listPimTransactions(),
  ]);
  state.contacts = contacts;
  state.mailingLists = mailingLists;
  state.calendarEvents = calendarEvents;
  state.tasks = tasks;
  state.selectedCalendarEventUids = new Set([...state.selectedCalendarEventUids].filter(uid => calendarEvents.some(event => event.uid === uid)));
  state.selectedTaskUids = new Set([...state.selectedTaskUids].filter(uid => tasks.some(task => task.uid === uid)));
  state.pimTransactions = transactions;
  state.pimLoaded = true;
  state.pimLoadError = "";
  state.contactSearchResults = null;
  if (state.selectedMailingListUid && mailingLists.some(list => list.uid === state.selectedMailingListUid)) {
    state.selectedMailingListMembers = await api.listMailingListMembers(state.selectedMailingListUid);
  } else {
    state.selectedMailingListUid = null;
    state.selectedMailingListMembers = [];
  }
  if (state.pimFilters.actions.size || state.pimFilters.kinds.size || state.pimFilters.from || state.pimFilters.to) {
    state.pimHistoryResults = await api.listPimTransactions(pimTransactionFilter());
  } else {
    state.pimHistoryResults = null;
  }
};

const ensurePimData = (force = false): Promise<void> => {
  if (state.pimLoaded && !force) return Promise.resolve();
  if (pimLoadPromise) return pimLoadPromise;
  pimLoadPromise = (async () => {
    state.busy.add("pim-load");
    state.pimLoadError = "";
    render();
    try {
      await refreshPimData();
    } catch (error) {
      state.pimLoaded = false;
      state.pimLoadError = errorMessage(error);
      pushToast("error", "Local records did not load", state.pimLoadError, "本機記錄載入唔到", state.pimLoadError);
    } finally {
      state.busy.delete("pim-load");
      render();
    }
  })().finally(() => {
    pimLoadPromise = null;
  });
  return pimLoadPromise;
};

const scheduleContactSearch = (): void => {
  if (contactSearchTimer !== null) window.clearTimeout(contactSearchTimer);
  const model = searchFor("contacts");
  const sequence = ++contactSearchSequence;
  if (!model.pattern || model.mode === "regex") {
    state.contactSearchResults = null;
    return;
  }
  state.contactSearchResults = null;
  contactSearchTimer = window.setTimeout(() => {
    void api.searchContacts(model.pattern).then(results => {
      if (sequence !== contactSearchSequence || searchFor("contacts").pattern !== model.pattern || searchFor("contacts").mode !== "plain") return;
      state.contactSearchResults = results;
      render();
    }).catch(error => {
      if (sequence === contactSearchSequence) pushToast("error", "Contact search failed", errorMessage(error), "聯絡人搜尋失敗", errorMessage(error));
    });
  }, 180);
};

const loadMessage = async (message: MessageSummary, navigationSequence = mailNavigationSequence): Promise<void> => {
  const requestSequence = ++messageRequestSequence;
  const ownsRequest = (): boolean => requestSequence === messageRequestSequence
    && navigationSequence === mailNavigationSequence
    && messageBelongsToCurrentView(message)
    && state.selectedMessageId === message.id;
  if (navigationSequence !== mailNavigationSequence || !messageBelongsToCurrentView(message)) return;
  state.selectedMessageId = message.id;
  state.detail = null;
  state.busy.add("message");
  render();
  try {
    const detail = await api.getMessage(message.accountId, message.folderPath, message.uid);
    if (!ownsRequest()) return;
    state.detail = detail;
    readerDocumentRevision += 1;
    render();
    await new Promise<void>(resolve => window.setTimeout(resolve, 700));
    const readerIsActive = ownsRequest()
      && state.activeTab === "mail"
      && document.visibilityState === "visible"
      && document.hasFocus();
    if (message.unread && readerIsActive) {
      try {
        await api.setMessageFlags(message.accountId, message.folderPath, message.uid, { unread: false });
        if (!ownsRequest()) return;
        message.unread = false;
        if (state.detail?.id === message.id) state.detail.unread = false;
      } catch (error) {
        if (ownsRequest()) pushToast("warning", "Message opened, read state unchanged", errorMessage(error), "郵件開咗，但未能改已讀", errorMessage(error));
      }
    }
  } catch (error) {
    if (!ownsRequest()) return;
    state.detail = null;
    pushToast("error", "Could not open message", errorMessage(error), "開唔到郵件", errorMessage(error));
  } finally {
    if (requestSequence === messageRequestSequence) {
      state.busy.delete("message");
      render();
    }
  }
};

interface MailNavigationOwner {
  navigationSequence: number;
  accountId: string;
}

const beginMailNavigation = (): number => ++mailNavigationSequence;

const loadUnifiedFolder = async (folder: UnifiedFolderKind, owner?: MailNavigationOwner): Promise<void> => {
  const accountId = owner?.accountId ?? state.accountId;
  if (!accountId) return;
  const navigationSequence = owner?.navigationSequence ?? beginMailNavigation();
  if (navigationSequence !== mailNavigationSequence || state.accountId !== accountId) return;
  const requestSequence = ++folderRequestSequence;
  const previousMessageId = state.selectedMessageId;
  const previousIndex = Math.max(0, state.messages.findIndex(message => message.id === previousMessageId));
  const previousDetail = state.detail;
  const ownsRequest = (): boolean => requestSequence === folderRequestSequence
    && navigationSequence === mailNavigationSequence
    && state.accountId === accountId
    && state.unifiedFolder === folder;
  state.unifiedFolder = folder;
  state.folderPath = null;
  state.messages = [];
  state.selectedMessageId = null;
  state.detail = null;
  state.busy.add("folder");
  render();
  try {
    const messages = await api.listUnifiedMessages(folder);
    if (!ownsRequest()) return;
    state.messages = messages;
    state.selectedMessageId = selectStableMessageId(messages, previousMessageId, previousIndex);
    const selected = activeMessage();
    if (selected && previousDetail?.id === selected.id) state.detail = previousDetail;
    else if (selected) await loadMessage(selected, navigationSequence);
  } catch (error) {
    if (ownsRequest()) pushToast("error", "Could not load unified folder", errorMessage(error), "載入唔到統一資料夾", errorMessage(error));
  } finally {
    if (requestSequence === folderRequestSequence) {
      state.busy.delete("folder");
      render();
    }
  }
};

const scheduleMailSearch = (delay = 160): void => {
  if (mailSearchTimer !== null) window.clearTimeout(mailSearchTimer);
  const model = searchFor("mail");
  const validation = validatePattern(model);
  const sequence = ++mailSearchSequence;
  state.mailSearchError = "";
  if (!model.pattern || !validation.valid) {
    state.mailSearchResult = null;
    state.mailSearchResultKey = "";
    state.mailSearchPending = false;
    return;
  }
  const key = currentMailSearchKey();
  state.mailSearchResult = null;
  state.mailSearchResultKey = "";
  state.mailSearchPending = true;
  mailSearchTimer = window.setTimeout(() => {
    void api.searchCachedMail({ mode: model.mode, pattern: model.pattern, flags: validation.normalizedFlags, limit: 100 }).then(result => {
      if (sequence !== mailSearchSequence || key !== currentMailSearchKey()) return;
      state.mailSearchResult = result;
      state.mailSearchResultKey = key;
      state.mailSearchPending = false;
      render();
    }).catch(error => {
      if (sequence !== mailSearchSequence || key !== currentMailSearchKey()) return;
      state.mailSearchResult = null;
      state.mailSearchResultKey = "";
      state.mailSearchPending = false;
      state.mailSearchError = errorMessage(error);
      pushToast("error", "Cached mail search failed", state.mailSearchError, "快取郵件搜尋失敗", state.mailSearchError);
      render();
    });
  }, delay);
};

const loadFolder = async (folderPath: string, persist = true, owner?: MailNavigationOwner): Promise<void> => {
  const accountId = owner?.accountId ?? state.accountId;
  if (!accountId) return;
  const navigationSequence = owner?.navigationSequence ?? beginMailNavigation();
  if (navigationSequence !== mailNavigationSequence || state.accountId !== accountId) return;
  const requestSequence = ++folderRequestSequence;
  const ownsRequest = (): boolean => requestSequence === folderRequestSequence
    && navigationSequence === mailNavigationSequence
    && state.accountId === accountId
    && state.unifiedFolder === null
    && state.folderPath === folderPath;
  state.unifiedFolder = null;
  state.folderPath = folderPath;
  state.selectedMessageId = null;
  state.detail = null;
  state.messages = [];
  state.busy.add("folder");
  render();
  try {
    const messages = await api.listMessages(accountId, folderPath);
    if (!ownsRequest()) return;
    state.messages = messages;
    const first = messages[0];
    if (first) await loadMessage(first, navigationSequence);
    if (!ownsRequest()) return;
    if (persist) {
      const saved = await api.savePreferences({ selectedAccountId: accountId, selectedFolderPath: folderPath });
      if (!ownsRequest()) return;
      if (state.bootstrap) state.bootstrap.preferences = saved;
    }
  } catch (error) {
    if (ownsRequest()) pushToast("error", "Could not load folder", errorMessage(error), "載入唔到資料夾", errorMessage(error));
  } finally {
    if (requestSequence === folderRequestSequence) {
      state.busy.delete("folder");
      render();
    }
  }
};

const loadAccount = async (accountId: string, synchronizeWhenEmpty = false): Promise<void> => {
  const requestSequence = ++accountRequestSequence;
  const navigationSequence = beginMailNavigation();
  const ownsRequest = (): boolean => requestSequence === accountRequestSequence
    && navigationSequence === mailNavigationSequence
    && state.accountId === accountId;
  state.accountId = accountId;
  state.unifiedFolder = null;
  state.folders = [];
  state.messages = [];
  state.folderPath = null;
  state.detail = null;
  state.selectedMessageId = null;
  state.busy.add("account");
  render();
  try {
    let folders = await api.listFolders(accountId);
    if (!ownsRequest()) return;
    if (synchronizeWhenEmpty && folders.length === 0) {
      const result = await api.syncAccount(accountId);
      if (!ownsRequest()) return;
      folders = result.folders;
      if (!(await refreshMetadata(ownsRequest))) return;
    }
    if (!ownsRequest()) return;
    state.folders = folders;
    const preferredPath = preferences().selectedAccountId === accountId ? preferences().selectedFolderPath : undefined;
    const selected = folders.find(folder => folder.path === preferredPath)
      ?? folders.find(folder => folder.role === "inbox")
      ?? folders[0];
    if (selected) await loadFolder(selected.path, false, { navigationSequence, accountId });
    if (!ownsRequest()) return;
    const saved = await api.savePreferences({ selectedAccountId: accountId, ...(selected ? { selectedFolderPath: selected.path } : {}) });
    if (!ownsRequest()) return;
    if (state.bootstrap) state.bootstrap.preferences = saved;
    await refreshDraftAndOutbox();
  } catch (error) {
    if (ownsRequest()) pushToast("error", "Could not open account", errorMessage(error), "開唔到帳戶", errorMessage(error));
  } finally {
    if (requestSequence === accountRequestSequence) {
      state.busy.delete("account");
      render();
    }
  }
};

const initialize = async (): Promise<void> => {
  state.phase = "loading";
  render();
  try {
    if (!api || typeof api.bootstrap !== "function") throw new Error("The secure desktop bridge is unavailable. Restart the packaged application.");
    const bootstrap = await api.bootstrap();
    state.oauthAuthorization = await api.getOAuthAuthorizationStatus().catch(() => DEFAULT_OAUTH_AUTHORIZATION);
    state.oauthTokenVault = await api.getOAuthTokenVaultStatus().catch(() => DEFAULT_OAUTH_TOKEN_VAULT);
    state.bootstrap = bootstrap;
    applyPreferences();
    state.setupOpen = bootstrap.isFirstRun || bootstrap.accounts.length === 0;
    state.setupContext = "first-run";
    state.phase = "ready";
    const preferred = bootstrap.accounts.find(account => account.id === bootstrap.preferences.selectedAccountId) ?? bootstrap.accounts[0];
    render();
    void maybeShowDimSum(bootstrap);
    if (preferred) {
      await loadAccount(preferred.id, false);
      await refreshDraftAndOutbox();
    }
  } catch (error) {
    state.phase = "error";
    state.fatalError = errorMessage(error);
    render();
  }
};

const syncCurrentAccount = async (): Promise<void> => {
  const account = activeAccount();
  if (!account || isBusy("sync")) return;
  const accountId = account.id;
  const unifiedFolder = state.unifiedFolder;
  const requestSequence = ++syncRequestSequence;
  const navigationSequence = beginMailNavigation();
  const ownsRequest = (): boolean => requestSequence === syncRequestSequence
    && navigationSequence === mailNavigationSequence
    && state.accountId === accountId;
  await withBusy("sync", async () => {
    let result: Awaited<ReturnType<typeof api.syncAccount>>;
    try {
      result = await api.syncAccount(accountId);
    } catch (error) {
      if (!ownsRequest()) return;
      throw error;
    }
    if (!ownsRequest()) return;
    state.folders = result.folders;
    if (unifiedFolder) await loadUnifiedFolder(unifiedFolder, { navigationSequence, accountId });
    else {
      const selected = state.folders.find(folder => folder.path === state.folderPath)
        ?? state.folders.find(folder => folder.role === "inbox")
        ?? state.folders[0];
      if (selected) await loadFolder(selected.path, false, { navigationSequence, accountId });
    }
    if (!ownsRequest()) return;
    if (!(await refreshMetadata(ownsRequest))) return;
    await refreshDraftAndOutbox();
    if (!ownsRequest()) return;
    if (mailSearchIsActive()) scheduleMailSearch(0);
    pushToast(
      "success",
      "Mail synchronized",
      `The server finished at ${formatDate(result.syncedAt)}.`,
      "郵件同步完成",
      `伺服器喺 ${formatDate(result.syncedAt)} 完成，今次真係有回覆。`,
    );
  });
};

const toggleSelectedFlag = async (field: "unread" | "starred"): Promise<void> => {
  const message = activeMessage();
  if (!message) return;
  const next = !message[field];
  await withBusy(`flag-${field}`, async () => {
    await api.setMessageFlags(message.accountId, message.folderPath, message.uid, { [field]: next });
    message[field] = next;
    const cachedViewMessage = state.messages.find(item => item.id === message.id);
    if (cachedViewMessage) cachedViewMessage[field] = next;
    if (state.detail) state.detail[field] = next;
    await refreshMetadata();
    const unifiedFolder = state.unifiedFolder;
    if ((field === "starred" && unifiedFolder === "starred") || (field === "unread" && unifiedFolder === "unread")) {
      await loadUnifiedFolder(unifiedFolder);
    }
    pushToast("success", "Message updated", field === "starred" ? (next ? "Star added." : "Star removed.") : (next ? "Marked unread." : "Marked read."), "郵件已更新", field === "starred" ? (next ? "粒星加咗。" : "粒星拎走咗。") : (next ? "標做未讀。" : "標做已讀。"));
  });
};

const moveSelectedMessage = async (destination: FolderSummary): Promise<void> => {
  const message = activeMessage();
  if (!message || destination.path === message.folderPath) return;
  if (state.unifiedFolder || mailSearchIsActive()) {
    pushToast("warning", "Open the account folder before moving", "Unified folders do not guess destination folders across accounts.", "移動之前先開帳戶資料夾", "統一資料夾唔會跨帳戶估目的地。");
    return;
  }
  await withBusy("move", async () => {
    await api.moveMessage(message.accountId, message.folderPath, message.uid, destination.path);
    state.messages = state.messages.filter(item => item.id !== message.id);
    state.selectedMessageId = null;
    state.detail = null;
    await refreshMetadata();
    pushToast("success", "Message moved", `Moved to ${destination.name}.`, "郵件搬好", `已經搬去 ${destination.name}，冇搬錯屋。`);
    const next = state.messages[0];
    if (next) await loadMessage(next);
  });
};

const prefixedSubject = (prefix: "Re" | "Fwd", subject: string): string =>
  new RegExp(`^${prefix}:`, "i").test(subject) ? subject : `${prefix}: ${subject}`;

const composeFingerprint = (draft: ComposeDraft): string => JSON.stringify({
  id: draft.id ?? null,
  accountId: draft.accountId,
  to: draft.to,
  cc: draft.cc,
  bcc: draft.bcc,
  subject: draft.subject,
  text: draft.text,
  inReplyTo: draft.inReplyTo ?? null,
  references: draft.references ?? [],
  attachments: draft.attachments,
});

const beginComposer = (mode: ComposerMode = "new", mailto?: MailtoComposition): void => {
  const detail = state.detail;
  const sourceAccountId = mode === "new" ? state.accountId : detail?.accountId;
  const account = state.bootstrap?.accounts.find(candidate => candidate.id === sourceAccountId) ?? null;
  if (!account) {
    pushToast("warning", "No sending account", "Add or select an account before composing.", "未有寄件帳戶", "寫信之前要先加或者揀一個帳戶。 ");
    return;
  }
  const base: ComposeDraft = {
    accountId: account.id,
    to: [],
    cc: [],
    bcc: [],
    subject: "",
    text: "",
    attachments: [],
  };
  const cleanBaseline = composeFingerprint(base);
  if (mode === "reply" && detail) {
    const recipients = detail.replyTo.length > 0 ? detail.replyTo : detail.from;
    base.to = recipients.map(item => item.address);
    base.subject = prefixedSubject("Re", detail.subject);
    base.text = `\n\n— ${displayAddress(detail.from[0] ?? { name: "", address: "Sender" })} wrote on ${formatDate(detail.date)} —\n${detail.text.replace(/^/gm, "> ")}`;
    if (detail.messageId) {
      base.inReplyTo = detail.messageId;
      base.references = [detail.messageId];
    }
  }
  if (mode === "forward" && detail) {
    base.subject = prefixedSubject("Fwd", detail.subject);
    base.text = `\n\n—— Forwarded message ——\nFrom: ${addressLine(detail.from)}\nDate: ${formatDate(detail.date)}\nSubject: ${detail.subject}\nTo: ${addressLine(detail.to)}\n\n${detail.text}`;
  }
  if (mailto) {
    base.to = mailto.to;
    base.cc = mailto.cc;
    base.bcc = mailto.bcc;
    base.subject = mailto.subject;
    base.text = mailto.body;
  }
  state.compose = { draft: base, showCopies: Boolean(mailto && (mailto.cc.length || mailto.bcc.length)), minimized: false, cleanBaseline };
  render();
  requestAnimationFrame(() => document.querySelector<HTMLInputElement>("#compose-to")?.focus());
};

const openComposer = (mode: ComposerMode = "new", mailto?: MailtoComposition): void => {
  captureComposer();
  if (composerIsDirty()) {
    showConfirmation({ kind: "replace-compose", mode, ...(mailto ? { mailto } : {}) });
    return;
  }
  beginComposer(mode, mailto);
};

function decorateStableFocusKeys(): void {
  for (const button of app!.querySelectorAll<HTMLElement>("[data-action='open-pim-editor'], [data-action='edit-pim'], [data-action='request-delete-pim']")) {
    const action = button.dataset.action ?? "pim";
    const kind = button.dataset.pimKind ?? "record";
    const uid = button.dataset.pimUid ?? "new";
    button.dataset.focusKey = `${action}-${kind}-${uid}`;
  }
  const editor = app!.querySelector<HTMLElement>("[data-testid='pim-editor']");
  if (editor) {
    const kind = state.pimEditor?.kind ?? "record";
    for (const [index, control] of [...editor.querySelectorAll<HTMLElement>("[name], [data-action='close-pim-editor']")].entries()) {
      const name = control.getAttribute("name") ?? control.dataset.action ?? "control";
      control.dataset.focusKey = `pim-editor-${kind}-${name}-${index}`;
    }
  }
}

function focusByKey(key: string | null): void {
  if (!key) return;
  const target = document.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(key)}"]`);
  target?.focus({ preventScroll: true });
}

const readerDocumentSelector = "iframe[data-reader-document]";
const stableReaderDocumentAttributes = ["srcdoc", "sandbox", "referrerpolicy"] as const;

const pathFromRoot = (root: Node, leaf: Element): Element[] | null => {
  const path: Element[] = [];
  let current: Node | null = leaf;
  while (current !== root) {
    if (!(current instanceof Element)) return null;
    path.push(current);
    current = current.parentNode;
  }
  return path.reverse();
};

const synchronizeAttributes = (current: Element, next: Element, preserveSourceDocument = false): void => {
  for (const attribute of [...current.attributes]) {
    if (preserveSourceDocument && stableReaderDocumentAttributes.includes(attribute.name as typeof stableReaderDocumentAttributes[number])) continue;
    if (!next.hasAttribute(attribute.name)) current.removeAttribute(attribute.name);
  }
  for (const attribute of [...next.attributes]) {
    if (preserveSourceDocument && stableReaderDocumentAttributes.includes(attribute.name as typeof stableReaderDocumentAttributes[number])) continue;
    if (current.getAttribute(attribute.name) !== attribute.value) current.setAttribute(attribute.name, attribute.value);
  }
};

const readerDocumentsMatch = (current: HTMLIFrameElement, next: HTMLIFrameElement): boolean =>
  stableReaderDocumentAttributes.every(attribute => current.getAttribute(attribute) === next.getAttribute(attribute));

const replaceSiblingsAroundPath = (
  currentParent: Node,
  nextParent: Node,
  currentPath: readonly Element[],
  nextPath: readonly Element[],
  depth = 0,
): boolean => {
  const currentChild = currentPath[depth];
  const nextChild = nextPath[depth];
  if (!currentChild || !nextChild || currentChild.tagName !== nextChild.tagName) return false;

  const nextChildren = [...nextParent.childNodes];
  const nextChildIndex = nextChildren.indexOf(nextChild);
  if (nextChildIndex < 0 || currentChild.parentNode !== currentParent) return false;

  for (const child of [...currentParent.childNodes]) if (child !== currentChild) child.remove();

  const before = document.createDocumentFragment();
  for (const child of nextChildren.slice(0, nextChildIndex)) before.append(child.cloneNode(true));
  currentParent.insertBefore(before, currentChild);

  const after = document.createDocumentFragment();
  for (const child of nextChildren.slice(nextChildIndex + 1)) after.append(child.cloneNode(true));
  currentParent.insertBefore(after, currentChild.nextSibling);

  const isReaderFrame = depth === currentPath.length - 1;
  synchronizeAttributes(currentChild, nextChild, isReaderFrame);
  if (isReaderFrame) return depth === nextPath.length - 1;
  return replaceSiblingsAroundPath(currentChild, nextChild, currentPath, nextPath, depth + 1);
};

const replaceApplicationMarkup = (markup: string): void => {
  const currentReader = app.querySelector<HTMLIFrameElement>(readerDocumentSelector);
  const currentDocument = currentReader?.dataset.readerDocument;
  if (!currentReader || !currentDocument) {
    app.innerHTML = markup;
    return;
  }

  const template = document.createElement("template");
  template.innerHTML = markup;
  const nextReader = template.content.querySelector<HTMLIFrameElement>(readerDocumentSelector);
  if (!nextReader || nextReader.dataset.readerDocument !== currentDocument || !readerDocumentsMatch(currentReader, nextReader)) {
    app.innerHTML = markup;
    return;
  }

  const currentPath = pathFromRoot(app, currentReader);
  const nextPath = pathFromRoot(template.content, nextReader);
  if (!currentPath || !nextPath || currentPath.length !== nextPath.length
    || !replaceSiblingsAroundPath(app, template.content, currentPath, nextPath)) {
    app.innerHTML = markup;
  }
};

const render = (): void => {
  const focused = document.activeElement instanceof HTMLElement ? document.activeElement.dataset.focusKey : undefined;
  const selection = document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement
    ? { start: document.activeElement.selectionStart, end: document.activeElement.selectionEnd }
    : null;
  const pimDraftKey = state.pimEditor ? `${state.pimEditor.kind}:${state.pimEditor.uid ?? "new"}` : null;
  const pimDraftValues = pimDraftKey
    ? [...app.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('[data-testid="pim-editor"] [name]')]
      .filter(control => !(control instanceof HTMLInputElement) || !["button", "checkbox", "file", "radio", "submit"].includes(control.type))
      .map(control => ({ name: control.name, value: control.value }))
    : [];
  applyPreferences();
  app.setAttribute("aria-busy", state.phase === "loading" || isBusy() ? "true" : "false");
  if (state.phase === "loading") app.innerHTML = renderLoading();
  else if (state.phase === "error") app.innerHTML = renderFatalError();
  else replaceApplicationMarkup(renderApplication());
  decorateStableFocusKeys();
  applyBilingualSemantics(app);
  const accountSetupForm = app.querySelector<HTMLFormElement>('[data-form="account-setup"]');
  if (accountSetupForm) syncIncomingProtocolMode(accountSetupForm, false);
  for (const [selector, testId] of [
    [".settings-grid", "settings-controls"],
    ['[data-form="compose"]', "compose-form"],
    ['[data-compose-submit="send"]', "compose-send"],
    ['[data-compose-submit="draft"]', "compose-save-draft"],
    [".about-card", "about-surface"],
    [".dim-sum-surprise", "dim-sum-card"],
  ] as const) app.querySelector<HTMLElement>(selector)?.setAttribute("data-testid", testId);
  const nextPimDraftKey = state.pimEditor ? `${state.pimEditor.kind}:${state.pimEditor.uid ?? "new"}` : null;
  if (pimDraftKey && pimDraftKey === nextPimDraftKey) {
    const form = app.querySelector<HTMLFormElement>('[data-testid="pim-editor"] form');
    for (const draft of pimDraftValues) {
      const control = form?.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`[name="${CSS.escape(draft.name)}"]`);
      if (control) control.value = draft.value;
    }
  }
  const confirmationLayer = app.querySelector<HTMLElement>(".confirmation-layer");
  if (confirmationLayer) {
    const shell = app.querySelector<HTMLElement>(".app-shell");
    for (const child of shell ? [...shell.children] : []) {
      if (child !== confirmationLayer && child instanceof HTMLElement) child.inert = true;
    }
  }
  if (focused && !state.confirmation && !pendingFocusKey) {
    const next = document.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(focused)}"]`);
    next?.focus({ preventScroll: true });
    const supportsTextSelection = next instanceof HTMLTextAreaElement
      || (next instanceof HTMLInputElement && ["email", "password", "search", "tel", "text", "url"].includes(next.type));
    if (selection && supportsTextSelection) {
      next.setSelectionRange(selection.start, selection.end);
    }
  }
  if (state.confirmation && confirmationNeedsInitialFocus) {
    confirmationNeedsInitialFocus = false;
    requestAnimationFrame(() => app.querySelector<HTMLElement>("[data-confirmation-initial]")?.focus());
  } else if (tabContextNeedsInitialFocus) {
    tabContextNeedsInitialFocus = false;
    requestAnimationFrame(() => app.querySelector<HTMLElement>(".context-menu [role='menuitem']")?.focus());
  } else if (appearanceEditorNeedsInitialFocus) {
    appearanceEditorNeedsInitialFocus = false;
    requestAnimationFrame(() => app.querySelector<HTMLElement>(".appearance-editor [data-tab-style]")?.focus());
  } else if (!state.confirmation && pendingFocusKey) {
    const key = pendingFocusKey;
    pendingFocusKey = null;
    requestAnimationFrame(() => focusByKey(key));
  }
};

function renderLoading(): string {
  return `<main class="launch-screen" id="main-content" tabindex="-1">
    <div class="brand-mark" aria-hidden="true">M</div>
    <h1>${escapeHtml(tx("Material Email", "Material 郵件"))}</h1>
    <p>${escapeHtml(tx("Opening your local workspace…", "正在開啟你嘅本機工作空間……"))}</p>
    <div class="indeterminate-progress" role="progressbar" aria-label="${escapeHtml(tx("Opening Material Email", "正在開啟 Material 郵件"))}"></div>
  </main>`;
}

function renderFatalError(): string {
  return `<main class="fatal-screen" id="main-content" tabindex="-1">
    <div class="fatal-card">
      <span class="hero-icon hero-icon--error">${icon("error")}</span>
      <p class="eyebrow">${escapeHtml(tx("DESKTOP BRIDGE", "桌面連接"))}</p>
      <h1>${escapeHtml(tx("Material Email could not start", "Material 郵件啟動唔到"))}</h1>
      <p>${escapeHtml(state.fatalError)}</p>
      <button class="button button--filled" type="button" data-action="retry-bootstrap">${icon("refresh")}<span>${escapeHtml(tx("Try again", "再試一次"))}</span></button>
    </div>
  </main>`;
}

function renderApplication(): string {
  const unread = state.messages.filter(message => message.unread).length;
  return `<div class="app-shell" data-testid="app-shell">
    <header class="titlebar">
      <div class="titlebar__identity">
        <div class="brand-mark brand-mark--small" aria-hidden="true">M</div>
        <div><strong>Material Email</strong><span>${escapeHtml(activeAccount()?.email ?? tx("Local workspace", "本機工作空間"))}</span></div>
      </div>
      <div class="titlebar__search">${renderSearchField("mail", tx("Search sender, subject, or preview", "搜尋寄件人、主旨或者預覽"), true)}</div>
      <div class="titlebar__actions">
        ${(state.bootstrap?.pendingOperationCount ?? 0) > 0 ? `<button class="pending-indicator" type="button" data-action="sync" aria-label="${escapeHtml(tx(`${state.bootstrap?.pendingOperationCount ?? 0} pending mail operations`, `${state.bootstrap?.pendingOperationCount ?? 0} 個待處理郵件操作`))}" data-tooltip="${escapeHtml(tx("Pending operations—synchronize to retry", "有待處理操作——同步以重試"))}">${icon("refresh")}<span>${state.bootstrap?.pendingOperationCount ?? 0}</span></button>` : ""}
        <button class="icon-button" type="button" data-action="open-command-palette" aria-label="${escapeHtml(tx("Open command palette", "開啟指令面板"))}" data-tooltip="${escapeHtml(tx("Command palette (Ctrl+K)", "指令面板 (Ctrl+K)"))}">${icon("search")}</button>
        <button class="icon-button" type="button" data-action="open-notifications" aria-label="${escapeHtml(tx("Open notifications", "開啟通知"))}" data-tooltip="${escapeHtml(tx("Notifications", "通知"))}">${icon("notifications")}${unread ? `<span class="status-dot" aria-label="${unread} ${escapeHtml(tx("unread messages", "封未讀郵件"))}"></span>` : ""}</button>
      </div>
    </header>
    <nav class="spaces-rail" aria-label="${escapeHtml(tx("App spaces", "應用程式空間"))}">
      ${renderSpaceButton("mail")}
      ${renderSpaceButton("contacts")}
      ${renderSpaceButton("calendar")}
      ${renderSpaceButton("tasks")}
      ${renderSpaceButton("notifications")}
      ${renderSpaceButton("history")}
      ${renderSpaceButton("changelog")}
      <span class="spaces-rail__spacer"></span>
      ${renderSpaceButton("tools")}
      ${renderSpaceButton("settings")}
    </nav>
    <div class="workspace">
      ${renderTabStrip()}
      <main class="page" id="main-content" tabindex="-1">
        ${renderActivePage()}
      </main>
    </div>
    ${state.setupOpen ? renderAccountSetup() : ""}
    ${state.compose ? renderComposer() : ""}
    ${state.pimEditor ? renderPimEditor() : ""}
    ${state.commandPaletteOpen ? renderCommandPalette() : ""}
    ${state.confirmation ? renderConfirmation() : ""}
    ${state.contextMenu ? renderTabContextMenu() : ""}
    ${state.appearanceEditor ? renderTabAppearanceEditor() : ""}
    ${state.dimSumVisible ? renderDimSumSurprise() : ""}
  </div>`;
}

function renderSpaceButton(id: PageId): string {
  const tab = tabDefinition(id);
  const selected = state.activeTab === id;
  const notificationCount = id === "notifications" ? state.bootstrap?.notifications.filter(item => !item.read).length ?? 0 : 0;
  return `<button class="space-button${selected ? " is-active" : ""}" type="button" data-action="activate-tab" data-tab-id="${id}" aria-current="${selected ? "page" : "false"}" aria-label="${escapeHtml(tx(tab.en, tab.yue))}" data-tooltip="${escapeHtml(tx(tab.en, tab.yue))}">
    ${icon(tab.icon)}${notificationCount ? `<span class="space-badge">${notificationCount > 99 ? "99+" : notificationCount}</span>` : ""}
  </button>`;
}

function visibleTabIds(): PageId[] {
  return state.tabPreferences.order.filter(id => !state.tabPreferences.closed.includes(id));
}

function renderTabStrip(): string {
  const visible = visibleTabIds();
  if (!visible.includes(state.activeTab)) state.activeTab = visible[0] ?? "mail";
  const pinned = visible.filter(id => state.tabPreferences.pinned.includes(id));
  const ordinary = visible.filter(id => !state.tabPreferences.pinned.includes(id));
  return `<div class="tabbar-shell">
    <div class="workspace-tabs" role="tablist" data-testid="tab-strip" aria-label="${escapeHtml(tx("Workspace tabs", "工作空間分頁"))}">
      ${pinned.map(id => renderWorkspaceTab(id, true)).join("")}
      ${pinned.length && ordinary.length ? '<span class="tab-divider" aria-hidden="true"></span>' : ""}
      ${ordinary.map(id => renderWorkspaceTab(id, false)).join("")}
      ${visible.length === 0 ? `<div class="empty-tabs">${escapeHtml(tx("No open tabs", "冇開啟嘅分頁"))}</div>` : ""}
    </div>
    <div class="tabbar-anchor">
      <button class="icon-button tab-overflow-button${state.tabManagerOpen ? " is-active" : ""}" type="button" data-action="toggle-tab-manager" aria-expanded="${state.tabManagerOpen}" aria-haspopup="dialog" aria-label="${escapeHtml(tx("Search and manage tabs", "搜尋同管理分頁"))}">${icon("chevron")}</button>
      ${state.tabManagerOpen ? renderTabManager() : ""}
    </div>
  </div>`;
}

function tabStyleAttribute(id: PageId): string {
  const style = state.tabPreferences.styles[id];
  if (!style) return "";
  const declarations: string[] = [];
  if (style.background !== undefined) declarations.push(`--tab-custom-bg:${safeColor(style.background, "transparent")}`);
  if (style.foreground !== undefined) declarations.push(`--tab-custom-fg:${safeColor(style.foreground, "currentColor")}`);
  if (style.fontSize !== undefined) declarations.push(`--tab-custom-size:${style.fontSize}px`);
  if (style.fontWeight !== undefined) declarations.push(`--tab-custom-weight:${style.fontWeight}`);
  if (style.radius !== undefined) declarations.push(`--tab-custom-radius:${style.radius}px`);
  return declarations.length ? ` style="${escapeHtml(declarations.join(";"))}"` : "";
}

function renderWorkspaceTab(id: PageId, pinned: boolean): string {
  const tab = tabDefinition(id);
  const selected = state.activeTab === id;
  return `<div class="workspace-tab${selected ? " is-active" : ""}${pinned ? " is-pinned" : ""}" draggable="true" data-drag-tab="${id}" data-tab-context="${id}"${tabStyleAttribute(id)}>
    <button class="workspace-tab__main" type="button" role="tab" id="tab-${id}" aria-selected="${selected}" aria-controls="panel-${id}" aria-keyshortcuts="Control+Shift+E" tabindex="${selected ? "0" : "-1"}" data-action="activate-tab" data-tab-id="${id}" data-focus-key="${tabFocusKey(id)}">
      ${icon(tab.icon)}<span>${escapeHtml(tx(tab.en, tab.yue))}</span>${pinned ? `<span class="visually-hidden">${escapeHtml(tx("Pinned", "已釘選"))}</span>` : ""}
    </button>
    ${pinned ? `<span class="tab-pin" aria-hidden="true">${icon("pin")}</span>` : `<button class="tab-close" type="button" data-action="close-tab" data-tab-id="${id}" aria-label="${escapeHtml(tx(`Close ${tab.en}`, `關閉${tab.yue}`))}">${icon("close")}</button>`}
  </div>`;
}

function renderSearchField(key: string, placeholder: string, compact = false): string {
  const model = searchFor(key);
  const validation = validatePattern(model);
  const invalid = model.mode === "regex" && model.pattern.length > 0 && !validation.valid;
  return `<div class="search-anchor${compact ? " search-anchor--compact" : ""}" data-search-anchor="${escapeHtml(key)}">
    <div class="search-field${invalid ? " has-error" : ""}">
      ${icon("search")}
      <input type="search" value="${escapeHtml(model.pattern)}" placeholder="${escapeHtml(placeholder)}" aria-label="${escapeHtml(placeholder)}" aria-invalid="${invalid}" ${invalid ? `aria-describedby="search-error-${escapeHtml(key)}"` : ""} data-search-key="${escapeHtml(key)}" data-focus-key="search-${escapeHtml(key)}" maxlength="${regexLimits.pattern}" autocomplete="off" spellcheck="false" />
      ${model.pattern ? `<button class="icon-button icon-button--small" type="button" data-action="clear-search" data-search-key="${escapeHtml(key)}" aria-label="${escapeHtml(tx("Clear search", "清除搜尋"))}">${icon("close")}</button>` : ""}
      <button class="regex-mode-button${model.mode === "regex" ? " is-regex" : ""}" type="button" data-action="toggle-regex-builder" data-search-key="${escapeHtml(key)}" aria-expanded="${model.builderOpen}" aria-label="${escapeHtml(tx("Open regular expression builder", "開啟正規表達式建立器"))}">${icon("regex")}<span>${model.mode === "regex" ? "Regex" : tx("Build", "建立")}</span></button>
    </div>
    ${invalid ? `<p class="field-error" id="search-error-${escapeHtml(key)}">${escapeHtml(validation.message)}</p>` : ""}
    ${model.builderOpen ? renderRegexBuilder(key) : ""}
  </div>`;
}

function renderRegexBuilder(key: string): string {
  const model = searchFor(key);
  const validation = validatePattern(model);
  const matches = model.pattern && validation.valid ? evaluateSample(model, model.sample) : [];
  return `<section class="anchored-popover regex-builder" data-testid="regex-popover" data-search-owner="${escapeHtml(key)}" role="dialog" aria-modal="false" aria-labelledby="regex-title-${escapeHtml(key)}">
    <header class="popover-header">
      <div><p class="eyebrow">${escapeHtml(tx("JAVASCRIPT REGEXP", "JAVASCRIPT 正規表達式"))}</p><h2 id="regex-title-${escapeHtml(key)}">${escapeHtml(tx("Regular expression builder", "正規表達式建立器"))}</h2></div>
      <button class="icon-button" type="button" data-action="close-regex-builder" data-search-key="${escapeHtml(key)}" aria-label="${escapeHtml(tx("Close regex builder", "關閉正規表達式建立器"))}">${icon("close")}</button>
    </header>
    <p class="supporting-copy">${escapeHtml(tx("This builder is attached only to this search field. Patterns and samples stay on this computer.", "呢個建立器只連住呢一個搜尋欄。模式同範例都留喺你部電腦。"))}</p>
    <div class="segmented-control" role="group" aria-label="${escapeHtml(tx("Match mode", "配對模式"))}">
      <button type="button" class="segment${model.mode === "plain" ? " is-selected" : ""}" data-action="set-regex-mode" data-search-key="${escapeHtml(key)}" data-mode="plain">${escapeHtml(tx("Plain text", "純文字"))}</button>
      <button type="button" class="segment${model.mode === "regex" ? " is-selected" : ""}" data-action="set-regex-mode" data-search-key="${escapeHtml(key)}" data-mode="regex">${escapeHtml(tx("Regular expression", "正規表達式"))}</button>
    </div>
    ${model.mode === "regex" ? `<div class="builder-guides" aria-label="${escapeHtml(tx("Pattern building blocks", "模式積木"))}">
      ${([
        ["literal", tx("Literal", "文字")],
        ["class", tx("Character class", "字元類別")],
        ["anchors", tx("Anchors", "錨點")],
        ["group", tx("Group", "群組")],
        ["alternation", tx("Alternation", "或者")],
        ["quantifier", tx("Quantifier", "數量詞")],
      ] as const).map(([guide, label]) => `<button type="button" class="assist-chip" data-action="insert-regex-guide" data-search-key="${escapeHtml(key)}" data-guide="${guide}">${escapeHtml(label)}</button>`).join("")}
    </div>` : ""}
    <label class="field field--textarea"><span>${escapeHtml(model.mode === "regex" ? tx("Pattern", "模式") : tx("Search text", "搜尋文字"))}</span><textarea data-regex-pattern="${escapeHtml(key)}" data-focus-key="regex-pattern-${escapeHtml(key)}" maxlength="${regexLimits.pattern}" rows="2" spellcheck="false">${escapeHtml(model.pattern)}</textarea></label>
    <fieldset class="flag-fieldset" ${model.mode === "plain" ? "disabled" : ""}><legend>${escapeHtml(tx("Flags", "旗標"))}</legend>
      ${([[
        "i", tx("Ignore case", "忽略大小寫")], ["m", tx("Multiline", "多行")], ["s", tx("Dot matches newline", "點號包括換行")], ["u", tx("Unicode", "Unicode")],
      ] as const).map(([flag, label]) => `<label class="check-row"><input type="checkbox" data-regex-flag="${escapeHtml(key)}" value="${flag}" ${model.flags.includes(flag) ? "checked" : ""}/><span>${escapeHtml(label)}</span></label>`).join("")}
    </fieldset>
    <label class="field field--textarea"><span>${escapeHtml(tx("Sample text", "範例文字"))}</span><textarea data-regex-sample="${escapeHtml(key)}" data-focus-key="regex-sample-${escapeHtml(key)}" maxlength="${regexLimits.sample}" rows="3">${escapeHtml(model.sample)}</textarea></label>
    <div class="validation-row ${validation.valid ? "is-valid" : "is-invalid"}">${icon(validation.valid ? "check" : "warning")}<span>${escapeHtml(validation.message)}</span></div>
    <section class="match-results" aria-live="polite"><h3>${escapeHtml(tx("Matches and capture groups", "配對同擷取群組"))} <span class="count-pill">${matches.length}</span></h3>
      ${matches.length ? `<ol>${matches.slice(0, 20).map(match => `<li><code>${escapeHtml(match.value || "(zero-width)")}</code><span>@ ${match.index}</span>${match.groups.length ? `<small>${escapeHtml(match.groups.map((group, index) => `$${index + 1}: ${group}`).join(" · "))}</small>` : ""}</li>`).join("")}</ol>${matches.length > 20 ? `<p>${escapeHtml(tx(`Showing 20 of ${matches.length} bounded matches.`, `顯示 ${matches.length} 個有界配對入面嘅 20 個。`))}</p>` : ""}` : `<p class="empty-inline">${escapeHtml(model.pattern ? tx("No matches in the sample.", "範例入面冇配對。") : tx("Enter a pattern to preview matches.", "輸入模式就可以預覽配對。"))}</p>`}
    </section>
    <footer class="popover-actions">
      <button class="button button--text" type="button" data-action="copy-regex" data-search-key="${escapeHtml(key)}">${icon("compose")}<span>${escapeHtml(tx("Copy", "複製"))}</span></button>
      <button class="button button--outlined" type="button" data-action="export-regex" data-search-key="${escapeHtml(key)}">${icon("download")}<span>${escapeHtml(tx("Export", "匯出"))}</span></button>
      <span class="action-spacer"></span>
      <button class="button button--filled" type="button" data-action="use-regex" data-search-key="${escapeHtml(key)}" ${!validation.valid ? "disabled" : ""}>${icon("check")}<span>${escapeHtml(tx("Use in search", "套用到搜尋"))}</span></button>
    </footer>
    <p class="engine-note">${escapeHtml(tx("Engine: JavaScript RegExp (ES2023). Evaluation is local and bounded; risky nested quantifiers are rejected.", "引擎：JavaScript RegExp (ES2023)。只喺本機有界運算；危險嘅巢狀數量詞會被拒絕。"))}</p>
  </section>`;
}

function renderActivePage(): string {
  switch (state.activeTab) {
    case "mail": return renderMailPage();
    case "drafts": return renderDraftsPage();
    case "outbox": return renderOutboxPage();
    case "contacts": return renderContactsPage();
    case "calendar": return renderCalendarPage();
    case "tasks": return renderTasksPage();
    case "settings": return renderSettingsPage();
    case "changelog": return renderChangelogPage();
    case "history": return renderHistoryPage();
    case "notifications": return renderNotificationsPage();
    case "tools": return renderToolsPage();
  }
}

const refreshDraftAndOutbox = async (): Promise<void> => {
  const account = activeAccount();
  if (!account) return;
  const [localDrafts, pendingOperations, outboxItems] = await Promise.all([
    api.listDrafts(account.id),
    api.listPendingOperations(account.id),
    api.listOutbox(account.id),
  ]);
  state.localDrafts = localDrafts;
  state.pendingOperations = pendingOperations;
  state.outboxItems = outboxItems;
  render();
};

function renderDraftsPage(): string {
  const account = activeAccount();
  if (!account) return renderNoAccount();
  return `<section class="standard-page" id="panel-drafts" role="tabpanel" aria-labelledby="tab-drafts">
    ${renderPageHeader("LOCAL DRAFTS", tx("Drafts", "草稿"), tx("Saved locally and ready to reopen, edit, or delete.", "儲存喺本機，可以重新開啟、編輯或者刪除。"), "archive")}
    <div class="page-tools"><button class="button button--filled" type="button" data-action="compose">${icon("compose")}<span>${escapeHtml(tx("New draft", "新草稿"))}</span></button><button class="button button--outlined" type="button" data-action="refresh-drafts">${icon("refresh")}<span>${escapeHtml(tx("Refresh", "重新整理"))}</span></button></div>
    <div class="record-list">${state.localDrafts.length ? state.localDrafts.map(draft => `<article class="history-card" data-testid="draft-card"><span class="history-card__icon">${icon("archive")}</span><div><div class="record-meta"><span class="kind-badge">${escapeHtml(tx("Draft", "草稿"))}</span><span>${draft.recipientCount} ${escapeHtml(tx("recipients", "個收件人"))}</span></div><h2>${escapeHtml(draft.subject || tx("(No subject)", "（冇主旨）"))}</h2><p>${escapeHtml(draft.preview || tx("Empty message", "空白郵件"))}</p></div><div class="button-row"><button class="button button--text" type="button" data-action="open-draft" data-draft-id="${escapeHtml(draft.id)}">${escapeHtml(tx("Open", "開啟"))}</button><button class="button button--text" type="button" data-action="delete-draft" data-draft-id="${escapeHtml(draft.id)}">${escapeHtml(tx("Delete", "刪除"))}</button></div></article>`).join("") : renderRecordEmpty("history")}</div>
  </section>`;
}

function renderOutboxPage(): string {
  const account = activeAccount();
  if (!account) return renderNoAccount();
  const queueBusy = isBusy("queue-operation");
  const pendingRows = state.pendingOperations.map(item => {
    const title = item.kind === "move"
      ? tx(`Move Inbox identity UID ${item.uid} to ${item.destination ?? "the selected folder"}`, `搬 Inbox 身份 UID ${item.uid} 去 ${item.destination ?? "所選資料夾"}`)
      : tx(`Update flags for UID ${item.uid} in ${item.folderPath}`, `更新 ${item.folderPath} 入面 UID ${item.uid} 嘅旗標`);
    const change = item.kind === "move"
      ? tx(`Destination: ${item.destination ?? "missing"}`, `目的地：${item.destination ?? "欠缺"}`)
      : [
          item.patch?.unread === undefined ? "" : tx(`Unread: ${item.patch.unread ? "yes" : "no"}`, `未讀：${item.patch.unread ? "係" : "唔係"}`),
          item.patch?.starred === undefined ? "" : tx(`Starred: ${item.patch.starred ? "yes" : "no"}`, `星號：${item.patch.starred ? "有" : "冇"}`),
        ].filter(Boolean).join(" · ");
    const retryDisabled = queueBusy || !item.isQueueHead || Boolean(item.conflictReason);
    return `<article class="history-card queue-card${item.conflictReason ? " queue-card--conflict" : ""}" data-testid="pending-operation-card">
      <span class="history-card__icon">${icon(item.kind === "move" ? "chevron" : "star")}</span>
      <div class="queue-card__body">
        <div class="record-meta"><span class="kind-badge">${escapeHtml(item.kind === "move" ? tx("Pending move", "待處理搬移") : tx("Pending flag change", "待處理旗標更改"))}</span><span>${escapeHtml(tx(`${item.attempts} failed attempts · automatic ceiling ${item.automaticAttemptLimit}`, `${item.attempts} 次失敗 · 自動上限 ${item.automaticAttemptLimit}`))}</span>${item.isQueueHead ? `<span class="queue-head-badge">${escapeHtml(tx("Queue head", "隊首先處理"))}</span>` : `<span>${escapeHtml(tx("Waiting behind an earlier item", "等緊前面項目"))}</span>`}</div>
        <h2>${escapeHtml(title)}</h2>
        <p>${escapeHtml(change)}</p>
        ${item.conflictReason ? `<p class="queue-status queue-status--conflict" role="status">${icon("warning")}<span><strong>${escapeHtml(tx("Conflict—retry refused", "衝突——已拒絕重試"))}</strong>${escapeHtml(item.conflictReason)}</span></p>` : item.automaticRetryPaused ? `<p class="queue-status queue-status--paused" role="status">${icon("warning")}<span><strong>${escapeHtml(tx("Automatic retries paused", "自動重試已暫停"))}</strong>${escapeHtml(tx("Use Retry once on the queue head or discard the queued change.", "喺隊首用「重試一次」，或者捨棄呢個排隊更改。"))}</span></p>` : ""}
        <p class="queue-error">${escapeHtml(item.lastError)}</p>
        <small>${escapeHtml(tx(`Queue ID ${item.id} · UIDVALIDITY ${item.uidValidity ?? "unavailable"}`, `隊列 ID ${item.id} · UIDVALIDITY ${item.uidValidity ?? "不可用"}`))}</small>
      </div>
      <div class="button-row"><button class="button button--text" type="button" data-action="retry-pending-operation" data-operation-id="${escapeHtml(item.id)}" ${retryDisabled ? "disabled" : ""}>${escapeHtml(tx("Retry once", "重試一次"))}</button><button class="button button--text button--danger" type="button" data-action="request-discard-pending-operation" data-operation-id="${escapeHtml(item.id)}" data-operation-label="${escapeHtml(title)}" ${queueBusy ? "disabled" : ""}>${escapeHtml(tx("Discard change", "捨棄更改"))}</button></div>
    </article>`;
  }).join("");
  const outboxRows = state.outboxItems.map(item => `<article class="history-card queue-card" data-testid="outbox-card"><span class="history-card__icon">${icon("send")}</span><div class="queue-card__body"><div class="record-meta"><span class="kind-badge">${escapeHtml(tx("Queued delivery", "排隊傳送"))}</span><span>${escapeHtml(tx(`${item.attempts} failed attempts · automatic ceiling ${item.automaticAttemptLimit}`, `${item.attempts} 次失敗 · 自動上限 ${item.automaticAttemptLimit}`))}</span>${item.isQueueHead ? `<span class="queue-head-badge">${escapeHtml(tx("Queue head", "隊首先處理"))}</span>` : `<span>${escapeHtml(tx("Waiting behind an earlier item", "等緊前面項目"))}</span>`}</div><h2>${escapeHtml(item.subject || tx("(No subject)", "（冇主旨）"))}</h2>${item.automaticRetryPaused ? `<p class="queue-status queue-status--paused" role="status">${icon("warning")}<span><strong>${escapeHtml(tx("Automatic retries paused", "自動重試已暫停"))}</strong>${escapeHtml(tx("Retry the queue head once or move this message back to drafts.", "重試隊首一次，或者將呢封郵件移返草稿。"))}</span></p>` : ""}<p class="queue-error">${escapeHtml(item.lastError || item.preview || tx("Waiting for delivery.", "等緊傳送。"))}</p><small>${escapeHtml(tx(`Queue ID ${item.id}`, `隊列 ID ${item.id}`))}</small></div><div class="button-row"><button class="button button--text" type="button" data-action="retry-outbox" data-outbox-id="${escapeHtml(item.id)}" ${queueBusy || !item.isQueueHead ? "disabled" : ""}>${escapeHtml(tx("Retry once", "重試一次"))}</button><button class="button button--text" type="button" data-action="cancel-outbox" data-outbox-id="${escapeHtml(item.id)}" ${queueBusy ? "disabled" : ""}>${escapeHtml(tx("Move to drafts", "移返草稿"))}</button></div></article>`).join("");
  return `<section class="standard-page" id="panel-outbox" role="tabpanel" aria-labelledby="tab-outbox">
    ${renderPageHeader("MAIL OPERATION QUEUE", tx("Outbox and pending changes", "寄件匣同待處理更改"), tx(`Automatic processing stops after ${AUTOMATIC_MAIL_QUEUE_ATTEMPT_LIMIT} failed attempts. Only the account queue head can be retried, and each manual action makes exactly one attempt.`, `自動處理失敗 ${AUTOMATIC_MAIL_QUEUE_ATTEMPT_LIMIT} 次就會停。只可以重試帳戶隊首，而且每次手動操作只試一次。`), "send")}
    <div class="page-tools"><button class="button button--outlined" type="button" data-action="refresh-outbox">${icon("refresh")}<span>${escapeHtml(tx("Refresh", "重新整理"))}</span></button></div>
    ${state.pendingOperations.length ? `<section class="queue-section" aria-labelledby="pending-change-title"><h2 id="pending-change-title">${escapeHtml(tx("Pending flag and move changes", "待處理旗標同搬移更改"))} <span class="count-pill">${state.pendingOperations.length}</span></h2><div class="record-list">${pendingRows}</div></section>` : ""}
    ${state.outboxItems.length ? `<section class="queue-section" aria-labelledby="queued-delivery-title"><h2 id="queued-delivery-title">${escapeHtml(tx("Queued deliveries", "排隊傳送"))} <span class="count-pill">${state.outboxItems.length}</span></h2><div class="record-list">${outboxRows}</div></section>` : ""}
    ${!state.pendingOperations.length && !state.outboxItems.length ? renderRecordEmpty("history") : ""}
  </section>`;
}

function messageAccountAttribution(message: MessageSummary): string {
  const searchHit = searchHitForMessage(message.id);
  if (searchHit) {
    const thread = searchHit.conversation.messageCount === 1
      ? tx("single-message conversation", "單封郵件對話")
      : tx(`${searchHit.conversation.messageCount}-message conversation`, `${searchHit.conversation.messageCount} 封郵件對話`);
    return `${searchHit.account.displayName} · ${searchHit.account.email} · ${searchHit.folder.name} · ${thread}`;
  }
  const account = state.bootstrap?.accounts.find(candidate => candidate.id === message.accountId);
  return account ? `${account.displayName} · ${account.email}` : message.accountId;
}

function filteredMessages(): MessageSummary[] {
  const model = searchFor("mail");
  if (!model.pattern) return state.messages;
  if (!validatePattern(model).valid) return [];
  return currentMailSearchResult()?.hits.map(hit => hit.message) ?? [];
}

function renderMailPage(): string {
  const account = activeAccount();
  if (!account) return renderNoAccount();
  const currentFolder = state.folders.find(folder => folder.path === state.folderPath);
  const messages = filteredMessages();
  const validation = validatePattern(searchFor("mail"));
  return `<section class="mail-workspace" id="panel-mail" role="tabpanel" aria-labelledby="tab-mail">
    <header class="mail-commandbar">
      <div class="account-switcher-wrap">
        <label class="visually-hidden" for="account-switcher">${escapeHtml(tx("Account", "帳戶"))}</label>
        <select class="account-switcher" id="account-switcher" data-action-change="switch-account" ${isBusy("account") ? "disabled" : ""}>
          ${(state.bootstrap?.accounts ?? []).map(candidate => `<option value="${escapeHtml(candidate.id)}" ${candidate.id === account.id ? "selected" : ""}>${escapeHtml(candidate.displayName)} · ${escapeHtml(candidate.email)}</option>`).join("")}
        </select>
      </div>
      <button class="button button--filled compose-button" type="button" data-action="compose">${icon("compose")}<span>${escapeHtml(tx("New message", "新增郵件"))}</span><kbd>Ctrl+N</kbd></button>
      <button class="button button--tonal" type="button" data-action="sync" ${isBusy("sync") ? "disabled" : ""}>${icon("refresh", isBusy("sync") ? "is-spinning" : "")}<span>${escapeHtml(isBusy("sync") ? tx("Syncing…", "同步緊……") : tx("Get messages", "收取郵件"))}</span></button>
      <span class="commandbar-spacer"></span>
      <p class="sync-status">${account.syncError ? `<span class="status-error">${icon("warning")}${escapeHtml(account.syncError)}</span>` : account.lastSyncAt ? escapeHtml(tx(`Last sync ${formatDate(account.lastSyncAt)}`, `上次同步 ${formatDate(account.lastSyncAt)}`)) : escapeHtml(account.kind === "demo" ? tx("Local demo workspace", "本機示範工作空間") : tx("Not synchronized yet", "仲未同步"))}</p>
    </header>
    <div class="mail-layout">
      ${renderFolderPane(currentFolder)}
      ${renderMessagePane(currentFolder, messages, !searchFor("mail").pattern || validation.valid)}
      ${renderReaderPane()}
    </div>
  </section>`;
}

function renderNoAccount(): string {
  return `<section class="empty-page" id="panel-mail" role="tabpanel" aria-labelledby="tab-mail">
    <span class="hero-icon">${icon("mail")}</span>
    <p class="eyebrow">${escapeHtml(tx("YOUR MAIL, YOUR COMPUTER", "你嘅郵件，你部電腦"))}</p>
    <h1>${escapeHtml(tx("Connect an account to begin", "連接帳戶先開始"))}</h1>
    <p>${escapeHtml(tone(
      ["Add an IMAP and SMTP account, or open the local demo.", "Add an IMAP and SMTP account, or explore the local demo.", "Connect the mail pipes, or take the demo for a tidy little spin.", "Connect the mail pipes, or let the demo deliver four emails without waking a server.", "Connect the mail pipes, or unleash the demo pigeons—strictly local pigeons, naturally."],
      ["加入 IMAP 同 SMTP 帳戶，或者開本機示範。", "加個 IMAP 同 SMTP 帳戶，或者睇吓本機示範。", "駁好郵件水喉，或者先玩本機示範。", "駁好郵件水喉，或者叫本機示範送四封信，唔使嘈醒伺服器。", "駁好郵件水喉，或者放本機示範白鴿出嚟送信——放心，隻鴿唔上網。"],
    ))}</p>
    <div class="button-row"><button class="button button--filled" type="button" data-action="open-account-setup">${icon("account")}<span>${escapeHtml(tx("Add account", "新增帳戶"))}</span></button><button class="button button--outlined" type="button" data-action="create-demo">${icon("mail")}<span>${escapeHtml(tx("Open local demo", "開啟本機示範"))}</span></button></div>
  </section>`;
}

function formatTemporal(value: CalendarEvent["start"] | Task["due"]): string {
  if (!value) return tx("No date", "冇日期");
  return value.kind === "date" ? value.value : formatDate(value.value);
}

function dateTimeLocalValue(value: CalendarEvent["start"] | undefined, fallback: Date): string {
  const date = value?.kind === "date-time" ? new Date(value.value) : fallback;
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function contactSearchText(contact: Contact): string {
  return [
    contact.displayName,
    contact.nickname ?? "",
    contact.name.given ?? "",
    contact.name.family ?? "",
    contact.organization ?? "",
    contact.title ?? "",
    contact.notes ?? "",
    ...contact.emails.map(email => email.value),
    ...contact.phones.map(phone => phone.value),
  ].join("\n");
}

function filteredContacts(): Contact[] {
  const model = searchFor("contacts");
  if (!model.pattern) return state.contacts;
  if (!validatePattern(model).valid) return [];
  if (model.mode === "plain" && state.contactSearchResults) return state.contactSearchResults;
  const matcher = createMatcher(model);
  return state.contacts.filter(contact => matcher(contactSearchText(contact)));
}

function filteredMailingLists(): MailingList[] {
  const model = searchFor("mailing-lists");
  if (!model.pattern) return state.mailingLists;
  if (!validatePattern(model).valid) return [];
  const matcher = createMatcher(model);
  return state.mailingLists.filter(list => matcher(`${list.name}\n${list.nickname ?? ""}\n${list.description ?? ""}\n${list.memberUids.join(" ")}`));
}

function filteredCalendarEvents(): CalendarEvent[] {
  const model = searchFor("calendar-events");
  if (!model.pattern) return state.calendarEvents;
  if (!validatePattern(model).valid) return [];
  const matcher = createMatcher(model);
  return state.calendarEvents.filter(event => matcher(`${event.title}\n${event.location ?? ""}\n${event.description ?? ""}\n${event.status}\n${event.categories.join(" ")}`));
}

function filteredTasks(): Task[] {
  const model = searchFor("tasks");
  if (!model.pattern) return state.tasks;
  if (!validatePattern(model).valid) return [];
  const matcher = createMatcher(model);
  return state.tasks.filter(task => matcher(`${task.title}\n${task.description ?? ""}\n${task.status}\n${task.priority}\n${task.categories.join(" ")}`));
}

function pimEntityPresent(kind: PimEntityKind, uid: string): boolean {
  if (kind === "contact") return state.contacts.some(contact => contact.uid === uid);
  if (kind === "mailing-list") return state.mailingLists.some(list => list.uid === uid);
  if (kind === "calendar-event") return state.calendarEvents.some(event => event.uid === uid);
  return state.tasks.some(task => task.uid === uid);
}

function pimTransactionLabel(transaction: PimTransaction): string {
  const snapshot = transaction.after ?? transaction.before;
  if (!snapshot) return transaction.entityUid;
  if (snapshot.entityKind === "contact") return snapshot.value.displayName;
  if (snapshot.entityKind === "mailing-list") return snapshot.value.name;
  return snapshot.value.title;
}

function latestDeletedPim(kinds: readonly PimEntityKind[]): PimTransaction[] {
  const latest = new Map<string, PimTransaction>();
  for (const transaction of state.pimTransactions) {
    if (transaction.action === "deleted" && kinds.includes(transaction.entityKind)) {
      latest.set(`${transaction.entityKind}\u0000${transaction.entityUid}`, transaction);
    }
  }
  return [...latest.values()]
    .filter(transaction => !pimEntityPresent(transaction.entityKind, transaction.entityUid))
    .sort((left, right) => right.sequence - left.sequence);
}

function renderPimUnavailable(pageId: PageId, title: string, iconName: IconName): string {
  if (state.pimLoadError) {
    return `<section class="standard-page pim-page" id="panel-${pageId}" role="tabpanel" aria-labelledby="tab-${pageId}">
      ${renderPageHeader("LOCAL ORGANIZER", title, tx("The local PIM store could not be opened. No network synchronization was attempted.", "本機 PIM 儲存庫開唔到。冇嘗試網絡同步。"), iconName)}
      <div class="empty-card" data-testid="pim-load-error" role="alert"><span class="hero-icon hero-icon--error">${icon("error")}</span><h2>${escapeHtml(tx("Local records unavailable", "本機記錄不可用"))}</h2><p>${escapeHtml(state.pimLoadError)}</p><button class="button button--filled" type="button" data-action="retry-pim-load">${icon("refresh")}<span>${escapeHtml(tx("Retry local records", "重試本機記錄"))}</span></button></div>
    </section>`;
  }
  return `<section class="standard-page pim-page" id="panel-${pageId}" role="tabpanel" aria-labelledby="tab-${pageId}">
    ${renderPageHeader("LOCAL ORGANIZER", title, tx("Opening the local PIM store. No network synchronization is implied.", "正在開啟本機 PIM 儲存庫。唔代表有網絡同步。"), iconName)}
    <div class="empty-card" aria-busy="true"><div class="circular-progress" role="progressbar" aria-label="${escapeHtml(tx("Loading local records", "載入本機記錄"))}"></div><h2>${escapeHtml(tx("Loading local records…", "正在載入本機記錄……"))}</h2></div>
  </section>`;
}

function renderContactsPage(): string {
  if (!state.pimLoaded) return renderPimUnavailable("contacts", tx("Contacts", "聯絡人"), "account");
  return `<section class="standard-page pim-page" data-testid="contacts-page" id="panel-contacts" role="tabpanel" aria-labelledby="tab-contacts">
    ${renderPageHeader("LOCAL ADDRESS BOOK", tx("Contacts", "聯絡人"), tx("Contacts and mailing lists live on this computer. This surface does not claim network sync or per-record encryption.", "聯絡人同郵件群組儲存喺呢部電腦。呢個介面唔會聲稱有網絡同步或者逐項加密。"), "account")}
    <div class="pim-subtabs" role="tablist" aria-label="${escapeHtml(tx("Contacts sections", "聯絡人部分"))}">
      ${renderContactsSubtab("people", tx("People", "聯絡人"), state.contacts.length)}
      ${renderContactsSubtab("lists", tx("Mailing lists", "郵件群組"), state.mailingLists.length)}
      ${renderContactsSubtab("activity", tx("Transaction history", "交易歷史"), state.pimTransactions.length)}
    </div>
    ${state.contactsView === "people" ? renderPeopleSurface() : state.contactsView === "lists" ? renderMailingListsSurface() : renderPimHistorySurface()}
  </section>`;
}

function renderContactsSubtab(view: ContactsView, label: string, count: number): string {
  const selected = state.contactsView === view;
  return `<button type="button" role="tab" id="pim-tab-${view}" aria-controls="pim-panel-${view}" aria-selected="${selected}" tabindex="${selected ? "0" : "-1"}" class="pim-subtab${selected ? " is-active" : ""}" data-action="set-contacts-view" data-contacts-view="${view}" data-focus-key="pim-subtab-${view}"><span>${escapeHtml(label)}</span><span class="count-pill">${count}</span></button>`;
}

function renderPeopleSurface(): string {
  const contacts = filteredContacts();
  return `<section class="pim-surface" id="pim-panel-people" role="tabpanel" data-testid="people-surface" aria-labelledby="pim-tab-people">
    <div class="page-tools pim-toolbar"><div class="page-search" data-testid="contacts-search">${renderSearchField("contacts", tx("Search name, email, phone, organization, or notes", "搜尋名稱、電郵、電話、機構或者備註"))}</div><button class="button button--outlined" type="button" data-action="import-vcard">${icon("download")}<span>${escapeHtml(tx("Import vCard", "匯入 vCard"))}</span></button><button class="button button--outlined" type="button" data-action="export-all-vcard" ${state.contacts.length + state.mailingLists.length === 0 ? "disabled" : ""}>${icon("download")}<span>${escapeHtml(tx("Export all", "全部匯出"))}</span></button><button class="button button--filled" data-testid="add-contact" type="button" data-action="open-pim-editor" data-pim-kind="contact">${icon("account")}<span>${escapeHtml(tx("New contact", "新增聯絡人"))}</span></button></div>
    <p class="local-truth-note">${icon("info")}<span>${escapeHtml(tx("Plain search uses the local contact index through the desktop bridge; regex search is bounded in this renderer.", "純文字搜尋會透過桌面連接使用本機聯絡人索引；正規表達式搜尋喺呢個介面有界運算。"))}</span></p>
    <div class="pim-card-grid" data-testid="contact-list">${contacts.length ? contacts.map(renderContactCard).join("") : renderPimEmpty(tx("No matching contacts", "冇符合嘅聯絡人"), tx("Create a contact or adjust this surface’s search.", "新增聯絡人，或者調整呢個介面嘅搜尋。"), "account")}</div>
    ${renderDeletedPimSection(["contact"], tx("Recently deleted contacts", "最近刪除嘅聯絡人"))}
  </section>`;
}

function renderContactCard(contact: Contact): string {
  const email = contact.emails.find(item => item.preferred) ?? contact.emails[0];
  const phone = contact.phones.find(item => item.preferred) ?? contact.phones[0];
  return `<article class="pim-card contact-card" data-testid="contact-card" data-pim-uid="${escapeHtml(contact.uid)}"><header><span class="avatar avatar--large" aria-hidden="true">${escapeHtml((contact.displayName.charAt(0) || "?").toUpperCase())}</span><div><h2>${escapeHtml(contact.displayName)}</h2><p>${escapeHtml([contact.title, contact.organization].filter(Boolean).join(" · ") || tx("Local contact", "本機聯絡人"))}</p></div><span class="revision-chip">r${contact.revision}</span></header><dl class="pim-details"><div><dt>${escapeHtml(tx("Email", "電郵"))}</dt><dd>${escapeHtml(email?.value ?? tx("Not provided", "未提供"))}</dd></div><div><dt>${escapeHtml(tx("Phone", "電話"))}</dt><dd>${escapeHtml(phone?.value ?? tx("Not provided", "未提供"))}</dd></div></dl>${contact.notes ? `<p class="pim-notes">${escapeHtml(contact.notes)}</p>` : ""}<footer><button class="button button--text" type="button" data-action="edit-pim" data-pim-kind="contact" data-pim-uid="${escapeHtml(contact.uid)}">${icon("edit")}<span>${escapeHtml(tx("Edit", "編輯"))}</span></button><button class="button button--text" type="button" data-action="export-contact-vcard" data-pim-uid="${escapeHtml(contact.uid)}">${icon("download")}<span>vCard</span></button><span class="action-spacer"></span><button class="icon-button danger-action" type="button" data-action="request-delete-pim" data-pim-kind="contact" data-pim-uid="${escapeHtml(contact.uid)}" data-pim-label="${escapeHtml(contact.displayName)}" aria-label="${escapeHtml(tx(`Delete ${contact.displayName}`, `刪除 ${contact.displayName}`))}">${icon("trash")}</button></footer></article>`;
}

function renderMailingListsSurface(): string {
  const lists = filteredMailingLists();
  return `<section class="pim-surface" id="pim-panel-lists" role="tabpanel" data-testid="mailing-lists-surface" aria-labelledby="pim-tab-lists">
    <div class="page-tools pim-toolbar"><div class="page-search" data-testid="mailing-list-search">${renderSearchField("mailing-lists", tx("Search list names, descriptions, or members", "搜尋群組名稱、描述或者成員"))}</div><button class="button button--outlined" type="button" data-action="import-vcard">${icon("download")}<span>${escapeHtml(tx("Import vCard", "匯入 vCard"))}</span></button><button class="button button--filled" data-testid="add-mailing-list" type="button" data-action="open-pim-editor" data-pim-kind="mailing-list">${icon("account")}<span>${escapeHtml(tx("New mailing list", "新增郵件群組"))}</span></button></div>
    <div class="pim-master-detail"><div class="pim-card-grid" data-testid="mailing-list-list">${lists.length ? lists.map(renderMailingListCard).join("") : renderPimEmpty(tx("No matching mailing lists", "冇符合嘅郵件群組"), tx("Create a list from existing contacts or adjust search.", "用現有聯絡人建立群組，或者調整搜尋。"), "account")}</div>${renderMailingListMembers()}</div>
    ${renderDeletedPimSection(["mailing-list"], tx("Recently deleted mailing lists", "最近刪除嘅郵件群組"))}
  </section>`;
}

function renderMailingListCard(list: MailingList): string {
  const selected = state.selectedMailingListUid === list.uid;
  const memberNames = list.memberUids.slice(0, 3).map(uid => state.contacts.find(contact => contact.uid === uid)?.displayName ?? uid);
  return `<article class="pim-card mailing-list-card${selected ? " is-selected" : ""}" data-testid="mailing-list-card" data-pim-uid="${escapeHtml(list.uid)}"><header><span class="pim-card__icon">${icon("account")}</span><div><h2>${escapeHtml(list.name)}</h2><p>${list.memberUids.length} ${escapeHtml(tx("members", "位成員"))}${list.nickname ? ` · ${escapeHtml(list.nickname)}` : ""}</p></div><span class="revision-chip">r${list.revision}</span></header>${list.description ? `<p class="pim-notes">${escapeHtml(list.description)}</p>` : ""}<p class="member-preview">${escapeHtml(memberNames.join(" · ") || tx("No members yet", "仲未有成員"))}${list.memberUids.length > 3 ? ` +${list.memberUids.length - 3}` : ""}</p><footer><button class="button button--tonal" type="button" data-action="view-mailing-list-members" data-pim-uid="${escapeHtml(list.uid)}">${escapeHtml(tx("View members", "查看成員"))}</button><button class="button button--text" type="button" data-action="edit-pim" data-pim-kind="mailing-list" data-pim-uid="${escapeHtml(list.uid)}">${icon("edit")}<span>${escapeHtml(tx("Edit", "編輯"))}</span></button><button class="button button--text" type="button" data-action="export-list-vcard" data-pim-uid="${escapeHtml(list.uid)}">${icon("download")}<span>vCard</span></button><span class="action-spacer"></span><button class="icon-button danger-action" type="button" data-action="request-delete-pim" data-pim-kind="mailing-list" data-pim-uid="${escapeHtml(list.uid)}" data-pim-label="${escapeHtml(list.name)}" aria-label="${escapeHtml(tx(`Delete ${list.name}`, `刪除 ${list.name}`))}">${icon("trash")}</button></footer></article>`;
}

function renderMailingListMembers(): string {
  const list = state.mailingLists.find(item => item.uid === state.selectedMailingListUid);
  if (!list) return `<aside class="pim-detail-pane" data-testid="mailing-list-members"><span class="hero-icon">${icon("account")}</span><h2>${escapeHtml(tx("Select a mailing list", "選擇一個郵件群組"))}</h2><p>${escapeHtml(tx("Member details come from the local PIM service.", "成員詳情來自本機 PIM 服務。"))}</p></aside>`;
  return `<aside class="pim-detail-pane" data-testid="mailing-list-members"><header><div><p class="eyebrow">${escapeHtml(tx("MEMBERS", "成員"))}</p><h2>${escapeHtml(list.name)}</h2></div><span class="count-pill">${state.selectedMailingListMembers.length}</span></header>${isBusy("mailing-list-members") ? `<div class="linear-progress" role="progressbar"></div>` : ""}<div class="member-list">${state.selectedMailingListMembers.length ? state.selectedMailingListMembers.map(contact => `<article><span class="avatar">${escapeHtml((contact.displayName.charAt(0) || "?").toUpperCase())}</span><div><strong>${escapeHtml(contact.displayName)}</strong><small>${escapeHtml(contact.emails[0]?.value ?? tx("No email", "冇電郵"))}</small></div></article>`).join("") : `<p>${escapeHtml(tx("This list has no current members.", "呢個群組目前冇成員。"))}</p>`}</div></aside>`;
}

function renderCalendarPage(): string {
  if (!state.pimLoaded) return renderPimUnavailable("calendar", tx("Calendar", "日曆"), "calendar");
  const events = [...filteredCalendarEvents()].sort((left, right) => Date.parse(left.start.value) - Date.parse(right.start.value));
  return `<section class="standard-page pim-page" data-testid="calendar-page" id="panel-calendar" role="tabpanel" aria-labelledby="tab-calendar">
    ${renderPageHeader("HOME · LOCAL", tx("Calendar", "日曆"), tx("Structured events are stored in the local Home calendar. Recurrence metadata is preserved but occurrences are not expanded here.", "結構化事件儲存喺本機 Home 日曆。重複 metadata 會保留，但呢度唔會展開每次出現。"), "calendar")}
    <div class="page-tools pim-toolbar"><div class="page-search" data-testid="calendar-search">${renderSearchField("calendar-events", tx("Search title, location, description, or status", "搜尋標題、地點、描述或者狀態"))}</div><label class="field ics-policy"><span>${escapeHtml(tx("Duplicate UIDs", "重複 UID"))}</span><select data-ics-duplicate-policy><option value="skip" ${state.icsDuplicatePolicy === "skip" ? "selected" : ""}>${escapeHtml(tx("Skip safely", "安全略過"))}</option><option value="update" ${state.icsDuplicatePolicy === "update" ? "selected" : ""}>${escapeHtml(tx("Update matching type", "更新同類記錄"))}</option></select></label><button class="button button--outlined" data-testid="import-calendar-ics" type="button" data-action="import-ics">${icon("download")}<span>${escapeHtml(tx("Import ICS", "匯入 ICS"))}</span></button><button class="button button--outlined" data-testid="export-selected-events-ics" type="button" data-action="export-selected-ics" data-ics-kind="calendar-event" ${state.selectedCalendarEventUids.size ? "" : "disabled"}>${icon("download")}<span>${escapeHtml(tx("Export selected", "匯出所選"))}</span></button><button class="button button--outlined" data-testid="export-all-events-ics" type="button" data-action="export-all-ics" data-ics-kind="calendar-event" ${state.calendarEvents.length ? "" : "disabled"}>${icon("download")}<span>${escapeHtml(tx("Export all", "全部匯出"))}</span></button><button class="button button--filled" data-testid="add-calendar-event" type="button" data-action="open-pim-editor" data-pim-kind="calendar-event">${icon("calendar")}<span>${escapeHtml(tx("New event", "新增事件"))}</span></button></div>
    <p class="local-truth-note" data-testid="calendar-ics-boundary">${icon("info")}<span>${escapeHtml(tx("ICS import is local-only, UTF-8, atomic, and bounded to 1 MiB / 5,000 records. Skip is the safe default; update changes only an active record with the same UID and type. Export uses normalized CRLF iCalendar 2.0 text.", "ICS 匯入只限本機、UTF-8、原子處理，同時限制為 1 MiB／5,000 筆記錄。安全預設係略過；更新只會改相同 UID 同類型嘅現有記錄。匯出使用標準化 CRLF iCalendar 2.0 文字。"))}</span></p>
    <div class="pim-card-grid calendar-grid" data-testid="calendar-event-list">${events.length ? events.map(renderCalendarEventCard).join("") : renderPimEmpty(tx("No matching events", "冇符合嘅事件"), tx("Create a local event or adjust this calendar search.", "新增本機事件，或者調整日曆搜尋。"), "calendar")}</div>
    ${renderDeletedPimSection(["calendar-event"], tx("Recently deleted events", "最近刪除嘅事件"))}
  </section>`;
}

function renderCalendarEventCard(event: CalendarEvent): string {
  const status = event.status === "confirmed" ? tx("Confirmed", "已確認") : event.status === "tentative" ? tx("Tentative", "暫定") : tx("Cancelled", "已取消");
  const selected = state.selectedCalendarEventUids.has(event.uid);
  return `<article class="pim-card event-card${selected ? " is-selected" : ""}" data-testid="calendar-event-card" data-pim-uid="${escapeHtml(event.uid)}">
    <header><span class="event-date"><strong>${escapeHtml(event.start.kind === "date" ? event.start.value.slice(-2) : new Date(event.start.value).toLocaleDateString(preferences().language === "yue" ? "zh-HK" : "en-CA", { day: "2-digit" }))}</strong><small>${escapeHtml(event.start.kind === "date" ? event.start.value.slice(0, 7) : new Date(event.start.value).toLocaleDateString(preferences().language === "yue" ? "zh-HK" : "en-CA", { month: "short" }))}</small></span><div><h2>${escapeHtml(event.title)}</h2><p>${escapeHtml(formatTemporal(event.start))} — ${escapeHtml(formatTemporal(event.end))}</p></div><span class="status-chip status-chip--${event.status}">${escapeHtml(status)}</span></header>
    <dl class="pim-details"><div><dt>${escapeHtml(tx("Location", "地點"))}</dt><dd>${escapeHtml(event.location ?? tx("Not set", "未設定"))}</dd></div><div><dt>${escapeHtml(tx("Calendar", "日曆"))}</dt><dd>Home · ${escapeHtml(tx("Local", "本機"))}</dd></div></dl>
    ${event.description ? `<p class="pim-notes">${escapeHtml(event.description)}</p>` : ""}
    <footer><label class="record-select"><input type="checkbox" data-ics-select="calendar-event" data-pim-uid="${escapeHtml(event.uid)}" ${selected ? "checked" : ""}/><span>${escapeHtml(tx("Select for export", "選擇匯出"))}</span></label><button class="button button--text" type="button" data-action="edit-pim" data-pim-kind="calendar-event" data-pim-uid="${escapeHtml(event.uid)}">${icon("edit")}<span>${escapeHtml(tx("Edit", "編輯"))}</span></button><span class="action-spacer"></span><button class="icon-button danger-action" type="button" data-action="request-delete-pim" data-pim-kind="calendar-event" data-pim-uid="${escapeHtml(event.uid)}" data-pim-label="${escapeHtml(event.title)}" aria-label="${escapeHtml(tx(`Delete ${event.title}`, `刪除 ${event.title}`))}">${icon("trash")}</button></footer>
  </article>`;
}

function renderTasksPage(): string {
  if (!state.pimLoaded) return renderPimUnavailable("tasks", tx("Tasks", "工作"), "check");
  const tasks = [...filteredTasks()].sort((left, right) => (left.status === "completed" ? 1 : 0) - (right.status === "completed" ? 1 : 0) || (left.due?.value ?? "9999").localeCompare(right.due?.value ?? "9999"));
  return `<section class="standard-page pim-page" data-testid="tasks-page" id="panel-tasks" role="tabpanel" aria-labelledby="tab-tasks">
    ${renderPageHeader("HOME · LOCAL", tx("Tasks", "工作"), tx("Track due dates, status, priority, and completion locally. Recurrence metadata is not expanded into instances.", "喺本機追蹤到期日、狀態、優先次序同完成度。重複 metadata 唔會展開成實例。"), "check")}
    <div class="page-tools pim-toolbar"><div class="page-search" data-testid="tasks-search">${renderSearchField("tasks", tx("Search title, description, status, or priority", "搜尋標題、描述、狀態或者優先次序"))}</div><label class="field ics-policy"><span>${escapeHtml(tx("Duplicate UIDs", "重複 UID"))}</span><select data-ics-duplicate-policy><option value="skip" ${state.icsDuplicatePolicy === "skip" ? "selected" : ""}>${escapeHtml(tx("Skip safely", "安全略過"))}</option><option value="update" ${state.icsDuplicatePolicy === "update" ? "selected" : ""}>${escapeHtml(tx("Update matching type", "更新同類記錄"))}</option></select></label><button class="button button--outlined" data-testid="import-tasks-ics" type="button" data-action="import-ics">${icon("download")}<span>${escapeHtml(tx("Import ICS", "匯入 ICS"))}</span></button><button class="button button--outlined" data-testid="export-selected-tasks-ics" type="button" data-action="export-selected-ics" data-ics-kind="task" ${state.selectedTaskUids.size ? "" : "disabled"}>${icon("download")}<span>${escapeHtml(tx("Export selected", "匯出所選"))}</span></button><button class="button button--outlined" data-testid="export-all-tasks-ics" type="button" data-action="export-all-ics" data-ics-kind="task" ${state.tasks.length ? "" : "disabled"}>${icon("download")}<span>${escapeHtml(tx("Export all", "全部匯出"))}</span></button><button class="button button--filled" data-testid="add-task" type="button" data-action="open-pim-editor" data-pim-kind="task">${icon("check")}<span>${escapeHtml(tx("New task", "新增工作"))}</span></button></div>
    <p class="local-truth-note" data-testid="tasks-ics-boundary">${icon("info")}<span>${escapeHtml(tx("The same local-only atomic ICS boundary applies here. Select tasks explicitly for a focused export, or export every task currently stored in Home.", "呢度使用同一個只限本機嘅原子 ICS 邊界。可以明確揀工作做精準匯出，或者匯出 Home 目前儲存嘅全部工作。"))}</span></p>
    <div class="pim-card-grid task-grid" data-testid="task-list">${tasks.length ? tasks.map(renderTaskCard).join("") : renderPimEmpty(tx("No matching tasks", "冇符合嘅工作"), tx("Create a task or adjust this task search.", "新增工作，或者調整工作搜尋。"), "check")}</div>
    ${renderDeletedPimSection(["task"], tx("Recently deleted tasks", "最近刪除嘅工作"))}
  </section>`;
}

function renderTaskCard(task: Task): string {
  const statusLabels: Record<Task["status"], string> = { "needs-action": tx("Needs action", "需要處理"), "in-progress": tx("In progress", "進行中"), completed: tx("Completed", "已完成"), cancelled: tx("Cancelled", "已取消") };
  const selected = state.selectedTaskUids.has(task.uid);
  return `<article class="pim-card task-card${task.status === "completed" ? " is-completed" : ""}${selected ? " is-selected" : ""}" data-testid="task-card" data-pim-uid="${escapeHtml(task.uid)}">
    <header><span class="task-check">${task.status === "completed" ? icon("check") : icon("tasks" as IconName)}</span><div><h2>${escapeHtml(task.title)}</h2><p>${escapeHtml(task.due ? tx(`Due ${formatTemporal(task.due)}`, `到期日 ${formatTemporal(task.due)}`) : tx("No due date", "冇到期日"))}</p></div><span class="status-chip status-chip--${task.status}">${escapeHtml(statusLabels[task.status])}</span></header>
    <div class="task-progress"><progress max="100" value="${task.percentComplete}" aria-label="${escapeHtml(tx("Task completion", "工作完成度"))}"></progress><span>${task.percentComplete}%</span><span class="priority-chip">P${task.priority}</span></div>
    ${task.description ? `<p class="pim-notes">${escapeHtml(task.description)}</p>` : ""}
    <footer><label class="record-select"><input type="checkbox" data-ics-select="task" data-pim-uid="${escapeHtml(task.uid)}" ${selected ? "checked" : ""}/><span>${escapeHtml(tx("Select for export", "選擇匯出"))}</span></label><button class="button button--text" type="button" data-action="edit-pim" data-pim-kind="task" data-pim-uid="${escapeHtml(task.uid)}">${icon("edit")}<span>${escapeHtml(tx("Edit", "編輯"))}</span></button>${task.status !== "completed" ? `<button class="button button--tonal" type="button" data-action="complete-task" data-pim-uid="${escapeHtml(task.uid)}">${icon("check")}<span>${escapeHtml(tx("Complete", "完成"))}</span></button>` : ""}<span class="action-spacer"></span><button class="icon-button danger-action" type="button" data-action="request-delete-pim" data-pim-kind="task" data-pim-uid="${escapeHtml(task.uid)}" data-pim-label="${escapeHtml(task.title)}" aria-label="${escapeHtml(tx(`Delete ${task.title}`, `刪除 ${task.title}`))}">${icon("trash")}</button></footer>
  </article>`;
}

function renderPimEmpty(title: string, body: string, iconName: IconName): string {
  return `<div class="pim-empty">${icon(iconName)}<h2>${escapeHtml(title)}</h2><p>${escapeHtml(body)}</p></div>`;
}

function renderDeletedPimSection(kinds: readonly PimEntityKind[], title: string): string {
  const deleted = latestDeletedPim(kinds);
  if (!deleted.length) return "";
  return `<section class="deleted-pim" data-testid="deleted-pim"><header><div><p class="eyebrow">${escapeHtml(tx("APPEND-ONLY RECOVERY", "只追加復原"))}</p><h2>${escapeHtml(title)}</h2></div><span class="count-pill">${deleted.length}</span></header><div>${deleted.map(transaction => `<article data-pim-uid="${escapeHtml(transaction.entityUid)}"><span class="pim-card__icon">${icon("history")}</span><div><strong>${escapeHtml(pimTransactionLabel(transaction))}</strong><p>${escapeHtml(formatDate(transaction.occurredAt))} · <code>${escapeHtml(transaction.entityUid)}</code></p></div><button class="button button--tonal" type="button" data-testid="restore-pim" data-action="restore-pim" data-pim-kind="${transaction.entityKind}" data-pim-uid="${escapeHtml(transaction.entityUid)}" data-transaction-id="${escapeHtml(transaction.id)}">${icon("refresh")}<span>${escapeHtml(tx("Restore", "還原"))}</span></button></article>`).join("")}</div></section>`;
}

function filteredPimTransactions(): PimTransaction[] {
  const source = state.pimHistoryResults ?? state.pimTransactions;
  const model = searchFor("pim-history");
  if (model.pattern && !validatePattern(model).valid) return [];
  const matcher = model.pattern ? createMatcher(model) : null;
  return [...source].filter(transaction => !matcher || matcher(`${transaction.action}\n${transaction.entityKind}\n${transaction.entityUid}\n${pimTransactionLabel(transaction)}`)).sort((left, right) => right.sequence - left.sequence);
}

function renderPimHistorySurface(): string {
  const transactions = filteredPimTransactions();
  const actions: PimTransaction["action"][] = ["created", "updated", "deleted", "restored"];
  const kinds: PimEntityKind[] = ["contact", "mailing-list", "calendar-event", "task"];
  return `<section class="pim-surface" id="pim-panel-activity" role="tabpanel" aria-labelledby="pim-tab-activity" data-testid="pim-history-surface">
    <div class="pim-history-filter">
      <div class="page-search" data-testid="pim-history-search">${renderSearchField("pim-history", tx("Search action, type, name, or stable ID", "搜尋操作、類型、名稱或者穩定 ID"))}</div>
      <fieldset><legend>${escapeHtml(tx("Actions", "操作"))}</legend>${actions.map(action => `<label class="filter-chip"><input type="checkbox" data-pim-filter-action="${action}" ${state.pimFilters.actions.has(action) ? "checked" : ""}/><span>${escapeHtml(action)} <b>${state.pimTransactions.filter(item => item.action === action).length}</b></span></label>`).join("")}</fieldset>
      <fieldset><legend>${escapeHtml(tx("Record types", "記錄類型"))}</legend>${kinds.map(kind => `<label class="filter-chip"><input type="checkbox" data-pim-filter-kind="${kind}" ${state.pimFilters.kinds.has(kind) ? "checked" : ""}/><span>${escapeHtml(kind.replaceAll("-", " "))} <b>${state.pimTransactions.filter(item => item.entityKind === kind).length}</b></span></label>`).join("")}</fieldset>
      <div class="pim-date-filter"><label class="field"><span>${escapeHtml(tx("From", "由"))}</span><input type="date" data-pim-filter-date="from" value="${escapeHtml(state.pimFilters.from)}"/></label><label class="field"><span>${escapeHtml(tx("To", "至"))}</span><input type="date" data-pim-filter-date="to" value="${escapeHtml(state.pimFilters.to)}"/></label><button class="assist-chip" type="button" data-action="pim-history-preset" data-days="7">${escapeHtml(tx("Last 7 days", "最近 7 日"))}</button><button class="assist-chip" type="button" data-action="clear-pim-filters">${escapeHtml(tx("Clear filters", "清除篩選"))}</button></div>
      <p class="local-truth-note">${icon("history")}<span>${escapeHtml(tx("These append-only records come from the real local PIM transaction journal. Restoring adds another transaction; it does not erase the deletion.", "呢啲只追加記錄來自真正本機 PIM 交易日誌。還原會新增另一筆交易，唔會抹走刪除記錄。"))}</span></p>
    </div>
    <div class="pim-transaction-list" data-testid="pim-transaction-list">${transactions.length ? transactions.map(renderPimTransactionRow).join("") : renderPimEmpty(tx("No matching transactions", "冇符合嘅交易"), tx("Adjust the search, action, type, or date filters.", "調整搜尋、操作、類型或者日期篩選。"), "history")}</div>
  </section>`;
}

function renderPimTransactionRow(transaction: PimTransaction): string {
  const canRestore = transaction.action === "deleted" && !pimEntityPresent(transaction.entityKind, transaction.entityUid);
  return `<article class="pim-transaction" data-testid="pim-transaction" data-transaction-id="${escapeHtml(transaction.id)}"><span class="pim-transaction__sequence">#${transaction.sequence}</span><span class="pim-card__icon">${icon(transaction.action === "deleted" ? "trash" : transaction.action === "restored" ? "refresh" : transaction.action === "created" ? "check" : "edit")}</span><div><div class="record-meta"><span class="kind-badge">${escapeHtml(transaction.action)}</span><span>${escapeHtml(transaction.entityKind.replaceAll("-", " "))}</span><time datetime="${escapeHtml(transaction.occurredAt)}">${escapeHtml(formatDate(transaction.occurredAt))}</time></div><h2>${escapeHtml(pimTransactionLabel(transaction))}</h2><p><code>${escapeHtml(transaction.entityUid)}</code></p></div>${canRestore ? `<button class="button button--tonal" type="button" data-testid="restore-pim" data-action="restore-pim" data-pim-kind="${transaction.entityKind}" data-pim-uid="${escapeHtml(transaction.entityUid)}" data-transaction-id="${escapeHtml(transaction.id)}">${icon("refresh")}<span>${escapeHtml(tx("Restore", "還原"))}</span></button>` : `<span class="view-only-label">${escapeHtml(tx("Recorded", "已記錄"))}</span>`}</article>`;
}

function renderPimEditor(): string {
  const editor = state.pimEditor;
  if (!editor) return "";
  const kindLabel = editor.kind === "contact" ? tx("contact", "聯絡人") : editor.kind === "mailing-list" ? tx("mailing list", "郵件群組") : editor.kind === "calendar-event" ? tx("event", "事件") : tx("task", "工作");
  const title = editor.uid ? tx(`Edit ${kindLabel}`, `編輯${kindLabel}`) : tx(`New ${kindLabel}`, `新增${kindLabel}`);
  return `<aside class="pim-editor-sheet" role="dialog" aria-modal="false" aria-labelledby="pim-editor-title" aria-busy="${isBusy("pim-save")}" ${isBusy("pim-save") ? "inert" : ""} data-testid="pim-editor"><header class="pim-editor-header"><div><p class="eyebrow">${escapeHtml(tx("LOCAL RECORD", "本機記錄"))}</p><h2 id="pim-editor-title">${escapeHtml(title)}</h2></div><span class="view-only-label" data-testid="pim-dirty-state" aria-live="polite">${escapeHtml(state.pimEditorDirty ? tx("Unsaved changes", "有未儲存更改") : tx("No unsaved changes", "冇未儲存更改"))}</span><button class="icon-button" type="button" data-action="close-pim-editor" aria-label="${escapeHtml(tx("Close editor", "關閉編輯器"))}">${icon("close")}</button></header><div class="pim-editor-body">${editor.kind === "contact" ? renderContactEditor(editor.uid) : editor.kind === "mailing-list" ? renderMailingListEditor(editor.uid) : editor.kind === "calendar-event" ? renderCalendarEventEditor(editor.uid) : renderTaskEditor(editor.uid)}</div></aside>`;
}

function renderContactEditor(uid: string | null): string {
  const contact = uid ? state.contacts.find(item => item.uid === uid) : undefined;
  const primaryEmail = contact?.emails.find(item => item.preferred) ?? contact?.emails[0];
  const primaryPhone = contact?.phones.find(item => item.preferred) ?? contact?.phones[0];
  return `<form class="pim-form" data-form="pim-contact" data-testid="contact-form" ${uid ? `data-pim-uid="${escapeHtml(uid)}"` : ""}>
    <label class="field"><span>${escapeHtml(tx("Display name", "顯示名稱"))}</span><input data-testid="contact-name" name="displayName" value="${escapeHtml(contact?.displayName ?? "")}" required maxlength="300" autocomplete="name"/></label>
    <div class="form-grid"><label class="field"><span>${escapeHtml(tx("Given name", "名"))}</span><input name="given" value="${escapeHtml(contact?.name.given ?? "")}" maxlength="120"/></label><label class="field"><span>${escapeHtml(tx("Family name", "姓"))}</span><input name="family" value="${escapeHtml(contact?.name.family ?? "")}" maxlength="120"/></label></div>
    <div class="form-grid"><label class="field"><span>${escapeHtml(tx("Primary email", "主要電郵"))}</span><input data-testid="contact-email" type="email" name="email" value="${escapeHtml(primaryEmail?.value ?? "")}" maxlength="320" autocomplete="email"/></label><label class="field"><span>${escapeHtml(tx("Primary phone", "主要電話"))}</span><input data-testid="contact-phone" type="tel" name="phone" value="${escapeHtml(primaryPhone?.value ?? "")}" maxlength="100" autocomplete="tel"/></label></div>
    <div class="form-grid"><label class="field"><span>${escapeHtml(tx("Organization", "機構"))}</span><input data-testid="contact-organization" name="organization" value="${escapeHtml(contact?.organization ?? "")}" maxlength="300" autocomplete="organization"/></label><label class="field"><span>${escapeHtml(tx("Title", "職銜"))}</span><input name="title" value="${escapeHtml(contact?.title ?? "")}" maxlength="300" autocomplete="organization-title"/></label></div>
    <label class="field field--textarea"><span>${escapeHtml(tx("Notes", "備註"))}</span><textarea data-testid="contact-notes" name="notes" maxlength="16384" rows="5">${escapeHtml(contact?.notes ?? "")}</textarea></label>
    ${contact && (contact.emails.length > 1 || contact.phones.length > 1) ? `<p class="local-truth-note">${icon("info")}<span>${escapeHtml(tx("This focused form edits the primary email and phone. Additional imported values are preserved.", "呢個精簡表單會編輯主要電郵同電話。其他匯入值會保留。"))}</span></p>` : ""}
    <footer class="pim-form-actions"><button class="button button--text" type="button" data-action="close-pim-editor">${escapeHtml(tx("Cancel", "取消"))}</button><span class="action-spacer"></span><button class="button button--filled" data-testid="save-contact" type="submit">${icon("check")}<span>${escapeHtml(uid ? tx("Save contact", "儲存聯絡人") : tx("Create contact", "建立聯絡人"))}</span></button></footer>
  </form>`;
}

function renderMailingListEditor(uid: string | null): string {
  const list = uid ? state.mailingLists.find(item => item.uid === uid) : undefined;
  const selectedMembers = state.pimDraftMemberUids ?? new Set(list?.memberUids ?? []);
  const memberSearch = searchFor("mailing-list-members-editor");
  const memberMatcher = memberSearch.pattern && validatePattern(memberSearch).valid ? createMatcher(memberSearch) : null;
  const contacts = state.contacts.filter(contact => !memberMatcher || memberMatcher(contactSearchText(contact)));
  return `<form class="pim-form" data-form="pim-mailing-list" data-testid="mailing-list-form" ${uid ? `data-pim-uid="${escapeHtml(uid)}"` : ""}>
    <label class="field"><span>${escapeHtml(tx("List name", "群組名稱"))}</span><input data-testid="mailing-list-name" name="name" value="${escapeHtml(list?.name ?? "")}" required maxlength="300"/></label>
    <label class="field"><span>${escapeHtml(tx("Nickname", "暱稱"))}</span><input name="nickname" value="${escapeHtml(list?.nickname ?? "")}" maxlength="120"/></label>
    <label class="field field--textarea"><span>${escapeHtml(tx("Description", "描述"))}</span><textarea name="description" maxlength="4096" rows="3">${escapeHtml(list?.description ?? "")}</textarea></label>
    <fieldset class="member-picker"><legend>${escapeHtml(tx("Members", "成員"))}</legend><div data-testid="mailing-list-member-search">${renderSearchField("mailing-list-members-editor", tx("Search contacts for this list", "搜尋呢個群組嘅聯絡人"), true)}</div><div class="member-picker__list">${contacts.length ? contacts.map(contact => `<label><input type="checkbox" name="memberUids" value="${escapeHtml(contact.uid)}" data-pim-member-uid="${escapeHtml(contact.uid)}" ${selectedMembers.has(contact.uid) ? "checked" : ""}/><span class="avatar">${escapeHtml((contact.displayName.charAt(0) || "?").toUpperCase())}</span><span><strong>${escapeHtml(contact.displayName)}</strong><small>${escapeHtml(contact.emails[0]?.value ?? tx("No email", "冇電郵"))}</small></span></label>`).join("") : `<p>${escapeHtml(tx("No contacts match this member search.", "冇聯絡人符合呢個成員搜尋。"))}</p>`}</div></fieldset>
    <footer class="pim-form-actions"><button class="button button--text" type="button" data-action="close-pim-editor">${escapeHtml(tx("Cancel", "取消"))}</button><span class="action-spacer"></span><button class="button button--filled" data-testid="save-mailing-list" type="submit">${icon("check")}<span>${escapeHtml(uid ? tx("Save mailing list", "儲存郵件群組") : tx("Create mailing list", "建立郵件群組"))}</span></button></footer>
  </form>`;
}

function renderCalendarEventEditor(uid: string | null): string {
  const event = uid ? state.calendarEvents.find(item => item.uid === uid) : undefined;
  const startFallback = new Date(); startFallback.setMinutes(0, 0, 0); startFallback.setHours(startFallback.getHours() + 1);
  const endFallback = new Date(startFallback.getTime() + 60 * 60_000);
  return `<form class="pim-form" data-form="pim-calendar-event" data-testid="calendar-event-form" ${uid ? `data-pim-uid="${escapeHtml(uid)}"` : ""}>
    <label class="field"><span>${escapeHtml(tx("Event title", "事件標題"))}</span><input data-testid="event-title" name="title" value="${escapeHtml(event?.title ?? "")}" required maxlength="500"/></label>
    <div class="form-grid"><label class="field"><span>${escapeHtml(tx("Starts", "開始"))}</span><input data-testid="event-start" type="datetime-local" name="start" value="${escapeHtml(dateTimeLocalValue(event?.start, startFallback))}" required/></label><label class="field"><span>${escapeHtml(tx("Ends", "結束"))}</span><input data-testid="event-end" type="datetime-local" name="end" value="${escapeHtml(dateTimeLocalValue(event?.end, endFallback))}" required/></label></div>
    <div class="form-grid"><label class="field"><span>${escapeHtml(tx("Location", "地點"))}</span><input data-testid="event-location" name="location" value="${escapeHtml(event?.location ?? "")}" maxlength="1000"/></label><label class="field"><span>${escapeHtml(tx("Status", "狀態"))}</span><select data-testid="event-status" name="status"><option value="confirmed" ${event?.status === "confirmed" || !event ? "selected" : ""}>${escapeHtml(tx("Confirmed", "已確認"))}</option><option value="tentative" ${event?.status === "tentative" ? "selected" : ""}>${escapeHtml(tx("Tentative", "暫定"))}</option><option value="cancelled" ${event?.status === "cancelled" ? "selected" : ""}>${escapeHtml(tx("Cancelled", "已取消"))}</option></select></label></div>
    <label class="field field--textarea"><span>${escapeHtml(tx("Description", "描述"))}</span><textarea data-testid="event-description" name="description" maxlength="32768" rows="5">${escapeHtml(event?.description ?? "")}</textarea></label>
    ${event?.recurrence ? `<p class="local-truth-note">${icon("info")}<span>${escapeHtml(tx("Existing recurrence metadata will be preserved. This editor does not expand occurrences or edit detached overrides.", "現有重複 metadata 會保留。呢個編輯器唔會展開每次出現，亦唔會編輯分離例外。"))}</span></p>` : ""}
    <footer class="pim-form-actions"><button class="button button--text" type="button" data-action="close-pim-editor">${escapeHtml(tx("Cancel", "取消"))}</button><span class="action-spacer"></span><button class="button button--filled" data-testid="save-calendar-event" type="submit">${icon("check")}<span>${escapeHtml(uid ? tx("Save event", "儲存事件") : tx("Create event", "建立事件"))}</span></button></footer>
  </form>`;
}

function renderTaskEditor(uid: string | null): string {
  const task = uid ? state.tasks.find(item => item.uid === uid) : undefined;
  return `<form class="pim-form" data-form="pim-task" data-testid="task-form" ${uid ? `data-pim-uid="${escapeHtml(uid)}"` : ""}>
    <label class="field"><span>${escapeHtml(tx("Task title", "工作標題"))}</span><input data-testid="task-title" name="title" value="${escapeHtml(task?.title ?? "")}" required maxlength="500"/></label>
    <div class="form-grid"><label class="field"><span>${escapeHtml(tx("Due date", "到期日"))}</span><input data-testid="task-due" type="date" name="due" value="${escapeHtml(task?.due?.kind === "date" ? task.due.value : "")}"/></label><label class="field"><span>${escapeHtml(tx("Status", "狀態"))}</span><select data-testid="task-status" name="status"><option value="needs-action" ${task?.status === "needs-action" || !task ? "selected" : ""}>${escapeHtml(tx("Needs action", "需要處理"))}</option><option value="in-progress" ${task?.status === "in-progress" ? "selected" : ""}>${escapeHtml(tx("In progress", "進行中"))}</option><option value="completed" ${task?.status === "completed" ? "selected" : ""}>${escapeHtml(tx("Completed", "已完成"))}</option><option value="cancelled" ${task?.status === "cancelled" ? "selected" : ""}>${escapeHtml(tx("Cancelled", "已取消"))}</option></select></label></div>
    <div class="form-grid"><label class="field"><span>${escapeHtml(tx("Priority (0–9)", "優先次序（0–9）"))}</span><input data-testid="task-priority" type="number" name="priority" min="0" max="9" step="1" value="${task?.priority ?? 0}" required/></label><label class="field field--range"><span>${escapeHtml(tx("Completion", "完成度"))} <output>${task?.percentComplete ?? 0}%</output></span><input data-testid="task-completion" type="range" name="percentComplete" min="0" max="100" step="5" value="${task?.percentComplete ?? 0}"/></label></div>
    <label class="field field--textarea"><span>${escapeHtml(tx("Description", "描述"))}</span><textarea data-testid="task-description" name="description" maxlength="32768" rows="5">${escapeHtml(task?.description ?? "")}</textarea></label>
    ${task?.recurrence ? `<p class="local-truth-note">${icon("info")}<span>${escapeHtml(tx("Existing recurrence metadata is preserved; this page does not expand recurrence instances.", "現有重複 metadata 會保留；呢個頁面唔會展開重複實例。"))}</span></p>` : ""}
    <footer class="pim-form-actions"><button class="button button--text" type="button" data-action="close-pim-editor">${escapeHtml(tx("Cancel", "取消"))}</button><span class="action-spacer"></span><button class="button button--filled" data-testid="save-task" type="submit">${icon("check")}<span>${escapeHtml(uid ? tx("Save task", "儲存工作") : tx("Create task", "建立工作"))}</span></button></footer>
  </form>`;
}



function renderFolderPane(current: FolderSummary | undefined): string {
  return `<aside class="folder-pane" aria-label="${escapeHtml(tx("Mail folders", "郵件資料夾"))}">
    <div class="pane-heading"><div><span class="overline">${escapeHtml(tx("ON THIS COMPUTER", "喺呢部電腦"))}</span><h2>${escapeHtml(tx("Unified folders", "統一資料夾"))}</h2></div><button class="icon-button" type="button" data-action="open-account-setup" aria-label="${escapeHtml(tx("Add account", "新增帳戶"))}" data-tooltip="${escapeHtml(tx("Add account", "新增帳戶"))}">${icon("account")}</button></div>
    <nav class="unified-folder-list" data-testid="unified-folder-list" aria-label="${escapeHtml(tx("Unified folders", "統一資料夾"))}">
      ${(["inbox", "starred", "unread"] as const).map(folder => {
        const selected = state.unifiedFolder === folder;
        return `<button class="folder-row${selected ? " is-selected" : ""}" type="button" data-action="select-unified-folder" data-unified-folder="${folder}" aria-current="${selected ? "page" : "false"}">
          <span class="folder-row__icon">${icon(folder === "inbox" ? "inbox" : folder === "starred" ? "star" : "unread")}</span>
          <span class="folder-row__name">${escapeHtml(unifiedFolderLabel(folder))}</span>
          ${selected ? `<span class="folder-row__total">${state.messages.length}</span>` : ""}
        </button>`;
      }).join("")}
    </nav>
    <div class="pane-section-label"><span class="overline">${escapeHtml(tx("ACCOUNT FOLDERS", "帳戶資料夾"))}</span><strong>${escapeHtml(activeAccount()?.displayName ?? "")}</strong></div>
    <nav class="folder-list" data-testid="folder-list" aria-label="${escapeHtml(tx("Folders", "資料夾"))}">
      ${state.folders.length ? state.folders.map(folder => {
        const selected = folder.path === current?.path;
        return `<button class="folder-row${selected ? " is-selected" : ""}" type="button" data-action="select-folder" data-folder-path="${escapeHtml(folder.path)}" aria-current="${selected ? "page" : "false"}">
          <span class="folder-row__icon">${icon(folder.role === "inbox" ? "inbox" : folder.role === "trash" ? "trash" : folder.role === "archive" ? "archive" : "folder")}</span>
          <span class="folder-row__name">${escapeHtml(folder.name)}</span>
          ${folder.unread ? `<span class="folder-row__count" aria-label="${folder.unread} ${escapeHtml(tx("unread", "未讀"))}">${folder.unread}</span>` : `<span class="folder-row__total">${folder.total}</span>`}
        </button>`;
      }).join("") : `<div class="pane-empty"><span>${icon("folder")}</span><p>${escapeHtml(tx("No folders are cached yet.", "仲未有已快取嘅資料夾。"))}</p><button class="button button--tonal" type="button" data-action="sync">${escapeHtml(tx("Synchronize now", "立即同步"))}</button></div>`}
    </nav>
    <footer class="folder-pane__footer"><button class="button button--text" type="button" data-action="activate-tab" data-tab-id="settings">${icon("settings")}<span>${escapeHtml(tx("Account settings", "帳戶設定"))}</span></button></footer>
  </aside>`;
}

function renderMessagePane(current: FolderSummary | undefined, messages: MessageSummary[], searchValid: boolean): string {
  const totalUnread = messages.filter(message => message.unread).length;
  const unified = state.unifiedFolder;
  const searchActive = mailSearchIsActive();
  const searchResult = currentMailSearchResult();
  const title = searchActive ? tx("Cached mail search", "快取郵件搜尋") : unified ? unifiedFolderLabel(unified) : current?.name ?? tx("Messages", "郵件");
  const grouping = groupCachedConversations(messages);
  return `<section class="message-pane" aria-label="${escapeHtml(tx("Message list", "郵件清單"))}">
    <header class="pane-heading message-pane__heading"><div><span class="overline">${escapeHtml(searchActive ? tx("IN-MEMORY CACHE INDEX", "記憶體快取索引") : unified ? tx("LOCAL UNIFIED VIEW", "本機統一檢視") : tx("FOLDER", "資料夾"))}</span><h2>${escapeHtml(title)}</h2></div><span class="count-pill">${searchResult ? `${messages.length} / ${searchResult.totalMatched}` : messages.length}${totalUnread ? ` · ${totalUnread} ${escapeHtml(tx("unread", "未讀"))}` : ""}</span></header>
    ${searchActive ? `<p class="local-truth-note cached-mail-search-note" data-testid="cached-mail-search-truth">${icon("info")}<span>${escapeHtml(searchResult ? tx(`Searched ${searchResult.indexedDocumentCount.toLocaleString()} cached summaries/body snippets in memory; showing up to ${searchResult.resultLimit} attributed results. No SQLite or server-scale index is implied.`, `喺記憶體搜尋咗 ${searchResult.indexedDocumentCount.toLocaleString()} 個快取摘要／內文片段；最多顯示 ${searchResult.resultLimit} 個有來源標示結果。唔代表有 SQLite 或伺服器級索引。`) : tx("Searching the bounded in-memory cache index. No server request is being made.", "正在搜尋有限記憶體快取索引。冇發出伺服器要求。"))}</span></p>` : ""}
    ${searchResult?.documentLimitReached ? `<p class="local-truth-note cached-mail-search-limit" data-testid="cached-mail-search-limit">${icon("warning")}<span>${escapeHtml(tx(`Only the first ${searchResult.documentLimit.toLocaleString()} coherent cached rows entered this query-time index. Narrow the cache or use folder views for rows beyond that ceiling.`, `今次查詢索引只收錄首 ${searchResult.documentLimit.toLocaleString()} 個一致快取項目。超出上限請收窄快取或者使用資料夾檢視。`))}</span></p>` : ""}
    ${unified ? `<p class="local-truth-note unified-folder-note" data-testid="unified-folder-truth">${icon("info")}<span>${escapeHtml(tx("Built only from summaries already cached on this computer. Subject/reference grouping is local and bounded; server-wide coverage and a scalable search index are not implied.", "只會使用呢部電腦已有嘅郵件摘要快取。主旨／reference 分組只係本機有限處理；唔代表全伺服器覆蓋或者可擴展搜尋索引。"))}</span></p>` : ""}
    ${grouping.limited ? `<p class="local-truth-note conversation-limit-note" data-testid="conversation-limit-note">${icon("warning")}<span>${escapeHtml(tx(`Conversation grouping is paused above ${CACHED_CONVERSATION_MESSAGE_LIMIT.toLocaleString()} visible cached messages; every message remains available as its own row.`, `畫面已快取郵件超過 ${CACHED_CONVERSATION_MESSAGE_LIMIT.toLocaleString()} 封，所以 conversation grouping 暫停；每封郵件仍然會獨立顯示。`))}</span></p>` : ""}
    ${isBusy("folder") || state.mailSearchPending ? `<div class="linear-progress" role="progressbar" aria-label="${escapeHtml(state.mailSearchPending ? tx("Searching cached mail", "搜尋快取郵件") : tx("Loading messages", "載入郵件"))}"></div>` : ""}
    <div class="message-list" data-testid="message-list" role="listbox" aria-label="${escapeHtml(tx("Messages", "郵件"))}" tabindex="0">
      ${!searchValid ? `<div class="pane-empty">${icon("warning")}<p>${escapeHtml(tx("Correct the regular expression to search messages.", "修正正規表達式先可以搜尋郵件。"))}</p></div>` : state.mailSearchPending ? `<div class="pane-empty"><span>${icon("search")}</span><h3>${escapeHtml(tx("Searching cached mail…", "正在搜尋快取郵件……"))}</h3></div>` : state.mailSearchError ? `<div class="pane-empty">${icon("warning")}<p>${escapeHtml(state.mailSearchError)}</p></div>` : messages.length ? grouping.conversations.map(renderConversation).join("") : `<div class="pane-empty"><span>${icon(searchFor("mail").pattern ? "search" : "inbox")}</span><h3>${escapeHtml(searchFor("mail").pattern ? tx("No matching cached messages", "冇符合嘅快取郵件") : unified ? tx("No cached messages in this view", "呢個檢視冇已快取郵件") : tx("This folder is clear", "呢個資料夾好乾淨"))}</h3><p>${escapeHtml(searchFor("mail").pattern ? tx("Try different words or adjust the regex builder.", "試吓其他字，或者調整正規表達式建立器。") : unified ? tx("Synchronize individual accounts, then refresh this local view.", "逐個帳戶同步，再重新整理呢個本機檢視。") : tx("Synchronize to check the server for anything new.", "同步一下，睇吓伺服器有冇新嘢。"))}</p></div>`}
    </div>
  </section>`;
}

function renderConversation(conversation: CachedConversation): string {
  if (conversation.messages.length === 1) return renderMessageRow(conversation.messages[0]!);
  const accountCount = conversation.accountIds.length;
  const summary = tx(
    `${conversation.messages.length} messages${conversation.unreadCount ? ` · ${conversation.unreadCount} unread` : ""}${accountCount > 1 ? ` · ${accountCount} accounts` : ""}`,
    `${conversation.messages.length} 封郵件${conversation.unreadCount ? ` · ${conversation.unreadCount} 封未讀` : ""}${accountCount > 1 ? ` · ${accountCount} 個帳戶` : ""}`,
  );
  return `<section class="conversation-group" data-testid="conversation-group" data-conversation-id="${escapeHtml(conversation.id)}" role="group" aria-label="${escapeHtml(tx(`Conversation: ${conversation.subject}`, `對話：${conversation.subject}`))}">
    <header class="conversation-group__header">${icon("mail")}<span><strong>${escapeHtml(conversation.subject)}</strong><small>${escapeHtml(summary)}</small></span><span class="count-pill">${conversation.messages.length}</span></header>
    <div class="conversation-group__messages">${conversation.messages.map(renderMessageRow).join("")}</div>
  </section>`;
}

function renderMessageRow(message: MessageSummary): string {
  const selected = message.id === state.selectedMessageId;
  const sender = message.from[0] ? displayAddress(message.from[0]) : tx("Unknown sender", "未知寄件人");
  const avatar = sender.trim().charAt(0).toUpperCase() || "?";
  return `<div class="message-row${message.unread ? " is-unread" : ""}${selected ? " is-selected" : ""}" role="option" aria-selected="${selected}" data-message-id="${escapeHtml(message.id)}">
    <button class="message-row__main" type="button" data-action="select-message" data-message-id="${escapeHtml(message.id)}">
      <span class="avatar" aria-hidden="true">${escapeHtml(avatar)}</span>
      <span class="message-row__copy"><span class="message-row__top"><strong>${escapeHtml(sender)}</strong><time datetime="${escapeHtml(message.date)}">${escapeHtml(formatDate(message.date))}</time></span>${state.unifiedFolder || mailSearchIsActive() ? `<span class="message-row__account">${escapeHtml(messageAccountAttribution(message))}</span>` : ""}<span class="message-row__subject">${escapeHtml(message.subject)}</span><span class="message-row__preview">${escapeHtml(searchHitForMessage(message.id)?.snippet || message.preview)}</span></span>
      ${message.hasAttachments ? `<span class="attachment-indicator" aria-label="${escapeHtml(tx("Has attachments", "有附件"))}">${icon("attach")}</span>` : ""}
    </button>
    <button class="star-button${message.starred ? " is-starred" : ""}" type="button" data-action="toggle-row-star" data-message-id="${escapeHtml(message.id)}" aria-label="${escapeHtml(message.starred ? tx("Remove star", "移除星號") : tx("Add star", "加入星號"))}">${icon("star")}</button>
  </div>`;
}

function safeMessageDocument(detail: MessageDetail): string {
  const parser = new DOMParser();
  const allowedImageOrigins = detail.remoteContentAllowed
    ? new Set(detail.remoteContentSources.map(source => source.origin))
    : new Set<string>();
  const parsed = parser.parseFromString(detail.remoteContentAllowed ? detail.remoteContentHtml : detail.html || "", "text/html");
  for (const blocked of parsed.querySelectorAll("script, style, link, meta, base, form, iframe, object, embed, video, audio, source")) blocked.remove();
  for (const element of parsed.querySelectorAll<HTMLElement>("*")) {
    element.removeAttribute("style");
    element.removeAttribute("class");
    element.removeAttribute("id");
    for (const attribute of [...element.attributes]) if (attribute.name.toLowerCase().startsWith("on")) element.removeAttribute(attribute.name);
  }
  for (const anchor of parsed.querySelectorAll<HTMLAnchorElement>("a")) {
    const raw = anchor.getAttribute("href") ?? "";
    if (!/^(https?:|mailto:)/i.test(raw)) anchor.removeAttribute("href");
    else {
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
      anchor.referrerPolicy = "no-referrer";
    }
  }
  for (const image of parsed.querySelectorAll<HTMLImageElement>("img")) {
    try {
      const source = new URL(image.getAttribute("src") ?? "");
      if ((source.protocol !== "http:" && source.protocol !== "https:")
        || source.username
        || source.password
        || !allowedImageOrigins.has(source.origin)) {
        image.remove();
        continue;
      }
      image.src = source.href;
      image.referrerPolicy = "no-referrer";
      image.loading = "lazy";
      image.removeAttribute("srcset");
    } catch {
      image.remove();
    }
  }
  const content = parsed.body.innerHTML.trim() || `<pre>${escapeHtml(detail.text)}</pre>`;
  const imagePolicy = [...allowedImageOrigins].join(" ");
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:${imagePolicy ? ` ${imagePolicy}` : ""}; connect-src 'none'; media-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><meta name="color-scheme" content="light dark"><style>:root{font:15px/1.6 system-ui,sans-serif;color-scheme:light dark}body{margin:0;padding:4px;color:CanvasText;background:Canvas;overflow-wrap:anywhere}a{color:LinkText;text-underline-offset:3px}img{display:block;max-width:100%;height:auto;margin-block:12px}pre{white-space:pre-wrap;font:inherit}blockquote{margin-inline:0;padding-inline-start:16px;border-inline-start:3px solid GrayText}table{border-collapse:collapse;max-width:100%}td,th{border:1px solid GrayText;padding:6px}</style></head><body>${content}</body></html>`;
}

function renderRemoteContentControl(detail: MessageDetail): string {
  if (!detail.remoteContentSources.length) return "";
  const origins = [...new Set(detail.remoteContentSources.map(source => source.origin))];
  const imageCount = detail.remoteContentSources.length;
  const insecureCount = detail.remoteContentSources.filter(source => source.protocol === "http:").length;
  const title = detail.remoteContentAllowed
    ? tx("Remote images loaded for this message", "呢封郵件已載入遠端圖片")
    : tx("Remote images blocked", "遠端圖片已封鎖");
  const summary = tx(
    `${imageCount} remote image${imageCount === 1 ? "" : "s"} from ${origins.length} source${origins.length === 1 ? "" : "s"}:`,
    `${imageCount} 張遠端圖片，來自 ${origins.length} 個來源：`,
  );
  const privacy = detail.remoteContentAllowed
    ? tx("Those sources can learn that this message was opened. Block them again to stop future requests from this reader.", "呢啲來源可以知道你開過呢封郵件。再次封鎖就會停止呢個閱讀器之後嘅請求。")
    : tx("Loading can tell those sources that you opened this message. Consent applies only to this message and is saved locally.", "載入可能會令呢啲來源知道你開過呢封郵件。同意只適用於呢封郵件，並會儲存喺本機。 ");
  return `<section class="remote-content-control${detail.remoteContentAllowed ? " is-allowed" : ""}" data-testid="remote-content-control" role="region" aria-labelledby="remote-content-title" aria-describedby="remote-content-summary remote-content-privacy">
    <span class="remote-content-control__icon" aria-hidden="true">${icon(detail.remoteContentAllowed ? "warning" : "unread")}</span>
    <div class="remote-content-control__copy"><h2 id="remote-content-title">${escapeHtml(title)}</h2><p id="remote-content-summary">${escapeHtml(summary)}</p><ul class="remote-content-origins" aria-label="${escapeHtml(tx("Remote image sources", "遠端圖片來源"))}">${origins.map(origin => `<li><code>${escapeHtml(origin)}</code></li>`).join("")}</ul><p id="remote-content-privacy">${escapeHtml(privacy)}</p>${insecureCount ? `<p class="remote-content-warning">${icon("warning")}<span>${escapeHtml(tx(`${insecureCount} image source${insecureCount === 1 ? " uses" : "s use"} unencrypted HTTP. This is a transport warning, not a certificate diagnostic.`, `${insecureCount} 個圖片來源使用未加密 HTTP。呢個係傳輸警告，唔係憑證診斷。`))}</span></p>` : ""}</div>
    <button class="button ${detail.remoteContentAllowed ? "button--outlined" : "button--tonal"}" type="button" data-action="toggle-remote-content" data-focus-key="remote-content-toggle" aria-pressed="${detail.remoteContentAllowed}" aria-describedby="remote-content-summary remote-content-privacy" ${isBusy(`remote-content-${detail.id}`) ? "disabled" : ""}>${icon(detail.remoteContentAllowed ? "close" : "download")}<span>${escapeHtml(detail.remoteContentAllowed ? tx("Block remote images again", "再次封鎖遠端圖片") : tx("Load for this message", "只為呢封郵件載入"))}</span></button>
  </section>`;
}

const attachmentRiskReasonLabel = (reason: AttachmentRiskReason): string => {
  switch (reason) {
    case "windows-executable": return tx("Windows executable file", "Windows 可執行檔");
    case "windows-script": return tx("Windows script file", "Windows 指令碼檔案");
    case "windows-shortcut": return tx("Windows shortcut file", "Windows 捷徑檔案");
    case "windows-installer": return tx("Windows installer package", "Windows 安裝套件");
    case "macro-enabled-document": return tx("Macro-enabled document", "可執行巨集嘅文件");
    case "double-extension": return tx("Deceptive double extension", "可能誤導嘅雙重副檔名");
    case "trailing-dot-or-space": return tx("Trailing dot or space changes the Windows filename", "結尾句點或者空格會改變 Windows 檔名");
    case "bidirectional-control": return tx("Bidirectional text control can disguise the filename", "雙向文字控制符可能偽裝檔名");
    case "mime-extension-mismatch": return tx("Declared file type conflicts with the extension", "聲稱嘅檔案類型同副檔名不符");
  }
};

const externalLinkReasonLabel = (reason: ExternalLinkReviewRequest["reasons"][number]): string => {
  switch (reason) {
    case "http": return tx("Unencrypted HTTP", "未加密 HTTP");
    case "credentials": return tx("Address contains credentials", "網址包含登入資料");
    case "ip-literal": return tx("IP address instead of a host name", "用 IP 位址代替主機名稱");
    case "non-default-port": return tx("Non-default network port", "非預設網絡連接埠");
    case "punycode": return tx("Punycode host name", "Punycode 主機名稱");
    case "bidi-control": return tx("Bidirectional control character", "雙向文字控制符");
    case "visible-host-mismatch": return tx("Visible host differs from destination", "顯示主機同目的地唔一致");
    case "malformed": return tx("Malformed address", "網址格式錯誤");
  }
};

const attachmentRiskLevelLabel = (attachment: AttachmentSummary): string =>
  attachment.risk.level === "dangerous" ? tx("Dangerous", "危險") : tx("Caution", "小心");

const renderAttachmentChip = (attachment: AttachmentSummary, index: number): string => {
  const risky = attachment.risk.level !== "ordinary";
  const riskId = `attachment-risk-${index}`;
  const riskCopy = risky
    ? `<small class="attachment-chip__risk" id="${riskId}"><span class="attachment-risk-badge attachment-risk-badge--${attachment.risk.level}">${escapeHtml(attachmentRiskLevelLabel(attachment))}</span><span>${escapeHtml(attachment.risk.reasons.map(attachmentRiskReasonLabel).join(" · "))}</span></small>`
    : "";
  return `<span class="attachment-chip attachment-chip--${attachment.risk.level}" data-testid="attachment-chip-${index}" role="group" aria-label="${escapeHtml(tx(`Attachment ${attachment.filename}`, `附件 ${attachment.filename}`))}"><span class="attachment-chip__copy"><strong><bdi>${escapeHtml(attachment.filename)}</bdi></strong><small>${escapeHtml(formatBytes(attachment.size))} · ${escapeHtml(attachment.contentType)}</small>${riskCopy}</span><button class="icon-button icon-button--small" type="button" data-action="save-attachment" data-attachment-index="${index}" data-focus-key="save-attachment-${index}" aria-label="${escapeHtml(tx(`Save ${attachment.filename}`, `儲存 ${attachment.filename}`))}" ${risky ? `aria-describedby="${riskId}"` : ""} ${isBusy("save-attachment") ? "disabled" : ""}>${icon("download")}</button></span>`;
};

const attachmentSaveReview = (detail: MessageDetail, target: number | "all"): AttachmentSaveReview => {
  const selected = target === "all"
    ? detail.attachments.map((attachment, index) => ({ attachment, index }))
    : detail.attachments[target] ? [{ attachment: detail.attachments[target], index: target }] : [];
  return {
    riskyAttachments: selected
      .filter(({ attachment }) => attachment.risk.level !== "ordinary")
      .map(({ attachment, index }) => ({
        index,
        filename: attachment.filename,
        contentType: attachment.contentType,
        level: attachment.risk.level as "caution" | "dangerous",
        reasons: [...attachment.risk.reasons],
      })),
  };
};

const messageCryptoProtocolLabel = (protocol: MessageCryptoProtocol | null): string => protocol === "openpgp"
  ? "OpenPGP"
  : protocol === "smime"
    ? "S/MIME"
    : tx("Unknown format", "未知格式");

const safeMessageCryptoProfile = (account: AccountSummary | null) => {
  try {
    return parseMessageCryptoProfile(account?.messageCryptography ?? emptyMessageCryptoProfile());
  } catch {
    return emptyMessageCryptoProfile();
  }
};

function renderReaderCryptographyTrust(input: MessageCryptographyAssessment | undefined): string {
  const assessment = input ?? unsignedMessageCryptography();
  const protocol = messageCryptoProtocolLabel(assessment.protocol);
  const title = assessment.state === "unsigned"
    ? tx("Unsigned message", "未簽署郵件")
    : assessment.state === "unverified"
      ? tx(`${protocol} signature not verified`, `${protocol} 簽署未驗證`)
      : assessment.container === "encrypted"
        ? tx(`${protocol} encrypted content unsupported`, `${protocol} 加密內容未支援`)
        : tx("Cryptographic container unsupported", "密碼學容器未支援");
  const stateLabel = assessment.state === "unsigned"
    ? tx("Unsigned", "未簽署")
    : assessment.state === "unverified"
      ? tx("Unverified", "未驗證")
      : tx("Unsupported", "未支援");
  const description = assessment.state === "unsigned"
    ? tx(
        "No supported signature or encryption container was detected in the bounded top-level MIME header. This does not prove sender identity or message integrity.",
        "有限頂層 MIME 標頭入面冇偵測到支援嘅簽署或者加密容器。呢個唔可以證明寄件人身份或者郵件完整性。",
      )
    : assessment.state === "unverified"
      ? tx(
          `A ${protocol} signature container was detected, but this build did not cryptographically verify the signature, signer identity, key or certificate, or message content.`,
          `偵測到 ${protocol} 簽署容器，但呢個版本冇用密碼學方法驗證簽署、簽署者身份、金鑰／憑證或者郵件內容。`,
        )
      : assessment.container === "encrypted"
        ? tx(
            `A ${protocol} encrypted container was detected. This build cannot decrypt or authenticate it; any displayed fallback content remains untrusted.`,
            `偵測到 ${protocol} 加密容器。呢個版本唔可以解密或者驗證；任何顯示嘅後備內容仍然唔可信。`,
          )
        : tx(
            "A cryptographic MIME container was detected, but its format is not supported. No verification or decryption was attempted.",
            "偵測到密碼學 MIME 容器，但格式未支援。冇嘗試驗證或者解密。",
          );
  const evidence = tx(
    "Local header assessment only · Signature verification not performed · Content decryption not performed",
    "只做本機標頭評估 · 冇驗證簽署 · 冇解密內容",
  );
  return `<section class="message-crypto-trust message-crypto-trust--${assessment.state}" data-testid="reader-crypto-trust" data-state="${assessment.state}" role="region" aria-labelledby="reader-crypto-title" aria-describedby="reader-crypto-description reader-crypto-evidence">
    <span class="message-crypto-trust__icon" aria-hidden="true">${icon(assessment.state === "unsigned" ? "info" : "warning")}</span>
    <div class="message-crypto-trust__copy"><div class="message-crypto-trust__heading"><h2 id="reader-crypto-title">${escapeHtml(title)}</h2><span class="trust-state-badge trust-state-badge--${assessment.state}" data-testid="reader-crypto-state">${escapeHtml(stateLabel)}</span></div><p id="reader-crypto-description">${escapeHtml(description)}</p><small id="reader-crypto-evidence">${escapeHtml(evidence)}</small></div>
  </section>`;
}

function renderComposeCryptographyTrust(account: AccountSummary | null): string {
  const profile = safeMessageCryptoProfile(account);
  const identitySummary = profile.identities.length
    ? `<details class="message-crypto-identities"><summary>${escapeHtml(tx(`${profile.identities.length} unverified local identity metadata record${profile.identities.length === 1 ? "" : "s"}`, `${profile.identities.length} 個未驗證本機身份中繼資料記錄`))}</summary><ul>${profile.identities.map(identity => `<li><strong>${escapeHtml(identity.displayName)}</strong><span>${messageCryptoProtocolLabel(identity.protocol)} · <bdi>${escapeHtml(identity.email)}</bdi></span><code><bdi>${escapeHtml(formatMessageCryptoFingerprint(identity.fingerprint))}</bdi></code>${identity.expiresAt ? `<small>${escapeHtml(tx("Metadata expiry", "中繼資料到期"))}: ${escapeHtml(formatDate(identity.expiresAt))}</small>` : ""}</li>`).join("")}</ul></details>`
    : `<p class="message-crypto-empty">${escapeHtml(tx("No local identity metadata is configured for this account.", "呢個帳戶未設定本機身份中繼資料。"))}</p>`;
  return `<section class="message-crypto-trust compose-crypto-trust message-crypto-trust--unsigned" data-testid="compose-crypto-trust" data-state="unsigned" role="region" aria-labelledby="compose-crypto-title" aria-describedby="compose-crypto-description compose-crypto-boundary">
    <span class="message-crypto-trust__icon" aria-hidden="true">${icon("warning")}</span>
    <div class="message-crypto-trust__copy"><div class="message-crypto-trust__heading"><h3 id="compose-crypto-title">${escapeHtml(tx("Sending unsigned", "將會未簽署寄出"))}</h3><span class="trust-state-badge trust-state-badge--unsigned" data-testid="compose-crypto-state">${escapeHtml(tx("Unsigned", "未簽署"))}</span></div><p id="compose-crypto-description">${escapeHtml(tx("The current SMTP path will send this draft without an OpenPGP or S/MIME signature and without message-content encryption.", "目前 SMTP 路徑會寄出呢份草稿，冇 OpenPGP 或者 S/MIME 簽署，亦冇郵件內容加密。"))}</p>
      <dl class="message-crypto-capabilities">${MESSAGE_CRYPTO_CAPABILITIES.map(capability => `<div><dt>${messageCryptoProtocolLabel(capability.protocol)}</dt><dd>${escapeHtml(tx("Container detection only; sign, encrypt, verify, and decrypt are unsupported.", "只偵測容器；簽署、加密、驗證同解密全部未支援。"))}</dd></div>`).join("")}</dl>
      ${identitySummary}
      <small id="compose-crypto-boundary">${escapeHtml(tx("Identity records are validated public metadata only. Keys, passphrases, and plaintext cryptographic secrets are neither accepted nor persisted.", "身份記錄只係已驗證格式嘅公開中繼資料。唔接受亦唔會保存金鑰、密碼句或者明文密碼學秘密。"))}</small>
    </div>
  </section>`;
}

function renderReaderPane(): string {
  const message = activeMessage();
  if (!message) return `<article class="reader-pane reader-pane--empty" aria-label="${escapeHtml(tx("Message reader", "郵件閱讀器"))}"><span class="hero-icon">${icon("mail")}</span><h2>${escapeHtml(tx("Choose a message", "揀一封郵件"))}</h2><p>${escapeHtml(tx("The message reader keeps remote content isolated from the app.", "郵件閱讀器會將遠端內容同應用程式隔離。"))}</p></article>`;
  if (isBusy("message") && !state.detail) return `<article class="reader-pane reader-pane--empty" aria-busy="true"><div class="circular-progress" role="progressbar" aria-label="${escapeHtml(tx("Opening message", "開啟郵件"))}"></div><p>${escapeHtml(tx("Opening message…", "正在開啟郵件……"))}</p></article>`;
  const detail = state.detail;
  if (!detail) return `<article class="reader-pane reader-pane--empty"><span class="hero-icon hero-icon--error">${icon("error")}</span><h2>${escapeHtml(tx("Message unavailable", "郵件暫時開唔到"))}</h2><button class="button button--outlined" type="button" data-action="retry-message">${icon("refresh")}<span>${escapeHtml(tx("Try again", "再試一次"))}</span></button></article>`;
  const movesAvailable = state.unifiedFolder === null && !mailSearchIsActive();
  const archive = movesAvailable ? folderByRole("archive") : null;
  const trash = movesAvailable ? folderByRole("trash") : null;
  return `<article class="reader-pane" aria-label="${escapeHtml(tx("Message reader", "郵件閱讀器"))}">
    <div class="reader-toolbar" role="toolbar" aria-label="${escapeHtml(tx("Message actions", "郵件操作"))}">
      <button class="button button--tonal" type="button" data-action="reply">${icon("reply")}<span>${escapeHtml(tx("Reply", "回覆"))}</span></button>
      <button class="button button--text" type="button" data-action="forward">${icon("forward")}<span>${escapeHtml(tx("Forward", "轉寄"))}</span></button>
      <span class="commandbar-spacer"></span>
      <button class="icon-button${detail.starred ? " is-starred" : ""}" type="button" data-action="toggle-selected-star" aria-label="${escapeHtml(detail.starred ? tx("Remove star", "移除星號") : tx("Add star", "加入星號"))}" data-tooltip="${escapeHtml(tx("Star", "星號"))}">${icon("star")}</button>
      <button class="icon-button" type="button" data-action="toggle-selected-unread" aria-label="${escapeHtml(detail.unread ? tx("Mark read", "標示為已讀") : tx("Mark unread", "標示為未讀"))}" data-tooltip="${escapeHtml(detail.unread ? tx("Mark read", "標示為已讀") : tx("Mark unread", "標示為未讀"))}">${icon("unread")}</button>
      <div class="menu-field"><label class="visually-hidden" for="move-destination">${escapeHtml(tx("Move message", "移動郵件"))}</label><select id="move-destination" data-action-change="move-message" aria-label="${escapeHtml(tx("Move message to folder", "移動郵件到資料夾"))}" ${movesAvailable ? "" : "disabled"}><option value="">${escapeHtml(movesAvailable ? tx("Move to…", "移動到……") : tx("Open account folder to move", "開帳戶資料夾先移動"))}</option>${movesAvailable ? state.folders.filter(folder => folder.path !== detail.folderPath).map(folder => `<option value="${escapeHtml(folder.path)}">${escapeHtml(folder.name)}</option>`).join("") : ""}</select></div>
      ${archive ? `<button class="icon-button" type="button" data-action="archive-message" aria-label="${escapeHtml(tx("Archive", "封存"))}" data-tooltip="${escapeHtml(tx("Archive", "封存"))}">${icon("archive")}</button>` : ""}
      ${trash ? `<button class="icon-button danger-action" type="button" data-action="trash-message" aria-label="${escapeHtml(tx("Move to trash", "移到垃圾桶"))}" data-tooltip="${escapeHtml(tx("Trash", "垃圾桶"))}">${icon("trash")}</button>` : ""}
    </div>
    ${state.unifiedFolder ? `<p class="local-truth-note reader-unified-note">${icon("info")}<span>${escapeHtml(tx("Reply, forward, star, and read-state actions keep the message's account identity. Open its account folder before moving it so this view never guesses a cross-account destination.", "回覆、轉寄、星號同已讀狀態都會保留郵件所屬帳戶。移動之前請開返該帳戶資料夾，避免呢個檢視跨帳戶亂估目的地。"))}</span></p>` : ""}
    <header class="message-header">
      <div class="avatar avatar--large" aria-hidden="true">${escapeHtml((displayAddress(detail.from[0] ?? { name: "", address: "?" }).charAt(0) || "?").toUpperCase())}</div>
      <div class="message-header__copy"><p class="eyebrow">${escapeHtml(tx("MESSAGE", "郵件"))}</p><h1>${escapeHtml(detail.subject)}</h1><p><strong>${escapeHtml(addressLine(detail.from) || tx("Unknown sender", "未知寄件人"))}</strong> <span>&lt;${escapeHtml(detail.from[0]?.address ?? "")}‌&gt;</span></p><p>${escapeHtml(tx("To", "寄給"))}: ${escapeHtml(addressLine(detail.to))}${detail.cc.length ? ` · ${escapeHtml(tx("Cc", "副本"))}: ${escapeHtml(addressLine(detail.cc))}` : ""}</p></div>
      <time datetime="${escapeHtml(detail.date)}">${escapeHtml(formatDate(detail.date))}</time>
    </header>
    ${renderReaderCryptographyTrust(detail.cryptography)}
    ${detail.attachments.length ? `<section class="attachment-strip" aria-label="${escapeHtml(tx("Attachments", "附件"))}"><div class="attachment-strip__heading"><strong>${icon("attach")} ${detail.attachments.length} ${escapeHtml(tx("attachments", "個附件"))}</strong><button class="button button--text" type="button" data-action="save-all-attachments" data-focus-key="save-all-attachments" ${isBusy("save-attachment") ? "disabled" : ""}>${icon("download")}<span>${escapeHtml(tx("Save all", "全部儲存"))}</span></button></div>${detail.attachments.map(renderAttachmentChip).join("")}</section>` : ""}
    ${renderRemoteContentControl(detail)}
    <div class="reader-security-note">${icon("check")}<span>${escapeHtml(detail.remoteContentAllowed ? tx("Message HTML stays sandboxed. Only the listed image origins are allowed; scripts, forms, frames, connections, and same-origin access remain blocked.", "郵件 HTML 仍然喺沙盒入面。只准上面列出嘅圖片來源；指令碼、表單、框架、連線同同源存取仍然全部封鎖。") : tx("Message HTML is isolated in a sandbox. Scripts, forms, remote images, connections, and same-origin access are blocked.", "郵件 HTML 放喺沙盒隔離。指令碼、表單、遠端圖片、連線同同源存取全部被封鎖。"))}</span></div>
    <iframe class="message-frame" data-testid="reader-iframe" data-reader-document="${readerDocumentRevision}" sandbox="allow-popups" referrerpolicy="no-referrer" title="${escapeHtml(tx(`Message body: ${detail.subject}`, `郵件內容：${detail.subject}`))}" srcdoc="${escapeHtml(safeMessageDocument(detail))}"></iframe>
  </article>`;
}

const connectionEndpointName = (endpoint: ConnectionDiagnostic["endpoint"], incomingProtocol: AccountDraft["incomingProtocol"] = "imap"): { english: string; cantonese: string } => endpoint === "incoming"
  ? incomingProtocol === "pop3"
    ? { english: "Incoming POP3", cantonese: "收取 POP3" }
    : { english: "Incoming IMAP", cantonese: "收取 IMAP" }
  : { english: "Outgoing SMTP", cantonese: "寄出 SMTP" };

const connectionDiagnosticCopy = (
  diagnostic: ConnectionDiagnostic,
  settings: MailConnectionSettings,
): { englishTitle: string; cantoneseTitle: string; englishBody: string; cantoneseBody: string } => {
  const incomingProtocol = settings.incomingProtocol ?? "imap";
  const endpoint = connectionEndpointName(diagnostic.endpoint, incomingProtocol);
  const server = settings[diagnostic.endpoint];
  const implicitPort = diagnostic.endpoint === "incoming" ? incomingProtocol === "pop3" ? 995 : 993 : 465;
  const starttlsPorts = diagnostic.endpoint === "incoming" ? incomingProtocol === "pop3" ? "110" : "143" : "25, 587, or 2525";
  const starttlsPortsYue = diagnostic.endpoint === "incoming" ? incomingProtocol === "pop3" ? "110" : "143" : "25、587 或 2525";
  const title = (english: string, cantonese: string) => ({
    englishTitle: `${endpoint.english}: ${english}`,
    cantoneseTitle: `${endpoint.cantonese}：${cantonese}`,
  });
  switch (diagnostic.code) {
    case "hostname-empty": return {
      ...title("host required", "需要主機名"),
      englishBody: "Enter the exact mail-server host supplied by the provider.",
      cantoneseBody: "請輸入供應商提供嘅確切郵件伺服器主機名。",
    };
    case "hostname-wildcard": return {
      ...title("wildcard is not a server address", "萬用字元唔係伺服器地址"),
      englishBody: "A value such as *.example.com is a certificate pattern, not a host to connect to. Enter the provider's exact host, such as imap.example.com. No server has been contacted.",
      cantoneseBody: "例如 *.example.com 係證書比對格式，唔係可以連接嘅主機。請輸入供應商列出嘅確切主機，例如 imap.example.com。程式未有聯絡任何伺服器。",
    };
    case "hostname-format": return {
      ...title("enter a host name only", "只可輸入主機名"),
      englishBody: "Remove https://, paths, credentials, brackets, and :port. Put the port in its own field so TLS can check the entered host identity. No server has been contacted.",
      cantoneseBody: "請移除 https://、路徑、憑證、方括號同 :連接埠；連接埠要放返喺獨立欄位，TLS 先可以按輸入嘅主機身份檢查。程式未有聯絡任何伺服器。",
    };
    case "certificate-ip-literal": return {
      ...title("certificate may not cover this IP address", "證書未必涵蓋呢個 IP 地址"),
      englishBody: "TLS can match an IP address only when the certificate lists that exact IP in subjectAltName. Use the provider's DNS mail host when available. This local preflight has not inspected a certificate.",
      cantoneseBody: "只有證書 subjectAltName 明確列出同一個 IP 地址，TLS 先可以配對。可以嘅話請用供應商嘅 DNS 郵件主機。呢個本機預檢未有檢查任何證書。",
    };
    case "certificate-local-name": return {
      ...title("certificate may not cover this local name", "證書未必涵蓋呢個本機名稱"),
      englishBody: "Single-label and private host names often do not match a public certificate. Use the provider's fully qualified DNS mail host, or confirm the private certificate policy. This local preflight has not inspected a certificate.",
      cantoneseBody: "單段或者私人主機名通常配對唔到公開證書。請用供應商完整嘅 DNS 郵件主機，或者確認私人證書政策。呢個本機預檢未有檢查任何證書。",
    };
    case "port-range": return {
      ...title("port is outside the valid range", "連接埠超出有效範圍"),
      englishBody: "Enter a whole-number port from 1 through 65535. No server has been contacted.",
      cantoneseBody: "請輸入 1 至 65535 嘅整數連接埠。程式未有聯絡任何伺服器。",
    };
    case "implicit-tls-on-starttls-port": return {
      ...title("TLS mode conflicts with this conventional port", "TLS 模式同呢個常用連接埠衝突"),
      englishBody: `Port ${server.port} normally starts without implicit TLS and upgrades with STARTTLS. Choose STARTTLS, or use TLS on port ${implicitPort} if the provider documents it. No server has been contacted.`,
      cantoneseBody: `連接埠 ${server.port} 通常唔會一開始就用隱式 TLS，而係再升級至 STARTTLS。請選擇 STARTTLS；如果供應商有列明，亦可以改用 TLS 配連接埠 ${implicitPort}。程式未有聯絡任何伺服器。`,
    };
    case "starttls-on-implicit-tls-port": return {
      ...title("STARTTLS mode conflicts with this conventional port", "STARTTLS 模式同呢個常用連接埠衝突"),
      englishBody: `Port ${implicitPort} expects TLS immediately. Choose TLS, or use STARTTLS on port ${starttlsPorts} if the provider documents it. No server has been contacted.`,
      cantoneseBody: `連接埠 ${implicitPort} 預期即時使用 TLS。請選擇 TLS；如果供應商有列明，亦可以用 STARTTLS 配連接埠 ${starttlsPortsYue}。程式未有聯絡任何伺服器。`,
    };
    case "plain-on-implicit-tls-port": return {
      ...title("plain transport cannot use this conventional TLS port", "純文字傳輸唔可以用呢個常用 TLS 連接埠"),
      englishBody: `Port ${implicitPort} expects TLS immediately. Choose TLS, or enter the provider's documented plain port. Plain transport has no certificate identity check and exposes credentials and mail data.`,
      cantoneseBody: `連接埠 ${implicitPort} 預期即時使用 TLS。請選擇 TLS，或者輸入供應商列明嘅純文字連接埠。純文字傳輸冇證書身份檢查，亦會暴露憑證同郵件資料。`,
    };
    case "nonstandard-secure-port": return {
      ...title("confirm this custom secure port", "請確認呢個自訂安全連接埠"),
      englishBody: `${server.security === "tls" ? "TLS" : "STARTTLS"} on port ${server.port} can be valid for a custom service. Confirm the provider's exact mode and port. This local preflight cannot verify server interoperability or inspect its certificate.`,
      cantoneseBody: `${server.security === "tls" ? "TLS" : "STARTTLS"} 配連接埠 ${server.port} 可以係自訂服務嘅有效設定。請確認供應商列出嘅確切模式同連接埠。呢個本機預檢唔可以驗證伺服器互通性，亦未有檢查證書。`,
    };
    case "plain-transport": return {
      ...title("plain transport has no certificate check", "純文字傳輸冇證書檢查"),
      englishBody: "Credentials and mail data would travel without TLS. Use TLS or STARTTLS unless the provider explicitly requires plain transport.",
      cantoneseBody: "憑證同郵件資料會喺冇 TLS 嘅情況下傳送。除非供應商明確要求純文字傳輸，否則請使用 TLS 或 STARTTLS。",
    };
  }
};

const renderConnectionDiagnosticItems = (
  diagnostics: readonly ConnectionDiagnostic[],
  settings: MailConnectionSettings,
): string => diagnostics.length
  ? `<ul class="connection-preflight__list">${diagnostics.map(diagnostic => {
    const copy = connectionDiagnosticCopy(diagnostic, settings);
    return `<li class="connection-diagnostic connection-diagnostic--${diagnostic.severity}" data-connection-diagnostic="${diagnostic.code}">${icon(diagnostic.severity === "error" ? "error" : "warning")}<span><strong>${escapeHtml(tx(copy.englishTitle, copy.cantoneseTitle))}</strong><span>${escapeHtml(tx(copy.englishBody, copy.cantoneseBody))}</span></span></li>`;
  }).join("")}</ul>`
  : `<p class="connection-preflight__ready">${icon("check")}<span>${escapeHtml(settings.incomingProtocol === "pop3"
    ? tx("No local hostname or conventional POP3 TLS/port conflict detected. Live POP3 testing remains unavailable; use the local demo only.", "本機未發現主機名或者常用 POP3 TLS／連接埠衝突。即時 POP3 測試仍然不可用；只可使用本機示範。")
    : tx("No local hostname or conventional TLS/port conflict detected. A real connection test is still required.", "本機未發現主機名或者常用 TLS／連接埠衝突；仍然需要真正連線測試。"))}</span></p>`;

const tlsAuthorizationIssueLabel = (issue: TlsCertificateAuthorizationIssue | null): string => {
  switch (issue) {
    case "hostname-mismatch": return tx("Hostname mismatch", "主機名唔吻合");
    case "expired": return tx("Certificate expired", "證書已過期");
    case "not-yet-valid": return tx("Certificate is not valid yet", "證書尚未生效");
    case "revoked": return tx("Certificate reported revoked", "證書被報告已撤銷");
    case "untrusted-chain": return tx("Chain is not trusted by this runtime", "呢個執行環境唔信任證書鏈");
    case "invalid-signature": return tx("Certificate signature is invalid", "證書簽署無效");
    case "unknown": return tx("Runtime reported another authorization problem", "執行環境報告另一個授權問題");
    default: return tx("No authorization problem reported", "未有報告授權問題");
  }
};

const renderTlsCertificateInspection = (result: TlsCertificateInspectionResult): string => {
  if (result.outcome === "not-applicable") {
    return `<div class="tls-inspection-result__summary">${icon("info")}<div><strong>${escapeHtml(tx("Plain transport has no TLS certificate", "純文字傳輸冇 TLS 證書"))}</strong><p>${escapeHtml(tx("No network connection was opened. Choose TLS or STARTTLS before requesting a live certificate inspection.", "未有開啟任何網絡連線。請先選擇 TLS 或 STARTTLS，再要求即時證書檢查。"))}</p></div></div>`;
  }
  const endpoint = connectionEndpointName(result.endpoint);
  const transport = result.transport === "implicit-tls" ? "TLS" : "STARTTLS";
  const chainState = result.chainComplete
    ? tx("The returned chain reached a self-signed root.", "傳回嘅證書鏈去到自簽根證書。")
    : result.chainTruncated
      ? tx("The returned chain exceeded the eight-certificate display bound.", "傳回嘅證書鏈超過八張證書顯示上限。")
      : tx("The server/runtime did not provide a provably complete chain.", "伺服器／執行環境未有提供可以證明完整嘅證書鏈。")
  return `<div class="tls-inspection-result__summary">${icon(result.authorized && result.hostnameMatch ? "check" : "warning")}<div><strong>${escapeHtml(tx(`${endpoint.english} live ${transport} inspection completed`, `${endpoint.cantonese}即時 ${transport} 檢查完成`))}</strong><p>${escapeHtml(tx("This was an explicit certificate-only diagnostic. No account username, password, token, or mail content was sent.", "呢次係明確啟動、只檢查證書嘅診斷。未有傳送帳戶使用者名稱、密碼、權杖或者郵件內容。"))}</p></div></div>
    <dl class="tls-inspection-facts">
      <div><dt>${escapeHtml(tx("Hostname", "主機名"))}</dt><dd>${escapeHtml(result.hostnameMatch ? tx("Matches certificate", "同證書吻合") : tx("Does not match certificate", "同證書唔吻合"))}</dd></div>
      <div><dt>${escapeHtml(tx("Runtime trust", "執行環境信任"))}</dt><dd>${escapeHtml(result.authorized ? tx("Authorized", "已授權") : tlsAuthorizationIssueLabel(result.authorizationIssue))}</dd></div>
      <div><dt>${escapeHtml(tx("Protocol", "協定"))}</dt><dd>${escapeHtml(result.protocol ?? tx("Not reported", "未有報告"))}</dd></div>
      <div><dt>${escapeHtml(tx("Cipher", "加密套件"))}</dt><dd>${escapeHtml(result.cipher ?? tx("Not reported", "未有報告"))}</dd></div>
      <div><dt>${escapeHtml(tx("Bound", "時間上限"))}</dt><dd>${escapeHtml(tx(`${result.timeoutMs / 1_000} seconds total`, `總共 ${result.timeoutMs / 1_000} 秒`))}</dd></div>
    </dl>
    <p class="tls-inspection-chain-state">${escapeHtml(chainState)}</p>
    <ol class="tls-certificate-chain" aria-label="${escapeHtml(tx("Redacted certificate chain, leaf first", "已遮蔽證書鏈，葉證書行先"))}">${result.chain.map(certificate => `<li><strong>${escapeHtml(tx(certificate.position === 0 ? "Leaf certificate" : `Chain certificate ${certificate.position + 1}`, certificate.position === 0 ? "葉證書" : `證書鏈第 ${certificate.position + 1} 張`))}</strong><span><code>${escapeHtml(certificate.certificateId)}</code> · ${escapeHtml(certificate.publicKeyBits ? `${certificate.publicKeyAlgorithm.toUpperCase()} ${certificate.publicKeyBits}` : certificate.publicKeyAlgorithm.toUpperCase())}</span><span>${escapeHtml(tx("Valid", "有效期"))}: ${escapeHtml(certificate.validFrom ? formatDate(certificate.validFrom) : tx("unknown", "未知"))} – ${escapeHtml(certificate.validTo ? formatDate(certificate.validTo) : tx("unknown", "未知"))}${certificate.selfSigned ? ` · ${escapeHtml(tx("self-signed", "自簽"))}` : ""}</span></li>`).join("")}</ol>
    <p class="tls-inspection-redaction">${icon("info")}<span>${escapeHtml(tx("Redacted output: subject and issuer names, SAN entries, serial numbers, full fingerprints, PEM/DER bytes, and server greetings stay in the main process and are not displayed or persisted. Short certificate IDs are one-way SHA-256 prefixes for this review only.", "已遮蔽輸出：主體同簽發者名稱、SAN 項目、序號、完整指紋、PEM／DER 內容同伺服器歡迎訊息都留喺主程序，唔會顯示或者儲存。短證書 ID 只係今次審閱用嘅單向 SHA-256 前綴。"))}</span></p>`;
};

const renderConnectionPreflight = (settings: MailConnectionSettings): string => {
  const diagnostics = diagnoseMailConnection(settings).filter(diagnostic => diagnostic.code !== "hostname-empty");
  return `<section class="connection-preflight" data-testid="connection-preflight" role="status" aria-live="polite" aria-atomic="true" aria-labelledby="connection-preflight-title" aria-describedby="connection-preflight-description" tabindex="-1">
    <header><span class="settings-card__icon">${icon("check")}</span><div><h3 id="connection-preflight-title">${escapeHtml(tx("Certificate and connection preflight", "證書同連線預檢"))}</h3><p id="connection-preflight-description">${escapeHtml(tx("Local checks only: the app has not opened a connection or inspected a server certificate. TLS will compare the certificate identity with the exact mail host entered here.", "只做本機檢查：應用程式未有開啟連線，亦未有檢查伺服器證書。TLS 會用證書身份配對呢度輸入嘅確切郵件主機。"))}</p></div></header>
    <div id="connection-preflight-list" data-connection-preflight-list>${renderConnectionDiagnosticItems(diagnostics, settings)}</div>
    <div class="tls-inspection-actions"><p>${escapeHtml(tx("Optional live inspection starts only when you press a button. It uses the host, port, and TLS mode shown above with a five-second total timeout and never sends account credentials.", "選用即時檢查只會喺你撳掣先開始。佢會用上面顯示嘅主機、連接埠同 TLS 模式，總時間上限五秒，而且永遠唔會傳送帳戶憑證。"))}</p><div class="button-row"><button class="button button--outlined" type="button" data-action="inspect-tls-certificate" data-tls-endpoint="incoming" data-testid="inspect-incoming-certificate">${icon("search")}<span>${escapeHtml(tx("Inspect incoming certificate", "檢查收取證書"))}</span></button><button class="button button--outlined" type="button" data-action="inspect-tls-certificate" data-tls-endpoint="outgoing" data-testid="inspect-outgoing-certificate">${icon("search")}<span>${escapeHtml(tx("Inspect outgoing certificate", "檢查寄出證書"))}</span></button></div></div>
    <div class="tls-inspection-results"><section class="tls-inspection-result" data-tls-inspection-result="incoming" role="status" aria-live="polite" aria-atomic="true" aria-label="${escapeHtml(tx("Incoming certificate inspection result", "收取證書檢查結果"))}"></section><section class="tls-inspection-result" data-tls-inspection-result="outgoing" role="status" aria-live="polite" aria-atomic="true" aria-label="${escapeHtml(tx("Outgoing certificate inspection result", "寄出證書檢查結果"))}"></section></div>
  </section>`;
};

const oauthAuthorizationIsActive = (snapshot = state.oauthAuthorization): boolean =>
  snapshot.phase === "preparing" || snapshot.phase === "opening-browser" || snapshot.phase === "waiting-for-callback";

const oauthAuthorizationCopy = (): { title: string; body: string; alert: boolean } => {
  const snapshot = state.oauthAuthorization;
  switch (snapshot.phase) {
    case "preparing": return {
      title: tx("Preparing the private callback", "準備緊私人回呼"),
      body: tx("Material Email is binding a temporary loopback port and creating a fresh PKCE challenge. Nothing has been saved.", "Material Email 正綁定臨時 loopback 連接埠，同埋建立全新 PKCE challenge。仲未儲存任何嘢。"),
      alert: false,
    };
    case "opening-browser": return {
      title: tx("Opening browser authorization", "開緊瀏覽器授權"),
      body: tx("The authorization URL stays in the main process. This window receives status only—no URL, verifier, code, or token crosses the desktop bridge.", "授權網址留喺主程序。呢個視窗只會收到狀態——網址、verifier、授權碼同權杖全部唔會跨過桌面連接。"),
      alert: false,
    };
    case "waiting-for-callback": return {
      title: tx("Waiting for the exact loopback callback", "等緊完全吻合嘅 loopback 回呼"),
      body: tx(
        `The temporary listener accepts only its exact 127.0.0.1 port, path, and state${snapshot.expiresAt ? ` until ${formatDate(snapshot.expiresAt)}` : ""}. You can cancel without saving anything.`,
        `臨時監聽器只接受完全吻合嘅 127.0.0.1 連接埠、路徑同 state${snapshot.expiresAt ? `，有效至 ${formatDate(snapshot.expiresAt)}` : ""}。你可以取消，唔會儲存任何嘢。`,
      ),
      alert: false,
    };
    case "authorization-received": return {
      title: tx("Callback validated; account still disconnected", "回呼已驗證；帳戶仍然未連接"),
      body: tx("The one-time authorization code was discarded. This build has no token exchange, token storage, or live provider account connection.", "一次性授權碼已捨棄。呢個版本冇 token exchange、權杖儲存或者即時供應商帳戶連接。"),
      alert: false,
    };
    case "cancelled": return {
      title: tx("Browser authorization cancelled", "瀏覽器授權已取消"),
      body: tx("The loopback listener closed and its temporary state was cleared. No code or token was saved.", "Loopback 監聽器已關閉，臨時狀態亦已清除。冇儲存授權碼或者權杖。"),
      alert: false,
    };
    case "timed-out": return {
      title: tx("Browser authorization timed out", "瀏覽器授權已逾時"),
      body: tx("The temporary listener closed after its bounded wait. Start a new attempt only when provider registration is available.", "臨時監聽器喺有限等候時間之後已關閉。供應商註冊可用時先開始新一次。"),
      alert: true,
    };
    case "error": {
      const copy = (() => {
        switch (snapshot.failure) {
          case "provider-not-configured": return tx("This build has no client registration for that provider. No browser or listener was opened.", "呢個版本冇嗰個供應商嘅 client registration。未有開瀏覽器或者監聽器。") ;
          case "callback-listener-failed": return tx("The temporary loopback listener could not start or remain available. No provider credential was sent or saved.", "臨時 loopback 監聽器啟動唔到或者未能維持。冇傳送或者儲存供應商憑證。") ;
          case "browser-open-failed": return tx("Windows could not open the authorization URL. The temporary listener closed and its secrets were cleared.", "Windows 開唔到授權網址。臨時監聽器已關閉，秘密狀態亦已清除。") ;
          case "provider-denied": return tx("The provider reported that authorization was denied. No code or token was retained.", "供應商報告授權被拒絕。冇保留授權碼或者權杖。") ;
          case "provider-error": return tx("The provider returned an error. Provider details were not copied into the app, and no code or token was retained.", "供應商傳回錯誤。供應商詳細資料冇複製入應用程式，亦冇保留授權碼或者權杖。") ;
          default: return tx("The callback did not satisfy the exact local checks. Temporary authorization state was cleared.", "回呼未能通過精準本機檢查。臨時授權狀態已清除。") ;
        }
      })();
      return { title: tx("Browser authorization stopped safely", "瀏覽器授權已安全停止"), body: copy, alert: true };
    }
    default: return {
      title: tx("Browser authorization foundation", "瀏覽器授權地基"),
      body: tx("Choose a provider to inspect availability. The current public build has no provider client registration, so it cannot complete a live login or token exchange.", "揀供應商查看可用狀態。目前公開版本冇供應商 client registration，所以唔可以完成即時登入或者 token exchange。"),
      alert: false,
    };
  }
};

const renderOAuthAuthorizationPanel = (): string => {
  const snapshot = state.oauthAuthorization;
  const active = oauthAuthorizationIsActive(snapshot);
  const selected = snapshot.providers.find(provider => provider.id === state.oauthProvider) ?? snapshot.providers[0];
  const copy = oauthAuthorizationCopy();
  return `<section class="oauth-foundation" data-testid="oauth-foundation" data-oauth-panel hidden aria-labelledby="oauth-foundation-title" aria-describedby="oauth-foundation-boundary">
    <header><span class="settings-card__icon">${icon("account")}</span><div><h3 id="oauth-foundation-title">${escapeHtml(tx("OAuth browser authorization foundation", "OAuth 瀏覽器授權地基"))}</h3><p>${escapeHtml(tx("Local, bounded, and intentionally stopped before token exchange", "本機、有界，而且刻意喺 token exchange 之前停低"))}</p></div></header>
    <p class="oauth-foundation__boundary" id="oauth-foundation-boundary">${icon("info")}<span>${escapeHtml(tx("No provider client registration ships in this build. The app never asks you to paste an OAuth token; the foundation keeps PKCE verifier, callback state, authorization URL, and code out of renderer IPC and persistent storage.", "呢個版本冇附帶供應商 client registration。應用程式永遠唔會叫你貼 OAuth 權杖；呢個地基會將 PKCE verifier、回呼 state、授權網址同授權碼留喺 renderer IPC 同持久儲存之外。"))}</span></p>
    <div class="oauth-foundation__controls">
      <label class="field"><span>${escapeHtml(tx("Browser provider", "瀏覽器供應商"))}</span><select name="oauthProvider" data-action-change="select-oauth-provider" aria-describedby="oauth-provider-support" ${active ? "disabled" : ""}>${snapshot.providers.map(provider => `<option value="${provider.id}" ${provider.id === state.oauthProvider ? "selected" : ""}>${escapeHtml(`${provider.name} — ${provider.configured ? tx("configured", "已設定") : tx("not configured", "未設定")}`)}</option>`).join("")}</select></label>
      <p id="oauth-provider-support" class="supporting-copy">${escapeHtml(selected?.configured ? tx("This provider configuration can exercise the local authorization foundation. A connected mail account still requires a separately reviewed token exchange and secure token lifecycle.", "呢個供應商設定可以運行本機授權地基。要連接郵件帳戶，仍然需要另行審閱 token exchange 同安全權杖生命週期。") : tx("Provider registration unavailable. The button stays disabled; no browser, loopback listener, mail server, or provider endpoint will be contacted.", "供應商註冊不可用。按鈕會保持停用；唔會聯絡瀏覽器、loopback 監聽器、郵件伺服器或者供應商端點。"))}</p>
    </div>
    <div class="oauth-foundation__status${copy.alert ? " oauth-foundation__status--error" : ""}" data-testid="oauth-status" role="${copy.alert ? "alert" : "status"}" aria-live="${copy.alert ? "assertive" : "polite"}" aria-atomic="true" aria-busy="${active}">${icon(copy.alert ? "warning" : active ? "refresh" : snapshot.phase === "authorization-received" ? "check" : "info", active ? "is-spinning" : "")}<div><strong>${escapeHtml(copy.title)}</strong><p>${escapeHtml(copy.body)}</p></div></div>
    <div class="button-row oauth-foundation__actions"><button class="button button--tonal" type="button" data-action="start-oauth-authorization" data-focus-key="oauth-start" ${!selected?.configured || active ? "disabled" : ""}>${icon("forward")}<span>${escapeHtml(tx("Start browser authorization", "開始瀏覽器授權"))}</span></button>${active ? `<button class="button button--outlined" type="button" data-action="cancel-oauth-authorization" data-focus-key="oauth-cancel">${icon("close")}<span>${escapeHtml(tx("Cancel authorization", "取消授權"))}</span></button>` : ""}</div>
  </section>`;
};

const renderPop3FoundationPanel = (): string => `<section class="pop3-foundation" data-testid="pop3-foundation" data-pop3-panel hidden tabindex="-1" aria-labelledby="pop3-foundation-title" aria-describedby="pop3-foundation-boundary">
  <header><span class="settings-card__icon">${icon("download")}</span><div><h3 id="pop3-foundation-title">${escapeHtml(tx("POP3 local foundation", "POP3 本機地基"))}</h3><p>${escapeHtml(tx("Deterministic fixture transport; live POP3 remains off", "固定道具傳輸；即時 POP3 仍然關閉"))}</p></div></header>
  <div class="form-grid pop3-foundation__options">
    <label class="field"><span>${escapeHtml(tx("Transport", "傳輸"))}</span><select name="pop3Transport" aria-describedby="pop3-foundation-boundary"><option value="local-demo">${escapeHtml(tx("Local demo · no network", "本機示範 · 冇網絡"))}</option><option value="live-network" disabled>${escapeHtml(tx("Live network · unavailable", "即時網絡 · 不可用"))}</option></select></label>
    <label class="field"><span>${escapeHtml(tx("Messages per demo check", "每次示範檢查郵件數"))}</span><input type="number" name="pop3MessageLimit" value="3" min="${POP3_MESSAGE_LIMIT_MIN}" max="${POP3_MESSAGE_LIMIT_MAX}" step="1" inputmode="numeric" aria-describedby="pop3-message-limit-help"/><small id="pop3-message-limit-help">${escapeHtml(tx(`Bounded from ${POP3_MESSAGE_LIMIT_MIN} through ${POP3_MESSAGE_LIMIT_MAX}. The bundled fixture currently contains three messages.`, `上限由 ${POP3_MESSAGE_LIMIT_MIN} 至 ${POP3_MESSAGE_LIMIT_MAX}。內置道具目前有三封郵件。`))}</small></label>
    <label class="field"><span>${escapeHtml(tx("Retrieval mode", "收取模式"))}</span><select name="pop3RetrievalMode"><option value="new-only">${escapeHtml(tx("New fixture messages only", "只收新道具郵件"))}</option></select></label>
    <label class="toggle-row pop3-foundation__leave"><input type="checkbox" name="pop3LeaveOnServer" checked disabled aria-describedby="pop3-deletion-boundary"/><span>${escapeHtml(tx("Leave messages on server (required)", "郵件保留喺伺服器（必須）"))}</span></label>
  </div>
  <p class="pop3-foundation__boundary" id="pop3-foundation-boundary">${icon("info")}<span>${escapeHtml(tx("The demo ignores the entered host, username, and password. It opens no socket, performs no TLS handshake, sends no credential, and saves no account.", "示範會忽略輸入嘅主機、使用者名稱同密碼。佢唔會開 socket、唔會做 TLS 握手、唔會傳送憑證，亦唔會儲存帳戶。"))}</span></p>
  <p class="pop3-foundation__boundary" id="pop3-deletion-boundary">${icon("warning")}<span>${escapeHtml(tx("DELE, server deletion, folder mapping, outgoing delivery, polling, persistence, and full synchronization are not implemented. The local result cannot prove provider interoperability.", "DELE、伺服器刪除、資料夾對應、寄出郵件、輪詢、持久儲存同完整同步全部未有實作。本機結果唔可以證明供應商互通性。"))}</span></p>
  <div class="button-row"><button class="button button--tonal" type="button" data-action="run-pop3-foundation" data-testid="run-pop3-foundation">${icon("forward")}<span>${escapeHtml(tx("Run local POP3 demo", "運行本機 POP3 示範"))}</span></button></div>
  <div class="pop3-foundation__result" data-testid="pop3-foundation-result" data-pop3-result role="status" aria-live="polite" aria-atomic="true"><p>${icon("info")}<span>${escapeHtml(tx("Ready. Running this demo will not contact the configured server.", "準備好。運行呢個示範唔會聯絡已設定嘅伺服器。"))}</span></p></div>
</section>`;

function renderAccountSetup(): string {
  const discovery = state.selectedDiscovery;
  const incoming = discovery?.incoming ?? { host: "", port: 993, security: "tls" as const, username: state.setupEmail };
  const outgoing = discovery?.outgoing ?? { host: "", port: 587, security: "starttls" as const, username: state.setupEmail };
  const emailName = state.setupEmail.includes("@") ? state.setupEmail.slice(0, state.setupEmail.indexOf("@")) : "";
  return `<div class="modal-layer setup-layer">
    <section class="setup-dialog" data-testid="onboarding" role="dialog" aria-modal="true" aria-labelledby="setup-title">
      <aside class="setup-hero">
        <div class="brand-mark" aria-hidden="true">M</div>
        <p class="eyebrow">${escapeHtml(tx("WELCOME TO", "歡迎使用"))}</p>
        <h1 id="setup-title">Material Email</h1>
        <p>${escapeHtml(tone(
          ["Connect securely with IMAP and SMTP.", "Connect securely with IMAP and SMTP, or explore the local demo.", "Bring your inbox over with IMAP and SMTP—the sensible mail plumbing.", "Bring your inbox over; we will label every mail pipe before turning the tap.", "Bring your inbox over. The mail pipes are labelled, the demo kettle is on, and no mystery button sends anything."],
          ["使用 IMAP 同 SMTP 安全連接。", "使用 IMAP 同 SMTP 安全連接，或者探索本機示範。", "用 IMAP 同 SMTP 搬個收件匣過嚟，郵件水喉清清楚楚。", "搬個收件匣過嚟；開水掣之前，每條郵件水喉都有名有姓。", "搬個收件匣過嚟啦。郵件水喉有標籤、示範水滾緊，冇任何神秘掣會偷雞寄信。"],
        ))}</p>
        <ul class="privacy-list"><li>${icon("check")}<span>${escapeHtml(tx("Credentials go only to the desktop bridge and are encrypted by Windows.", "憑證只會交畀桌面連接，並由 Windows 加密。"))}</span></li><li>${icon("check")}<span>${escapeHtml(tx("Test checks both servers before an account is saved.", "儲存帳戶之前，「測試」會檢查兩邊伺服器。"))}</span></li><li>${icon("check")}<span>${escapeHtml(tx("Manual settings always remain editable.", "手動設定永遠都可以再編輯。"))}</span></li></ul>
        <button class="button button--tonal demo-setup-button" data-testid="demo-action" type="button" data-action="create-demo" ${isBusy("create-demo") ? "disabled" : ""}>${icon("mail")}<span>${escapeHtml(isBusy("create-demo") ? tx("Opening demo…", "開緊示範……") : tx("Use the local demo", "使用本機示範"))}</span></button>
      </aside>
      <div class="setup-form-column">
        <header class="setup-form-heading"><div><p class="eyebrow">${escapeHtml(tx("ACCOUNT SETUP", "帳戶設定"))}</p><h2>${escapeHtml(tx("Add your email address", "加入你嘅電郵地址"))}</h2></div>${state.setupContext === "settings" ? `<button class="icon-button" type="button" data-action="close-account-setup" aria-label="${escapeHtml(tx("Close account setup", "關閉帳戶設定"))}">${icon("close")}</button>` : ""}</header>
        <form id="account-setup-form" data-form="account-setup" novalidate>
          <div class="discovery-row">
            <label class="field field--grow"><span>${escapeHtml(tx("Email address", "電郵地址"))}</span><input type="email" name="email" value="${escapeHtml(state.setupEmail || discovery?.email || "")}" required maxlength="320" autocomplete="email" data-focus-key="setup-email" placeholder="you@example.com" /></label>
            <button class="button button--outlined discover-button" type="button" data-action="discover-account" ${isBusy("discover-account") ? "disabled" : ""}>${icon("search", isBusy("discover-account") ? "is-spinning" : "")}<span>${escapeHtml(isBusy("discover-account") ? tx("Discovering…", "探索緊……") : tx("Discover", "自動探索"))}</span></button>
          </div>
          ${state.discoveries.length ? `<fieldset class="discovery-results"><legend>${escapeHtml(tx("Discovered configurations", "探索到嘅設定"))}</legend>${state.discoveries.map((candidate, index) => `<label class="discovery-option"><input type="radio" name="discovery" value="${index}" ${candidate === discovery ? "checked" : ""} data-discovery-index="${index}"/><span><strong>${escapeHtml(candidate.source === "dns-srv" ? tx("Provider DNS records", "供應商 DNS 記錄") : candidate.source === "provider-preset" ? tx("Known provider preset", "已知供應商預設") : tx("Conventional settings", "常用設定"))}</strong><small>${escapeHtml(candidate.incoming.host)}:${candidate.incoming.port} · ${escapeHtml(candidate.outgoing.host)}:${candidate.outgoing.port}</small></span></label>`).join("")}</fieldset>` : ""}
          <label class="field"><span>${escapeHtml(tx("Your name", "你嘅名稱"))}</span><input type="text" name="displayName" value="${escapeHtml(discovery?.displayName || emailName)}" required maxlength="120" autocomplete="name" placeholder="Alex Wong" /></label>
          <label class="field"><span>${escapeHtml(tx("Incoming protocol", "收取協定"))}</span><select name="incomingProtocol" aria-describedby="incoming-protocol-boundary"><option value="imap">IMAP · ${escapeHtml(tx("live account path", "即時帳戶路徑"))}</option><option value="pop3">POP3 · ${escapeHtml(tx("local foundation only", "只限本機地基"))}</option></select></label>
          <p class="supporting-copy" id="incoming-protocol-boundary"><span data-incoming-protocol-copy="imap">${escapeHtml(tx("IMAP can use the reviewed account test and save path below. Choose POP3 only to inspect its local bounded foundation; live POP3 is not connected.", "IMAP 可以使用下面經審閱嘅帳戶測試同儲存路徑。選擇 POP3 只會檢查本機有界地基；即時 POP3 未有接駁。"))}</span><span data-incoming-protocol-copy="pop3" hidden>${escapeHtml(tx("POP3 configuration is validated locally, but Test settings, Connect account, incoming certificate inspection, credentials, deletion, and synchronization stay disabled. Run the local demo instead.", "POP3 設定會喺本機驗證，但「測試設定」、「連接帳戶」、收取證書檢查、憑證、刪除同同步全部保持停用。請改為運行本機示範。"))}</span></p>
          <div class="server-card">
            <div class="server-card__title"><span>${icon("download")}</span><div><h3><span data-incoming-protocol-heading="imap">${escapeHtml(tx("Incoming mail · IMAP", "收取郵件 · IMAP"))}</span><span data-incoming-protocol-heading="pop3" hidden>${escapeHtml(tx("Incoming mail · POP3 configuration", "收取郵件 · POP3 設定"))}</span></h3><p><span data-incoming-protocol-subtitle="imap">${escapeHtml(tx("Messages and folders", "郵件同資料夾"))}</span><span data-incoming-protocol-subtitle="pop3" hidden>${escapeHtml(tx("Local validation and demo only", "只限本機驗證同示範"))}</span></p></div></div>
            <div class="server-grid">
              <label class="field field--wide"><span>${escapeHtml(tx("Host", "主機"))}</span><input type="text" name="incomingHost" value="${escapeHtml(incoming.host)}" required maxlength="255" autocomplete="off" placeholder="imap.example.com" aria-describedby="connection-preflight-description connection-preflight-list" /></label>
              <label class="field"><span>${escapeHtml(tx("Port", "連接埠"))}</span><input type="number" name="incomingPort" value="${incoming.port}" required min="1" max="65535" inputmode="numeric" aria-describedby="connection-preflight-description connection-preflight-list" /></label>
              <label class="field"><span>${escapeHtml(tx("Security", "安全性"))}</span><select name="incomingSecurity" aria-describedby="connection-preflight-description connection-preflight-list">${renderSecurityOptions(incoming.security)}</select></label>
              <label class="field field--wide"><span>${escapeHtml(tx("Username", "使用者名稱"))}</span><input type="text" name="incomingUsername" value="${escapeHtml(incoming.username)}" required maxlength="320" autocomplete="username" /></label>
            </div>
          </div>
          ${renderPop3FoundationPanel()}
          <div class="server-card">
            <div class="server-card__title"><span>${icon("send")}</span><div><h3>${escapeHtml(tx("Outgoing mail · SMTP", "寄出郵件 · SMTP"))}</h3><p>${escapeHtml(tx("Delivery and authentication", "傳送同驗證"))}</p></div></div>
            <div class="server-grid">
              <label class="field field--wide"><span>${escapeHtml(tx("Host", "主機"))}</span><input type="text" name="outgoingHost" value="${escapeHtml(outgoing.host)}" required maxlength="255" autocomplete="off" placeholder="smtp.example.com" aria-describedby="connection-preflight-description connection-preflight-list" /></label>
              <label class="field"><span>${escapeHtml(tx("Port", "連接埠"))}</span><input type="number" name="outgoingPort" value="${outgoing.port}" required min="1" max="65535" inputmode="numeric" aria-describedby="connection-preflight-description connection-preflight-list" /></label>
              <label class="field"><span>${escapeHtml(tx("Security", "安全性"))}</span><select name="outgoingSecurity" aria-describedby="connection-preflight-description connection-preflight-list">${renderSecurityOptions(outgoing.security)}</select></label>
              <label class="field field--wide"><span>${escapeHtml(tx("Username", "使用者名稱"))}</span><input type="text" name="outgoingUsername" value="${escapeHtml(outgoing.username)}" required maxlength="320" autocomplete="username" /></label>
            </div>
          </div>
          <div class="credential-grid">
            <label class="field"><span>${escapeHtml(tx("Authentication", "驗證方式"))}</span><select name="authMode" aria-describedby="authentication-boundary"><option value="password" ${!discovery || discovery.authModes.includes("password") ? "" : "disabled"}>${escapeHtml(tx("Password", "密碼"))}</option><option value="oauth2">${escapeHtml(tx("OAuth 2 browser foundation", "OAuth 2 瀏覽器地基"))}</option></select></label>
            <label class="field" data-password-credential><span>${escapeHtml(tx("Password", "密碼"))}</span><input type="password" name="secret" required maxlength="16384" autocomplete="current-password" /></label>
          </div>
          <p id="authentication-boundary" class="supporting-copy">${escapeHtml(tx("Password mode can test and save an encrypted password. OAuth mode cannot accept a pasted token and cannot connect an account in this build.", "密碼模式可以測試同加密儲存密碼。OAuth 模式喺呢個版本唔接受貼上權杖，亦唔可以連接帳戶。"))}</p>
          ${renderOAuthAuthorizationPanel()}
          ${renderConnectionPreflight({ incomingProtocol: "imap", incoming, outgoing })}
          <p class="security-disclosure">${icon("info")}<span>${escapeHtml(tx("Required TLS never falls back to plain text. Password testing contacts the named mail servers; adding saves the encrypted password only after both checks succeed. OAuth foundation actions never test mail or save a token.", "必須使用 TLS 時絕對唔會降級到純文字。密碼測試會聯絡指定郵件伺服器；兩邊檢查成功之後先會加密儲存密碼。OAuth 地基操作唔會測試郵件或者儲存權杖。"))}</span></p>
          <footer class="setup-actions">
            ${state.setupContext === "settings" ? `<button class="button button--text" type="button" data-action="close-account-setup">${escapeHtml(tx("Cancel", "取消"))}</button>` : ""}
            <span class="action-spacer"></span>
            <button class="button button--outlined" type="submit" data-account-submit="test" ${isBusy("account-test") || isBusy("account-add") ? "disabled" : ""}>${icon("check")}<span>${escapeHtml(isBusy("account-test") ? tx("Testing…", "測試緊……") : tx("Test settings", "測試設定"))}</span></button>
            <button class="button button--filled" type="submit" data-account-submit="add" ${isBusy("account-test") || isBusy("account-add") ? "disabled" : ""}>${icon("account")}<span>${escapeHtml(isBusy("account-add") ? tx("Connecting…", "連接緊……") : tx("Connect account", "連接帳戶"))}</span></button>
          </footer>
        </form>
      </div>
    </section>
  </div>`;
}

function renderSecurityOptions(selected: AccountDraft["incoming"]["security"]): string {
  return ([
    ["tls", tx("TLS (recommended)", "TLS（建議）")],
    ["starttls", "STARTTLS"],
    ["plain", tx("Plain (not recommended)", "純文字（唔建議）")],
  ] as const).map(([value, label]) => `<option value="${value}" ${value === selected ? "selected" : ""}>${escapeHtml(label)}</option>`).join("");
}

function settingSectionMatches(keywords: string): boolean {
  const model = searchFor("settings");
  return !model.pattern || createMatcher(model)(keywords);
}

function renderSettingsPage(): string {
  const prefs = preferences();
  const sections = [
    settingSectionMatches("appearance theme light dark system density compact comfortable relaxed accent color font family size weight") ? renderAppearanceSettings(prefs) : "",
    settingSectionMatches("language English Cantonese bilingual funny humour voice narrator warning error dim sum startup") ? renderLanguageSettings(prefs) : "",
    settingSectionMatches("accounts email IMAP POP3 SMTP server local demo capability state machine remove add credentials OAuth") ? renderAccountSettings() : "",
    settingSectionMatches("contacts calendars tasks PIM CardDAV CalDAV ICS provider URL HTTPS authentication import export recurrence capability local") ? renderPimProviderSettings() : "",
    settingSectionMatches("OAuth token vault Windows safeStorage encrypted access refresh rotation revoke clear provider registration credentials") ? renderOAuthTokenVaultSettings() : "",
    settingSectionMatches("external editor Visual Studio Code Cursor Notepad detect open") ? renderEditorSettings(prefs) : "",
    settingSectionMatches("tabs pin reorder overflow search restore appearance") ? renderTabSettings() : "",
  ].filter(Boolean);
  const validation = validatePattern(searchFor("settings"));
  return `<section class="standard-page settings-page" data-testid="settings-page" id="panel-settings" role="tabpanel" aria-labelledby="tab-settings">
    ${renderPageHeader("PERSONALIZE", tx("Settings", "設定"), tx("Change the app without restarting it. Every preference here is stored locally.", "唔使重新啟動就可以改個應用程式。呢度每項偏好都儲喺本機。"), "settings")}
    <div class="page-search">${renderSearchField("settings", tx("Search settings and current values", "搜尋設定同目前值"))}</div>
    ${!validation.valid && searchFor("settings").mode === "regex" ? `<div class="inline-banner inline-banner--error">${icon("warning")}<span>${escapeHtml(validation.message)}</span></div>` : ""}
    <div class="settings-grid">${sections.length ? sections.join("") : `<div class="empty-card">${icon("search")}<h2>${escapeHtml(tx("No settings match", "冇符合嘅設定"))}</h2><p>${escapeHtml(tx("Try a different query or clear the regex filter.", "試吓其他搜尋字，或者清除正規表達式篩選。"))}</p></div>`}</div>
  </section>`;
}

function renderPageHeader(eyebrow: string, title: string, description: string, iconName: IconName): string {
  return `<header class="page-header"><div class="page-header__icon">${icon(iconName)}</div><div><p class="eyebrow">${escapeHtml(eyebrow)}</p><h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p></div></header>`;
}

function renderAppearanceSettings(prefs: Preferences): string {
  return `<section class="settings-card" data-setting-section="appearance">
    <header><span class="settings-card__icon">${icon("edit")}</span><div><h2>${escapeHtml(tx("Appearance", "外觀"))}</h2><p>${escapeHtml(tx("Material color, scale, density, and typography", "Material 色彩、比例、密度同字款"))}</p></div></header>
    <div class="form-grid">
      <label class="field"><span>${escapeHtml(tx("Theme", "主題"))}</span><select data-pref="theme"><option value="system" ${prefs.theme === "system" ? "selected" : ""}>${escapeHtml(tx("Follow Windows", "跟隨 Windows"))}</option><option value="light" ${prefs.theme === "light" ? "selected" : ""}>${escapeHtml(tx("Light", "淺色"))}</option><option value="dark" ${prefs.theme === "dark" ? "selected" : ""}>${escapeHtml(tx("Dark", "深色"))}</option></select></label>
      <label class="field"><span>${escapeHtml(tx("Density", "密度"))}</span><select data-pref="density"><option value="compact" ${prefs.density === "compact" ? "selected" : ""}>${escapeHtml(tx("Compact", "緊湊"))}</option><option value="comfortable" ${prefs.density === "comfortable" ? "selected" : ""}>${escapeHtml(tx("Comfortable", "舒適"))}</option><option value="relaxed" ${prefs.density === "relaxed" ? "selected" : ""}>${escapeHtml(tx("Relaxed", "寬鬆"))}</option></select></label>
      <label class="field field--color"><span>${escapeHtml(tx("Accent color", "重點色"))}</span><span class="color-input"><input type="color" value="${escapeHtml(/^#[0-9a-f]{6}$/i.test(prefs.accent) ? prefs.accent : "#6750A4")}" data-pref="accent" aria-label="${escapeHtml(tx("Choose accent color", "選擇重點色"))}"/><input type="text" value="${escapeHtml(prefs.accent)}" data-pref="accent" maxlength="64" spellcheck="false" aria-label="${escapeHtml(tx("Accent color value", "重點色數值"))}"/></span></label>
      <label class="field"><span>${escapeHtml(tx("Interface font", "介面字款"))}</span><input type="text" value="${escapeHtml(prefs.fontFamily)}" data-pref="fontFamily" list="font-suggestions" maxlength="120"/><datalist id="font-suggestions"><option value="Segoe UI Variable"></option><option value="Segoe UI"></option><option value="Microsoft JhengHei UI"></option><option value="Arial"></option><option value="Consolas"></option></datalist></label>
      <label class="field field--range"><span>${escapeHtml(tx("Font scale", "字體比例"))} <output data-pref-output="fontScale">${Math.round(prefs.fontScale * 100)}%</output></span><input type="range" min="0.8" max="1.5" step="0.05" value="${prefs.fontScale}" data-pref="fontScale"/></label>
      <label class="field field--range"><span>${escapeHtml(tx("Font weight", "字體粗幼"))} <output data-pref-output="fontWeight">${prefs.fontWeight}</output></span><input type="range" min="300" max="700" step="50" value="${prefs.fontWeight}" data-pref="fontWeight"/></label>
    </div>
    <div class="appearance-preview"><span class="avatar">Aa</span><div><strong>${escapeHtml(tx("Live preview", "即時預覽"))}</strong><p>${escapeHtml(tx("Changes apply to the whole interface while you adjust them.", "調整嗰陣，變更會即時套用到成個介面。"))}</p></div><button class="button button--tonal" type="button">${escapeHtml(tx("Material button", "Material 按鈕"))}</button></div>
    <div class="button-row appearance-actions"><button class="button button--outlined" type="button" data-action="reset-appearance">${icon("refresh")}<span>${escapeHtml(tx("Reset appearance", "重設外觀"))}</span></button></div>
  </section>`;
}

function renderLanguageSettings(prefs: Preferences): string {
  return `<section class="settings-card" data-setting-section="language">
    <header><span class="settings-card__icon">${icon("account")}</span><div><h2>${escapeHtml(tx("Language, tone, and sound", "語言、語氣同聲音"))}</h2><p>${escapeHtml(tx("Facts stay exact; the surrounding voice can loosen its tie.", "事實永遠準確；旁邊嘅語氣可以鬆一鬆條呔。"))}</p></div></header>
    <div class="form-grid">
      <label class="field"><span>${escapeHtml(tx("Language mode", "語言模式"))}</span><select data-pref="language"><option value="en" ${prefs.language === "en" ? "selected" : ""}>English</option><option value="yue" ${prefs.language === "yue" ? "selected" : ""}>香港粵語</option><option value="bilingual" ${prefs.language === "bilingual" ? "selected" : ""}>English · 香港粵語</option></select></label>
      <label class="field field--range"><span>${escapeHtml(tx("English funny level", "英文搞笑程度"))} <output data-pref-output="funnyEnglish">${prefs.funnyEnglish}</output>/5</span><input type="range" min="1" max="5" step="1" value="${prefs.funnyEnglish}" data-pref="funnyEnglish"/></label>
      <label class="field field--range"><span>${escapeHtml(tx("Cantonese funny level", "廣東話搞笑程度"))} <output data-pref-output="funnyCantonese">${prefs.funnyCantonese}</output>/5</span><input type="range" min="1" max="5" step="1" value="${prefs.funnyCantonese}" data-pref="funnyCantonese"/></label>
      <label class="switch-row"><span><strong>${escapeHtml(tx("Optional narrator", "選用旁白"))}</strong><small>${escapeHtml(tx("Off by default; speaks one event at a time.", "預設關閉；每次只讀一個事件。"))}</small></span><input type="checkbox" role="switch" data-pref="narratorEnabled" ${prefs.narratorEnabled ? "checked" : ""}/></label>
      <label class="switch-row"><span><strong>${escapeHtml(tx("Native Windows notifications", "原生 Windows 通知"))}</strong><small>${escapeHtml(tx("Off by default. Shows only generic, privacy-safe summaries; never message text or recipients.", "預設關閉。只顯示通用、保障私隱嘅摘要；永遠唔會顯示郵件內容或者收件人。"))}</small></span><input type="checkbox" role="switch" data-pref="nativeNotificationsEnabled" ${prefs.nativeNotificationsEnabled ? "checked" : ""}/></label>
      <label class="field"><span>${escapeHtml(tx("Narrator language", "旁白語言"))}</span><select data-pref="narratorLanguage" ${!prefs.narratorEnabled ? "disabled" : ""}><option value="en" ${prefs.narratorLanguage === "en" ? "selected" : ""}>English</option><option value="yue" ${prefs.narratorLanguage === "yue" ? "selected" : ""}>香港粵語</option><option value="bilingual" ${prefs.narratorLanguage === "bilingual" ? "selected" : ""}>English, then 香港粵語</option></select></label>
      <label class="switch-row"><span><strong>${escapeHtml(tx("One-percent dim-sum surprise", "百分之一點心驚喜"))}</strong><small>${escapeHtml(tx("Non-blocking, local, and disabled during first run or errors.", "唔阻住你、只用本機，而且首次啟動同錯誤流程唔會出現。"))}</small></span><input type="checkbox" role="switch" data-pref="dimSumEnabled" ${prefs.dimSumEnabled ? "checked" : ""}/></label>
    </div>
    <div class="inline-banner">${icon("info")}<span>${escapeHtml(tx("Funny levels style every message, including errors and warnings, without changing names, dates, affected data, choices, or consequences. Reset them any time.", "搞笑程度會調整所有訊息，包括錯誤同警告，但唔會改名稱、日期、受影響資料、選項同後果。隨時都可以重設。"))}</span></div>
  </section>`;
}

function renderAccountSettings(): string {
  const accounts = state.bootstrap?.accounts ?? [];
  return `<section class="settings-card settings-card--wide" data-setting-section="accounts">
    <header><span class="settings-card__icon">${icon("mail")}</span><div><h2>${escapeHtml(tx("Mail accounts", "郵件帳戶"))}</h2><p>${escapeHtml(tx("Incoming, outgoing, and identity scope", "收取、寄出同身份範圍"))}</p></div><span class="action-spacer"></span><button class="button button--filled" type="button" data-action="open-account-setup">${icon("account")}<span>${escapeHtml(tx("Add account", "新增帳戶"))}</span></button></header>
    <div class="account-list">${accounts.length ? accounts.map(account => `<article class="account-card"><span class="avatar">${escapeHtml((account.displayName.charAt(0) || "?").toUpperCase())}</span><div><strong>${escapeHtml(account.displayName)}</strong><p>${escapeHtml(account.email)}</p><small>${escapeHtml(account.kind === "demo" ? tx("Local demo · no network", "本機示範 · 唔連網") : `${account.incoming.host}:${account.incoming.port} · ${account.outgoing.host}:${account.outgoing.port}`)}</small></div><span class="account-kind">${escapeHtml(account.kind.toUpperCase())}</span><button class="icon-button danger-action" type="button" data-action="request-remove-account" data-account-id="${escapeHtml(account.id)}" aria-label="${escapeHtml(tx(`Remove ${account.email}`, `移除 ${account.email}`))}" data-tooltip="${escapeHtml(tx("Remove account", "移除帳戶"))}">${icon("trash")}</button></article>`).join("") : `<p>${escapeHtml(tx("No accounts are configured.", "未有設定帳戶。"))}</p>`}</div>
  </section>`;
}

function pimProviderCapabilityLabel(name: string): string {
  switch (name) {
    case "local-vcard-boundary": return tx("Bounded local vCard envelope", "有界本機 vCard 封套");
    case "local-icalendar-boundary": return tx("Bounded local iCalendar envelope", "有界本機 iCalendar 封套");
    case "collection-discovery": return tx("Provider collection discovery", "供應商集合探索");
    case "etag-concurrency": return tx("ETag conflict control", "ETag 衝突控制");
    case "sync-token": return tx("Sync-token continuation", "同步權杖接續");
    case "remote-read": return tx("Provider read", "供應商讀取");
    case "remote-write": return tx("Provider write-back", "供應商寫回");
    case "scheduling": return tx("Invitations and scheduling", "邀請同排程");
    case "recurrence-expansion": return tx("Recurrence expansion", "重複活動展開");
    case "credential-use": return tx("Credential handling", "憑證處理");
    default: return name;
  }
}

function renderPimProviderResult(): string {
  const snapshot = state.pimProviderSnapshot;
  if (!snapshot) {
    return `<p>${icon("info")}<span>${escapeHtml(tx("Ready. Local validation will not contact, authenticate with, or save the provider.", "準備好。本機驗證唔會聯絡供應商、唔會登入，亦唔會儲存供應商。"))}</span></p>`;
  }
  const transitions = snapshot.transitions.map(item => `${item.sequence}. ${item.from} —${item.event}→ ${item.to}`).join("\n");
  const factValue = (english: string, cantonese: string): string => escapeHtml(tx(english, cantonese));
  const facts = `<dl class="pop3-foundation__facts">
    <div><dt>${factValue("Endpoint contacted", "已聯絡端點")}</dt><dd>${factValue("No", "冇")}</dd></div>
    <div><dt>${factValue("Credential used", "已使用憑證")}</dt><dd>${factValue("No", "冇")}</dd></div>
    <div><dt>${factValue("Provider state saved", "已儲存供應商狀態")}</dt><dd>${factValue("No", "冇")}</dd></div>
    <div><dt>${factValue("Live synchronization", "即時同步")}</dt><dd>${factValue("Not provided", "未提供")}</dd></div>
    <div><dt>${factValue("Recurrence", "重複活動")}</dt><dd>${factValue("Metadata only; not expanded", "只保留 metadata；冇展開")}</dd></div>
    <div><dt>${factValue("Boundary", "邊界")}</dt><dd>${factValue("Local validation only", "只限本機驗證")}</dd></div>
  </dl>`;
  if (snapshot.state === "rejected") {
    return `<div class="pop3-foundation__summary pop3-foundation__summary--warning">${icon("warning")}<div><strong>${escapeHtml(tx("Profile rejected locally", "設定檔已喺本機拒絕"))}</strong><p>${escapeHtml(tx("Correct the listed fields. No provider interaction was attempted.", "修正列出嘅欄位。完全冇嘗試同供應商互動。"))}</p></div></div>
      <ul class="pop3-foundation__messages">${snapshot.issues.map(issue => `<li><strong>${escapeHtml(issue)}</strong></li>`).join("")}</ul>
      ${facts}
      <details><summary>${escapeHtml(tx("Deterministic state trace", "固定狀態軌跡"))}</summary><pre>${escapeHtml(transitions)}</pre></details>`;
  }
  const capabilities = snapshot.capabilities.map(capability => `<li><strong>${escapeHtml(pimProviderCapabilityLabel(capability.name))}</strong><span>${escapeHtml(capability.available
    ? tx("Available only at the bounded local import/export envelope", "只喺有界本機匯入／匯出封套可用")
    : tx("Unavailable; no provider proof", "不可用；冇供應商證據"))}</span></li>`).join("");
  return `<div class="pop3-foundation__summary">${icon("check")}<div><strong>${escapeHtml(tx("Local provider profile is structurally ready", "本機供應商設定檔結構已準備好"))}</strong><p>${escapeHtml(tx("This proves only URL, HTTPS, authentication-mode, and local capability rules.", "呢個只證明 URL、HTTPS、驗證模式同本機能力規則。"))}</p></div></div>
    <p class="pop3-foundation__boundary"><span><strong>${escapeHtml(tx("Normalized URL", "正規化 URL"))}</strong><br/><code><bdi>${escapeHtml(snapshot.profile?.endpointUrl ?? "")}</bdi></code></span></p>
    ${facts}
    <details open><summary>${escapeHtml(tx("Capability model", "能力模型"))}</summary><ul class="pop3-foundation__messages">${capabilities}</ul></details>
    <details><summary>${escapeHtml(tx("Deterministic state trace", "固定狀態軌跡"))}</summary><pre>${escapeHtml(transitions)}</pre></details>`;
}

function renderPimProviderSettings(): string {
  const profile = state.pimProviderProfile;
  const isIcs = profile.kind === "ics-file";
  const endpointHelp = isIcs
    ? tx("Use an absolute Windows file URL ending in .ics, for example file:///C:/Calendars/home.ics. UNC and network files are refused.", "使用以 .ics 結尾嘅 Windows 絕對檔案 URL，例如 file:///C:/Calendars/home.ics。UNC 同網絡檔案會被拒絕。")
    : tx("CardDAV and CalDAV require an absolute HTTPS URL without user info, query data, or a fragment.", "CardDAV 同 CalDAV 必須使用絕對 HTTPS URL，唔可以包含使用者資料、query 資料或者 fragment。 ");
  return `<section class="settings-card settings-card--wide pim-provider-settings" data-setting-section="pim-providers" data-testid="pim-provider-settings" aria-labelledby="pim-provider-title">
    <header><span class="settings-card__icon">${icon("calendar")}</span><div><h2 id="pim-provider-title">${escapeHtml(tx("Contacts and calendar provider foundation", "聯絡人同日曆供應商地基"))}</h2><p>${escapeHtml(tx("Local CardDAV, CalDAV, and ICS validation with zero live provider claims", "本機 CardDAV、CalDAV 同 ICS 驗證；零即時供應商聲稱"))}</p></div></header>
    <form class="pop3-foundation pim-provider-foundation" data-form="pim-provider-foundation" aria-describedby="pim-provider-boundary pim-interchange-boundary">
      <div class="form-grid pop3-foundation__options">
        <label class="field"><span>${escapeHtml(tx("Provider kind", "供應商類型"))}</span><select name="kind"><option value="carddav" ${profile.kind === "carddav" ? "selected" : ""}>CardDAV · vCard</option><option value="caldav" ${profile.kind === "caldav" ? "selected" : ""}>CalDAV · iCalendar</option><option value="ics-file" ${isIcs ? "selected" : ""}>${escapeHtml(tx("Local ICS file", "本機 ICS 檔案"))}</option></select></label>
        <label class="field"><span>${escapeHtml(tx("Authentication mode", "驗證模式"))}</span><select name="authMode" ${isIcs ? "disabled" : ""} aria-describedby="pim-auth-boundary"><option value="none" ${profile.authMode === "none" ? "selected" : ""}>${escapeHtml(tx("None / public metadata", "無／公開 metadata"))}</option><option value="basic" ${profile.authMode === "basic" ? "selected" : ""}>${escapeHtml(tx("Password mode label only", "只記錄密碼模式標籤"))}</option><option value="oauth2" ${profile.authMode === "oauth2" ? "selected" : ""}>${escapeHtml(tx("OAuth 2 mode label only", "只記錄 OAuth 2 模式標籤"))}</option></select><small id="pim-auth-boundary">${escapeHtml(tx("This foundation accepts no user name, password, token, client ID, or scope.", "呢個地基唔會接收使用者名稱、密碼、權杖、client ID 或 scope。"))}</small></label>
        <label class="field"><span>${escapeHtml(tx("Provider URL", "供應商 URL"))}</span><input name="endpointUrl" type="text" inputmode="url" value="${escapeHtml(profile.endpointUrl)}" maxlength="2048" required autocomplete="off" autocapitalize="off" spellcheck="false" aria-describedby="pim-endpoint-help" placeholder="${escapeHtml(isIcs ? "file:///C:/Calendars/home.ics" : "https://calendar.example.test/dav/")}"/><small id="pim-endpoint-help">${escapeHtml(endpointHelp)}</small></label>
      </div>
      <p class="pop3-foundation__boundary" id="pim-provider-boundary">${icon("warning")}<span>${escapeHtml(tx("Validation is local and ephemeral. It performs no DNS lookup, socket connection, TLS handshake, discovery, authentication, read, write, sync-token, ETag, invitation, or credential operation, and it saves no provider state.", "驗證只喺本機短暫進行。佢唔會做 DNS 查詢、socket 連線、TLS 握手、探索、登入、讀取、寫入、同步權杖、ETag、邀請或者憑證操作，亦唔會儲存供應商狀態。"))}</span></p>
      <p class="pop3-foundation__boundary" id="pim-interchange-boundary">${icon("info")}<span>${escapeHtml(tx(`The import/export gate is limited to ${PIM_INTERCHANGE_MAX_BYTES / 1_048_576} MiB local vCard 3/4 or iCalendar 2.0 envelopes. Scheduling METHOD and attachments are refused; recurrence rules are counted and preserved as metadata, never expanded. This panel does not import records.`, `匯入／匯出閘門只處理最多 ${PIM_INTERCHANGE_MAX_BYTES / 1_048_576} MiB 嘅本機 vCard 3/4 或 iCalendar 2.0 封套。排程 METHOD 同附件會被拒絕；重複規則只會計數同保留做 metadata，永遠唔會展開。呢個面板唔會匯入記錄。`))}</span></p>
      <div class="button-row"><button class="button button--tonal" type="submit" data-testid="run-pim-provider-foundation" ${isBusy("pim-provider-foundation") ? "disabled" : ""}>${icon("check", isBusy("pim-provider-foundation") ? "is-spinning" : "")}<span>${escapeHtml(isBusy("pim-provider-foundation") ? tx("Validating locally…", "本機驗證緊……") : tx("Validate local foundation", "驗證本機地基"))}</span></button></div>
      <div class="pop3-foundation__result" data-testid="pim-provider-foundation-result" role="status" aria-live="polite" aria-atomic="true" aria-busy="${isBusy("pim-provider-foundation")}">${renderPimProviderResult()}</div>
    </form>
  </section>`;
}

function renderEditorSettings(prefs: Preferences): string {
  const selectedIsDetected = Boolean(prefs.externalEditorPath && state.editors.some(editor => editor.path.toLocaleLowerCase() === prefs.externalEditorPath?.toLocaleLowerCase()));
  const customOption = prefs.externalEditorPath && !selectedIsDetected
    ? `<option value="${escapeHtml(prefs.externalEditorPath)}" selected>${escapeHtml(tx("Custom editor", "自訂編輯器"))} · ${escapeHtml(prefs.externalEditorPath)}</option>`
    : "";
  return `<section class="settings-card" data-setting-section="editors">
    <header><span class="settings-card__icon">${icon("tools")}</span><div><h2>${escapeHtml(tx("External editor", "外部編輯器"))}</h2><p>${escapeHtml(tx("Open this project in an installed editor", "用已安裝嘅編輯器開啟呢個專案"))}</p></div></header>
    <div class="editor-controls"><button class="button button--outlined" type="button" data-action="detect-editors" ${isBusy("detect-editors") ? "disabled" : ""}>${icon("search", isBusy("detect-editors") ? "is-spinning" : "")}<span>${escapeHtml(tx("Detect editors", "偵測編輯器"))}</span></button>
    <label class="field"><span>${escapeHtml(tx("Selected editor", "已選編輯器"))}</span><select data-pref="externalEditorPath"><option value="">${escapeHtml(tx("Choose after detection", "偵測之後選擇"))}</option>${customOption}${state.editors.map(editor => `<option value="${escapeHtml(editor.path)}" ${prefs.externalEditorPath?.toLocaleLowerCase() === editor.path.toLocaleLowerCase() ? "selected" : ""}>${escapeHtml(editor.name)} · ${escapeHtml(editor.path)}</option>`).join("")}</select></label>
    <button class="button button--outlined" data-testid="choose-custom-editor" type="button" data-action="choose-custom-editor" ${isBusy("choose-custom-editor") ? "disabled" : ""}>${icon("folder")}<span>${escapeHtml(isBusy("choose-custom-editor") ? tx("Choosing…", "選擇緊……") : tx("Choose custom editor…", "選擇自訂編輯器……"))}</span></button>
    <button class="button button--tonal" type="button" data-action="open-editor" ${!prefs.externalEditorPath ? "disabled" : ""}>${icon("tools")}<span>${escapeHtml(tx("Open project", "開啟專案"))}</span></button></div>
    <p class="supporting-copy">${escapeHtml(tx("The native Windows picker accepts executable (.exe) files only. Choosing one approves it locally, saves the selection, and opens this project; cancelling changes nothing.", "原生 Windows 選擇器只接受可執行 (.exe) 檔。選擇之後會喺本機批准、儲存選擇，再開啟呢個專案；取消就乜都唔改。"))}</p>
  </section>`;
}

function renderTabSettings(): string {
  return `<section class="settings-card" data-setting-section="tabs"><header><span class="settings-card__icon">${icon("folder")}</span><div><h2>${escapeHtml(tx("Workspace tabs", "工作空間分頁"))}</h2><p>${escapeHtml(tx("Order, pinning, overflow, search, and per-tab style", "次序、釘選、溢出、搜尋同每個分頁嘅樣式"))}</p></div></header><p>${escapeHtml(tx("Drag tabs to reorder. Right-click for tab management; Shift+right-click opens its appearance editor directly. Pinned tabs are protected from bulk close by default.", "拖曳分頁就可以排序。右擊管理分頁；Shift+右擊會直接開外觀編輯器。釘選分頁預設受批量關閉保護。"))}</p><div class="button-row"><button class="button button--tonal" type="button" data-action="toggle-tab-manager">${icon("search")}<span>${escapeHtml(tx("Search and manage tabs", "搜尋同管理分頁"))}</span></button><button class="button button--text" type="button" data-action="reset-tabs">${icon("refresh")}<span>${escapeHtml(tx("Reset tab layout", "重設分頁版面"))}</span></button></div></section>`;
}

function notificationMatches(item: NotificationRecord): boolean {
  const model = searchFor("notifications");
  return !model.pattern || createMatcher(model)(`${item.title}\n${item.body}\n${item.kind}`);
}

function renderNotificationsPage(): string {
  const records = (state.bootstrap?.notifications ?? []).filter(notificationMatches);
  const unread = records.filter(item => !item.read).length;
  return `<section class="standard-page" data-testid="notifications-page" id="panel-notifications" role="tabpanel" aria-labelledby="tab-notifications">
    ${renderPageHeader("INBOX FOR THE APP", tx("Notification centre", "通知中心"), tx("Informational messages stay reviewable after their corner toasts disappear.", "角落提示消失之後，資訊訊息仍然可以喺呢度翻查。"), "notifications")}
    <div class="page-tools"><div class="page-search">${renderSearchField("notifications", tx("Search notification title, body, or kind", "搜尋通知標題、內容或者類型"))}</div><span class="count-pill">${unread} ${escapeHtml(tx("unread", "未讀"))}</span><button class="button button--outlined" type="button" data-action="request-clear-notifications" ${records.length === 0 ? "disabled" : ""}>${icon("trash")}<span>${escapeHtml(tx("Clear history", "清除記錄"))}</span></button></div>
    <div class="record-list">${records.length ? records.map(item => `<article class="notification-card notification-card--${item.kind}${item.read ? " is-read" : ""}"><span class="notification-card__icon">${icon(item.kind === "success" ? "check" : item.kind === "warning" ? "warning" : item.kind === "error" ? "error" : "info")}</span><div><div class="record-meta"><span class="kind-badge">${escapeHtml(item.kind)}</span><time datetime="${escapeHtml(item.createdAt)}">${escapeHtml(formatDate(item.createdAt))}</time></div><h2>${escapeHtml(item.title)}</h2><p>${escapeHtml(item.body)}</p></div><button class="button button--text" type="button" data-action="toggle-notification-read" data-notification-id="${escapeHtml(item.id)}" data-read="${item.read}">${escapeHtml(item.read ? tx("Mark unread", "標示為未讀") : tx("Mark read", "標示為已讀"))}</button></article>`).join("") : renderRecordEmpty("notifications")}</div>
  </section>`;
}

function currentHistorySelection(): {
  records: HistoryRecord[];
  range: ReturnType<typeof validateDateRange>;
  valid: boolean;
} {
  const model = searchFor("history");
  const range = validateDateRange(state.filters.historyFrom, state.filters.historyTo, historyDateLocale());
  const valid = range.valid && (!model.pattern || validatePattern(model).valid);
  return {
    records: valid ? filterHistoryRecords(
      state.bootstrap?.history ?? [],
      model.pattern,
      createMatcher(model),
      state.filters.historyActions,
      range.from.isoDate,
      range.to.isoDate,
    ) : [],
    range,
    valid,
  };
}

function renderOAuthTokenVaultSettings(): string {
  const vault = state.oauthTokenVault;
  const unavailableCopy = vault.failure === "windows-only"
    ? tx("This Windows-only vault is unavailable on the current platform.", "呢個只限 Windows 嘅保險庫喺目前平台不可用。")
    : vault.failure === "encryption-unavailable"
      ? tx("Windows credential encryption is unavailable, so token writes and provider revocation stay blocked.", "Windows 憑證加密不可用，所以權杖寫入同供應商撤銷會保持封鎖。")
      : vault.failure === "storage-failed"
        ? tx("The encrypted vault metadata could not be read safely. Token actions are withheld instead of guessing.", "加密保險庫中繼資料未能安全讀取。權杖操作會暫停，唔會靠估。")
        : tx("Windows safeStorage protection is available. This build registers no OAuth provider and performs no token exchange.", "Windows safeStorage 保護可用。呢個版本冇註冊 OAuth 供應商，亦唔會做 token exchange。 ");
  const providerStateCopy = (provider: OAuthTokenVaultSnapshot["providers"][number]): string => {
    if (provider.state === "unavailable") return tx("Vault unavailable", "保險庫不可用");
    if (provider.state === "not-registered") return tx("Provider registration required", "需要供應商註冊");
    if (provider.state === "empty") return tx("Registered; no encrypted token record", "已註冊；冇加密權杖記錄");
    const expiry = provider.expiresAt ? formatDate(provider.expiresAt) : tx("unknown expiry", "到期時間不明");
    return provider.state === "active"
      ? tx(`Encrypted generation ${provider.generation}; expires ${expiry}`, `加密第 ${provider.generation} 代；${expiry} 到期`)
      : tx(`Encrypted generation ${provider.generation}; expired ${expiry}`, `加密第 ${provider.generation} 代；已於 ${expiry} 到期`);
  };
  return `<section class="settings-card settings-card--wide oauth-vault-settings" data-setting-section="oauth-vault" data-testid="oauth-token-vault-settings" aria-labelledby="oauth-vault-title" aria-describedby="oauth-vault-boundary">
    <header><span class="settings-card__icon">${icon("account")}</span><div><h2 id="oauth-vault-title">${escapeHtml(tx("Windows OAuth token vault", "Windows OAuth 權杖保險庫"))}</h2><p>${escapeHtml(tx("Main-process safeStorage boundary and provider-gated lifecycle", "主程序 safeStorage 邊界同供應商閘門生命週期"))}</p></div><span class="action-spacer"></span><button class="button button--outlined" type="button" data-action="refresh-oauth-token-vault" data-focus-key="oauth-vault-refresh" ${isBusy("oauth-vault") ? "disabled" : ""}>${icon("refresh", isBusy("oauth-vault") ? "is-spinning" : "")}<span>${escapeHtml(tx("Refresh vault status", "重新整理保險庫狀態"))}</span></button></header>
    <div class="inline-banner${vault.failure ? " inline-banner--error" : ""}" id="oauth-vault-boundary" role="status" aria-live="polite" aria-atomic="true">${icon(vault.failure ? "warning" : "info")}<span>${escapeHtml(unavailableCopy)}</span></div>
    <p class="supporting-copy">${escapeHtml(tx("Access and refresh tokens never cross renderer IPC. Clear removes active local ciphertext; it is not a secure-erasure claim. Revoke is enabled only when a reviewed provider revoker is registered, and still clears the local record if that provider call fails.", "Access 同 refresh 權杖永遠唔會經過 renderer IPC。清除會移除目前本機密文；呢個唔係安全抹除聲明。只有註冊咗經審閱供應商 revoker 先會啟用撤銷，而且供應商呼叫失敗都仍然會清除本機記錄。"))}</p>
    <div class="oauth-vault-provider-list">${vault.providers.map(provider => `<article class="oauth-vault-provider" data-testid="oauth-vault-provider-${provider.id}"><div><strong>${escapeHtml(provider.name)}</strong><p>${escapeHtml(providerStateCopy(provider))}</p><small>${escapeHtml(tx(`${provider.recordCount} encrypted local record${provider.recordCount === 1 ? "" : "s"}`, `${provider.recordCount} 個加密本機記錄`))}</small></div><div class="button-row"><button class="button button--outlined" type="button" data-action="request-clear-oauth-token-vault" data-oauth-provider="${provider.id}" data-focus-key="oauth-vault-clear-${provider.id}" ${!provider.canClear || isBusy("oauth-vault") ? "disabled" : ""}>${icon("trash")}<span>${escapeHtml(tx("Clear local", "清除本機記錄"))}</span></button><button class="button button--tonal" type="button" data-action="request-revoke-oauth-token-vault" data-oauth-provider="${provider.id}" data-focus-key="oauth-vault-revoke-${provider.id}" ${!provider.canRevoke || isBusy("oauth-vault") ? "disabled" : ""}>${icon("close")}<span>${escapeHtml(tx("Revoke and clear", "撤銷並清除"))}</span></button></div></article>`).join("")}</div>
  </section>`;
}

function localRevisionMatches(revision: LocalRevision): boolean {
  const model = searchFor("history-versions");
  return filterLocalRevisions([revision], model.pattern, createMatcher(model)).length === 1;
}

function renderLocalRevisionDiff(revision: LocalRevision): string {
  const hash = revision.hash;
  const busy = isBusy(`local-revision-diff-${hash}`);
  const diff = state.localRevisionDiff?.revision.hash === hash ? state.localRevisionDiff : null;
  const inputId = `local-revision-label-${hash}`;
  const lineMarkup = diff?.lines.map(line => {
    const description = diffLineDescription(line.kind);
    const marker = line.kind === "added" ? "+" : line.kind === "removed" ? "−" : line.kind === "hunk" ? "@@" : "";
    return `<li class="revision-diff-line revision-diff-line--${line.kind}"><span class="visually-hidden">${escapeHtml(tx(description.en, description.yue))}: </span><code>${marker ? `<span aria-hidden="true">${marker} </span>` : ""}${escapeHtml(line.text || " ")}</code></li>`;
  }).join("") ?? "";
  return `<section class="local-revision-detail" id="local-revision-detail-${hash}" data-testid="local-revision-detail" role="region" aria-label="${escapeHtml(tx(`Changes for ${revision.label}`, `${revision.label} 嘅更改`))}">
    <div class="revision-label-editor">
      <label class="field" for="${inputId}"><span>${escapeHtml(tx("Revision label", "修訂標籤"))}</span><input id="${inputId}" data-local-revision-label="${hash}" data-focus-key="local-revision-label-${hash}" value="${escapeHtml(revision.label)}" maxlength="120" required autocomplete="off" /></label>
      <button class="button button--tonal" type="button" data-action="save-local-revision-label" data-revision-hash="${hash}" ${isBusy(`local-revision-label-${hash}`) ? "disabled" : ""}>${icon("check")}<span>${escapeHtml(tx("Save label", "儲存標籤"))}</span></button>
    </div>
    ${busy ? `<div class="indeterminate-progress" role="progressbar" aria-label="${escapeHtml(tx("Loading revision changes", "載入修訂更改"))}"></div>` : ""}
    ${state.localRevisionDiffError && !busy ? `<p class="field-error" role="alert">${escapeHtml(state.localRevisionDiffError)}</p>` : ""}
    ${diff && !busy ? `<div class="revision-diff-heading"><p>${escapeHtml(diff.parentHash ? tx(`Compared with ${diff.parentHash.slice(0, 10)}`, `同 ${diff.parentHash.slice(0, 10)} 比較`) : tx("First snapshot; compared with an empty workspace", "第一個快照；同空白工作空間比較"))}</p><span class="count-pill">${diff.lines.length} ${escapeHtml(tx("preview lines", "行預覽"))}</span></div>
      ${lineMarkup ? `<ol class="revision-diff-list" aria-label="${escapeHtml(tx("Bounded JSON change preview", "有限 JSON 更改預覽"))}">${lineMarkup}</ol>` : `<p class="supporting-copy">${escapeHtml(tx("No textual state changes were found in this snapshot.", "呢個快照搵唔到文字狀態更改。"))}</p>`}
      ${diff.truncated ? `<p class="supporting-copy revision-diff-warning">${escapeHtml(tx("Preview truncated at the local safety limit; restore still uses the complete validated snapshot.", "預覽去到本機安全上限已截短；還原仍然使用完整並已驗證嘅快照。"))}</p>` : ""}` : ""}
  </section>`;
}

function renderLocalHistoryDeletionEvidence(): string {
  const evidence = state.localHistoryDeletionEvidence;
  const summary = evidence ? deletionEvidenceDescription(evidence) : null;
  return `<section class="deletion-evidence" data-testid="history-deletion-policy" aria-labelledby="history-deletion-policy-title">
    <header><div><p class="eyebrow">${escapeHtml(tx("READ-ONLY EVIDENCE", "只讀證據"))}</p><h3 id="history-deletion-policy-title">${escapeHtml(tx("Deletion limits and storage evidence", "刪除限制同儲存證據"))}</h3></div><button class="button button--outlined" type="button" data-action="inspect-local-history-deletion" data-focus-key="inspect-local-history-deletion" ${isBusy("local-history-deletion-evidence") ? "disabled" : ""}>${icon("search")}<span>${escapeHtml(tx(evidence ? "Refresh evidence" : "Inspect deletion limits", evidence ? "重新整理證據" : "檢查刪除限制"))}</span></button></header>
    <p class="supporting-copy">${escapeHtml(tx("This dry run reads Git metadata only. It does not expire reflogs, run garbage collection, overwrite storage, inspect backups, or change a revision.", "呢次試行只會讀取 Git 中繼資料。唔會 expire reflog、跑垃圾回收、覆寫儲存、檢查備份，或者更改任何修訂。"))}</p>
    ${state.localHistoryDeletionError ? `<p class="field-error" role="alert">${escapeHtml(state.localHistoryDeletionError)}</p>` : ""}
    ${evidence ? `<div class="deletion-evidence__report" data-testid="history-deletion-evidence" role="status" aria-live="polite">
      <p><strong>${escapeHtml(tx("Evidence summary", "證據摘要"))}</strong> ${escapeHtml(tx(summary!.en, summary!.yue))}</p>
      <dl class="evidence-grid">
        <div><dt>${escapeHtml(tx("Supported policy", "支援政策"))}</dt><dd>${escapeHtml(tx("Active-history pruning only", "只限現役歷史清理"))}</dd></div>
        <div><dt>${escapeHtml(tx("Active revisions", "現役修訂"))}</dt><dd>${evidence.activeRevisionCount}</dd></div>
        <div><dt>${escapeHtml(tx("Active labels", "現役標籤"))}</dt><dd>${evidence.activeLabeledRevisionCount}</dd></div>
        <div><dt>${escapeHtml(tx("Reflog-only revisions", "只喺 reflog 嘅修訂"))}</dt><dd>${evidence.reflogOnlyRevisionCount}</dd></div>
        <div><dt>${escapeHtml(tx("Loose Git objects", "鬆散 Git 物件"))}</dt><dd>${evidence.looseObjectCount} · ${evidence.looseObjectSizeKiB} KiB</dd></div>
        <div><dt>${escapeHtml(tx("Packed Git objects", "已封裝 Git 物件"))}</dt><dd>${evidence.packedObjectCount} · ${evidence.packCount} ${escapeHtml(tx("packs", "個封裝"))} · ${evidence.packSizeKiB} KiB</dd></div>
        <div><dt>${escapeHtml(tx("Prune-packable objects", "可清理封裝物件"))}</dt><dd>${evidence.prunePackableObjectCount}</dd></div>
        <div><dt>${escapeHtml(tx("Reported garbage", "已報告垃圾物件"))}</dt><dd>${evidence.garbageObjectCount} · ${evidence.garbageSizeKiB} KiB</dd></div>
      </dl>
      <div class="inline-banner inline-banner--warning">${icon("warning")}<span>${escapeHtml(tx("Not performed: cryptographic erasure, reflog expiry, Git garbage collection, backup auditing, or storage-media auditing. A zero count is not proof that every copy disappeared.", "未有執行：密碼學抹除、reflog expiry、Git 垃圾回收、備份審核或者儲存媒體審核。數字係零都唔代表所有副本已經消失。"))}</span></div>
      <p class="supporting-copy"><code>${escapeHtml(evidence.gitVersion)}</code> · ${escapeHtml(tx(`Generated ${formatDate(evidence.generatedAt)}`, `產生於 ${formatDate(evidence.generatedAt)}`))}</p>
      <div class="button-row"><button class="button button--text" type="button" data-action="export-local-history-deletion-evidence">${icon("download")}<span>${escapeHtml(tx("Export evidence", "匯出證據"))}</span></button></div>
    </div>` : `<p class="empty-inline">${escapeHtml(tx("Inspect to create a current, read-only evidence report.", "執行檢查以建立目前嘅只讀證據報告。"))}</p>`}
  </section>`;
}

function renderLocalHistoryRetention(): string {
  const prefs = preferences();
  const preview = state.localHistoryPrunePreview;
  const summary = preview ? retentionPreviewDescription(preview) : null;
  const retentionOptions = [...new Set([30, 90, 180, 365, 730, 1_825, 3_650, prefs.historyRetentionDays])].sort((left, right) => left - right);
  const candidateMarkup = preview?.eligibleRevisions.length
    ? `<details class="retention-candidates"><summary>${escapeHtml(tx(`Review ${preview.eligibleRevisions.length} exact pruning candidates`, `審閱 ${preview.eligibleRevisions.length} 個確切清理候選修訂`))}</summary><ol aria-label="${escapeHtml(tx("Eligible local revisions", "符合清理條件嘅本機修訂"))}">${preview.eligibleRevisions.map(revision => `<li><code>${escapeHtml(revision.hash.slice(0, 12))}</code><span>${escapeHtml(formatDate(revision.createdAt))}</span></li>`).join("")}</ol></details>`
    : "";
  const previewMarkup = preview ? `<div class="retention-preview" data-testid="history-retention-preview" role="status" aria-live="polite">
    <p><strong>${escapeHtml(tx("Dry-run result", "試行結果"))}</strong> ${escapeHtml(tx(summary!.en, summary!.yue))}</p>
    <p>${escapeHtml(tx(`Cutoff: revisions before ${formatDate(preview.cutoffAt)}.`, `截止：${formatDate(preview.cutoffAt)} 之前嘅修訂。`))}</p>
    ${preview.blockedNonAppOwnedCount ? `<p class="field-error" role="alert">${escapeHtml(tx(`${preview.blockedNonAppOwnedCount} commit${preview.blockedNonAppOwnedCount === 1 ? " was" : "s were"} not created by Material Email. Automatic pruning is blocked.`, `${preview.blockedNonAppOwnedCount} 個提交唔係由 Material Email 建立。自動清理已封鎖。`))}</p>` : ""}
    ${candidateMarkup}
    <div class="button-row"><button class="button button--danger" type="button" data-action="request-prune-local-history" data-focus-key="prune-local-history" ${preview.canPrune || isBusy("local-history-prune") ? (isBusy("local-history-prune") ? "disabled" : "") : "disabled"}>${icon("trash")}<span>${escapeHtml(tx(`Prune ${preview.eligibleRevisions.length} previewed revisions…`, `清理已預覽嘅 ${preview.eligibleRevisions.length} 個修訂……`))}</span></button></div>
  </div>` : "";
  return `<section class="history-retention" data-testid="history-retention" aria-labelledby="history-retention-title">
    <header><div><p class="eyebrow">${escapeHtml(tx("BOUNDED RETENTION", "有限保留"))}</p><h3 id="history-retention-title">${escapeHtml(tx("Revision retention", "修訂保留"))}</h3></div></header>
    <div class="retention-controls"><label class="field" for="history-retention-days"><span>${escapeHtml(tx("Keep unlabeled revisions for", "未有標籤修訂保留"))}</span><select id="history-retention-days" data-pref="historyRetentionDays" data-testid="history-retention-days">${retentionOptions.map(days => `<option value="${days}" ${prefs.historyRetentionDays === days ? "selected" : ""}>${days} ${escapeHtml(tx("days", "日"))}</option>`).join("")}</select></label><button class="button button--tonal" type="button" data-action="preview-local-history-prune" data-focus-key="preview-local-history-prune" ${isBusy("local-history-prune-preview") || isBusy("local-history-prune") ? "disabled" : ""}>${icon("search")}<span>${escapeHtml(tx("Preview pruning", "預覽清理"))}</span></button></div>
    <p class="supporting-copy">${escapeHtml(tx(`The policy is limited to ${LOCAL_HISTORY_RETENTION_DAYS_MIN}–${LOCAL_HISTORY_RETENTION_DAYS_MAX} days. Previewing changes nothing. Applying it preserves the current state and every labeled revision and refuses commits the app did not create.`, `保留政策限制為 ${LOCAL_HISTORY_RETENTION_DAYS_MIN} 至 ${LOCAL_HISTORY_RETENTION_DAYS_MAX} 日。預覽唔會改任何嘢。套用時會保留目前狀態同每個有標籤修訂，亦會拒絕唔係由應用程式建立嘅提交。`))}</p>
    <p class="supporting-copy revision-diff-warning">${escapeHtml(tx("Pruning removes eligible revisions from active history. It is not secure deletion; Git objects, backups, and storage media can retain data outside this view.", "清理會由現役歷史移除符合條件嘅修訂。呢個唔係安全刪除；Git 物件、備份同儲存媒體仍可能喺呢個檢視之外保留資料。"))}</p>
    ${state.localHistoryPruneError ? `<p class="field-error" role="alert">${escapeHtml(state.localHistoryPruneError)}</p>` : ""}
    ${previewMarkup}
    ${renderLocalHistoryDeletionEvidence()}
  </section>`;
}

function renderLocalVersions(): string {
  const model = searchFor("history-versions");
  const revisions = state.localRevisions.filter(localRevisionMatches);
  return `<section class="local-version-card" data-testid="local-versions" aria-labelledby="local-versions-title"><header><div><p class="eyebrow">${escapeHtml(tx("GIT-BACKED SNAPSHOTS", "GIT 支援快照"))}</p><h2 id="local-versions-title">${escapeHtml(tx("Whole-workspace versions", "整個工作空間版本"))}</h2></div><span class="count-pill">${revisions.length} / ${state.localRevisions.length}</span></header>
    <div class="local-version-search">${renderSearchField("history-versions", tx("Search revision labels, hashes, or dates", "搜尋修訂標籤、雜湊或者日期"))}</div>
    ${renderLocalHistoryRetention()}
    ${state.localRevisionsError ? `<p class="field-error" role="alert">${escapeHtml(state.localRevisionsError)}</p>` : ""}
    ${!state.localRevisionsLoaded && !state.localRevisionsError ? `<div class="indeterminate-progress" role="progressbar" aria-label="${escapeHtml(tx("Loading workspace versions", "載入工作空間版本"))}"></div>` : ""}
    <div class="revision-row-list">${revisions.map(revision => {
      const open = state.selectedLocalRevisionHash === revision.hash;
      return `<article class="local-revision-row" data-testid="local-revision-row"><span class="local-revision-row__icon">${icon("history")}</span><div class="local-revision-row__copy"><strong>${escapeHtml(revision.label)}</strong><p><code>${escapeHtml(revision.hash.slice(0, 10))}</code> · ${escapeHtml(formatDate(revision.createdAt))}${revision.label !== revision.subject ? ` · ${escapeHtml(revision.subject)}` : ""}</p></div><div class="button-row"><button class="button button--text" type="button" data-action="toggle-local-revision-diff" data-revision-hash="${escapeHtml(revision.hash)}" data-focus-key="local-revision-diff-${escapeHtml(revision.hash)}" aria-expanded="${open}" aria-controls="local-revision-detail-${escapeHtml(revision.hash)}">${escapeHtml(open ? tx("Hide changes", "收起更改") : tx("View changes", "查看更改"))}</button><button class="button button--text" type="button" data-action="request-restore-local" data-revision-hash="${escapeHtml(revision.hash)}" data-revision-label="${escapeHtml(revision.label)}" ${isBusy("restore-local") ? "disabled" : ""}>${escapeHtml(tx("Restore", "還原"))}</button></div>${open ? renderLocalRevisionDiff(revision) : ""}</article>`;
    }).join("") || (state.localRevisionsLoaded && model.pattern ? `<p class="empty-inline">${escapeHtml(tx("No workspace versions match this search.", "冇工作空間版本符合呢個搜尋。"))}</p>` : state.localRevisionsLoaded ? `<p class="empty-inline">${escapeHtml(tx("No workspace versions have been recorded yet.", "仲未記錄任何工作空間版本。"))}</p>` : "")}</div>
  </section>`;
}

const historyDateLocale = (): string => preferences().language === "yue" ? "zh-HK" : "en-CA";

const historyCalendarFocusDate = (): string => {
  const { visibleMonth, focusDate } = state.historyCalendar;
  return focusDate.startsWith(`${visibleMonth}-`) ? focusDate : `${visibleMonth}-01`;
};

function renderHistoryCalendar(range: ReturnType<typeof validateDateRange>): string {
  const { visibleMonth, selecting } = state.historyCalendar;
  const [year, month] = visibleMonth.split("-").map(Number) as [number, number];
  const today = localIsoDate();
  const focusDate = historyCalendarFocusDate();
  const monthLabel = tx(
    new Intl.DateTimeFormat("en-CA", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, 1))),
    new Intl.DateTimeFormat("zh-HK", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, 1))),
  );
  const monthOptions = Array.from({ length: 12 }, (_, index) => {
    const value = index + 1;
    const label = tx(
      new Intl.DateTimeFormat("en-CA", { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2020, index, 1))),
      new Intl.DateTimeFormat("zh-HK", { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2020, index, 1))),
    );
    return `<option value="${value}" ${month === value ? "selected" : ""}>${escapeHtml(label)}</option>`;
  }).join("");
  const weekdayLabels = Array.from({ length: 7 }, (_, weekday) => {
    const date = new Date(Date.UTC(2026, 7, 2 + weekday));
    const full = tx(
      new Intl.DateTimeFormat("en-CA", { weekday: "long", timeZone: "UTC" }).format(date),
      new Intl.DateTimeFormat("zh-HK", { weekday: "long", timeZone: "UTC" }).format(date),
    );
    const short = tx(
      new Intl.DateTimeFormat("en-CA", { weekday: "narrow", timeZone: "UTC" }).format(date),
      new Intl.DateTimeFormat("zh-HK", { weekday: "narrow", timeZone: "UTC" }).format(date),
    );
    return `<span role="columnheader" aria-label="${escapeHtml(full)}">${escapeHtml(short)}</span>`;
  }).join("");
  const from = range.from.isoDate;
  const to = range.to.isoDate;
  const weeks = changelogCalendarWeeks(visibleMonth).map(week => `<div class="changelog-calendar__week" role="row">${week.map(day => {
    if (!day) return `<span class="changelog-calendar__blank" role="gridcell" aria-hidden="true"></span>`;
    const inRange = Boolean(from && day.isoDate >= from && (!to || day.isoDate <= to));
    const isStart = day.isoDate === from;
    const isEnd = day.isoDate === to;
    const classes = [
      "changelog-calendar__day",
      inRange ? "is-in-range" : "",
      isStart ? "is-range-start" : "",
      isEnd ? "is-range-end" : "",
      day.isoDate === today ? "is-today" : "",
    ].filter(Boolean).join(" ");
    return `<button class="${classes}" type="button" role="gridcell" data-action="select-history-date" data-history-calendar-day="${day.isoDate}" data-focus-key="history-calendar-day-${day.isoDate}" tabindex="${day.isoDate === focusDate ? "0" : "-1"}" aria-selected="${inRange}" ${day.isoDate === today ? `aria-current="date"` : ""} aria-label="${escapeHtml(changelogCalendarDateLabel(day.isoDate))}">${day.day}</button>`;
  }).join("")}</div>`).join("");
  const presets: Array<{ id: ChangelogDatePreset; label: string }> = [
    { id: "last-7-days", label: tx("Last 7 days", "最近 7 日") },
    { id: "last-30-days", label: tx("Last 30 days", "最近 30 日") },
    { id: "this-month", label: tx("This month", "今個月") },
    { id: "this-year", label: tx("This year", "今年") },
    { id: "all", label: tx("All history", "全部歷史") },
  ];
  const status = selecting === "end" && from
    ? tx(`Start ${from}. Choose an end date.`, `開始係 ${from}。請揀結束日期。`)
    : from && to
      ? tx(`Selected ${from} through ${to}. Choose a new start date to replace it.`, `已選 ${from} 至 ${to}。揀新開始日期就可以換過。`)
      : tx("Choose the start date for the history range.", "請揀歷史日期範圍嘅開始日期。 ");
  return `<aside class="changelog-calendar" id="history-calendar" role="dialog" aria-modal="false" aria-labelledby="history-calendar-title" aria-describedby="history-calendar-instructions" data-testid="history-calendar">
    <header class="changelog-calendar__header"><div><p class="eyebrow">${escapeHtml(tx("DATE RANGE", "日期範圍"))}</p><h2 id="history-calendar-title">${escapeHtml(tx("Choose history dates", "選擇歷史日期"))}</h2></div><button class="icon-button" type="button" data-action="close-history-calendar" aria-label="${escapeHtml(tx("Close date picker", "關閉日期選擇器"))}">${icon("close")}</button></header>
    <p class="changelog-calendar__instructions" id="history-calendar-instructions">${escapeHtml(tx("Pick a start and end date, use a preset, or keep typing in either field. Date, action, and text filters stay composed locally.", "揀開始同結束日期、用預設，或者繼續喺欄位打字。日期、操作同文字篩選會喺本機保持組合。"))}</p>
    <div class="preset-row" role="group" aria-label="${escapeHtml(tx("History date-range presets", "歷史日期範圍預設"))}">${presets.map(preset => {
      const value = changelogDateRangeForPreset(preset.id, today);
      const active = state.filters.historyFrom === value.from && state.filters.historyTo === value.to;
      return `<button class="assist-chip${active ? " is-selected" : ""}" type="button" data-action="history-date-preset" data-history-date-preset="${preset.id}" data-focus-key="history-preset-${preset.id}" aria-pressed="${active}">${escapeHtml(preset.label)}</button>`;
    }).join("")}</div>
    <div class="changelog-calendar__navigation">
      <button class="icon-button" type="button" data-action="shift-history-calendar" data-month-delta="-1" data-focus-key="history-calendar-previous" aria-label="${escapeHtml(tx("Previous month", "上個月"))}">${icon("back")}</button>
      <label><span class="visually-hidden">${escapeHtml(tx("Month", "月份"))}</span><select data-history-calendar-month data-focus-key="history-calendar-month" aria-label="${escapeHtml(tx("Calendar month", "日曆月份"))}">${monthOptions}</select></label>
      <label><span class="visually-hidden">${escapeHtml(tx("Year", "年份"))}</span><input type="number" min="1900" max="9999" value="${year}" data-history-calendar-year data-focus-key="history-calendar-year" aria-label="${escapeHtml(tx("Calendar year", "日曆年份"))}"/></label>
      <button class="icon-button" type="button" data-action="shift-history-calendar" data-month-delta="1" data-focus-key="history-calendar-next" aria-label="${escapeHtml(tx("Next month", "下個月"))}">${icon("forward")}</button>
    </div>
    <div class="changelog-calendar__month-label" aria-live="polite">${escapeHtml(monthLabel)}</div>
    <div class="changelog-calendar__grid" role="grid" aria-label="${escapeHtml(monthLabel)}"><div class="changelog-calendar__weekdays" role="row">${weekdayLabels}</div>${weeks}</div>
    <p class="changelog-calendar__status" aria-live="polite">${escapeHtml(status)}</p>
    <footer><button class="button button--text" type="button" data-action="clear-history-dates" data-focus-key="history-calendar-clear">${escapeHtml(tx("Clear dates", "清除日期"))}</button><span class="action-spacer"></span><button class="button button--filled" type="button" data-action="close-history-calendar">${escapeHtml(tx("Done", "完成"))}</button></footer>
  </aside>`;
}

function renderHistoryPage(): string {
  const all = state.bootstrap?.history ?? [];
  const selection = currentHistorySelection();
  const { records, range } = selection;
  const actionCounts = new Map<HistoryRecord["kind"], number>();
  for (const record of all) actionCounts.set(record.kind, (actionCounts.get(record.kind) ?? 0) + 1);
  const fromError = changelogInputError(range.from.error);
  const toError = changelogInputError(range.to.error);
  const rangeError = range.error === "inverted"
    ? tx("The start date must be on or before the end date.", "開始日期一定要早過或者等於結束日期。 ")
    : "";
  const fromInvalid = Boolean(fromError || rangeError);
  const toInvalid = Boolean(toError || rangeError);
  const fromDescription = fromError ? "history-date-from-error" : rangeError ? "history-date-range-error" : "";
  const toDescription = toError ? "history-date-to-error" : rangeError ? "history-date-range-error" : "";
  return `<section class="standard-page" data-testid="history-page" id="panel-history" role="tabpanel" aria-labelledby="tab-history">
    ${renderPageHeader("APPEND-ONLY", tx("Local history and versions", "本機歷史同版本"), tx("Restores create another revision; they never rewrite the state you started from.", "還原會新增另一個修訂，永遠唔會改寫你開始嗰個狀態。"), "history")}
    <div class="filter-surface changelog-filter history-filter">
      <div class="page-search">${renderSearchField("history", tx("Search labels, actions, and record types", "搜尋標籤、操作同記錄類型"))}</div>
      <div class="date-filter" role="group" aria-label="${escapeHtml(tx("Filter local history by date", "按日期篩選本機歷史"))}">
        <label class="field"><span>${escapeHtml(tx("History from", "歷史日期由"))}</span><input type="text" inputmode="numeric" autocomplete="off" spellcheck="false" maxlength="${CHANGELOG_DATE_INPUT_LIMIT}" placeholder="YYYY-MM-DD" value="${escapeHtml(state.filters.historyFrom)}" data-history-date="from" data-focus-key="history-date-from" aria-invalid="${fromInvalid}" ${fromDescription ? `aria-describedby="${fromDescription}"` : ""}/><small>${escapeHtml(tx("ISO or your Windows date format", "ISO 或者你嘅 Windows 日期格式"))}</small>${fromError ? `<span class="field-error" id="history-date-from-error" role="alert">${escapeHtml(fromError)}</span>` : ""}</label>
        <span class="date-filter__separator" aria-hidden="true">—</span>
        <label class="field"><span>${escapeHtml(tx("History through", "歷史日期至"))}</span><input type="text" inputmode="numeric" autocomplete="off" spellcheck="false" maxlength="${CHANGELOG_DATE_INPUT_LIMIT}" placeholder="YYYY-MM-DD" value="${escapeHtml(state.filters.historyTo)}" data-history-date="to" data-focus-key="history-date-to" aria-invalid="${toInvalid}" ${toDescription ? `aria-describedby="${toDescription}"` : ""}/><small>${escapeHtml(tx("ISO or your Windows date format", "ISO 或者你嘅 Windows 日期格式"))}</small>${toError ? `<span class="field-error" id="history-date-to-error" role="alert">${escapeHtml(toError)}</span>` : ""}</label>
        <div class="changelog-calendar-anchor"><button class="button button--outlined" type="button" data-action="toggle-history-calendar" data-focus-key="history-calendar-trigger" aria-haspopup="dialog" aria-expanded="${state.historyCalendar.open}" aria-controls="history-calendar">${icon("calendar")}<span>${escapeHtml(tx("Choose dates", "選擇日期"))}</span></button>${state.historyCalendar.open ? renderHistoryCalendar(range) : ""}</div>
      </div>
      ${rangeError ? `<div class="inline-banner inline-banner--error" id="history-date-range-error" role="alert">${icon("warning")}<span>${escapeHtml(rangeError)}</span></div>` : ""}
      <fieldset class="action-filter"><legend>${escapeHtml(tx("Filter by action", "按操作篩選"))}</legend>${[...actionCounts.entries()].map(([kind, count]) => `<label class="filter-chip"><input type="checkbox" data-history-action="${kind}" ${state.filters.historyActions.has(kind) ? "checked" : ""}/><span>${escapeHtml(kind.replaceAll("-", " "))} <b>${count}</b></span></label>`).join("") || `<span>${escapeHtml(tx("No recorded actions yet", "仲未有已記錄操作"))}</span>`}</fieldset>
      <div class="filter-actions"><span aria-live="polite">${records.length} ${escapeHtml(tx("matching revisions", "個符合修訂"))}</span><button class="button button--outlined" type="button" data-action="export-history" ${!selection.valid || records.length === 0 ? "disabled" : ""}>${icon("download")}<span>${escapeHtml(tx("Export view", "匯出目前檢視"))}</span></button></div>
    </div>
    ${renderLocalVersions()}
    <div class="record-list history-list">${records.length ? records.map(item => `<article class="history-card"><span class="history-card__icon">${icon(item.kind === "restored" || item.kind === "undone" ? "refresh" : item.kind === "deleted" ? "trash" : item.kind === "settings-changed" ? "settings" : "history")}</span><div><div class="record-meta"><span class="kind-badge">${escapeHtml(item.kind.replaceAll("-", " "))}</span><span>${escapeHtml(item.entityType)}</span><time datetime="${escapeHtml(item.createdAt)}">${escapeHtml(formatDate(item.createdAt))}</time></div><h2>${escapeHtml(item.label)}</h2><p><code>${escapeHtml(item.entityId)}</code></p></div>${item.entityType === "settings" ? `<button class="button button--text" type="button" data-action="restore-history" data-history-id="${escapeHtml(item.id)}">${icon("refresh")}<span>${escapeHtml(tx("Restore settings", "還原設定"))}</span></button>` : `<span class="view-only-label">${escapeHtml(tx("View only", "只供查看"))}</span>`}</article>`).join("") : renderRecordEmpty("history")}</div>
  </section>`;
}

function changelogEntries(): ChangelogEntry[] {
  const published = (version: string, codeName?: string, image?: string): ChangelogEntry => ({
    version,
    date: "2026-08-01",
    title: tx("Published Windows release", "已發佈 Windows 版本"),
    ...(codeName && image ? { codeName, image } : {}),
    changes: [{
      category: tx("Release", "發佈"),
      detail: tx("Published a Windows installer and immutable release assets for this version.", "已發佈呢個版本嘅 Windows 安裝程式同不可變版本資產。"),
    }],
  });
  const entries: ChangelogEntry[] = [
    published("0.45.1"),
    published("0.44.1"),
    published("0.19.1", "Cuttlefish Shrimp Dumpling · 墨魚蝦餃", "hk-dish-0010-cuttlefish-shrimp-dumpling.png"),
    published("0.18.1", "Dried Scallop Shrimp Dumpling · 瑤柱蝦餃", "hk-dish-0009-dried-scallop-shrimp-dumpling.png"),
    published("0.17.1", "Lobster Dumpling · 龍蝦餃", "hk-dish-0008-lobster-dumpling.png"),
    published("0.16.1", "Pea Shoot Shrimp Dumpling · 豆苗蝦餃", "hk-dish-0007-pea-shoot-shrimp-dumpling.png"),
    published("0.14.1", "Spinach Shrimp Dumpling · 菠菜蝦餃", "hk-dish-0006-spinach-shrimp-dumpling.png"),
    published("0.13.1", "Chive Shrimp Dumpling · 韭菜蝦餃", "hk-dish-0005-chive-shrimp-dumpling.png"),
    published("0.12.1", "Crab Roe Har Gow · 蟹籽蝦餃", "hk-dish-0004-crab-roe-har-gow.png"),
    { version: "0.8.1", date: "2026-08-01", title: tx("Windows desktop foundation", "Windows 桌面基礎"), codeName: "Classic Har Gow · 蝦餃", image: "hk-dish-0001-classic-har-gow.png", changes: [{ category: tx("Mail", "郵件"), detail: tx("Secure account setup, three-pane mail, isolated reading, compose, and attachment saving.", "安全帳戶設定、三欄郵件、隔離閱讀、撰寫同附件儲存。") }, { category: tx("Workspace", "工作空間"), detail: tx("Persistent tabs, search, pinning, and reviewed bulk close.", "持久分頁、搜尋、釘選同經審閱批量關閉。") }] },
    { version: "0.10.1", date: "2026-08-01", title: tx("Drafts and reading continuity", "草稿同閱讀連貫性"), codeName: "Scallop Har Gow · 帶子蝦餃", image: "hk-dish-0002-scallop-har-gow.png", changes: [{ category: tx("Mail", "郵件"), detail: tx("Drafts and Outbox became visible workspaces with retry, cancel, and delete actions.", "草稿同寄件匣變成可見工作空間，有重試、取消同刪除操作。") }, { category: tx("Reading", "閱讀"), detail: tx("Reader documents stay alive while message chrome updates.", "郵件介面更新嗰陣，閱讀文件保持連貫。") }] },
    { version: "0.11.1", date: "2026-08-01", title: tx("Queue recovery and privacy-safe notifications", "佇列復原同保障私隱通知"), codeName: "Bamboo Shoot Har Gow · 筍尖蝦餃", image: "hk-dish-0003-bamboo-shoot-har-gow.png", changes: [{ category: tx("Reliability", "可靠性"), detail: tx("Queued mail operations have retry ceilings, queue-head ordering, conflict visibility, and explicit discard.", "排隊郵件操作有重試上限、隊頭排序、衝突顯示同明確丟棄。") }, { category: tx("Privacy", "私隱"), detail: tx("Native Windows notifications are opt-in and contain only generic summaries.", "原生 Windows 通知要主動開啟，而且只包含通用摘要。") }] },
  ];
  return entries;
}

const changelogDateLocale = (): string => preferences().language === "yue" ? "zh-HK" : "en-CA";

function currentChangelogSelection(): {
  entries: ChangelogEntry[];
  markdown: string;
  range: ReturnType<typeof validateDateRange>;
  valid: boolean;
} {
  const model = searchFor("changelog");
  const range = validateDateRange(state.changelogDates.from, state.changelogDates.to, changelogDateLocale());
  const valid = range.valid && (!model.pattern || validatePattern(model).valid);
  const entries = valid
    ? filterChangelogEntries(
      changelogEntries(),
      model.pattern,
      model.pattern ? createMatcher(model) : null,
      range.from.isoDate,
      range.to.isoDate,
    )
    : [];
  return {
    entries,
    range,
    valid,
    markdown: changelogMarkdown(entries, model.pattern, range.from.isoDate, range.to.isoDate),
  };
}

const changelogInputError = (error: "partial" | "format" | "calendar" | null): string => {
  if (error === "partial") return tx("Finish entering the date; your text has been kept.", "請輸入完整日期；你打咗嘅文字仲喺度，冇走失。 ");
  if (error === "calendar") return tx("Enter a real calendar date.", "請輸入真實存在嘅日曆日期。 ");
  if (error === "format") return tx("Enter a complete date as YYYY-MM-DD or in your Windows date format.", "請用 YYYY-MM-DD 或者你嘅 Windows 日期格式輸入完整日期。 ");
  return "";
};

const changelogCalendarDateLabel = (isoDate: string): string => {
  const date = new Date(`${isoDate}T00:00:00Z`);
  return tx(
    new Intl.DateTimeFormat("en-CA", { dateStyle: "full", timeZone: "UTC" }).format(date),
    new Intl.DateTimeFormat("zh-HK", { dateStyle: "full", timeZone: "UTC" }).format(date),
  );
};

const changelogCalendarFocusDate = (): string => {
  const { visibleMonth, focusDate } = state.changelogCalendar;
  return focusDate.startsWith(`${visibleMonth}-`) ? focusDate : `${visibleMonth}-01`;
};

function renderChangelogCalendar(range: ReturnType<typeof validateDateRange>): string {
  const { visibleMonth, selecting } = state.changelogCalendar;
  const [year, month] = visibleMonth.split("-").map(Number) as [number, number];
  const today = localIsoDate();
  const focusDate = changelogCalendarFocusDate();
  const monthLabel = tx(
    new Intl.DateTimeFormat("en-CA", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, 1))),
    new Intl.DateTimeFormat("zh-HK", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, 1))),
  );
  const monthOptions = Array.from({ length: 12 }, (_, index) => {
    const value = index + 1;
    const label = tx(
      new Intl.DateTimeFormat("en-CA", { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2020, index, 1))),
      new Intl.DateTimeFormat("zh-HK", { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2020, index, 1))),
    );
    return `<option value="${value}" ${month === value ? "selected" : ""}>${escapeHtml(label)}</option>`;
  }).join("");
  const weekdayLabels = Array.from({ length: 7 }, (_, weekday) => {
    const date = new Date(Date.UTC(2026, 7, 2 + weekday));
    const full = tx(
      new Intl.DateTimeFormat("en-CA", { weekday: "long", timeZone: "UTC" }).format(date),
      new Intl.DateTimeFormat("zh-HK", { weekday: "long", timeZone: "UTC" }).format(date),
    );
    const short = tx(
      new Intl.DateTimeFormat("en-CA", { weekday: "narrow", timeZone: "UTC" }).format(date),
      new Intl.DateTimeFormat("zh-HK", { weekday: "narrow", timeZone: "UTC" }).format(date),
    );
    return `<span role="columnheader" aria-label="${escapeHtml(full)}">${escapeHtml(short)}</span>`;
  }).join("");
  const from = range.from.isoDate;
  const to = range.to.isoDate;
  const weeks = changelogCalendarWeeks(visibleMonth).map(week => `<div class="changelog-calendar__week" role="row">${week.map(day => {
    if (!day) return `<span class="changelog-calendar__blank" role="gridcell" aria-hidden="true"></span>`;
    const inRange = Boolean(from && day.isoDate >= from && (!to || day.isoDate <= to));
    const isStart = day.isoDate === from;
    const isEnd = day.isoDate === to;
    const classes = [
      "changelog-calendar__day",
      inRange ? "is-in-range" : "",
      isStart ? "is-range-start" : "",
      isEnd ? "is-range-end" : "",
      day.isoDate === today ? "is-today" : "",
    ].filter(Boolean).join(" ");
    return `<button class="${classes}" type="button" role="gridcell" data-action="select-changelog-date" data-changelog-calendar-day="${day.isoDate}" data-focus-key="changelog-calendar-day-${day.isoDate}" tabindex="${day.isoDate === focusDate ? "0" : "-1"}" aria-selected="${inRange}" ${day.isoDate === today ? `aria-current="date"` : ""} aria-label="${escapeHtml(changelogCalendarDateLabel(day.isoDate))}">${day.day}</button>`;
  }).join("")}</div>`).join("");
  const presets: Array<{ id: ChangelogDatePreset; label: string }> = [
    { id: "last-30-days", label: tx("Last 30 days", "最近 30 日") },
    { id: "this-month", label: tx("This month", "今個月") },
    { id: "this-year", label: tx("This year", "今年") },
    { id: "all", label: tx("All releases", "全部版本") },
  ];
  const status = selecting === "end" && from
    ? tx(`Start ${from}. Choose an end date.`, `開始係 ${from}。請揀結束日期。`)
    : from && to
      ? tx(`Selected ${from} through ${to}. Choose a new start date to replace it.`, `已選 ${from} 至 ${to}。揀新開始日期就可以換過。`)
      : tx("Choose the start date for the release range.", "請揀發佈日期範圍嘅開始日期。 ");
  return `<aside class="changelog-calendar" id="changelog-calendar" role="dialog" aria-modal="false" aria-labelledby="changelog-calendar-title" aria-describedby="changelog-calendar-instructions" data-testid="changelog-calendar">
    <header class="changelog-calendar__header"><div><p class="eyebrow">${escapeHtml(tx("DATE RANGE", "日期範圍"))}</p><h2 id="changelog-calendar-title">${escapeHtml(tx("Choose release dates", "選擇發佈日期"))}</h2></div><button class="icon-button" type="button" data-action="close-changelog-calendar" aria-label="${escapeHtml(tx("Close date picker", "關閉日期選擇器"))}">${icon("close")}</button></header>
    <p class="changelog-calendar__instructions" id="changelog-calendar-instructions">${escapeHtml(tx("Pick a start and end date, use a preset, or keep typing in either field. Dates stay local to this app.", "揀開始同結束日期、用預設，或者繼續喺欄位打字。日期只會留喺呢個 App 本機。"))}</p>
    <div class="preset-row" role="group" aria-label="${escapeHtml(tx("Date-range presets", "日期範圍預設"))}">${presets.map(preset => {
      const value = changelogDateRangeForPreset(preset.id, today);
      const active = state.changelogDates.from === value.from && state.changelogDates.to === value.to;
      return `<button class="assist-chip${active ? " is-selected" : ""}" type="button" data-action="changelog-date-preset" data-changelog-date-preset="${preset.id}" data-focus-key="changelog-preset-${preset.id}" aria-pressed="${active}">${escapeHtml(preset.label)}</button>`;
    }).join("")}</div>
    <div class="changelog-calendar__navigation">
      <button class="icon-button" type="button" data-action="shift-changelog-calendar" data-month-delta="-1" data-focus-key="changelog-calendar-previous" aria-label="${escapeHtml(tx("Previous month", "上個月"))}">${icon("back")}</button>
      <label><span class="visually-hidden">${escapeHtml(tx("Month", "月份"))}</span><select data-changelog-calendar-month data-focus-key="changelog-calendar-month" aria-label="${escapeHtml(tx("Calendar month", "日曆月份"))}">${monthOptions}</select></label>
      <label><span class="visually-hidden">${escapeHtml(tx("Year", "年份"))}</span><input type="number" min="1900" max="9999" value="${year}" data-changelog-calendar-year data-focus-key="changelog-calendar-year" aria-label="${escapeHtml(tx("Calendar year", "日曆年份"))}"/></label>
      <button class="icon-button" type="button" data-action="shift-changelog-calendar" data-month-delta="1" data-focus-key="changelog-calendar-next" aria-label="${escapeHtml(tx("Next month", "下個月"))}">${icon("forward")}</button>
    </div>
    <div class="changelog-calendar__month-label" aria-live="polite">${escapeHtml(monthLabel)}</div>
    <div class="changelog-calendar__grid" role="grid" aria-label="${escapeHtml(monthLabel)}"><div class="changelog-calendar__weekdays" role="row">${weekdayLabels}</div>${weeks}</div>
    <p class="changelog-calendar__status" aria-live="polite">${escapeHtml(status)}</p>
    <footer><button class="button button--text" type="button" data-action="clear-changelog-dates" data-focus-key="changelog-calendar-clear">${escapeHtml(tx("Clear dates", "清除日期"))}</button><span class="action-spacer"></span><button class="button button--filled" type="button" data-action="close-changelog-calendar">${escapeHtml(tx("Done", "完成"))}</button></footer>
  </aside>`;
}

function renderChangelogPage(): string {
  const selection = currentChangelogSelection();
  const { entries, range } = selection;
  const fromError = changelogInputError(range.from.error);
  const toError = changelogInputError(range.to.error);
  const rangeError = range.error === "inverted"
    ? tx("The start date must be on or before the end date.", "開始日期一定要早過或者等於結束日期。 ")
    : "";
  const fromInvalid = Boolean(fromError || rangeError);
  const toInvalid = Boolean(toError || rangeError);
  const fromDescription = fromError ? "changelog-date-from-error" : rangeError ? "changelog-date-range-error" : "";
  const toDescription = toError ? "changelog-date-to-error" : rangeError ? "changelog-date-range-error" : "";
  return `<section class="standard-page" data-testid="changelog-page" id="panel-changelog" role="tabpanel" aria-labelledby="tab-changelog">
    ${renderPageHeader("BUILD NOTES", tx("Changelog", "更新記錄"), tx("Bundled facts for every version known to this build—never a prediction about a release or CI run.", "列出呢個版本已知嘅每個版本事實——絕對唔預測發佈或者 CI 結果。"), "info")}
    <div class="filter-surface changelog-filter">
      <div class="page-search">${renderSearchField("changelog", tx("Search versions and changes", "搜尋版本同變更"))}</div>
      <div class="date-filter" role="group" aria-label="${escapeHtml(tx("Filter changelog by release date", "按發佈日期篩選更新記錄"))}">
        <label class="field"><span>${escapeHtml(tx("Released from", "發佈日期由"))}</span><input type="text" inputmode="numeric" autocomplete="off" spellcheck="false" maxlength="${CHANGELOG_DATE_INPUT_LIMIT}" placeholder="YYYY-MM-DD" value="${escapeHtml(state.changelogDates.from)}" data-changelog-date="from" data-focus-key="changelog-date-from" aria-invalid="${fromInvalid}" ${fromDescription ? `aria-describedby="${fromDescription}"` : ""}/><small>${escapeHtml(tx("ISO or your Windows date format", "ISO 或者你嘅 Windows 日期格式"))}</small>${fromError ? `<span class="field-error" id="changelog-date-from-error" role="alert">${escapeHtml(fromError)}</span>` : ""}</label>
        <span class="date-filter__separator" aria-hidden="true">—</span>
        <label class="field"><span>${escapeHtml(tx("Released through", "發佈日期至"))}</span><input type="text" inputmode="numeric" autocomplete="off" spellcheck="false" maxlength="${CHANGELOG_DATE_INPUT_LIMIT}" placeholder="YYYY-MM-DD" value="${escapeHtml(state.changelogDates.to)}" data-changelog-date="to" data-focus-key="changelog-date-to" aria-invalid="${toInvalid}" ${toDescription ? `aria-describedby="${toDescription}"` : ""}/><small>${escapeHtml(tx("ISO or your Windows date format", "ISO 或者你嘅 Windows 日期格式"))}</small>${toError ? `<span class="field-error" id="changelog-date-to-error" role="alert">${escapeHtml(toError)}</span>` : ""}</label>
        <div class="changelog-calendar-anchor"><button class="button button--outlined" type="button" data-action="toggle-changelog-calendar" data-focus-key="changelog-calendar-trigger" aria-haspopup="dialog" aria-expanded="${state.changelogCalendar.open}" aria-controls="changelog-calendar">${icon("calendar")}<span>${escapeHtml(tx("Choose dates", "選擇日期"))}</span></button>${state.changelogCalendar.open ? renderChangelogCalendar(range) : ""}</div>
      </div>
      ${rangeError ? `<div class="inline-banner inline-banner--error" id="changelog-date-range-error" role="alert">${icon("warning")}<span>${escapeHtml(rangeError)}</span></div>` : ""}
      <div class="filter-actions"><span aria-live="polite">${entries.length} ${escapeHtml(tx(entries.length === 1 ? "matching released version" : "matching released versions", "個符合嘅已發佈版本"))}</span><div class="button-row"><button class="button button--text" type="button" data-action="copy-changelog" ${selection.valid ? "" : "disabled"}>${icon("compose")}<span>${escapeHtml(tx("Copy filtered view", "複製已篩選檢視"))}</span></button><button class="button button--outlined" type="button" data-action="export-changelog" ${selection.valid ? "" : "disabled"}>${icon("download")}<span>${escapeHtml(tx("Export filtered notes", "匯出已篩選記錄"))}</span></button></div></div>
    </div>
    <div class="timeline">${entries.length ? entries.map(entry => `<article class="changelog-card"><div class="timeline-dot" aria-hidden="true"></div><header><div><p class="eyebrow">${escapeHtml(tx("VERSION", "版本"))} ${escapeHtml(entry.version)}</p><h2>${escapeHtml(entry.title)}</h2></div>${entry.date ? `<time datetime="${entry.date}">${escapeHtml(formatDate(entry.date, false))}</time>` : `<span class="date-unavailable">${escapeHtml(tx("Release date not recorded", "未有記錄發佈日期"))}</span>`}</header><div class="change-list">${entry.changes.map(change => `<div><span class="kind-badge">${escapeHtml(change.category)}</span><p>${escapeHtml(change.detail)}</p></div>`).join("")}</div><div class="release-code-name"><img src="./assets/dim-sum/${escapeHtml(entry.image ?? "hk-dish-0001-classic-har-gow.png")}" alt="${escapeHtml(entry.codeName ?? tx("Dim sum build code name", "版本點心代號"))}"/><div><small>${escapeHtml(tx("Build code name", "版本代號"))}</small><strong>${escapeHtml(entry.codeName ?? tx("Not recorded", "未有記錄"))}</strong></div></div></article>`).join("") : renderRecordEmpty("changelog")}</div>
  </section>`;
}

function renderToolsPage(): string {
  const release = state.bootstrap?.release;
  const releaseCodeName = release?.codeName.trim() ?? "";
  const releaseImage = release?.imageAsset.trim() ?? "";
  const hasReleaseCodeName = Boolean(releaseCodeName && /^[a-z0-9][a-z0-9._-]*\.png$/iu.test(releaseImage));
  const releaseDishId = release?.dishId.trim() || tx("Not recorded", "未有記錄");
  const releaseCatalogCommit = release?.catalogCommit.trim().slice(0, 12) || tx("Not recorded", "未有記錄");
  const quarantined = state.bootstrap?.quarantinedAttachments ?? [];
  const quarantineRows = quarantined.map(item => {
    const titleId = `quarantine-title-${item.id}`;
    const riskLabel = item.risk.level === "dangerous" ? tx("Dangerous", "危險") : tx("Caution", "小心");
    return `<article class="history-card quarantine-card quarantine-card--${item.risk.level}" data-testid="quarantine-card" aria-labelledby="${titleId}">
      <span class="history-card__icon quarantine-card__icon">${icon("warning")}</span>
      <div class="quarantine-card__body"><div class="record-meta"><span class="attachment-risk-badge attachment-risk-badge--${item.risk.level}">${escapeHtml(riskLabel)}</span><time datetime="${escapeHtml(item.quarantinedAt)}">${escapeHtml(formatDate(item.quarantinedAt))}</time></div><h3 id="${titleId}"><bdi>${escapeHtml(item.filename)}</bdi></h3><p>${escapeHtml(item.risk.reasons.map(attachmentRiskReasonLabel).join(" · "))}</p><small>${escapeHtml(formatBytes(item.size))} · ${escapeHtml(item.contentType)} · ${escapeHtml(tx(`Source ${item.source.folderPath}, message UID ${item.source.uid}`, `來源 ${item.source.folderPath}，郵件 UID ${item.source.uid}`))}</small><small>${escapeHtml(tx(`Integrity SHA-256 ${item.sha256.slice(0, 12)}…`, `完整性 SHA-256 ${item.sha256.slice(0, 12)}…`))}</small></div>
      <div class="button-row"><button class="button button--tonal" type="button" data-action="request-release-quarantined-attachment" data-quarantine-id="${escapeHtml(item.id)}" data-focus-key="quarantine-release-${escapeHtml(item.id)}">${icon("download")}<span>${escapeHtml(tx("Release…", "放行……"))}</span></button><button class="button button--text button--danger" type="button" data-action="request-delete-quarantined-attachment" data-quarantine-id="${escapeHtml(item.id)}" data-focus-key="quarantine-delete-${escapeHtml(item.id)}">${icon("trash")}<span>${escapeHtml(tx("Delete", "刪除"))}</span></button></div>
    </article>`;
  }).join("");
  return `<section class="standard-page" id="panel-tools" role="tabpanel" aria-labelledby="tab-tools">
    ${renderPageHeader("WORKBENCH", tx("Tools", "工具"), tx("Keyboard-first utilities and honest local diagnostics.", "鍵盤優先工具同如實本機診斷。"), "tools")}
    <div class="tool-grid">
      <section class="tool-card tool-card--wide quarantine-tool" data-testid="quarantine-center" aria-labelledby="quarantine-center-title"><header><span>${icon("warning")}</span><div><h2 id="quarantine-center-title">${escapeHtml(tx("Attachment quarantine", "附件隔離區"))} <span class="count-pill" aria-label="${escapeHtml(tx(`${quarantined.length} quarantined attachments`, `${quarantined.length} 個已隔離附件`))}">${quarantined.length}</span></h2><p id="quarantine-boundary-note">${escapeHtml(tx("Caution and dangerous attachments stay in private local storage until you explicitly release or delete them. Filename checks and SHA-256 integrity are not antivirus scanning.", "小心同危險附件會留喺私人本機儲存，直至你明確放行或者刪除。檔名檢查同 SHA-256 完整性唔係防毒掃描。"))}</p></div></header><div class="record-list" aria-describedby="quarantine-boundary-note">${quarantineRows || `<div class="empty-card quarantine-empty" role="status">${icon("check")}<h3>${escapeHtml(tx("Local quarantine is empty", "本機隔離區係空嘅"))}</h3><p>${escapeHtml(tx("No caution or dangerous attachment is waiting for a decision.", "冇小心或者危險附件等緊你決定。"))}</p></div>`}</div></section>
      <section class="tool-card tool-card--wide"><header><span>${icon("regex")}</span><div><h2>${escapeHtml(tx("Regex playground", "正規表達式試驗場"))}</h2><p>${escapeHtml(tx("A standalone field using the same bounded JavaScript engine as every search surface.", "獨立欄位，使用同每個搜尋介面一樣嘅有界 JavaScript 引擎。"))}</p></div></header>${renderSearchField("tools-regex", tx("Build and test a pattern", "建立同測試模式"))}</section>
      <section class="tool-card"><header><span>${icon("search")}</span><div><h2>${escapeHtml(tx("Command palette", "指令面板"))}</h2><p>${escapeHtml(tx("Find a destination or action without reaching for the mouse.", "唔使掂滑鼠都可以搵到目的地或者操作。"))}</p></div></header><button class="button button--tonal" type="button" data-action="open-command-palette">${escapeHtml(tx("Open commands", "開啟指令"))}<kbd>Ctrl+K</kbd></button></section>
      <section class="tool-card"><header><span>${icon("tools")}</span><div><h2>${escapeHtml(tx("External editor", "外部編輯器"))}</h2><p>${escapeHtml(preferences().externalEditorPath ?? tx("Choose an editor in Settings first.", "先喺設定揀一個編輯器。"))}</p></div></header><button class="button button--tonal" type="button" data-action="open-editor" ${!preferences().externalEditorPath ? "disabled" : ""}>${escapeHtml(tx("Open project", "開啟專案"))}<kbd>Alt+E</kbd></button></section>
      <section class="tool-card"><header><span>${icon("download")}</span><div><h2>${escapeHtml(tx("Export local data", "匯出本機資料"))}</h2><p>${escapeHtml(tx("Choose the destination through the secure desktop save dialog.", "透過安全桌面儲存對話框選擇目的地。"))}</p></div></header><div class="button-row"><button class="button button--outlined" type="button" data-action="export-settings">${escapeHtml(tx("Settings", "設定"))}</button><button class="button button--outlined" type="button" data-action="export-history">${escapeHtml(tx("History", "歷史"))}</button></div></section>
      <section class="tool-card shortcut-card"><header><span>${icon("menu")}</span><div><h2>${escapeHtml(tx("Keyboard map", "鍵盤地圖"))}</h2><p>${escapeHtml(tx("Core paths remain available at 200% scale and without a pointer.", "核心操作喺 200% 顯示比例同冇滑鼠之下仍然可用。"))}</p></div></header><dl><div><dt>${escapeHtml(tx("Compose", "撰寫"))}</dt><dd><kbd>Ctrl+N</kbd></dd></div><div><dt>${escapeHtml(tx("Commands", "指令"))}</dt><dd><kbd>Ctrl+K</kbd></dd></div><div><dt>${escapeHtml(tx("Regex builder", "正規表達式建立器"))}</dt><dd><kbd>Alt+R</kbd></dd></div><div><dt>${escapeHtml(tx("Synchronize", "同步"))}</dt><dd><kbd>Ctrl+Shift+S</kbd></dd></div><div><dt>${escapeHtml(tx("Switch tabs", "切換分頁"))}</dt><dd><kbd>Alt+1…6</kbd></dd></div><div><dt>${escapeHtml(tx("Edit focused tab appearance", "編輯焦點分頁外觀"))}</dt><dd><kbd>Ctrl+Shift+E</kbd></dd></div></dl></section>
      <section class="tool-card about-card"><header><span>${icon("info")}</span><div><h2>${escapeHtml(tx("About Material Email", "關於 Material 郵件"))}</h2><p>${escapeHtml(tx(`Version ${release?.version ?? state.bootstrap?.version ?? "unknown"} · Original Windows Electron renderer`, `版本 ${release?.version ?? state.bootstrap?.version ?? "未知"} · 原創 Windows Electron 介面`))}</p></div></header><div class="release-code-name release-code-name--large">${hasReleaseCodeName ? `<img src="./assets/dim-sum/${escapeHtml(releaseImage)}" alt="${escapeHtml(releaseCodeName)}"/>` : `<span class="release-code-name__empty" aria-hidden="true">${icon("info")}</span>`}<div><small>${escapeHtml(tx("Build code name", "版本代號"))}</small><strong>${escapeHtml(hasReleaseCodeName ? releaseCodeName : tx("No code name assigned", "未有分配版本代號"))}</strong><p>${escapeHtml(hasReleaseCodeName ? tx("The image is bundled locally; no food photography leaves your computer.", "圖片已經內置喺本機；任何點心相都唔會離開你部電腦。") : tx("The verified local catalog was exhausted, so this build shipped without a dim-sum code name or substitute image.", "已驗證本機目錄已經用盡，所以呢個版本冇點心代號，亦冇用替代圖片頂檔。"))}</p></div></div><dl class="diagnostic-list"><div><dt>${escapeHtml(tx("Secure bridge", "安全連接"))}</dt><dd>${icon("check")} ${escapeHtml(tx("Available", "可用"))}</dd></div><div><dt>${escapeHtml(tx("Catalog dish ID", "目錄菜式 ID"))}</dt><dd><code>${escapeHtml(releaseDishId)}</code></dd></div><div><dt>${escapeHtml(tx("Catalog commit", "目錄提交"))}</dt><dd><code>${escapeHtml(releaseCatalogCommit)}</code></dd></div><div><dt>${escapeHtml(tx("Accounts", "帳戶"))}</dt><dd>${state.bootstrap?.accounts.length ?? 0}</dd></div><div><dt>${escapeHtml(tx("Pending operations", "待處理操作"))}</dt><dd>${state.bootstrap?.pendingOperationCount ?? 0}</dd></div></dl></section>
    </div>
  </section>`;
}

function renderRecordEmpty(kind: "notifications" | "history" | "changelog"): string {
  const iconName: IconName = kind === "notifications" ? "notifications" : kind === "history" ? "history" : "info";
  const title = kind === "notifications" ? tx("No matching notifications", "冇符合嘅通知") : kind === "history" ? tx("No matching revisions", "冇符合嘅修訂") : tx("No matching build notes", "冇符合嘅版本記錄");
  const body = tx("Clear or adjust the active search and filters.", "清除或者調整目前搜尋同篩選器。 ");
  return `<div class="empty-card record-empty">${icon(iconName)}<h2>${escapeHtml(title)}</h2><p>${escapeHtml(body)}</p></div>`;
}

function renderDimSumSurprise(): string {
  const dish = state.dimSumDish;
  const name = dish ? `${dish.name.en} · ${dish.name.zhHant}` : state.bootstrap?.release.codeName ?? tx("Dim sum surprise", "點心驚喜");
  const source = dish ? `./assets/dim-sum/${dish.file}` : releaseImageSource();
  return `<aside class="dim-sum-surprise" role="status" aria-label="${escapeHtml(tx("Dim sum surprise", "點心驚喜"))}"><img src="${escapeHtml(source)}" alt="${escapeHtml(name)}"/><div><p class="eyebrow">${escapeHtml(tx("TODAY'S ONE-PERCENT HELLO", "今日百分之一招呼"))}</p><strong>${escapeHtml(name)}</strong><p>${escapeHtml(tone(
    ["A small local surprise. It will leave shortly.", "A small local surprise—dismiss it whenever you like.", "A tiny steamer basket rolled by to say hello.", "A tiny steamer basket rolled by, waved politely, and promised not to block your inbox.", "A tiny steamer basket achieved inbox zero before the rest of us. It will roll away shortly."],
    ["一個本機小驚喜，好快會自己離開。", "一個本機小驚喜，隨時可以關閉。", "一籠小點心過嚟打個招呼。", "一籠小點心過嚟揮揮手，仲保證唔會擋住你個收件匣。", "一籠小點心快過大家做到 inbox zero。佢好快會自己碌走。"],
  ))}</p></div><button class="icon-button" type="button" data-action="dismiss-dim-sum" aria-label="${escapeHtml(tx("Dismiss dim sum surprise", "關閉點心驚喜"))}">${icon("close")}</button></aside>`;
}

function releaseImageSource(): string {
  const filename = state.bootstrap?.release.imageAsset;
  return filename && /^[a-z0-9][a-z0-9._-]*\.png$/i.test(filename)
    ? `./assets/dim-sum/${filename}`
    : "./assets/dim-sum/hk-dish-0001-classic-har-gow.png";
}

const groupLabel = (group: TabDefinition["group"]): string => group === "workspace"
  ? tx("Workspace", "工作空間")
  : group === "records"
    ? tx("Records", "記錄")
    : tx("System", "系統");

function filterTabs(key: string, tabs: TabDefinition[]): TabDefinition[] {
  const model = searchFor(key);
  return model.pattern ? tabs.filter(tab => createMatcher(model)(`${tab.en}\n${tab.yue}\n${groupLabel(tab.group)}\n${tab.id}`)) : tabs;
}

function renderTabSearchResults(key: string, tabs: TabDefinition[]): string {
  const results = filterTabs(key, tabs);
  return `<div class="tab-search-results" role="list">${results.length ? results.map(tab => {
    const open = !state.tabPreferences.closed.includes(tab.id);
    const pinned = state.tabPreferences.pinned.includes(tab.id);
    return `<button type="button" role="listitem" data-action="activate-tab" data-tab-id="${tab.id}"><span>${icon(tab.icon)}</span><span><strong>${escapeHtml(tx(tab.en, tab.yue))}</strong><small>${escapeHtml(groupLabel(tab.group))} · ${escapeHtml(open ? tx("open", "已開啟") : tx("closed", "已關閉"))}${pinned ? ` · ${escapeHtml(tx("pinned", "已釘選"))}` : ""}</small></span>${icon("chevron")}</button>`;
  }).join("") : `<p class="empty-inline">${escapeHtml(tx("No matching tabs", "冇符合嘅分頁"))}</p>`}</div>`;
}

function bulkClosePreview(): PageId[] {
  const model = searchFor("bulk-tabs");
  if (!model.pattern || !validatePattern(model).valid) return [];
  const matches = createMatcher(model);
  return visibleTabIds().filter(id => {
    if (!state.bulkIncludePinned && state.tabPreferences.pinned.includes(id)) return false;
    const tab = tabDefinition(id);
    const hit = matches(tx(tab.en, tab.yue));
    return state.bulkInverse ? !hit : hit;
  });
}

function renderTabManager(): string {
  const current = TAB_DEFINITIONS.filter(tab => visibleTabIds().includes(tab.id));
  const groupTabs = TAB_DEFINITIONS.filter(tab => tab.group === state.selectedTabGroup);
  const preview = bulkClosePreview();
  const bulk = searchFor("bulk-tabs");
  const bulkValidation = validatePattern(bulk);
  return `<section class="anchored-popover tab-manager" role="dialog" aria-modal="false" aria-labelledby="tab-manager-title">
    <header class="popover-header"><div><p class="eyebrow">${escapeHtml(tx("TAB DISCOVERY", "分頁探索"))}</p><h2 id="tab-manager-title">${escapeHtml(tx("Search and manage tabs", "搜尋同管理分頁"))}</h2></div><button class="icon-button" type="button" data-action="close-tab-manager" aria-label="${escapeHtml(tx("Close tab manager", "關閉分頁管理器"))}">${icon("close")}</button></header>
    <div class="tab-manager__scroll">
      <section class="tab-search-section"><h3>${escapeHtml(tx("1. Current tab strip", "1. 目前分頁列"))}</h3>${renderSearchField("tabs-current", tx("Search open tabs", "搜尋已開啟分頁"), true)}${renderTabSearchResults("tabs-current", current)}</section>
      <section class="tab-search-section"><div class="section-title-row"><h3>${escapeHtml(tx("2. Tabs inside a group", "2. 群組入面嘅分頁"))}</h3><label><span class="visually-hidden">${escapeHtml(tx("Tab group", "分頁群組"))}</span><select data-action-change="select-tab-group">${(["workspace", "records", "system"] as const).map(group => `<option value="${group}" ${group === state.selectedTabGroup ? "selected" : ""}>${escapeHtml(groupLabel(group))}</option>`).join("")}</select></label></div>${renderSearchField("tabs-group", tx("Search this group", "搜尋呢個群組"), true)}${renderTabSearchResults("tabs-group", groupTabs)}</section>
      <section class="tab-search-section"><h3>${escapeHtml(tx("3. Tab groups", "3. 分頁群組"))}</h3>${renderSearchField("tab-groups", tx("Search group names", "搜尋群組名稱"), true)}<div class="group-result-list">${(["workspace", "records", "system"] as const).filter(group => {
        const model = searchFor("tab-groups");
        return !model.pattern || createMatcher(model)(groupLabel(group));
      }).map(group => `<button type="button" data-action="select-group-result" data-group="${group}"><span class="group-swatch group-swatch--${group}"></span><span><strong>${escapeHtml(groupLabel(group))}</strong><small>${TAB_DEFINITIONS.filter(tab => tab.group === group).length} ${escapeHtml(tx("tabs", "個分頁"))}</small></span>${icon("chevron")}</button>`).join("")}</div></section>
      <section class="tab-search-section"><h3>${escapeHtml(tx("4. Master tab search", "4. 全部分頁搜尋"))}</h3>${renderSearchField("tabs-master", tx("Search all app tabs", "搜尋所有應用程式分頁"), true)}${renderTabSearchResults("tabs-master", [...TAB_DEFINITIONS])}</section>
      <section class="bulk-close-card"><header><span>${icon("trash")}</span><div><h3>${escapeHtml(state.bulkInverse ? tx("Close tabs not containing text", "關閉唔包含文字嘅分頁") : tx("Close tabs containing text", "關閉包含文字嘅分頁"))}</h3><p>${escapeHtml(tx("Matching uses visible tab labels only. Empty or invalid patterns never close anything.", "配對只使用可見分頁標籤。空白或者無效模式永遠唔會關閉任何嘢。"))}</p></div></header>${renderSearchField("bulk-tabs", tx("Text to review before closing", "關閉前要審閱嘅文字"), true)}<div class="bulk-options"><label class="switch-row"><span>${escapeHtml(tx("Inverse: close non-matches", "反向：關閉唔符合項目"))}</span><input type="checkbox" role="switch" data-bulk-option="inverse" ${state.bulkInverse ? "checked" : ""}/></label><label class="switch-row"><span>${escapeHtml(tx("Include pinned tabs", "包括釘選分頁"))}</span><input type="checkbox" role="switch" data-bulk-option="pinned" ${state.bulkIncludePinned ? "checked" : ""}/></label></div><div class="bulk-preview"><strong>${preview.length} ${escapeHtml(tx("tabs would close", "個分頁將會關閉"))}</strong>${preview.length ? `<span>${preview.map(id => escapeHtml(tx(tabDefinition(id).en, tabDefinition(id).yue))).join(" · ")}</span>` : `<span>${escapeHtml(!bulk.pattern ? tx("Enter a non-empty query.", "輸入非空白搜尋。") : !bulkValidation.valid ? bulkValidation.message : tx("No tabs match this scope.", "呢個範圍冇符合分頁。"))}</span>`}</div><button class="button button--danger" type="button" data-action="request-bulk-close" ${preview.length === 0 ? "disabled" : ""}>${icon("trash")}<span>${escapeHtml(tx("Review and close…", "審閱並關閉……"))}</span></button></section>
      ${state.tabPreferences.closed.length ? `<section class="closed-tabs"><h3>${escapeHtml(tx("Recently closed app tabs", "最近關閉嘅應用程式分頁"))}</h3><div>${state.tabPreferences.closed.slice(-10).reverse().map(id => `<button class="assist-chip" type="button" data-action="reopen-tab" data-tab-id="${id}">${icon(tabDefinition(id).icon)}<span>${escapeHtml(tx(tabDefinition(id).en, tabDefinition(id).yue))}</span></button>`).join("")}</div></section>` : ""}
    </div>
  </section>`;
}

function renderTabContextMenu(): string {
  const menu = state.contextMenu;
  if (!menu) return "";
  const tab = tabDefinition(menu.tabId);
  const pinned = state.tabPreferences.pinned.includes(tab.id);
  return `<div class="context-menu" role="menu" style="left:${Math.max(8, menu.x)}px;top:${Math.max(8, menu.y)}px" aria-label="${escapeHtml(tx(`${tab.en} tab menu`, `${tab.yue}分頁選單`))}">
    <button type="button" role="menuitem" data-action="toggle-tab-pin" data-tab-id="${tab.id}">${icon("pin")}<span>${escapeHtml(pinned ? tx("Unpin tab", "取消釘選分頁") : tx("Pin tab", "釘選分頁"))}</span></button>
    <button type="button" role="menuitem" data-action="move-tab-left" data-tab-id="${tab.id}">${icon("back")}<span>${escapeHtml(tx("Move left", "向左移"))}</span></button>
    <button type="button" role="menuitem" data-action="move-tab-right" data-tab-id="${tab.id}">${icon("forward")}<span>${escapeHtml(tx("Move right", "向右移"))}</span></button>
    <hr/>
    <button type="button" role="menuitem" data-action="open-tab-appearance" data-tab-id="${tab.id}">${icon("edit")}<span>${escapeHtml(tx("Edit tab appearance…", "編輯分頁外觀……"))}</span></button>
    ${!pinned ? `<button class="danger-action" type="button" role="menuitem" data-action="close-tab" data-tab-id="${tab.id}">${icon("close")}<span>${escapeHtml(tx("Close tab", "關閉分頁"))}</span></button>` : ""}
  </div>`;
}

const isTabStyleKey = (value: string | undefined): value is TabStyleKey =>
  value !== undefined && TAB_STYLE_KEYS.includes(value as TabStyleKey);

function renderTabStyleReset(
  tabId: PageId,
  key: TabStyleKey,
  label: string,
  overrides: TabStyleOverrides,
): string {
  const inherited = overrides[key] === undefined;
  return `<button class="appearance-property__reset" type="button" data-action="reset-tab-style-property" data-tab-id="${tabId}" data-tab-style-key="${key}" data-focus-key="tab-style-${tabId}-${key}-reset" ${inherited ? "disabled" : ""} aria-label="${escapeHtml(tx(`Use inherited ${label.toLocaleLowerCase()} for this tab`, `呢個分頁使用繼承嘅${label}`))}">${icon("refresh")}<span>${escapeHtml(inherited ? tx("Inherited", "已繼承") : tx("Use inherited", "使用繼承值"))}</span></button>`;
}

function renderTabAppearanceEditor(): string {
  const editor = state.appearanceEditor;
  if (!editor) return "";
  const tab = tabDefinition(editor.tabId);
  const overrides = state.tabPreferences.styles[editor.tabId] ?? {};
  const style = resolveTabStyle(overrides);
  const backgroundLabel = tx("Background", "背景");
  const foregroundLabel = tx("Text color", "文字顏色");
  const fontSizeLabel = tx("Font size", "字體大小");
  const fontWeightLabel = tx("Font weight", "字體粗幼");
  const radiusLabel = tx("Corner radius", "圓角半徑");
  return `<section class="appearance-editor" data-testid="tab-appearance-editor" role="dialog" aria-modal="false" aria-labelledby="appearance-editor-title" aria-describedby="appearance-editor-note" style="left:${Math.max(12, editor.x)}px;top:${Math.max(60, editor.y)}px">
    <header class="popover-header"><div><p class="eyebrow">${escapeHtml(tx("ANCHORED TO TAB", "固定喺分頁旁邊"))}</p><h2 id="appearance-editor-title">${escapeHtml(tx(`Edit ${tab.en} appearance`, `編輯${tab.yue}外觀`))}</h2></div><button class="icon-button" type="button" data-action="close-tab-appearance" aria-label="${escapeHtml(tx("Close appearance editor", "關閉外觀編輯器"))}">${icon("close")}</button></header>
    <div class="appearance-editor__preview" style="background:${escapeHtml(safeColor(style.background, "#EADDFF"))};color:${escapeHtml(safeColor(style.foreground, "#21005D"))};font-size:${Math.min(22, Math.max(11, style.fontSize))}px;font-weight:${Math.min(800, Math.max(300, style.fontWeight))};border-radius:${Math.min(28, Math.max(0, style.radius))}px">${icon(tab.icon)}<span>${escapeHtml(tx(tab.en, tab.yue))}</span></div>
    <div class="form-grid appearance-editor__properties">
      <div class="appearance-property"><label class="field field--color"><span>${escapeHtml(backgroundLabel)}</span><span class="color-input"><input type="color" value="${escapeHtml(style.background.slice(0, 7))}" data-tab-style="background" data-focus-key="tab-style-${tab.id}-background-picker" aria-label="${escapeHtml(tx("Choose tab background", "選擇分頁背景"))}"/><input type="text" value="${escapeHtml(style.background)}" data-tab-style="background" data-focus-key="tab-style-${tab.id}-background-value" maxlength="9" spellcheck="false" aria-label="${escapeHtml(tx("Tab background HEX value", "分頁背景 HEX 數值"))}"/></span></label>${renderTabStyleReset(tab.id, "background", backgroundLabel, overrides)}</div>
      <div class="appearance-property"><label class="field field--color"><span>${escapeHtml(foregroundLabel)}</span><span class="color-input"><input type="color" value="${escapeHtml(style.foreground.slice(0, 7))}" data-tab-style="foreground" data-focus-key="tab-style-${tab.id}-foreground-picker" aria-label="${escapeHtml(tx("Choose tab text color", "選擇分頁文字顏色"))}"/><input type="text" value="${escapeHtml(style.foreground)}" data-tab-style="foreground" data-focus-key="tab-style-${tab.id}-foreground-value" maxlength="9" spellcheck="false" aria-label="${escapeHtml(tx("Tab text HEX value", "分頁文字 HEX 數值"))}"/></span></label>${renderTabStyleReset(tab.id, "foreground", foregroundLabel, overrides)}</div>
      <div class="appearance-property"><label class="field"><span>${escapeHtml(fontSizeLabel)}</span><input type="number" min="11" max="22" value="${style.fontSize}" data-tab-style="fontSize" data-focus-key="tab-style-${tab.id}-fontSize-value"/></label>${renderTabStyleReset(tab.id, "fontSize", fontSizeLabel, overrides)}</div>
      <div class="appearance-property"><label class="field"><span>${escapeHtml(fontWeightLabel)}</span><input type="number" min="300" max="800" step="50" value="${style.fontWeight}" data-tab-style="fontWeight" data-focus-key="tab-style-${tab.id}-fontWeight-value"/></label>${renderTabStyleReset(tab.id, "fontWeight", fontWeightLabel, overrides)}</div>
      <div class="appearance-property"><label class="field field--range"><span>${escapeHtml(radiusLabel)}</span><input type="range" min="0" max="28" value="${style.radius}" data-tab-style="radius" data-focus-key="tab-style-${tab.id}-radius-value"/></label>${renderTabStyleReset(tab.id, "radius", radiusLabel, overrides)}</div>
    </div>
    <p class="engine-note" id="appearance-editor-note">${escapeHtml(tx("This focused editor persists bounded HEX colors, type size, weight, and shape for this workspace tab. Use inherited resets one property; Reset tab removes every override. Global font and density remain in Settings.", "呢個專用編輯器會為目前工作空間分頁保存有界限嘅 HEX 顏色、字體大小、粗幼同形狀。使用繼承值會重設一項；重設分頁會移除全部覆寫。全域字款同密度喺設定入面。"))}</p>
    <footer class="popover-actions"><button class="button button--text" type="button" data-action="reset-tab-appearance" data-tab-id="${tab.id}" data-focus-key="tab-style-${tab.id}-reset-all" ${Object.keys(overrides).length ? "" : "disabled"}>${icon("refresh")}<span>${escapeHtml(tx("Reset tab", "重設分頁"))}</span></button><span class="action-spacer"></span><button class="button button--filled" type="button" data-action="close-tab-appearance">${escapeHtml(tx("Done", "完成"))}</button></footer>
  </section>`;
}

function renderComposer(): string {
  const composer = state.compose;
  if (!composer) return "";
  const draft = composer.draft;
  const sourceAccount = state.bootstrap?.accounts.find(account => account.id === draft.accountId);
  return `<aside class="compose-sheet${composer.minimized ? " is-minimized" : ""}" role="dialog" aria-modal="false" aria-labelledby="compose-title">
    <form data-form="compose">
      <header class="compose-header"><div><p class="eyebrow">${escapeHtml(tx("FROM", "寄件帳戶"))} ${escapeHtml(sourceAccount?.email ?? draft.accountId)}</p><h2 id="compose-title">${escapeHtml(draft.subject || tx("New message", "新增郵件"))}</h2></div><div class="compose-header__actions"><button class="icon-button" type="button" data-action="minimize-compose" aria-label="${escapeHtml(tx("Minimize composer", "縮小撰寫視窗"))}">${icon("chevron")}</button><button class="icon-button" type="button" data-action="request-close-compose" aria-label="${escapeHtml(tx("Close composer", "關閉撰寫視窗"))}">${icon("close")}</button></div></header>
      <div class="compose-fields">
        <div class="recipient-row"><label for="compose-to">${escapeHtml(tx("To", "收件人"))}</label><input id="compose-to" name="to" value="${escapeHtml(draft.to.join(", "))}" data-compose-field="to" autocomplete="off" spellcheck="false"/><button type="button" class="button button--text" data-action="toggle-compose-copies">${escapeHtml(composer.showCopies ? tx("Hide Cc/Bcc", "收起副本/密件副本") : tx("Cc/Bcc", "副本/密件副本"))}</button></div>
        ${composer.showCopies || draft.cc.length || draft.bcc.length ? `<div class="recipient-row"><label for="compose-cc">${escapeHtml(tx("Cc", "副本"))}</label><input id="compose-cc" name="cc" value="${escapeHtml(draft.cc.join(", "))}" data-compose-field="cc" autocomplete="off" spellcheck="false"/></div><div class="recipient-row"><label for="compose-bcc">${escapeHtml(tx("Bcc", "密件副本"))}</label><input id="compose-bcc" name="bcc" value="${escapeHtml(draft.bcc.join(", "))}" data-compose-field="bcc" autocomplete="off" spellcheck="false"/></div>` : ""}
        <div class="recipient-row"><label for="compose-subject">${escapeHtml(tx("Subject", "主旨"))}</label><input id="compose-subject" name="subject" value="${escapeHtml(draft.subject)}" data-compose-field="subject" maxlength="998"/></div>
      </div>
      ${renderComposeCryptographyTrust(sourceAccount ?? null)}
      <label class="visually-hidden" for="compose-body">${escapeHtml(tx("Message body", "郵件內容"))}</label><textarea class="compose-body" id="compose-body" name="text" data-compose-field="text" placeholder="${escapeHtml(tx("Write a message…", "撰寫郵件……"))}" spellcheck="true">${escapeHtml(draft.text)}</textarea>
      ${draft.attachments.length ? `<div class="compose-attachments" aria-label="${escapeHtml(tx("Attached files", "已附加檔案"))}">${draft.attachments.map((file, index) => `<span class="attachment-chip">${icon("attach")}<span>${escapeHtml(file.split(/[\\/]/).pop() ?? file)}</span><button class="icon-button icon-button--small" type="button" data-action="remove-compose-attachment" data-attachment-index="${index}" aria-label="${escapeHtml(tx("Remove attachment", "移除附件"))}">${icon("close")}</button></span>`).join("")}</div>` : ""}
      <footer class="compose-footer"><button class="button button--filled" type="submit" data-compose-submit="send" ${isBusy("send") || isBusy("save-draft") ? "disabled" : ""}>${icon("send", isBusy("send") ? "is-spinning" : "")}<span>${escapeHtml(isBusy("send") ? tx("Sending or queueing…", "寄出或者排隊緊……") : tx("Send", "寄出"))}</span><kbd>Ctrl+Enter</kbd></button><button class="icon-button" type="button" data-action="choose-attachments" aria-label="${escapeHtml(tx("Attach files", "附加檔案"))}" data-tooltip="${escapeHtml(tx("Attach files", "附加檔案"))}">${icon("attach")}</button><span class="action-spacer"></span><button class="button button--outlined" type="submit" data-compose-submit="draft" ${isBusy("send") || isBusy("save-draft") ? "disabled" : ""}>${icon("archive")}<span>${escapeHtml(isBusy("save-draft") ? tx("Saving…", "儲存緊……") : tx("Save draft", "儲存草稿"))}</span></button></footer>
    </form>
  </aside>`;
}

interface PaletteCommand {
  id: string;
  en: string;
  yue: string;
  icon: IconName;
  shortcut?: string;
}

const paletteCommands = (): PaletteCommand[] => [
  { id: "compose", en: "Compose new message", yue: "撰寫新郵件", icon: "compose", shortcut: "Ctrl+N" },
  { id: "sync", en: "Synchronize current account", yue: "同步目前帳戶", icon: "refresh", shortcut: "Ctrl+Shift+S" },
  ...TAB_DEFINITIONS.map(tab => ({ id: `tab:${tab.id}`, en: `Open ${tab.en}`, yue: `開啟${tab.yue}`, icon: tab.icon })),
  { id: "regex", en: "Open mail regex builder", yue: "開啟郵件正規表達式建立器", icon: "regex", shortcut: "Alt+R" },
  { id: "editor", en: "Open in external editor", yue: "用外部編輯器開啟", icon: "tools", shortcut: "Alt+E" },
];

const resetCommandPaletteSearch = (): void => {
  delete state.searches.commands;
};

function renderCommandPalette(): string {
  const model = searchFor("commands");
  const validation = validatePattern(model);
  const invalid = model.mode === "regex" && model.pattern.length > 0 && !validation.valid;
  const commands = filterPaletteCommands(paletteCommands(), model);
  return `<div class="modal-layer palette-layer"><section class="command-palette" data-testid="command-palette" role="dialog" aria-modal="true" aria-labelledby="palette-title"><header><div><p class="eyebrow">${escapeHtml(tx("KEYBOARD FIRST", "鍵盤優先"))}</p><h2 id="palette-title">${escapeHtml(tx("Command palette", "指令面板"))}</h2></div><button class="icon-button" type="button" data-action="close-command-palette" aria-label="${escapeHtml(tx("Close command palette", "關閉指令面板"))}">${icon("close")}</button></header><div class="palette-search">${renderSearchField("commands", tx("Type a command or destination", "輸入指令或者目的地"))}</div><div class="command-list" role="listbox" aria-label="${escapeHtml(tx("Matching commands", "符合嘅指令"))}">${commands.length ? commands.map((command, index) => `<button type="button" role="option" aria-selected="${index === 0}" data-action="run-command" data-command-id="${escapeHtml(command.id)}">${icon(command.icon)}<span><strong>${escapeHtml(tx(command.en, command.yue))}</strong></span>${command.shortcut ? `<kbd>${escapeHtml(command.shortcut)}</kbd>` : ""}</button>`).join("") : `<p class="empty-inline" ${invalid ? `role="alert"` : `role="status"`}>${escapeHtml(invalid ? tx("Correct the regular expression before running a command.", "修正正規表達式先可以執行指令。") : tx("No matching commands", "冇符合嘅指令"))}</p>`}</div></section></div>`;
}

function showConfirmation(confirmation: ConfirmationState, returnFocusKey?: string | null): void {
  state.confirmation = confirmation;
  state.confirmationReturnFocusKey = returnFocusKey
    ?? (document.activeElement instanceof HTMLElement ? document.activeElement.dataset.focusKey ?? null : null);
  confirmationNeedsInitialFocus = true;
  render();
}

function cancelConfirmation(): void {
  const confirmation = state.confirmation;
  if (confirmation?.kind === "external-link") void api.cancelExternalLink(confirmation.request.requestId).catch(() => undefined);
  const pimReturnName = confirmation?.kind === "discard-pim-editor" || confirmation?.kind === "replace-pim-editor"
    ? state.pimEditorLastFocusName
    : null;
  const returnFocusKey = state.confirmationReturnFocusKey
    ?? (confirmation?.kind === "discard-pim-editor" || confirmation?.kind === "replace-pim-editor"
      ? state.pimEditorLastFocusKey
      : null);
  state.confirmation = null;
  state.confirmationReturnFocusKey = null;
  pendingFocusKey = returnFocusKey;
  render();
  focusByKey(returnFocusKey);
  if (pimReturnName) {
    app?.querySelector<HTMLElement>(`[data-testid="pim-editor"] [name="${CSS.escape(pimReturnName)}"]`)?.focus({ preventScroll: true });
  }
}

function renderConfirmation(): string {
  const confirmation = state.confirmation;
  if (!confirmation) return "";
  let title = tx("Confirm action", "確認操作");
  let body = "";
  let confirmLabel = tx("Continue", "繼續");
  let cancelLabel = tx("Cancel", "取消");
  let detailsMarkup = "";
  if (confirmation.kind === "remove-account") {
    title = tx("Remove this account?", "移除呢個帳戶？");
    body = tx(`${confirmation.label}, its local cache, drafts, Outbox items, pending changes, and any open composer for this account will be removed from this computer. Server mail is not deleted.`, `${confirmation.label}、本機快取、草稿、寄件匣項目、待處理更改，同呢個帳戶已開啟嘅撰寫視窗，都會由呢部電腦移除。伺服器郵件唔會被刪除。`);
    confirmLabel = tx("Remove account", "移除帳戶");
  } else if (confirmation.kind === "clear-oauth-token-vault") {
    title = tx(`Clear ${confirmation.label} OAuth ciphertext from this computer?`, `由呢部電腦清除 ${confirmation.label} OAuth 密文？`);
    body = tx("Every active encrypted access/refresh-token record for this provider will leave the vault. No provider endpoint will be contacted, the action cannot be undone in the app, and filesystem secure erasure is not claimed.", "呢個供應商所有目前加密 access／refresh 權杖記錄都會離開保險庫。唔會聯絡供應商端點；應用程式入面唔可以復原，而且唔聲稱檔案系統安全抹除。 ");
    confirmLabel = tx("Clear local ciphertext", "清除本機密文");
  } else if (confirmation.kind === "revoke-oauth-token-vault") {
    title = tx(`Revoke ${confirmation.label} OAuth tokens and clear local ciphertext?`, `撤銷 ${confirmation.label} OAuth 權杖並清除本機密文？`);
    body = tx("The registered provider revoker will receive the decrypted tokens inside the main process. Local encrypted records will then be cleared even if the provider rejects or cannot complete revocation. This build cannot prove provider interoperability.", "已註冊供應商 revoker 會喺主程序內收到解密權杖。之後即使供應商拒絕或者未能完成撤銷，本機加密記錄都會清除。呢個版本唔可以證明供應商互通性。 ");
    confirmLabel = tx("Revoke and clear", "撤銷並清除");
  } else if (confirmation.kind === "clear-notifications") {
    title = tx("Clear notification history?", "清除通知記錄？");
    body = tx("All stored app notifications will be removed. Mail and local history are unchanged.", "所有已儲存應用程式通知會被移除。郵件同本機歷史唔會改變。 ");
    confirmLabel = tx("Clear notifications", "清除通知");
  } else if (confirmation.kind === "bulk-close-tabs") {
    title = tx(`Close ${confirmation.tabIds.length} reviewed tabs?`, `關閉已審閱嘅 ${confirmation.tabIds.length} 個分頁？`);
    body = `${confirmation.tabIds.map(id => tx(tabDefinition(id).en, tabDefinition(id).yue)).join(" · ")}. ${tx("Pinned tabs were included only if you explicitly enabled that option.", "釘選分頁只會喺你明確啟用嗰個選項時包括。")}`;
    confirmLabel = tx("Close reviewed tabs", "關閉已審閱分頁");
  } else if (confirmation.kind === "restore-local") {
    title = tx("Restore this workspace version?", "還原呢個工作空間版本？");
    body = tx(`Restore “${confirmation.label}”. The current state is preserved as another append-only version.`, `還原「${confirmation.label}」。目前狀態會保留做另一個只追加版本。`);
    confirmLabel = tx("Restore version", "還原版本");
  } else if (confirmation.kind === "prune-local-history") {
    const preview = confirmation.preview;
    title = tx(`Prune ${preview.eligibleRevisions.length} previewed local revisions?`, `清理已預覽嘅 ${preview.eligibleRevisions.length} 個本機修訂？`);
    body = tx(
      `Only the exact app-owned revisions in the dry run will leave active history. The current state and ${preview.protectedLabeledCount} labeled revision${preview.protectedLabeledCount === 1 ? "" : "s"} stay available. This cannot be undone from the app and is not secure deletion.`,
      `只會將試行入面確切列出、由應用程式建立嘅修訂移離現役歷史。目前狀態同 ${preview.protectedLabeledCount} 個有標籤修訂會繼續保留。應用程式入面唔可以復原呢次清理，而且呢個唔係安全刪除。`,
    );
    confirmLabel = tx("Prune previewed revisions", "清理已預覽修訂");
    cancelLabel = tx("Keep every revision", "保留全部修訂");
    detailsMarkup = `<div class="retention-confirmation" id="confirmation-details"><p><strong>${escapeHtml(tx("Cutoff", "截止"))}</strong> ${escapeHtml(formatDate(preview.cutoffAt))}</p><p><strong>${escapeHtml(tx("Expected current revision", "預期目前修訂"))}</strong> <code>${escapeHtml(preview.headHash?.slice(0, 12) ?? "")}</code></p></div>`;
  } else if (confirmation.kind === "discard-pending-operation") {
    title = tx("Discard this queued server change?", "捨棄呢個排隊伺服器更改？");
    body = tx(
      `${confirmation.label} will be removed from the queue without contacting the mail server. The next folder refresh will replace any optimistic local state with the server's authoritative state.`,
      `${confirmation.label} 會由隊列移除，而且唔會聯絡郵件伺服器。下次重新整理資料夾時，伺服器權威狀態會取代任何本機預先顯示嘅狀態。`,
    );
    confirmLabel = tx("Discard queued change", "捨棄排隊更改");
  } else if (confirmation.kind === "delete-pim") {
    title = tx(`Delete ${confirmation.label}?`, `刪除 ${confirmation.label}？`);
    body = tx(`This local ${confirmation.entityKind.replaceAll("-", " ")} will be removed. Its append-only transaction snapshot remains available for restore.`, `呢個本機${confirmation.entityKind.replaceAll("-", " ")}會被移除。只追加交易快照仍然可以用嚟還原。`);
    confirmLabel = tx("Delete local record", "刪除本機記錄");
  } else if (confirmation.kind === "discard-compose") {
    title = tx("Discard this unsaved composer?", "放棄呢個未儲存撰寫視窗？");
    body = tx("Recipients, subject, body, and unsaved attachments in this window will be lost. Save a draft to keep them.", "呢個視窗入面嘅收件人、主旨、內容同未儲存附件會遺失。要保留就儲存草稿。 ");
    confirmLabel = tx("Discard message", "放棄郵件");
    cancelLabel = tx("Keep writing", "繼續撰寫");
  } else if (confirmation.kind === "replace-compose") {
    title = tx("Discard this unsaved composer and start another?", "放棄呢個未儲存撰寫視窗，再開另一個？");
    body = tx("The current recipients, subject, body, and unsaved attachments will be lost before the requested composer opens.", "目前嘅收件人、主旨、內容同未儲存附件會遺失，之後先會開啟要求嘅撰寫視窗。 ");
    confirmLabel = tx("Discard and continue", "放棄並繼續");
    cancelLabel = tx("Keep writing", "繼續撰寫");
  } else if (confirmation.kind === "discard-pim-editor") {
    title = tx("Discard unsaved local changes?", "放棄未儲存嘅本機更改？");
    body = tx(`Changes to this ${confirmation.label} have not been saved. Discarding closes the editor and cannot be undone from transaction history.`, `呢個${confirmation.label}嘅更改仲未儲存。放棄會關閉編輯器，而且交易歷史唔可以還原未儲存內容。`);
    confirmLabel = tx("Discard changes", "放棄更改");
    cancelLabel = tx("Keep editing", "繼續編輯");
  } else if (confirmation.kind === "replace-pim-editor") {
    title = tx("Discard unsaved changes and open another record?", "放棄未儲存更改，再開另一個記錄？");
    body = tx("The current local form has not been saved. Opening the requested editor will discard those changes.", "目前本機表格仲未儲存。開啟要求嘅編輯器會放棄呢啲更改。 ");
    confirmLabel = tx("Discard and open", "放棄並開啟");
    cancelLabel = tx("Keep editing", "繼續編輯");
  } else if (confirmation.kind === "save-risky-attachments") {
    const riskyCount = confirmation.review.riskyAttachments.length;
    title = confirmation.target === "all"
      ? tx(`Quarantine ${riskyCount} risky attachment${riskyCount === 1 ? "" : "s"} before saving the ordinary files?`, `儲存普通檔案之前，隔離 ${riskyCount} 個有風險嘅附件？`)
      : tx("Place this risky attachment in local quarantine?", "將呢個有風險嘅附件放入本機隔離區？");
    body = tx(
      "Material Email found filename or declared-type warning signs. Continuing stores each risky file under a randomized local quarantine name; it will not reach a chosen destination until you separately release it. Ordinary files in a batch can still use the native folder chooser. No antivirus scan is performed.",
      "Material Email 發現檔名或者聲稱類型有警號。繼續會用隨機本機隔離名稱儲存每個有風險檔案；除非你之後另行放行，否則唔會去到所選目的地。批次入面嘅普通檔案仍然可以用原生資料夾選擇器。呢個流程冇做防毒掃描。",
    );
    confirmLabel = confirmation.target === "all" ? tx("Quarantine risks and continue", "隔離風險並繼續") : tx("Place in quarantine", "放入隔離區");
    cancelLabel = tx("Cancel save", "取消儲存");
    detailsMarkup = `<ul class="attachment-review-list" id="confirmation-details" aria-label="${escapeHtml(tx("Risky attachments to review", "要審閱嘅有風險附件"))}">${confirmation.review.riskyAttachments.map(item => `<li><div><strong><bdi>${escapeHtml(item.filename)}</bdi></strong><span class="attachment-risk-badge attachment-risk-badge--${item.level}">${escapeHtml(item.level === "dangerous" ? tx("Dangerous", "危險") : tx("Caution", "小心"))}</span></div><small>${escapeHtml(item.reasons.map(attachmentRiskReasonLabel).join(" · "))}</small></li>`).join("")}</ul>`;
  } else if (confirmation.kind === "release-quarantined-attachment") {
    const item = confirmation.item;
    title = tx(`Release ${item.filename} from local quarantine?`, `由本機隔離區放行 ${item.filename}？`);
    body = tx(
      "Release verifies the stored SHA-256 value, opens a native save dialog, and copies the file to the destination you choose. The local quarantine copy and active metadata are removed only after that copy succeeds. This is not an antivirus approval.",
      "放行會核對已儲存嘅 SHA-256、開啟原生儲存對話框，再複製檔案去你揀嘅目的地。複製成功之後先會移除本機隔離副本同目前中繼資料。呢個唔係防毒批准。",
    );
    confirmLabel = tx("Release to a chosen location…", "放行去所選位置……");
    cancelLabel = tx("Keep quarantined", "繼續隔離");
    detailsMarkup = `<div class="quarantine-review" id="confirmation-details"><p><span class="attachment-risk-badge attachment-risk-badge--${item.risk.level}">${escapeHtml(item.risk.level === "dangerous" ? tx("Dangerous", "危險") : tx("Caution", "小心"))}</span> ${escapeHtml(item.risk.reasons.map(attachmentRiskReasonLabel).join(" · "))}</p><p><strong>${escapeHtml(tx("Integrity", "完整性"))}</strong> <code>${escapeHtml(item.sha256)}</code></p></div>`;
  } else if (confirmation.kind === "delete-quarantined-attachment") {
    const item = confirmation.item;
    title = tx(`Delete ${item.filename} from local quarantine?`, `由本機隔離區刪除 ${item.filename}？`);
    body = tx(
      "The quarantined payload and active metadata will be removed without releasing a copy. The deletion event remains in local history, but the attachment bytes cannot be restored from that metadata.",
      "隔離內容同目前中繼資料會直接移除，唔會放行副本。刪除事件會留喺本機歷史，但附件內容唔可以靠嗰啲中繼資料還原。",
    );
    confirmLabel = tx("Delete quarantined file", "刪除隔離檔案");
    cancelLabel = tx("Keep quarantined", "繼續隔離");
  } else if (confirmation.kind === "external-link") {
    const request = confirmation.request;
    title = tx("Review external link before opening", "開啟外部連結之前先審閱");
    body = tx(
      "This link came from message content and has been stopped before any browser window opened. Check the normalized address and warning signs before continuing.",
      "呢條連結來自郵件內容，已經喺瀏覽器視窗開啟之前停低。繼續之前請檢查標準化網址同警號。",
    );
    confirmLabel = tx("Open in browser", "用瀏覽器開啟");
    cancelLabel = tx("Do not open", "唔好開啟");
    const riskLabel = request.risk === "dangerous" ? tx("Dangerous", "危險") : request.risk === "caution" ? tx("Caution", "小心") : tx("No detected warning", "未發現警號");
    detailsMarkup = `<div class="external-link-review" id="confirmation-details"><p><strong>${escapeHtml(tx("Destination", "目的地"))}</strong><code class="external-link-review__url" tabindex="0"><bdi>${escapeHtml(request.normalizedUrl)}</bdi></code></p><p><strong>${escapeHtml(tx("Host", "主機"))}</strong> <bdi>${escapeHtml(request.hostname)}</bdi> · <span class="attachment-risk-badge attachment-risk-badge--${request.risk}">${escapeHtml(riskLabel)}</span></p>${request.reasons.length ? `<p><strong>${escapeHtml(tx("Why it was flagged", "點解標記咗"))}</strong> ${escapeHtml(request.reasons.map(externalLinkReasonLabel).join(" · "))}</p>` : ""}</div>`;
  } else {
    title = tx("Send without a subject?", "冇主旨都寄出？");
    body = tx("Recipients and body are present, but the subject is empty. The message will still be sent or queued if you continue.", "收件人同內容都有，但主旨係空白。繼續之後，郵件仍然會寄出或者排入寄件匣。 ");
    confirmLabel = tx("Send without subject", "冇主旨都寄出");
  }
  return `<div class="modal-layer confirmation-layer"><section class="confirmation-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirmation-title" aria-describedby="confirmation-body${detailsMarkup ? " confirmation-details" : ""}"><span class="hero-icon hero-icon--warning">${icon("warning")}</span><h2 id="confirmation-title">${escapeHtml(title)}</h2><p id="confirmation-body">${escapeHtml(body)}</p>${detailsMarkup}<div class="button-row"><button class="button button--text" type="button" data-action="cancel-confirmation" data-confirmation-initial>${escapeHtml(cancelLabel)}</button><button class="button button--danger" type="button" data-action="confirm-action">${escapeHtml(confirmLabel)}</button></div></section></div>`;
}

const splitRecipients = (value: string): string[] => value
  .split(/[;,]/)
  .map(item => item.trim().replace(/[\r\n\0]/g, ""))
  .filter(Boolean)
  .slice(0, 200)
  .map(item => item.slice(0, 320));

const composerIsDirty = (): boolean => Boolean(state.compose && composeFingerprint(state.compose.draft) !== state.compose.cleanBaseline);

const captureComposer = (): void => {
  if (!state.compose) return;
  const form = document.querySelector<HTMLFormElement>('[data-form="compose"]');
  if (!form) return;
  const data = new FormData(form);
  state.compose.draft.to = splitRecipients(String(data.get("to") ?? ""));
  state.compose.draft.cc = splitRecipients(String(data.get("cc") ?? ""));
  state.compose.draft.bcc = splitRecipients(String(data.get("bcc") ?? ""));
  state.compose.draft.subject = String(data.get("subject") ?? "").slice(0, 998);
  state.compose.draft.text = String(data.get("text") ?? "").slice(0, 2_000_000);
};

const syncAccountAuthenticationMode = (form: HTMLFormElement): void => {
  const authMode = form.elements.namedItem("authMode");
  const password = form.elements.namedItem("secret");
  const incomingProtocol = form.elements.namedItem("incomingProtocol");
  const pop3Mode = incomingProtocol instanceof HTMLSelectElement && incomingProtocol.value === "pop3";
  const oauthMode = authMode instanceof HTMLSelectElement && authMode.value === "oauth2";
  const passwordField = form.querySelector<HTMLElement>("[data-password-credential]");
  const oauthPanel = form.querySelector<HTMLElement>("[data-oauth-panel]");
  const pop3Panel = form.querySelector<HTMLElement>("[data-pop3-panel]");
  if (authMode instanceof HTMLSelectElement) authMode.disabled = pop3Mode;
  if (passwordField) passwordField.hidden = oauthMode || pop3Mode;
  if (password instanceof HTMLInputElement) {
    password.required = !oauthMode && !pop3Mode;
    password.disabled = pop3Mode;
    if (oauthMode || pop3Mode) password.value = "";
  }
  if (oauthPanel) oauthPanel.hidden = !oauthMode || pop3Mode;
  if (pop3Panel) pop3Panel.hidden = !pop3Mode;
  for (const submit of form.querySelectorAll<HTMLButtonElement>("[data-account-submit]")) {
    submit.disabled = oauthMode || pop3Mode || isBusy("account-test") || isBusy("account-add");
  }
};

const syncIncomingProtocolMode = (form: HTMLFormElement, adjustConventionalPort = true): void => {
  const protocol = form.elements.namedItem("incomingProtocol");
  if (!(protocol instanceof HTMLSelectElement)) return;
  const pop3Mode = protocol.value === "pop3";
  const authMode = form.elements.namedItem("authMode");
  if (pop3Mode && authMode instanceof HTMLSelectElement) authMode.value = "password";
  for (const element of form.querySelectorAll<HTMLElement>("[data-incoming-protocol-heading], [data-incoming-protocol-subtitle], [data-incoming-protocol-copy]")) {
    const target = element.dataset.incomingProtocolHeading ?? element.dataset.incomingProtocolSubtitle ?? element.dataset.incomingProtocolCopy;
    element.hidden = target !== (pop3Mode ? "pop3" : "imap");
  }
  const port = form.elements.namedItem("incomingPort");
  if (adjustConventionalPort && port instanceof HTMLInputElement) {
    if (pop3Mode && port.value === "993") port.value = "995";
    if (!pop3Mode && port.value === "995") port.value = "993";
  }
  const host = form.elements.namedItem("incomingHost");
  if (host instanceof HTMLInputElement) host.placeholder = pop3Mode ? "pop.example.com" : "imap.example.com";
  const incomingInspection = form.querySelector<HTMLButtonElement>('[data-tls-endpoint="incoming"]');
  if (incomingInspection) {
    incomingInspection.disabled = pop3Mode;
    if (pop3Mode) incomingInspection.setAttribute("aria-describedby", "incoming-protocol-boundary");
    else incomingInspection.removeAttribute("aria-describedby");
  }
  if (pop3Mode) {
    const incomingResult = form.querySelector<HTMLElement>('[data-tls-inspection-result="incoming"]');
    if (incomingResult) incomingResult.replaceChildren();
  }
  syncAccountAuthenticationMode(form);
  updateConnectionPreflight(form);
};

const updateOAuthAuthorizationPanel = (focusKey?: "oauth-start" | "oauth-cancel"): void => {
  const form = document.querySelector<HTMLFormElement>('[data-form="account-setup"]');
  const panel = form?.querySelector<HTMLElement>("[data-oauth-panel]");
  if (!form || !panel) return;
  const preservedFocusKey = document.activeElement instanceof HTMLElement
    && document.activeElement.closest("[data-oauth-panel]")
    ? document.activeElement.dataset.focusKey as "oauth-start" | "oauth-cancel" | undefined
    : undefined;
  panel.outerHTML = renderOAuthAuthorizationPanel();
  syncAccountAuthenticationMode(form);
  applyBilingualSemantics(form);
  const nextFocusKey = focusKey ?? preservedFocusKey;
  if (nextFocusKey) requestAnimationFrame(() => form.querySelector<HTMLElement>(`[data-focus-key="${nextFocusKey}"]`)?.focus());
};

const stopOAuthStatusPolling = (): void => {
  if (oauthStatusPollTimer !== null) window.clearTimeout(oauthStatusPollTimer);
  oauthStatusPollTimer = null;
};

const oauthAuthorizationSnapshotsEqual = (left: OAuthAuthorizationSnapshot, right: OAuthAuthorizationSnapshot): boolean =>
  left.phase === right.phase
  && left.provider === right.provider
  && left.expiresAt === right.expiresAt
  && left.failure === right.failure
  && left.providers.length === right.providers.length
  && left.providers.every((provider, index) => {
    const candidate = right.providers[index];
    return candidate?.id === provider.id && candidate.name === provider.name && candidate.configured === provider.configured;
  });

const scheduleOAuthStatusPoll = (): void => {
  stopOAuthStatusPolling();
  if (!state.setupOpen || !oauthAuthorizationIsActive()) return;
  oauthStatusPollTimer = window.setTimeout(async () => {
    oauthStatusPollTimer = null;
    try {
      const next = await api.getOAuthAuthorizationStatus();
      if (!oauthAuthorizationSnapshotsEqual(state.oauthAuthorization, next)) {
        state.oauthAuthorization = next;
        updateOAuthAuthorizationPanel();
      }
      scheduleOAuthStatusPoll();
    } catch {
      pushToast(
        "error",
        "OAuth status unavailable",
        "The desktop bridge could not read the local authorization state. No connected account or token is claimed.",
        "OAuth 狀態不可用",
        "桌面連接讀唔到本機授權狀態。唔會聲稱已有連接帳戶或者權杖。",
      );
    }
  }, 250);
};

const refreshOAuthAuthorizationStatus = async (): Promise<void> => {
  state.oauthAuthorization = await api.getOAuthAuthorizationStatus();
  const selectedExists = state.oauthAuthorization.providers.some(provider => provider.id === state.oauthProvider);
  if (!selectedExists) state.oauthProvider = state.oauthAuthorization.providers[0]?.id ?? "google";
  updateOAuthAuthorizationPanel();
  scheduleOAuthStatusPoll();
};

const startOAuthAuthorizationFromSetup = async (): Promise<void> => {
  const provider = state.oauthAuthorization.providers.find(candidate => candidate.id === state.oauthProvider);
  if (!provider?.configured || oauthAuthorizationIsActive()) return;
  state.oauthAuthorization = {
    ...state.oauthAuthorization,
    phase: "preparing",
    provider: provider.id,
    expiresAt: null,
    failure: null,
  };
  updateOAuthAuthorizationPanel();
  try {
    state.oauthAuthorization = await api.startOAuthAuthorization(provider.id);
    updateOAuthAuthorizationPanel(oauthAuthorizationIsActive() ? "oauth-cancel" : "oauth-start");
    scheduleOAuthStatusPoll();
  } catch {
    await refreshOAuthAuthorizationStatus().catch(() => undefined);
    pushToast(
      "error",
      "Browser authorization did not start",
      "The local OAuth foundation stopped before account connection. No token was saved.",
      "瀏覽器授權未有開始",
      "本機 OAuth 地基喺連接帳戶之前已停止。冇儲存權杖。",
    );
  }
};

const cancelOAuthAuthorizationFromSetup = async (): Promise<void> => {
  stopOAuthStatusPolling();
  try {
    state.oauthAuthorization = await api.cancelOAuthAuthorization();
    updateOAuthAuthorizationPanel("oauth-start");
  } catch {
    pushToast(
      "error",
      "Authorization cancellation status unavailable",
      "The desktop bridge did not confirm cancellation. Close account setup or the app to tear down the local listener.",
      "授權取消狀態不可用",
      "桌面連接未能確認取消。關閉帳戶設定或者應用程式，就會拆走本機監聽器。",
    );
  }
};

const accountDraftFromForm = (form: HTMLFormElement): AccountDraft => {
  const data = new FormData(form);
  const incomingSecurity = String(data.get("incomingSecurity"));
  const outgoingSecurity = String(data.get("outgoingSecurity"));
  const authMode = String(data.get("authMode"));
  const incomingProtocol = String(data.get("incomingProtocol"));
  if (!new Set(["tls", "starttls", "plain"]).has(incomingSecurity) || !new Set(["tls", "starttls", "plain"]).has(outgoingSecurity)) {
    throw new Error("Choose a valid server security mode.");
  }
  if (authMode !== "password" && authMode !== "oauth2") throw new Error("Choose a valid authentication mode.");
  if (incomingProtocol !== "imap" && incomingProtocol !== "pop3") throw new Error("Choose IMAP or POP3 as the incoming protocol.");
  const base = {
    displayName: String(data.get("displayName") ?? "").trim(),
    email: String(data.get("email") ?? "").trim(),
    incoming: {
      host: String(data.get("incomingHost") ?? "").trim(),
      port: Number(data.get("incomingPort")),
      security: incomingSecurity as AccountDraft["incoming"]["security"],
      username: String(data.get("incomingUsername") ?? "").trim(),
    },
    outgoing: {
      host: String(data.get("outgoingHost") ?? "").trim(),
      port: Number(data.get("outgoingPort")),
      security: outgoingSecurity as AccountDraft["outgoing"]["security"],
      username: String(data.get("outgoingUsername") ?? "").trim(),
    },
    authMode: authMode as AccountDraft["authMode"],
    secret: String(data.get("secret") ?? ""),
  };
  if (incomingProtocol === "imap") return { ...base, incomingProtocol };
  return { ...base, incomingProtocol, pop3: pop3OptionsFromForm(form) };
};

const pop3OptionsFromForm = (form: HTMLFormElement): Pop3AccountOptions => {
  const data = new FormData(form);
  const transport = String(data.get("pop3Transport"));
  const retrievalMode = String(data.get("pop3RetrievalMode"));
  const messageLimit = Number(data.get("pop3MessageLimit"));
  if (transport !== "local-demo" && transport !== "live-network") throw new Error("Choose a valid POP3 transport boundary.");
  if (retrievalMode !== "new-only") throw new Error("Choose the supported new-messages-only POP3 retrieval mode.");
  if (!Number.isInteger(messageLimit) || messageLimit < POP3_MESSAGE_LIMIT_MIN || messageLimit > POP3_MESSAGE_LIMIT_MAX) {
    throw new Error(`POP3 demo message limit must be a whole number from ${POP3_MESSAGE_LIMIT_MIN} through ${POP3_MESSAGE_LIMIT_MAX}.`);
  }
  return { transport, retrievalMode, leaveOnServer: true, messageLimit };
};

const CONNECTION_PREFLIGHT_FIELD_NAMES = new Set([
  "incomingHost",
  "incomingPort",
  "incomingSecurity",
  "outgoingHost",
  "outgoingPort",
  "outgoingSecurity",
]);

const connectionSettingsFromForm = (form: HTMLFormElement): MailConnectionSettings => {
  const data = new FormData(form);
  const security = (value: FormDataEntryValue | null): AccountDraft["incoming"]["security"] => {
    const candidate = String(value ?? "");
    return candidate === "tls" || candidate === "starttls" || candidate === "plain" ? candidate : "plain";
  };
  return {
    incomingProtocol: String(data.get("incomingProtocol")) === "pop3" ? "pop3" : "imap",
    incoming: {
      host: String(data.get("incomingHost") ?? "").trim(),
      port: Number(data.get("incomingPort")),
      security: security(data.get("incomingSecurity")),
      username: String(data.get("incomingUsername") ?? "").trim(),
    },
    outgoing: {
      host: String(data.get("outgoingHost") ?? "").trim(),
      port: Number(data.get("outgoingPort")),
      security: security(data.get("outgoingSecurity")),
      username: String(data.get("outgoingUsername") ?? "").trim(),
    },
  };
};

const diagnosticControlNames = (diagnostic: ConnectionDiagnostic): string[] => {
  const prefix = diagnostic.endpoint;
  if (diagnostic.field === "host") return [`${prefix}Host`];
  if (diagnostic.field === "port") return [`${prefix}Port`];
  if (diagnostic.code === "implicit-tls-on-starttls-port" || diagnostic.code === "starttls-on-implicit-tls-port" || diagnostic.code === "plain-on-implicit-tls-port") {
    return [`${prefix}Port`, `${prefix}Security`];
  }
  return [`${prefix}Security`];
};

const updateConnectionPreflight = (
  form: HTMLFormElement,
  announceErrors = false,
  settings = connectionSettingsFromForm(form),
): ConnectionDiagnostic[] => {
  const region = form.querySelector<HTMLElement>('[data-testid="connection-preflight"]');
  const list = form.querySelector<HTMLElement>("[data-connection-preflight-list]");
  const diagnostics = diagnoseMailConnection(settings);
  const visibleDiagnostics = announceErrors ? diagnostics : diagnostics.filter(diagnostic => diagnostic.code !== "hostname-empty");
  if (!region || !list) return diagnostics;

  list.innerHTML = renderConnectionDiagnosticItems(visibleDiagnostics, settings);
  applyBilingualSemantics(list);
  region.setAttribute("role", announceErrors && visibleDiagnostics.some(diagnostic => diagnostic.severity === "error") ? "alert" : "status");
  region.setAttribute("aria-live", announceErrors && visibleDiagnostics.some(diagnostic => diagnostic.severity === "error") ? "assertive" : "polite");

  for (const name of CONNECTION_PREFLIGHT_FIELD_NAMES) {
    const control = form.elements.namedItem(name);
    if (control instanceof HTMLElement) control.removeAttribute("aria-invalid");
  }
  const invalidNames = new Set(
    visibleDiagnostics.filter(diagnostic => diagnostic.severity === "error").flatMap(diagnosticControlNames),
  );
  for (const name of invalidNames) {
    const control = form.elements.namedItem(name);
    if (control instanceof HTMLElement) control.setAttribute("aria-invalid", "true");
  }
  if (announceErrors && invalidNames.size) {
    const firstInvalid = [...form.elements].find(control => control instanceof HTMLElement && invalidNames.has(control.getAttribute("name") ?? ""));
    if (firstInvalid instanceof HTMLElement) firstInvalid.focus();
  }
  return diagnostics;
};

const inspectTlsCertificateFromSetup = async (button: HTMLElement): Promise<void> => {
  const endpoint = button.dataset.tlsEndpoint;
  if (endpoint !== "incoming" && endpoint !== "outgoing") return;
  const form = button.closest<HTMLFormElement>('[data-form="account-setup"]');
  if (!form) return;
  const settings = connectionSettingsFromForm(form);
  const localErrors = diagnoseMailConnection(settings).filter(diagnostic => diagnostic.endpoint === endpoint && diagnostic.severity === "error");
  if (localErrors.length) {
    updateConnectionPreflight(form, true, settings);
    pushToast(
      "error",
      "Live certificate inspection did not start",
      "Correct the highlighted local host, port, or TLS-mode conflict first. No network connection was opened and no credentials were sent.",
      "即時證書檢查未有開始",
      "請先修正已標示嘅本機主機、連接埠或者 TLS 模式衝突。未有開啟網絡連線，亦未有傳送憑證。",
    );
    return;
  }
  const resultRegion = form.querySelector<HTMLElement>(`[data-tls-inspection-result="${endpoint}"]`);
  if (!resultRegion || button.getAttribute("aria-busy") === "true") return;
  const original = button.innerHTML;
  button.setAttribute("aria-busy", "true");
  button.setAttribute("disabled", "");
  button.innerHTML = `${icon("refresh", "is-spinning")}<span>${escapeHtml(tx("Inspecting certificate…", "檢查證書緊……"))}</span>`;
  applyBilingualSemantics(button);
  resultRegion.setAttribute("role", "status");
  resultRegion.setAttribute("aria-busy", "true");
  resultRegion.innerHTML = `<p class="tls-inspection-progress">${icon("refresh", "is-spinning")}<span>${escapeHtml(tx("Opening the bounded credential-free diagnostic connection…", "開緊有時限、唔用憑證嘅診斷連線……"))}</span></p>`;
  applyBilingualSemantics(resultRegion);
  try {
    const server = settings[endpoint];
    const result = await api.inspectTlsCertificate({ endpoint, host: server.host, port: server.port, security: server.security });
    resultRegion.setAttribute("role", "status");
    resultRegion.innerHTML = renderTlsCertificateInspection(result);
    applyBilingualSemantics(resultRegion);
    pushToast(
      result.outcome === "inspected" ? "success" : "info",
      result.outcome === "inspected" ? "Certificate inspection completed" : "No TLS certificate to inspect",
      result.outcome === "inspected" ? "Redacted certificate metadata is shown in account setup. This does not prove provider interoperability." : "Plain transport opened no network connection and has no certificate.",
      result.outcome === "inspected" ? "證書檢查完成" : "冇 TLS 證書可以檢查",
      result.outcome === "inspected" ? "帳戶設定已顯示遮蔽後嘅證書資料。呢個結果唔代表已證明供應商互通性。" : "純文字傳輸未有開啟網絡連線，亦冇證書。",
    );
  } catch (error) {
    const message = errorMessage(error);
    resultRegion.setAttribute("role", "alert");
    resultRegion.innerHTML = `<div class="tls-inspection-result__summary tls-inspection-result__summary--error">${icon("error")}<div><strong>${escapeHtml(tx("Certificate inspection failed", "證書檢查失敗"))}</strong><p>${escapeHtml(tx(message, `檢查未完成：${message}`))}</p></div></div>`;
    applyBilingualSemantics(resultRegion);
    pushToast("error", "Certificate inspection failed", message, "證書檢查失敗", `檢查未完成：${message}`);
  } finally {
    resultRegion.setAttribute("aria-busy", "false");
    button.removeAttribute("aria-busy");
    button.removeAttribute("disabled");
    button.innerHTML = original;
  }
};

const renderPop3FoundationResult = (snapshot: Pop3FoundationSnapshot): string => {
  if (snapshot.boundary === "live-network-unsupported") {
    return `<div class="pop3-foundation__summary pop3-foundation__summary--warning">${icon("warning")}<div><strong>${escapeHtml(tx("Live POP3 stopped before transport", "即時 POP3 喺傳輸之前已停止"))}</strong><p>${escapeHtml(tx("The state machine entered unsupported without opening a socket, using a credential, changing server mail, or saving an account.", "狀態機進入「不支援」，冇開 socket、冇使用憑證、冇改動伺服器郵件，亦冇儲存帳戶。"))}</p></div></div>`;
  }
  const available = snapshot.capabilities.filter(capability => capability.available).map(capability => capability.name).join(", ") || tx("none", "冇");
  const unavailable = snapshot.capabilities.filter(capability => !capability.available).map(capability => capability.name).join(", ") || tx("none", "冇");
  const trace = snapshot.transitions.map(item => `${item.sequence}. ${item.from} —${item.event}→ ${item.to}`).join("\n");
  return `<div class="pop3-foundation__summary">${icon("check")}<div><strong>${escapeHtml(tx("Local POP3 demo completed", "本機 POP3 示範完成"))}</strong><p>${escapeHtml(tx(`${snapshot.messages.length} deterministic fixture message${snapshot.messages.length === 1 ? "" : "s"} reached the disconnected state.`, `${snapshot.messages.length} 封固定道具郵件完成並進入 disconnected 狀態。`))}</p></div></div>
    <dl class="pop3-foundation__facts"><div><dt>${escapeHtml(tx("Available in demo", "示範可用"))}</dt><dd>${escapeHtml(available)}</dd></div><div><dt>${escapeHtml(tx("Unavailable", "不可用"))}</dt><dd>${escapeHtml(unavailable)}</dd></div><div><dt>${escapeHtml(tx("Server contacted", "已聯絡伺服器"))}</dt><dd>${escapeHtml(tx("No", "冇"))}</dd></div><div><dt>${escapeHtml(tx("Credential used", "已使用憑證"))}</dt><dd>${escapeHtml(tx("No", "冇"))}</dd></div><div><dt>DELE</dt><dd>${escapeHtml(tx("Not attempted", "未有嘗試"))}</dd></div><div><dt>${escapeHtml(tx("Full synchronization", "完整同步"))}</dt><dd>${escapeHtml(tx("Not provided", "未有提供"))}</dd></div></dl>
    <details><summary>${escapeHtml(tx("Deterministic transition trace", "固定狀態轉移記錄"))}</summary><pre><code>${escapeHtml(trace)}</code></pre></details>
    <ol class="pop3-foundation__messages" aria-label="${escapeHtml(tx("Local POP3 fixture messages", "本機 POP3 道具郵件"))}">${snapshot.messages.map(message => `<li><strong>${escapeHtml(message.subject)}</strong><span><code>${escapeHtml(message.uidl)}</code> · ${message.octets} ${escapeHtml(tx("octets", "八位元組"))}</span></li>`).join("")}</ol>
    <p class="pop3-foundation__boundary">${icon("info")}<span>${escapeHtml(tx("This proves only local validation, capability reporting, bounded retrieval, and transition ordering. It does not prove a provider login, server retention, deletion semantics, polling, folders, or complete synchronization.", "呢個結果只證明本機驗證、能力報告、有界收取同狀態次序。佢唔證明供應商登入、伺服器保留、刪除語義、輪詢、資料夾或者完整同步。"))}</span></p>`;
};

const runPop3FoundationFromSetup = async (button: HTMLButtonElement): Promise<void> => {
  const form = button.closest<HTMLFormElement>('[data-form="account-setup"]');
  const result = form?.querySelector<HTMLElement>("[data-pop3-result]");
  if (!form || !result || button.getAttribute("aria-busy") === "true") return;
  let options: Pop3AccountOptions;
  try {
    options = pop3OptionsFromForm(form);
  } catch (error) {
    result.setAttribute("role", "alert");
    result.innerHTML = `<p>${icon("error")}<span>${escapeHtml(tx(errorMessage(error), `POP3 選項無效：${errorMessage(error)}`))}</span></p>`;
    applyBilingualSemantics(result);
    return;
  }
  const original = button.innerHTML;
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  button.innerHTML = `${icon("refresh", "is-spinning")}<span>${escapeHtml(tx("Running local demo…", "運行緊本機示範……"))}</span>`;
  result.setAttribute("role", "status");
  result.setAttribute("aria-busy", "true");
  result.innerHTML = `<p>${icon("refresh", "is-spinning")}<span>${escapeHtml(tx("Advancing the in-memory POP3 state machine. No network connection is opening.", "推進緊記憶體內 POP3 狀態機。唔會開啟任何網絡連線。"))}</span></p>`;
  applyBilingualSemantics(form);
  try {
    const snapshot = await api.runPop3Foundation(options);
    result.setAttribute("role", snapshot.boundary === "live-network-unsupported" ? "alert" : "status");
    result.innerHTML = renderPop3FoundationResult(snapshot);
    applyBilingualSemantics(result);
    pushToast(
      snapshot.boundary === "local-demo-only" ? "success" : "warning",
      snapshot.boundary === "local-demo-only" ? "Local POP3 demo completed" : "Live POP3 remains unavailable",
      snapshot.boundary === "local-demo-only" ? "The deterministic fixture completed without network, credentials, deletion, persistence, or full synchronization." : "The request stopped before transport; no server was contacted.",
      snapshot.boundary === "local-demo-only" ? "本機 POP3 示範完成" : "即時 POP3 仍然不可用",
      snapshot.boundary === "local-demo-only" ? "固定道具已完成；冇網絡、憑證、刪除、持久儲存或者完整同步。" : "要求喺傳輸之前已停止；冇聯絡任何伺服器。",
    );
  } catch (error) {
    result.setAttribute("role", "alert");
    result.innerHTML = `<p>${icon("error")}<span>${escapeHtml(tx("The local POP3 demo could not complete.", "本機 POP3 示範未能完成。"))} ${escapeHtml(errorMessage(error))}</span></p>`;
    applyBilingualSemantics(result);
  } finally {
    result.setAttribute("aria-busy", "false");
    button.removeAttribute("aria-busy");
    button.disabled = false;
    button.innerHTML = original;
    applyBilingualSemantics(button);
  }
};

const runPimProviderFoundationFromSettings = async (form: HTMLFormElement): Promise<void> => {
  const kindControl = form.elements.namedItem("kind");
  const authControl = form.elements.namedItem("authMode");
  const endpointControl = form.elements.namedItem("endpointUrl");
  if (!(kindControl instanceof HTMLSelectElement) || !(authControl instanceof HTMLSelectElement) || !(endpointControl instanceof HTMLInputElement)) return;
  if (kindControl.value !== "carddav" && kindControl.value !== "caldav" && kindControl.value !== "ics-file") return;
  const authMode = kindControl.value === "ics-file"
    ? "none"
    : authControl.value === "basic" || authControl.value === "oauth2"
      ? authControl.value
      : "none";
  state.pimProviderProfile = { kind: kindControl.value, endpointUrl: endpointControl.value, authMode };
  state.pimProviderSnapshot = null;
  await withBusy("pim-provider-foundation", async () => {
    const snapshot = await api.runPimProviderFoundation(state.pimProviderProfile);
    state.pimProviderSnapshot = snapshot;
    pushToast(
      snapshot.state === "ready" ? "success" : "warning",
      snapshot.state === "ready" ? "Local provider profile validated" : "Provider profile needs attention",
      snapshot.state === "ready"
        ? "The bounded local model is ready. No endpoint was contacted, no credential was used, and no live synchronization was performed."
        : "The profile was rejected locally before any endpoint, credential, or provider state could be used.",
      snapshot.state === "ready" ? "本機供應商設定檔已驗證" : "供應商設定檔要處理",
      snapshot.state === "ready"
        ? "有界本機模型已準備好。冇聯絡端點、冇使用憑證，亦冇進行即時同步。"
        : "設定檔喺本機已被拒絕，完全未有使用端點、憑證或者供應商狀態。",
    );
  });
};

const handleAccountSubmit = async (form: HTMLFormElement, mode: "test" | "add"): Promise<void> => {
  const incomingProtocol = form.elements.namedItem("incomingProtocol");
  if (incomingProtocol instanceof HTMLSelectElement && incomingProtocol.value === "pop3") {
    pushToast(
      "warning",
      "Live POP3 account actions are unavailable",
      "Use the local POP3 demo. No server was contacted, no credential was sent, no account was saved, and deletion or full synchronization is not claimed.",
      "即時 POP3 帳戶操作不可用",
      "請使用本機 POP3 示範。冇聯絡伺服器、冇傳送憑證、冇儲存帳戶，亦唔會聲稱已有刪除或者完整同步。",
    );
    form.querySelector<HTMLElement>("[data-pop3-panel]")?.focus({ preventScroll: false });
    return;
  }
  const authMode = form.elements.namedItem("authMode");
  if (authMode instanceof HTMLSelectElement && authMode.value === "oauth2") {
    pushToast(
      "warning",
      "OAuth account connection is not available",
      "This build can exercise only the local PKCE and callback foundation. It has no reviewed token exchange, token lifecycle, or connected-account path.",
      "OAuth 帳戶連接不可用",
      "呢個版本只可以運行本機 PKCE 同回呼地基。仲未有經審閱嘅 token exchange、權杖生命週期或者帳戶連接路徑。",
    );
    updateOAuthAuthorizationPanel("oauth-start");
    return;
  }
  if (!form.reportValidity()) return;
  let draft: AccountDraft;
  try {
    draft = accountDraftFromForm(form);
  } catch (error) {
    pushToast("error", "Check account settings", errorMessage(error), "檢查帳戶設定", errorMessage(error));
    return;
  }
  const diagnostics = updateConnectionPreflight(form, true, draft);
  if (diagnostics.some(diagnostic => diagnostic.severity === "error")) {
    pushToast(
      "error",
      "Check certificate and connection settings",
      "Correct the highlighted host, port, or security mode. The connection test was not started and no server was contacted.",
      "檢查證書同連線設定",
      "請修正已標示嘅主機、連接埠或者安全模式。連線測試未有開始，程式亦未有聯絡任何伺服器。",
    );
    return;
  }
  await withBusy(mode === "test" ? "account-test" : "account-add", async () => {
    if (mode === "test") {
      const result = await api.testAccount(draft);
      if (result.incoming && result.outgoing) pushToast("success", "Both servers responded", "Incoming IMAP and outgoing SMTP checks completed. The account has not been saved yet.", "兩邊伺服器都有回覆", "收取 IMAP 同寄出 SMTP 檢查完成。帳戶仲未儲存。 ");
      return;
    }
    const account = await api.addAccount(draft);
    await refreshMetadata();
    state.setupOpen = false;
    state.discoveries = [];
    state.selectedDiscovery = null;
    state.setupEmail = "";
    await loadAccount(account.id, true);
    pushToast("success", "Account connected", `${account.email} was verified, encrypted, and saved on this computer.`, "帳戶已連接", `${account.email} 已經驗證、加密，同埋儲存喺呢部電腦。`);
    if (state.pendingMailto) {
      const pending = state.pendingMailto;
      state.pendingMailto = null;
      handleMailtoActivation(pending);
    }
  });
};

const discoverAccount = async (): Promise<void> => {
  const form = document.querySelector<HTMLFormElement>('[data-form="account-setup"]');
  const input = form?.elements.namedItem("email");
  if (!(input instanceof HTMLInputElement) || !input.reportValidity()) return;
  const email = input.value.trim();
  state.setupEmail = email;
  await withBusy("discover-account", async () => {
    const discoveries = await api.discoverAccount(email);
    state.discoveries = discoveries;
    state.selectedDiscovery = discoveries[0] ?? null;
    if (discoveries.length) {
      pushToast("success", "Settings discovered", `${discoveries.length} reviewable configuration${discoveries.length === 1 ? "" : "s"} found. Nothing has been saved.`, "搵到設定", `搵到 ${discoveries.length} 個可以審閱嘅設定。仲未儲存任何嘢。`);
    } else {
      pushToast("warning", "No settings discovered", "Enter the IMAP and SMTP settings manually; the account has not been saved.", "搵唔到設定", "請手動輸入 IMAP 同 SMTP 設定；帳戶仲未儲存。 ");
    }
  });
};

const savePreferencesPatch = (patch: Partial<Preferences>): void => {
  if (state.bootstrap) state.bootstrap.preferences = { ...state.bootstrap.preferences, ...patch };
  pendingPreferencePatch = { ...pendingPreferencePatch, ...patch };
  applyPreferences();
  if (!preferenceSaveInFlight) void flushPreferencePatch();
};

const flushPreferencePatch = async (): Promise<void> => {
  preferenceSaveInFlight = true;
  try {
    while (Object.keys(pendingPreferencePatch).length) {
      const patch = pendingPreferencePatch;
      pendingPreferencePatch = {};
      try {
        const saved = await api.savePreferences(patch);
        if (state.bootstrap) state.bootstrap.preferences = saved;
      } catch (error) {
        pushToast("error", "Settings were not saved", errorMessage(error), "設定未能儲存", errorMessage(error));
      }
    }
  } finally {
    preferenceSaveInFlight = false;
  }
};

const preferencePatchFromControl = (control: HTMLInputElement | HTMLSelectElement): Partial<Preferences> | null => {
  const key = control.dataset.pref;
  if (!key) return null;
  switch (key) {
    case "language": return ["en", "yue", "bilingual"].includes(control.value) ? { language: control.value as Preferences["language"] } : null;
    case "theme": return ["light", "dark", "system"].includes(control.value) ? { theme: control.value as Preferences["theme"] } : null;
    case "density": return ["compact", "comfortable", "relaxed"].includes(control.value) ? { density: control.value as Preferences["density"] } : null;
    case "narratorLanguage": return ["en", "yue", "bilingual"].includes(control.value) ? { narratorLanguage: control.value as Preferences["narratorLanguage"] } : null;
    case "funnyEnglish": return { funnyEnglish: Math.min(5, Math.max(1, Number(control.value))) as Preferences["funnyEnglish"] };
    case "funnyCantonese": return { funnyCantonese: Math.min(5, Math.max(1, Number(control.value))) as Preferences["funnyCantonese"] };
    case "fontScale": return { fontScale: Math.min(1.5, Math.max(0.8, Number(control.value))) };
    case "fontWeight": return { fontWeight: Math.min(700, Math.max(300, Number(control.value))) };
    case "dimSumEnabled": return control instanceof HTMLInputElement ? { dimSumEnabled: control.checked } : null;
    case "narratorEnabled": return control instanceof HTMLInputElement ? { narratorEnabled: control.checked } : null;
    case "nativeNotificationsEnabled": return control instanceof HTMLInputElement ? { nativeNotificationsEnabled: control.checked } : null;
    case "historyRetentionDays": {
      const retentionDays = Number(control.value);
      return Number.isInteger(retentionDays)
        && retentionDays >= LOCAL_HISTORY_RETENTION_DAYS_MIN
        && retentionDays <= LOCAL_HISTORY_RETENTION_DAYS_MAX
        ? { historyRetentionDays: retentionDays }
        : null;
    }
    case "accent": return { accent: control.value.slice(0, 64) };
    case "fontFamily": return { fontFamily: control.value.slice(0, 120) };
    case "externalEditorPath": return { externalEditorPath: control.value };
    default: return null;
  }
};

const activateTab = (id: PageId, focusTarget: "panel" | "tab" = "panel"): void => {
  state.tabPreferences.closed = state.tabPreferences.closed.filter(tab => tab !== id);
  state.activeTab = id;
  state.tabManagerOpen = false;
  state.contextMenu = null;
  if (focusTarget === "tab") pendingFocusKey = tabFocusKey(id);
  persistTabs();
  render();
  if (focusTarget === "panel") document.querySelector<HTMLElement>("#main-content")?.focus({ preventScroll: true });
  if (id === "history" && !state.localRevisionsLoaded) void loadLocalRevisions();
  if (id === "contacts" || id === "calendar" || id === "tasks") void ensurePimData();
  if (id === "drafts" || id === "outbox") {
    void refreshDraftAndOutbox().catch(error => pushToast("error", "Queue refresh failed", errorMessage(error), "隊列重新整理失敗", errorMessage(error)));
  }
};

const loadLocalRevisions = async (): Promise<void> => {
  state.busy.add("local-revisions");
  state.localRevisionsError = "";
  try {
    state.localRevisions = await api.listLocalRevisions();
    state.localRevisionsLoaded = true;
  } catch (error) {
    state.localRevisionsError = errorMessage(error);
    pushToast("warning", "Workspace versions unavailable", state.localRevisionsError, "工作空間版本暫時不可用", state.localRevisionsError);
  } finally {
    state.busy.delete("local-revisions");
    render();
  }
};

const toggleLocalRevisionDiff = async (hash: string): Promise<void> => {
  if (state.selectedLocalRevisionHash === hash) {
    localRevisionDiffSequence += 1;
    state.selectedLocalRevisionHash = null;
    state.localRevisionDiff = null;
    state.localRevisionDiffError = "";
    render();
    focusByKey(`local-revision-diff-${hash}`);
    return;
  }
  const request = ++localRevisionDiffSequence;
  state.selectedLocalRevisionHash = hash;
  state.localRevisionDiff = null;
  state.localRevisionDiffError = "";
  const busyKey = `local-revision-diff-${hash}`;
  state.busy.add(busyKey);
  render();
  try {
    const diff = await api.getLocalRevisionDiff(hash);
    if (request !== localRevisionDiffSequence || state.selectedLocalRevisionHash !== hash) return;
    state.localRevisionDiff = diff;
    state.localRevisions = state.localRevisions.map(revision => revision.hash === hash ? diff.revision : revision);
  } catch (error) {
    if (request !== localRevisionDiffSequence || state.selectedLocalRevisionHash !== hash) return;
    state.localRevisionDiffError = errorMessage(error);
    pushToast("error", "Revision changes unavailable", state.localRevisionDiffError, "修訂更改暫時不可用", state.localRevisionDiffError);
  } finally {
    state.busy.delete(busyKey);
    if (request === localRevisionDiffSequence) render();
  }
};

const saveLocalRevisionLabel = async (button: HTMLElement, hash: string): Promise<void> => {
  const input = button.closest(".local-revision-detail")?.querySelector<HTMLInputElement>("[data-local-revision-label]");
  const label = input?.value.trim() ?? "";
  if (!label || label.length > 120) {
    pushToast("warning", "Revision label needs attention", "Enter 1 to 120 characters.", "修訂標籤要處理", "請輸入 1 至 120 個字元。 ");
    input?.focus();
    return;
  }
  await withBusy(`local-revision-label-${hash}`, async () => {
    const revision = await api.labelLocalRevision(hash, label);
    state.localRevisions = state.localRevisions.map(item => item.hash === hash ? revision : item);
    if (state.localRevisionDiff?.revision.hash === hash) state.localRevisionDiff = { ...state.localRevisionDiff, revision };
    state.localHistoryDeletionEvidence = null;
    state.localHistoryDeletionError = "";
    pendingFocusKey = `local-revision-label-${hash}`;
    pushToast("success", "Revision label saved", "The snapshot commit stayed immutable; only its local label changed.", "修訂標籤已儲存", "快照提交保持不變；只係本機標籤改咗。 ");
  });
};

const previewLocalHistoryPrune = async (): Promise<void> => {
  state.localHistoryPruneError = "";
  await withBusy("local-history-prune-preview", async () => {
    try {
      state.localHistoryPrunePreview = await api.previewLocalHistoryPrune(preferences().historyRetentionDays);
      pendingFocusKey = "preview-local-history-prune";
    } catch (error) {
      state.localHistoryPrunePreview = null;
      state.localHistoryPruneError = errorMessage(error);
      throw error;
    }
  });
};

const inspectLocalHistoryDeletion = async (): Promise<void> => {
  state.localHistoryDeletionError = "";
  await withBusy("local-history-deletion-evidence", async () => {
    try {
      state.localHistoryDeletionEvidence = await api.inspectLocalHistoryDeletion();
      pendingFocusKey = "inspect-local-history-deletion";
    } catch (error) {
      state.localHistoryDeletionEvidence = null;
      state.localHistoryDeletionError = errorMessage(error);
      throw error;
    }
  });
};

const pruneRequestFromPreview = (preview: LocalHistoryPrunePreview): LocalHistoryPruneRequest => ({
  retentionDays: preview.retentionDays,
  cutoffAt: preview.cutoffAt,
  expectedHeadHash: preview.headHash ?? "",
  expectedEligibleHashes: preview.eligibleRevisions.map(revision => revision.hash),
});

const moveTabBy = (id: PageId, offset: -1 | 1): void => {
  const from = state.tabPreferences.order.indexOf(id);
  const to = Math.min(state.tabPreferences.order.length - 1, Math.max(0, from + offset));
  if (from < 0 || from === to) return;
  state.tabPreferences.order.splice(from, 1);
  state.tabPreferences.order.splice(to, 0, id);
  persistTabs();
  render();
};

const closeTab = (id: PageId): void => {
  if (state.tabPreferences.pinned.includes(id)) {
    pushToast("warning", "Pinned tab protected", "Unpin the tab before closing it.", "釘選分頁受保護", "關閉之前先取消釘選。 ");
    return;
  }
  if (!state.tabPreferences.closed.includes(id)) state.tabPreferences.closed.push(id);
  const remaining = visibleTabIds();
  if (state.activeTab === id) state.activeTab = remaining[0] ?? "mail";
  persistTabs();
  render();
};

const copyText = async (value: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = value;
    area.setAttribute("readonly", "");
    area.className = "clipboard-fallback";
    document.body.append(area);
    area.select();
    const copied = document.execCommand("copy");
    area.remove();
    return copied;
  }
};

const exportText = async (kind: "history" | "settings" | "changelog", content: string, suggestedName: string, label: string): Promise<void> => {
  try {
    const destination = await api.exportData(kind, content, suggestedName);
    if (destination) pushToast("success", `${label} exported`, "The desktop save completed at the chosen destination.", `${label} 已匯出`, "桌面儲存已經喺所選位置完成。 ");
    else pushToast("info", "Export cancelled", "No file was written.", "已取消匯出", "冇寫入任何檔案。 ");
  } catch (error) {
    pushToast("error", `${label} export failed`, errorMessage(error), `${label} 匯出失敗`, errorMessage(error));
  }
};

const parseMailto = (raw: string): MailtoComposition | null => {
  if (raw.length > 32_768) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol.toLowerCase() !== "mailto:") return null;
    const cleanText = (value: string | null, limit: number): string => (value ?? "").replaceAll("\0", "").slice(0, limit);
    return {
      to: splitRecipients(decodeURIComponent(parsed.pathname)),
      cc: splitRecipients(parsed.searchParams.get("cc") ?? ""),
      bcc: splitRecipients(parsed.searchParams.get("bcc") ?? ""),
      subject: cleanText(parsed.searchParams.get("subject"), 998).replace(/[\r\n]/g, " "),
      body: cleanText(parsed.searchParams.get("body"), 2_000_000),
    };
  } catch {
    return null;
  }
};

const handleMailtoActivation = (raw: string): void => {
  const parsed = parseMailto(raw);
  if (!parsed) {
    pushToast("error", "Mail link rejected", "The mailto link was invalid or too large.", "郵件連結已拒絕", "mailto 連結無效或者太大。 ");
    return;
  }
  if (!activeAccount()) {
    state.pendingMailto = raw;
    state.setupOpen = true;
    state.setupContext = "first-run";
    render();
    pushToast("info", "Add an account to continue", "The mail link is waiting locally; no message has been sent.", "先加入帳戶", "郵件連結喺本機等緊；未有寄出任何郵件。 ");
    return;
  }
  openComposer("new", parsed);
};

const maybeShowDimSum = async (bootstrap: BootstrapState): Promise<void> => {
  if (bootstrap.isFirstRun || !bootstrap.preferences.dimSumEnabled || Math.random() >= 0.01) return;
  try {
    const response = await fetch("./assets/dim-sum/release-catalog.json", { cache: "no-store" });
    if (!response.ok) return;
    const candidate = await response.json() as unknown;
    if (!Array.isArray(candidate)) return;
    const dishes = candidate.filter((value): value is DimSumDish => {
      if (!value || typeof value !== "object") return false;
      const dish = value as Partial<DimSumDish>;
      return typeof dish.id === "string"
        && typeof dish.file === "string" && /^[a-z0-9][a-z0-9._-]*\.png$/i.test(dish.file)
        && typeof dish.sha256 === "string"
        && typeof dish.catalogCommit === "string"
        && Boolean(dish.name && typeof dish.name.en === "string" && typeof dish.name.zhHant === "string");
    });
    if (!dishes.length) return;
    const chosen = dishes[Math.floor(Math.random() * dishes.length)];
    if (!chosen) return;
    state.dimSumDish = chosen;
    state.dimSumVisible = true;
    render();
    window.setTimeout(() => {
      state.dimSumVisible = false;
      render();
    }, 9_000);
  } catch {
    // The surprise is optional and must never delay or block startup.
  }
};

const formText = (data: FormData, name: string): string => String(data.get(name) ?? "").trim();

const pimEditorFingerprint = (): string | null => {
  const form = app.querySelector<HTMLFormElement>('[data-testid="pim-editor"] form');
  if (!form) return null;
  return JSON.stringify([...new FormData(form).entries()].map(([name, value]) => [name, typeof value === "string" ? value : value.name]));
};

const updatePimEditorDirty = (): void => {
  if (!state.pimEditor || state.pimEditorBaseline === null) return;
  const current = pimEditorFingerprint();
  state.pimEditorDirty = current !== null && current !== state.pimEditorBaseline;
  const indicator = app.querySelector<HTMLElement>('[data-testid="pim-dirty-state"]');
  if (indicator) {
    indicator.innerHTML = escapeHtml(state.pimEditorDirty ? tx("Unsaved changes", "有未儲存更改") : tx("No unsaved changes", "冇未儲存更改"));
    applyBilingualSemantics(indicator);
  }
};

const pimEditorKindLabel = (): string => {
  const kind = state.pimEditor?.kind;
  if (kind === "contact") return tx("contact", "聯絡人");
  if (kind === "mailing-list") return tx("mailing list", "郵件群組");
  if (kind === "calendar-event") return tx("event", "事件");
  return tx("task", "工作");
};

const finishPimEditorClose = (restoreFocus = true): void => {
  if (restoreFocus) pendingFocusKey = state.pimEditorReturnFocusKey;
  state.pimEditor = null;
  state.pimDraftMemberUids = null;
  state.pimEditorBaseline = null;
  state.pimEditorDirty = false;
  state.pimEditorReturnFocusKey = null;
  state.pimEditorLastFocusKey = null;
  state.pimEditorLastFocusName = null;
};

const requestPimEditorClose = (): void => {
  updatePimEditorDirty();
  if (state.pimEditorDirty) {
    showConfirmation({ kind: "discard-pim-editor", label: pimEditorKindLabel() }, state.pimEditorLastFocusKey);
    return;
  }
  finishPimEditorClose();
  render();
};

const beginPimEditor = (kind: PimEntityKind, uid: string | null, returnFocusKey: string | null): void => {
  state.pimEditor = { kind, uid } as PimEditorState;
  state.pimEditorReturnFocusKey = returnFocusKey;
  state.pimEditorLastFocusKey = null;
  state.pimEditorLastFocusName = null;
  state.pimEditorBaseline = null;
  state.pimEditorDirty = false;
  state.pimDraftMemberUids = kind === "mailing-list"
    ? new Set(uid ? state.mailingLists.find(list => list.uid === uid)?.memberUids ?? [] : [])
    : null;
  if (kind === "mailing-list") searchFor("mailing-list-members-editor").pattern = "";
  render();
  state.pimEditorBaseline = pimEditorFingerprint();
  state.pimEditorDirty = false;
  requestAnimationFrame(() => {
    document.querySelector<HTMLInputElement>('[data-testid="pim-editor"] input:not([type="checkbox"])')?.focus();
  });
};

const requestPimEditorOpen = (kind: PimEntityKind, uid: string | null, returnFocusKey: string | null): void => {
  if (uid && !pimEntityPresent(kind, uid)) {
    pushToast("error", "Record unavailable", "The selected local record no longer exists.", "記錄不可用", "所選本機記錄已經唔存在。 ");
    return;
  }
  if (state.pimEditor) {
    updatePimEditorDirty();
    if (state.pimEditor.kind === kind && state.pimEditor.uid === uid) {
      const focusKey = state.pimEditorLastFocusKey;
      requestAnimationFrame(() => {
        const target = focusKey
          ? document.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(focusKey)}"]`)
          : document.querySelector<HTMLElement>('[data-testid="pim-editor"] input:not([type="checkbox"])');
        target?.focus();
      });
      return;
    }
    if (state.pimEditorDirty) {
      showConfirmation(
        { kind: "replace-pim-editor", entityKind: kind, uid, returnFocusKey },
        state.pimEditorLastFocusKey,
      );
      return;
    }
  }
  beginPimEditor(kind, uid, returnFocusKey);
};

interface PimSaveOwner {
  editor: PimEditorState;
  sequence: number;
}

const claimPimSave = (kind: PimEntityKind, uid: string | null): PimSaveOwner | null => {
  if (isBusy("pim-save")) return null;
  const editor = state.pimEditor;
  if (!editor || editor.kind !== kind || editor.uid !== uid) return null;
  return { editor, sequence: ++pimSaveSequence };
};

const ownsPimSaveEditor = (owner: PimSaveOwner): boolean =>
  owner.sequence === pimSaveSequence && state.pimEditor === owner.editor;

const upsertPimRecord = <RecordType extends { uid: string }>(records: RecordType[], saved: RecordType): RecordType[] => {
  const index = records.findIndex(record => record.uid === saved.uid);
  if (index < 0) return [...records, saved];
  return records.map((record, recordIndex) => recordIndex === index ? saved : record);
};

const resetOwnedPimEditorBaselineAfterRender = (owner: PimSaveOwner): void => {
  requestAnimationFrame(() => {
    if (!ownsPimSaveEditor(owner)) return;
    state.pimEditorBaseline = pimEditorFingerprint();
    state.pimEditorDirty = false;
    updatePimEditorDirty();
  });
};

const finishPimSave = async <Saved extends { uid: string }>(
  owner: PimSaveOwner,
  saved: Saved,
  retainSavedRecord: () => void,
): Promise<boolean> => {
  try {
    await refreshPimData();
  } catch (error) {
    retainSavedRecord();
    const refreshError = errorMessage(error);
    state.pimLoaded = false;
    state.pimLoadError = `The record was saved locally, but the local views could not refresh: ${refreshError}`;
    if (ownsPimSaveEditor(owner)) {
      owner.editor.uid = saved.uid;
      state.pimEditorBaseline = null;
      state.pimEditorDirty = false;
      resetOwnedPimEditorBaselineAfterRender(owner);
    }
    pushToast(
      "warning",
      "Record saved; local views need a retry",
      `The record was saved locally, but the local views did not refresh: ${refreshError}. The editor remains open; use Retry local records to reload the saved state.`,
      "記錄已儲存；本機畫面需要重試",
      `記錄已儲存喺本機，但本機畫面未能重新整理：${refreshError}。編輯器會保持開啟；請用「重試本機記錄」重新載入已儲存狀態。`,
    );
    return false;
  }
  if (ownsPimSaveEditor(owner)) finishPimEditorClose();
  return true;
};

const contactNameFromForm = (data: FormData, existing?: Contact): Contact["name"] => {
  const name: Contact["name"] = { ...(existing?.name ?? {}) };
  const given = formText(data, "given");
  const family = formText(data, "family");
  if (given) name.given = given; else delete name.given;
  if (family) name.family = family; else delete name.family;
  return name;
};

const contactMethodsFromForm = (data: FormData, existing?: Contact): { emails: Contact["emails"]; phones: Contact["phones"] } => {
  const email = formText(data, "email");
  const phone = formText(data, "phone");
  const oldEmail = existing?.emails.find(item => item.preferred) ?? existing?.emails[0];
  const oldPhone = existing?.phones.find(item => item.preferred) ?? existing?.phones[0];
  const additionalEmails = existing?.emails.filter(item => item !== oldEmail && item.value.toLowerCase() !== email.toLowerCase()) ?? [];
  const additionalPhones = existing?.phones.filter(item => item !== oldPhone && item.value.toLowerCase() !== phone.toLowerCase()) ?? [];
  return {
    emails: email ? [{ value: email, types: oldEmail?.types ?? ["work"], preferred: true }, ...additionalEmails.map(item => ({ ...item, preferred: false }))] : additionalEmails,
    phones: phone ? [{ value: phone, types: oldPhone?.types ?? ["work"], preferred: true }, ...additionalPhones.map(item => ({ ...item, preferred: false }))] : additionalPhones,
  };
};

const saveContactForm = async (form: HTMLFormElement): Promise<void> => {
  if (!form.reportValidity()) return;
  const data = new FormData(form);
  const uid = form.dataset.pimUid;
  const existing = uid ? state.contacts.find(contact => contact.uid === uid) : undefined;
  const displayName = formText(data, "displayName");
  const organization = formText(data, "organization");
  const title = formText(data, "title");
  const notes = formText(data, "notes");
  const methods = contactMethodsFromForm(data, existing);
  const saveOwner = claimPimSave("contact", uid ?? null);
  if (!saveOwner) return;
  await withBusy("pim-save", async () => {
    let saved: Contact;
    if (existing) {
      const patch: ContactPatch = {
        displayName,
        name: contactNameFromForm(data, existing),
        emails: methods.emails,
        phones: methods.phones,
        organization: organization || null,
        title: title || null,
        notes: notes || null,
      };
      saved = await api.updateContact(existing.uid, patch);
    } else {
      const input: CreateContactInput = {
        displayName,
        name: contactNameFromForm(data),
        emails: methods.emails,
        phones: methods.phones,
        addresses: [],
        ...(organization ? { organization } : {}),
        ...(title ? { title } : {}),
        ...(notes ? { notes } : {}),
      };
      saved = await api.createContact(input);
    }
    const changed = !existing || saved.revision !== existing.revision;
    if (!(await finishPimSave(saveOwner, saved, () => {
      state.contacts = upsertPimRecord(state.contacts, saved);
    }))) return;
    if (existing && !changed) pushToast("info", "No contact changes to save", `${saved.displayName} was already up to date; no revision was created.`, "聯絡人冇更改要儲存", `${saved.displayName} 已經係最新；冇建立新修訂。`);
    else pushToast("success", existing ? "Contact updated" : "Contact created", `${saved.displayName} is saved in the local address book.`, existing ? "聯絡人已更新" : "聯絡人已建立", `${saved.displayName} 已儲存喺本機通訊錄。`);
  });
};

const saveMailingListForm = async (form: HTMLFormElement): Promise<void> => {
  if (!form.reportValidity()) return;
  const data = new FormData(form);
  const uid = form.dataset.pimUid;
  const existing = uid ? state.mailingLists.find(list => list.uid === uid) : undefined;
  const name = formText(data, "name");
  const nickname = formText(data, "nickname");
  const description = formText(data, "description");
  const memberUids = [...(state.pimDraftMemberUids ?? new Set(data.getAll("memberUids").map(String)))];
  const saveOwner = claimPimSave("mailing-list", uid ?? null);
  if (!saveOwner) return;
  await withBusy("pim-save", async () => {
    let saved: MailingList;
    if (existing) {
      const patch: MailingListPatch = { name, nickname: nickname || null, description: description || null, memberUids };
      saved = await api.updateMailingList(existing.uid, patch);
    } else {
      const input: CreateMailingListInput = { name, memberUids, ...(nickname ? { nickname } : {}), ...(description ? { description } : {}) };
      saved = await api.createMailingList(input);
    }
    const changed = !existing || saved.revision !== existing.revision;
    state.selectedMailingListUid = saved.uid;
    if (!(await finishPimSave(saveOwner, saved, () => {
      state.mailingLists = upsertPimRecord(state.mailingLists, saved);
    }))) return;
    if (existing && !changed) pushToast("info", "No mailing-list changes to save", `${saved.name} was already up to date; no revision was created.`, "郵件群組冇更改要儲存", `${saved.name} 已經係最新；冇建立新修訂。`);
    else pushToast("success", existing ? "Mailing list updated" : "Mailing list created", `${saved.name} now has ${saved.memberUids.length} local member${saved.memberUids.length === 1 ? "" : "s"}.`, existing ? "郵件群組已更新" : "郵件群組已建立", `${saved.name} 而家有 ${saved.memberUids.length} 位本機成員。`);
  });
};

const temporalDateTimeFromInput = (value: string): CalendarEvent["start"] => {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) throw new Error("Enter a valid local date and time.");
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return { kind: "date-time", value: date.toISOString(), ...(timeZone ? { timeZone } : {}) };
};

const saveCalendarEventForm = async (form: HTMLFormElement): Promise<void> => {
  if (!form.reportValidity()) return;
  const data = new FormData(form);
  const uid = form.dataset.pimUid;
  const existing = uid ? state.calendarEvents.find(event => event.uid === uid) : undefined;
  const title = formText(data, "title");
  const description = formText(data, "description");
  const location = formText(data, "location");
  const start = temporalDateTimeFromInput(formText(data, "start"));
  const end = temporalDateTimeFromInput(formText(data, "end"));
  if (Date.parse(end.value) <= Date.parse(start.value)) {
    pushToast("error", "Event time is invalid", "The event end must be after its start.", "事件時間無效", "事件結束時間必須喺開始時間之後。");
    return;
  }
  const rawStatus = formText(data, "status");
  if (rawStatus !== "tentative" && rawStatus !== "confirmed" && rawStatus !== "cancelled") return;
  const saveOwner = claimPimSave("calendar-event", uid ?? null);
  if (!saveOwner) return;
  await withBusy("pim-save", async () => {
    let saved: CalendarEvent;
    if (existing) {
      const patch: CalendarEventPatch = { title, start, end, status: rawStatus, location: location || null, description: description || null };
      saved = await api.updateCalendarEvent(existing.uid, patch);
    } else {
      const input: CreateCalendarEventInput = {
        calendarUid: "home",
        title,
        start,
        end,
        status: rawStatus,
        transparency: "opaque",
        attendees: [],
        alarms: [],
        categories: [],
        ...(location ? { location } : {}),
        ...(description ? { description } : {}),
      };
      saved = await api.createCalendarEvent(input);
    }
    const changed = !existing || saved.revision !== existing.revision;
    if (!(await finishPimSave(saveOwner, saved, () => {
      state.calendarEvents = upsertPimRecord(state.calendarEvents, saved);
    }))) return;
    if (existing && !changed) pushToast("info", "No event changes to save", `${saved.title} was already up to date; no revision was created.`, "事件冇更改要儲存", `${saved.title} 已經係最新；冇建立新修訂。`);
    else pushToast("success", existing ? "Event updated" : "Event created", `${saved.title} is saved in the local Home calendar.`, existing ? "事件已更新" : "事件已建立", `${saved.title} 已儲存喺本機 Home 日曆。`);
  });
};

const saveTaskForm = async (form: HTMLFormElement): Promise<void> => {
  if (!form.reportValidity()) return;
  const data = new FormData(form);
  const uid = form.dataset.pimUid;
  const existing = uid ? state.tasks.find(task => task.uid === uid) : undefined;
  const title = formText(data, "title");
  const description = formText(data, "description");
  const dueValue = formText(data, "due");
  const rawStatus = formText(data, "status");
  if (rawStatus !== "needs-action" && rawStatus !== "in-progress" && rawStatus !== "completed" && rawStatus !== "cancelled") return;
  const priority = Number(data.get("priority"));
  const requestedComplete = Number(data.get("percentComplete"));
  const percentComplete = rawStatus === "completed" ? 100 : Math.min(100, Math.max(0, requestedComplete));
  const due = dueValue ? { kind: "date" as const, value: dueValue } : undefined;
  const saveOwner = claimPimSave("task", uid ?? null);
  if (!saveOwner) return;
  await withBusy("pim-save", async () => {
    let saved: Task;
    if (existing) {
      const patch: TaskPatch = {
        title,
        status: rawStatus,
        priority,
        percentComplete,
        description: description || null,
        due: due ?? null,
        completedAt: rawStatus === "completed" ? existing.completedAt ?? new Date().toISOString() : null,
      };
      saved = await api.updateTask(existing.uid, patch);
    } else {
      const input: CreateTaskInput = {
        calendarUid: "home",
        title,
        status: rawStatus,
        priority,
        percentComplete,
        categories: [],
        ...(description ? { description } : {}),
        ...(due ? { due } : {}),
        ...(rawStatus === "completed" ? { completedAt: new Date().toISOString() } : {}),
      };
      saved = await api.createTask(input);
    }
    const changed = !existing || saved.revision !== existing.revision;
    if (!(await finishPimSave(saveOwner, saved, () => {
      state.tasks = upsertPimRecord(state.tasks, saved);
    }))) return;
    if (existing && !changed) pushToast("info", "No task changes to save", `${saved.title} was already up to date; no revision was created.`, "工作冇更改要儲存", `${saved.title} 已經係最新；冇建立新修訂。`);
    else pushToast("success", existing ? "Task updated" : "Task created", `${saved.title} is saved in the local Home task list.`, existing ? "工作已更新" : "工作已建立", `${saved.title} 已儲存喺本機 Home 工作清單。`);
  });
};

const deletePimEntity = async (kind: PimEntityKind, uid: string, label: string): Promise<void> => {
  await withBusy("pim-delete", async () => {
    const changed = kind === "contact"
      ? await api.deleteContact(uid)
      : kind === "mailing-list"
        ? await api.deleteMailingList(uid)
        : kind === "calendar-event"
          ? await api.deleteCalendarEvent(uid)
          : await api.deleteTask(uid);
    if (!changed) throw new Error(`${label} was already absent; no deletion was recorded.`);
    await refreshPimData();
    pushToast("success", "Local record deleted", `${label} was removed. Its transaction snapshot remains available to restore.`, "本機記錄已刪除", `${label} 已移除。交易快照仍然可以還原。`);
  });
};

const restorePimEntity = async (kind: PimEntityKind, uid: string, transactionId: string): Promise<void> => {
  await withBusy("pim-restore", async () => {
    const restored = kind === "contact"
      ? await api.restoreContact(uid, transactionId)
      : kind === "mailing-list"
        ? await api.restoreMailingList(uid, transactionId)
        : kind === "calendar-event"
          ? await api.restoreCalendarEvent(uid, transactionId)
          : await api.restoreTask(uid, transactionId);
    await refreshPimData();
    const label = "displayName" in restored ? restored.displayName : "name" in restored ? restored.name : restored.title;
    pushToast("success", "Local record restored", `${label} is active again, and the restore is recorded as a new transaction.`, "本機記錄已還原", `${label} 已經再次啟用，還原亦記錄成新交易。`);
  });
};

const importVCard = async (): Promise<void> => {
  await withBusy("pim-vcard", async () => {
    const result = await api.importVCard();
    if (!result) {
      pushToast("info", "vCard import cancelled", "No local records were changed.", "已取消 vCard 匯入", "冇本機記錄被更改。 ");
      return;
    }
    await refreshPimData();
    pushToast("success", "vCard import complete", `${result.created} created, ${result.updated} updated, and ${result.unchanged} unchanged across contacts and mailing lists.`, "vCard 匯入完成", `聯絡人同郵件群組合共有 ${result.created} 個建立、${result.updated} 個更新、${result.unchanged} 個冇變。`);
  });
};

const exportVCardSelection = async (contactUids?: string[], mailingListUids?: string[]): Promise<void> => {
  await withBusy("pim-vcard", async () => {
    const path = await api.exportVCard(contactUids, mailingListUids);
    if (path) pushToast("success", "vCard exported", "The selected local contacts and mailing lists were written to the chosen file.", "vCard 已匯出", "所選本機聯絡人同郵件群組已寫入所選檔案。 ");
    else pushToast("info", "vCard export cancelled", "No file was written.", "已取消 vCard 匯出", "冇寫入任何檔案。 ");
  });
};


const sendComposer = async (confirmedEmptySubject = false): Promise<void> => {
  if (isBusy("send") || isBusy("save-draft")) return;
  captureComposer();
  const composerAtSubmit = state.compose;
  if (!composerAtSubmit) return;
  const submitted = structuredClone(composerAtSubmit.draft);
  const submittedFingerprint = composeFingerprint(submitted);
  if (!submitted.to.length && !submitted.cc.length && !submitted.bcc.length) {
    pushToast("error", "Add a recipient", "Enter at least one To, Cc, or Bcc recipient before sending.", "加入收件人", "寄出之前至少輸入一個收件人、副本或者密件副本。 ");
    document.querySelector<HTMLInputElement>("#compose-to")?.focus();
    return;
  }
  if (!submitted.subject.trim() && !confirmedEmptySubject) {
    showConfirmation({ kind: "send-empty-subject" });
    return;
  }
  await withBusy("send", async () => {
    const result = await api.sendMessage(submitted);
    await refreshMetadata();
    const disposition = classifyRendererDelivery(result);
    const composerStillCurrent = state.compose === composerAtSubmit;
    if (composerStillCurrent) captureComposer();
    const newerEditsRemain = composerStillCurrent
      && state.compose !== null
      && composeFingerprint(state.compose.draft) !== submittedFingerprint;
    if (shouldKeepComposerOpen(result)) {
      if (composerStillCurrent && state.compose) state.compose.cleanBaseline = submittedFingerprint;
      pushToast(
        "error",
        newerEditsRemain ? "Message not sent; submitted draft kept and newer edits remain" : "Message not sent; draft kept",
        `0 accepted; ${result.rejected.length} rejected${result.rejected.length ? `: ${result.rejected.join(", ")}` : ""}. ${newerEditsRemain ? "The submitted snapshot was kept as a draft; text entered during delivery remains in the composer and is still unsaved." : "The compose editor remains open so you can review the recipients and retry."}`,
        newerEditsRemain ? "郵件未寄出；已保留提交草稿，較新更改仍未儲存" : "郵件未寄出；草稿已保留",
        `0 個接受；${result.rejected.length} 個被拒絕${result.rejected.length ? `：${result.rejected.join("、")}` : ""}。${newerEditsRemain ? "已提交嘅快照保留成草稿；傳送期間輸入嘅內容仍然喺撰寫視窗，而且仲未儲存。" : "撰寫視窗會保持開啟，方便檢查收件人再試。"}`,
      );
      return;
    }
    if (composerStillCurrent && !newerEditsRemain) state.compose = null;
    if (newerEditsRemain) {
      const recipientCount = submitted.to.length + submitted.cc.length + submitted.bcc.length;
      const title = disposition === "queued"
        ? "Submitted message queued; newer edits remain"
        : disposition === "partial"
          ? "Submitted message partially accepted; newer edits remain"
          : "Submitted message accepted; newer edits remain";
      const yueTitle = disposition === "queued"
        ? "已提交郵件排入寄件匣；較新更改仍未傳送"
        : disposition === "partial"
          ? "已提交郵件部分獲接受；較新更改仍未傳送"
          : "已提交郵件獲接受；較新更改仍未傳送";
      pushToast(
        "warning",
        title,
        `${result.accepted.length} accepted; ${result.rejected.length} rejected; ${recipientCount} addressed. Text entered during delivery remains in the composer and was not part of that submission.`,
        yueTitle,
        `${result.accepted.length} 個接受；${result.rejected.length} 個被拒絕；共 ${recipientCount} 個收件地址。傳送期間輸入嘅內容仍然喺撰寫視窗，並冇包括喺嗰次提交。`,
      );
      return;
    }
    if (disposition === "queued") {
      pushToast("info", "Message queued in Outbox", `Delivery is pending for ${submitted.to.length + submitted.cc.length + submitted.bcc.length} recipient${submitted.to.length + submitted.cc.length + submitted.bcc.length === 1 ? "" : "s"}. It has not been reported as sent.`, "郵件已排入寄件匣", `有 ${submitted.to.length + submitted.cc.length + submitted.bcc.length} 個收件人等待傳送。未有聲稱已寄出。`);
    } else if (disposition === "partial") {
      pushToast("warning", "Server accepted only part of the delivery", `${result.accepted.length} accepted; ${result.rejected.length} rejected: ${result.rejected.join(", ")}.`, "伺服器只接受部分傳送", `${result.accepted.length} 個接受；${result.rejected.length} 個被拒絕：${result.rejected.join(", ")}。`);
    } else {
      pushToast("success", "Message accepted by the server", `${result.accepted.length} recipient${result.accepted.length === 1 ? "" : "s"} accepted. Message ID: ${result.messageId}`, "伺服器已接受郵件", `${result.accepted.length} 個收件人獲接受。郵件 ID：${result.messageId}`);
    }
  });
};

const saveComposerDraft = async (): Promise<void> => {
  if (isBusy("send") || isBusy("save-draft")) return;
  captureComposer();
  const composerAtSubmit = state.compose;
  if (!composerAtSubmit) return;
  const submitted = structuredClone(composerAtSubmit.draft);
  const submittedFingerprint = composeFingerprint(submitted);
  await withBusy("save-draft", async () => {
    const saved = await api.saveDraft(submitted);
    await refreshDraftAndOutbox();
    const composerStillCurrent = state.compose === composerAtSubmit;
    if (composerStillCurrent) captureComposer();
    let newerEditsRemain = false;
    if (composerStillCurrent && state.compose) {
      const current = structuredClone(state.compose.draft);
      newerEditsRemain = composeFingerprint(current) !== submittedFingerprint;
      state.compose.draft = newerEditsRemain
        ? { ...current, ...(saved.id ? { id: saved.id } : {}) }
        : saved;
      state.compose.cleanBaseline = composeFingerprint(saved);
    }
    await refreshMetadata();
    if (newerEditsRemain) {
      pushToast("warning", "Draft saved; newer edits remain", `“${saved.subject || "(No subject)"}” was saved as ${saved.id ?? "unknown"}. Text entered during the save remains in the composer and is still unsaved.`, "草稿已儲存；較新更改仍未儲存", `「${saved.subject || "（冇主旨）"}」已儲存為 ${saved.id ?? "未知"}。儲存期間輸入嘅內容仍然保留喺撰寫視窗，而且仲未儲存。`);
    } else {
      pushToast("success", "Draft saved locally", `“${saved.subject || "(No subject)"}” has revision ${saved.id ?? "unknown"}.`, "草稿已儲存喺本機", `「${saved.subject || "（冇主旨）"}」修訂係 ${saved.id ?? "未知"}。`);
    }
  });
};

const chooseComposeAttachments = async (): Promise<void> => {
  captureComposer();
  await withBusy("choose-attachments", async () => {
    const paths = await api.chooseAttachments();
    if (!state.compose || !paths.length) return;
    state.compose.draft.attachments = [...new Set([...state.compose.draft.attachments, ...paths])];
    pushToast("success", "Files attached", `${paths.length} file${paths.length === 1 ? "" : "s"} added to this unsent message.`, "已附加檔案", `${paths.length} 個檔案加入呢封未寄出郵件。`);
  });
};

const saveReaderAttachment = async (index: number | "all", reviewed?: AttachmentSaveReview): Promise<void> => {
  const detail = state.detail;
  if (!detail) return;
  if (!reviewed) {
    const review = attachmentSaveReview(detail, index);
    if (review.riskyAttachments.length) {
      showConfirmation(
        { kind: "save-risky-attachments", target: index, review },
        index === "all" ? "save-all-attachments" : `save-attachment-${index}`,
      );
      return;
    }
  }
  await withBusy("save-attachment", async () => {
    if (index === "all") {
      const outcome = await api.saveAllAttachments(detail.accountId, detail.folderPath, detail.uid, reviewed);
      if (outcome.quarantined.length) {
        await refreshMetadata();
        pushToast(
          "warning",
          "Risky attachments quarantined",
          `${outcome.quarantined.length} attachment${outcome.quarantined.length === 1 ? "" : "s"} now require an explicit Release or Delete decision. No antivirus scan was performed.`,
          "有風險附件已隔離",
          `${outcome.quarantined.length} 個附件而家要明確揀「放行」或者「刪除」。冇做防毒掃描。`,
        );
      }
      if (outcome.savedPaths.length) {
        pushToast("success", "Ordinary attachments saved", `${outcome.savedPaths.length} ordinary attachment${outcome.savedPaths.length === 1 ? "" : "s"} written to the chosen folder.`, "普通附件已儲存", `${outcome.savedPaths.length} 個普通附件已寫入所選資料夾。`);
      } else if (outcome.ordinarySaveCancelled) {
        pushToast("info", "Ordinary attachment save cancelled", "No ordinary attachment was written; any reviewed risky attachment remains safely quarantined.", "已取消普通附件儲存", "冇寫入普通附件；任何已審閱嘅有風險附件仍然安全留喺隔離區。 ");
      }
      return;
    }
    const outcome = await api.saveAttachment(detail.accountId, detail.folderPath, detail.uid, index, reviewed);
    if (outcome.status === "saved") {
      pushToast("success", "Attachment saved", `${detail.attachments[index]?.filename ?? "Attachment"} was written to the chosen destination.`, "附件已儲存", `${detail.attachments[index]?.filename ?? "附件"} 已寫入所選位置。`);
    } else if (outcome.status === "quarantined") {
      await refreshMetadata();
      pushToast("warning", "Attachment quarantined", `${outcome.quarantine.filename} is held locally until you explicitly release or delete it. No antivirus scan was performed.`, "附件已隔離", `${outcome.quarantine.filename} 會留喺本機，直至你明確放行或者刪除。冇做防毒掃描。`);
    } else {
      pushToast("info", "Attachment save cancelled", "No file was written.", "已取消附件儲存", "冇寫入任何檔案。 ");
    }
  });
};

const importICalendar = async (): Promise<void> => {
  await withBusy("pim-ics", async () => {
    const result = await api.importICalendar(state.icsDuplicatePolicy);
    if (!result) {
      pushToast("info", "ICS import cancelled", "No local events or tasks were changed.", "已取消 ICS 匯入", "冇本機事件或者工作被更改。 ");
      return;
    }
    await refreshPimData();
    pushToast(
      "success",
      "ICS import complete",
      `${result.created} created, ${result.updated} updated, ${result.unchanged} unchanged, and ${result.skipped} duplicate UIDs skipped atomically.`,
      "ICS 匯入完成",
      `原子匯入結果：${result.created} 個建立、${result.updated} 個更新、${result.unchanged} 個冇變，另有 ${result.skipped} 個重複 UID 安全略過。`,
    );
  });
};

const exportICalendar = async (request: ICalendarExportRequest): Promise<void> => {
  await withBusy("pim-ics", async () => {
    const result = await api.exportICalendar(request);
    if (result.status === "cancelled") {
      pushToast("info", "ICS export cancelled", "No file was written.", "已取消 ICS 匯出", "冇寫入任何檔案。 ");
      return;
    }
    pushToast("success", "ICS exported", `${result.eventCount} events and ${result.taskCount} tasks were written as normalized iCalendar 2.0.`, "ICS 已匯出", `已將 ${result.eventCount} 個事件同 ${result.taskCount} 個工作寫成標準化 iCalendar 2.0。`);
  });
};

const handleConfirmation = async (): Promise<void> => {
  const confirmation = state.confirmation;
  const returnFocusKey = state.confirmationReturnFocusKey;
  state.confirmation = null;
  state.confirmationReturnFocusKey = null;
  render();
  if (!confirmation) return;
  if (confirmation.kind === "clear-oauth-token-vault" || confirmation.kind === "revoke-oauth-token-vault") {
    await withBusy("oauth-vault", async () => {
      const result = confirmation.kind === "clear-oauth-token-vault"
        ? await api.clearOAuthTokenVault(confirmation.provider)
        : await api.revokeOAuthTokenVault(confirmation.provider);
      state.oauthTokenVault = result.snapshot;
      pendingFocusKey = returnFocusKey;
      if (confirmation.kind === "clear-oauth-token-vault") {
        pushToast(
          "success",
          "Local OAuth ciphertext cleared",
          `${result.localRecordsCleared} encrypted ${confirmation.label} record${result.localRecordsCleared === 1 ? "" : "s"} removed. No provider endpoint was contacted; secure filesystem erasure is not claimed.`,
          "本機 OAuth 密文已清除",
          `已移除 ${result.localRecordsCleared} 個 ${confirmation.label} 加密記錄。冇聯絡供應商端點；唔聲稱檔案系統安全抹除。`,
        );
      } else {
        const kind: ToastKind = result.remoteRevocation === "succeeded" ? "success" : result.remoteRevocation === "failed" ? "warning" : "info";
        const outcomeEnglish = result.remoteRevocation === "succeeded"
          ? "The registered provider revoker completed."
          : result.remoteRevocation === "failed"
            ? "The provider revoker failed, but local ciphertext was still cleared."
            : "No reviewed provider revoker was available; only local ciphertext was cleared.";
        const outcomeCantonese = result.remoteRevocation === "succeeded"
          ? "已註冊供應商 revoker 已完成。"
          : result.remoteRevocation === "failed"
            ? "供應商 revoker 失敗，但本機密文仍然已清除。"
            : "冇可用嘅經審閱供應商 revoker；只清除咗本機密文。 ";
        pushToast(
          kind,
          "OAuth revoke-and-clear finished",
          `${result.localRecordsCleared} encrypted ${confirmation.label} record${result.localRecordsCleared === 1 ? "" : "s"} removed. ${outcomeEnglish}`,
          "OAuth 撤銷並清除已完成",
          `已移除 ${result.localRecordsCleared} 個 ${confirmation.label} 加密記錄。${outcomeCantonese}`,
        );
      }
    });
    return;
  }
  if (confirmation.kind === "discard-compose") {
    state.compose = null;
    render();
    return;
  }
  if (confirmation.kind === "replace-compose") {
    state.compose = null;
    beginComposer(confirmation.mode, confirmation.mailto);
    return;
  }
  if (confirmation.kind === "discard-pim-editor") {
    finishPimEditorClose();
    render();
    return;
  }
  if (confirmation.kind === "replace-pim-editor") {
    finishPimEditorClose(false);
    pendingFocusKey = null;
    beginPimEditor(confirmation.entityKind, confirmation.uid, confirmation.returnFocusKey);
    return;
  }
  if (confirmation.kind === "send-empty-subject") {
    await sendComposer(true);
    return;
  }
  if (confirmation.kind === "save-risky-attachments") {
    await saveReaderAttachment(confirmation.target, confirmation.review);
    return;
  }
  if (confirmation.kind === "release-quarantined-attachment") {
    await withBusy(`quarantine-release-${confirmation.item.id}`, async () => {
      const destination = await api.releaseQuarantinedAttachment(confirmation.item.id);
      if (!destination) {
        pushToast("info", "Release cancelled", "The attachment remains in local quarantine.", "已取消放行", "附件仍然留喺本機隔離區。 ");
        return;
      }
      await refreshMetadata();
      pushToast("warning", "Attachment released", `${confirmation.item.filename} was copied to the chosen location and removed from local quarantine. This was not an antivirus approval.`, "附件已放行", `${confirmation.item.filename} 已複製去所選位置，並由本機隔離區移除。呢個唔係防毒批准。`);
    });
    return;
  }
  if (confirmation.kind === "delete-quarantined-attachment") {
    await withBusy(`quarantine-delete-${confirmation.item.id}`, async () => {
      await api.deleteQuarantinedAttachment(confirmation.item.id);
      await refreshMetadata();
      pushToast("success", "Quarantined attachment deleted", `${confirmation.item.filename} was removed without being released.`, "已刪除隔離附件", `${confirmation.item.filename} 已經移除，冇被放行。`);
    });
    return;
  }
  if (confirmation.kind === "external-link") {
    await withBusy("external-link-open", async () => {
      try {
        await api.confirmExternalLink(confirmation.request.requestId);
        pushToast("success", "Link opened", "The reviewed address was handed to your default browser.", "連結已開啟", "已審閱嘅網址交畀預設瀏覽器開啟。 ");
      } catch (error) {
        pushToast("error", "Link was not opened", errorMessage(error), "連結未有開啟", errorMessage(error));
      }
    });
    return;
  }
  if (confirmation.kind === "bulk-close-tabs") {
    for (const id of confirmation.tabIds) {
      if (!state.tabPreferences.closed.includes(id)) state.tabPreferences.closed.push(id);
    }
    const remaining = visibleTabIds();
    if (!remaining.includes(state.activeTab)) state.activeTab = remaining[0] ?? "mail";
    persistTabs();
    pushToast("success", "Reviewed tabs closed", `${confirmation.tabIds.length} tab${confirmation.tabIds.length === 1 ? "" : "s"} closed.`, "已關閉審閱分頁", `已關閉 ${confirmation.tabIds.length} 個分頁。`);
    render();
    return;
  }
  if (confirmation.kind === "clear-notifications") {
    await withBusy("clear-notifications", async () => {
      await api.clearNotifications();
      await refreshMetadata();
      pushToast("success", "Notification history cleared", "Stored notifications were removed; messages and local revisions were untouched.", "通知記錄已清除", "已儲存通知已移除；郵件同本機修訂冇變。 ");
    });
    return;
  }
  if (confirmation.kind === "discard-pending-operation") {
    await withBusy("queue-operation", async () => {
      await api.discardPendingOperation(confirmation.accountId, confirmation.operationId);
      await Promise.all([refreshDraftAndOutbox(), refreshMetadata()]);
      pushToast(
        "warning",
        "Queued change discarded",
        `${confirmation.label} was removed without contacting the server. Refreshing the folder will reconcile the visible message state.`,
        "已捨棄排隊更改",
        `${confirmation.label} 已經移除，冇聯絡伺服器。重新整理資料夾會對齊畫面同伺服器郵件狀態。`,
      );
    });
    return;
  }
  if (confirmation.kind === "remove-account") {
    await withBusy("remove-account", async () => {
      beginMailNavigation();
      await api.removeAccount(confirmation.accountId);
      if (state.compose?.draft.accountId === confirmation.accountId) state.compose = null;
      await refreshMetadata();
      const next = state.bootstrap?.accounts[0];
      if (next) await loadAccount(next.id, false);
      else {
        state.accountId = null;
        state.unifiedFolder = null;
        state.folders = [];
        state.messages = [];
        state.detail = null;
        state.selectedMessageId = null;
        state.setupOpen = true;
        state.setupContext = "first-run";
      }
      pushToast("success", "Account removed from this computer", `${confirmation.label} and its local cache were removed.`, "帳戶已由呢部電腦移除", `${confirmation.label} 同本機快取已經移除。`);
    });
    return;
  }
  if (confirmation.kind === "delete-pim") {
    await deletePimEntity(confirmation.entityKind, confirmation.uid, confirmation.label);
    pendingFocusKey = pimEntityPresent(confirmation.entityKind, confirmation.uid)
      ? returnFocusKey
      : `open-pim-editor-${confirmation.entityKind}-new`;
    render();
    return;
  }
  if (confirmation.kind === "prune-local-history") {
    await withBusy("local-history-prune", async () => {
      state.localHistoryPruneError = "";
      const result = await api.pruneLocalHistory(pruneRequestFromPreview(confirmation.preview));
      await refreshMetadata();
      state.localHistoryPrunePreview = null;
      state.localHistoryDeletionEvidence = null;
      state.localHistoryDeletionError = "";
      state.localRevisionsLoaded = false;
      state.localRevisions = [];
      state.selectedLocalRevisionHash = null;
      state.localRevisionDiff = null;
      state.localRevisionDiffError = "";
      await loadLocalRevisions();
      pendingFocusKey = "preview-local-history-prune";
      pushToast(
        "success",
        "Local revisions pruned",
        `${result.prunedRevisionCount} eligible app-owned revision${result.prunedRevisionCount === 1 ? " was" : "s were"} removed from active history. The current state and labeled revisions remain; this was not secure deletion.`,
        "本機修訂已清理",
        `${result.prunedRevisionCount} 個符合條件、由應用程式建立嘅修訂已移離現役歷史。目前狀態同有標籤修訂仍然保留；呢次唔係安全刪除。`,
      );
    });
    return;
  }
  if (confirmation.kind !== "restore-local") return;
  await withBusy("restore-local", async () => {
    beginMailNavigation();
    const restored = await api.restoreLocalRevision(confirmation.hash);
    state.bootstrap = restored;
    applyPreferences();
    state.localRevisionsLoaded = false;
    state.localRevisions = [];
    state.localRevisionsError = "";
    state.selectedLocalRevisionHash = null;
    state.localRevisionDiff = null;
    state.localRevisionDiffError = "";
    state.localHistoryPrunePreview = null;
    state.localHistoryPruneError = "";
    state.localHistoryDeletionEvidence = null;
    state.localHistoryDeletionError = "";
    const next = restored.accounts.find(account => account.id === restored.preferences.selectedAccountId) ?? restored.accounts[0];
    if (next) await loadAccount(next.id, false);
    await loadLocalRevisions();
    pushToast("success", "Workspace version restored", "The prior current state remains available as another local revision.", "工作空間版本已還原", "之前嘅目前狀態仍然保留做另一個本機修訂。 ");
  });
};

const sampleForSearch = (key: string): string => {
  if (key === "mail") return state.messages.slice(0, 20).map(message => `${addressLine(message.from)} — ${message.subject}\n${message.preview}`).join("\n\n");
  if (key === "history") return (state.bootstrap?.history ?? []).slice(0, 20).map(item => `${item.kind}: ${item.label}`).join("\n");
  if (key === "history-versions") return state.localRevisions.slice(0, 20).map(item => `${item.label}\n${item.hash}\n${item.createdAt}`).join("\n\n");
  if (key === "notifications") return (state.bootstrap?.notifications ?? []).slice(0, 20).map(item => `${item.title}: ${item.body}`).join("\n");
  if (key === "changelog") return changelogEntries().map(entry => `${entry.version} ${entry.title}\n${entry.changes.map(change => change.detail).join("\n")}`).join("\n");
  if (key === "contacts") return state.contacts.slice(0, 30).map(contact => `${contact.displayName}\n${contact.emails.map(email => email.value).join(" ")}\n${contact.organization ?? ""}`).join("\n\n");
  if (key === "mailing-lists") return state.mailingLists.slice(0, 30).map(list => `${list.name}\n${list.nickname ?? ""}\n${list.description ?? ""}`).join("\n\n");
  if (key === "calendar-events") return state.calendarEvents.slice(0, 30).map(event => `${event.title}\n${event.location ?? ""}\n${event.description ?? ""}`).join("\n\n");
  if (key === "tasks") return state.tasks.slice(0, 30).map(task => `${task.title}\n${task.status}\n${task.description ?? ""}`).join("\n\n");
  if (key === "pim-history") return state.pimTransactions.slice(-50).map(transaction => `${transaction.action} ${transaction.entityKind} ${transaction.entityUid}`).join("\n");
  if (key === "commands") return paletteCommands().map(command => `${command.en}\n${command.yue}`).join("\n\n");
  if (key.startsWith("tabs") || key === "bulk-tabs" || key === "tab-groups") return TAB_DEFINITIONS.map(tab => `${tab.en} · ${tab.yue}`).join("\n");
  return "Invoice #20261 arrived. Receipt 4471 is attached.\n發票 #20261 已到，收據 4471 已附上。";
};

const exportHistory = async (): Promise<void> => {
  const selection = currentHistorySelection();
  if (!selection.valid) {
    pushToast("error", "History filters need attention", "Correct the search or date-range error before exporting.", "歷史篩選要處理", "匯出之前請修正搜尋或者日期範圍錯誤。 ");
    return;
  }
  await exportText("history", JSON.stringify({
    exportedAt: new Date().toISOString(),
    filters: {
      from: selection.range.from.isoDate,
      to: selection.range.to.isoDate,
      typedFrom: state.filters.historyFrom,
      typedTo: state.filters.historyTo,
      actions: [...state.filters.historyActions],
      query: searchFor("history"),
    },
    records: selection.records,
  }, null, 2), "material-email-history.json", tx("History", "歷史"));
};

const exportLocalHistoryDeletionEvidence = async (): Promise<void> => {
  const evidence = state.localHistoryDeletionEvidence;
  if (!evidence) {
    pushToast("warning", "Deletion evidence unavailable", "Inspect deletion limits before exporting the report.", "刪除證據未有提供", "匯出報告之前請先檢查刪除限制。 ");
    return;
  }
  await exportText(
    "history",
    JSON.stringify({
      report: "Material Email local-history deletion evidence",
      interpretation: "Read-only Git metadata. This report is not cryptographic-erasure proof.",
      evidence,
    }, null, 2),
    "material-email-local-history-deletion-evidence.json",
    tx("Deletion evidence", "刪除證據"),
  );
};

const exportChangelog = async (): Promise<void> => {
  const selection = currentChangelogSelection();
  if (!selection.valid) {
    pushToast("error", "Changelog filters need attention", "Correct the search or date-range error before exporting.", "更新記錄篩選要處理", "匯出之前請修正搜尋或者日期範圍錯誤。 ");
    return;
  }
  await exportText("changelog", selection.markdown, "material-email-changelog.md", tx("Changelog", "更新記錄"));
};

const copyChangelog = async (): Promise<void> => {
  const selection = currentChangelogSelection();
  if (!selection.valid) {
    pushToast("error", "Changelog filters need attention", "Correct the search or date-range error before copying.", "更新記錄篩選要處理", "複製之前請修正搜尋或者日期範圍錯誤。 ");
    return;
  }
  const copied = await copyText(selection.markdown);
  pushToast(
    copied ? "success" : "error",
    copied ? "Filtered changelog copied" : "Copy failed",
    copied ? "The same Markdown selection used by export is on the clipboard." : "The clipboard was unavailable.",
    copied ? "已複製篩選後更新記錄" : "複製失敗",
    copied ? "剪貼簿而家有同匯出完全相同嘅 Markdown 選擇。 " : "剪貼簿不可用。 ",
  );
};

const exportSettings = async (): Promise<void> => {
  await exportText("settings", JSON.stringify({ exportedAt: new Date().toISOString(), preferences: preferences(), tabs: state.tabPreferences }, null, 2), "material-email-settings.json", tx("Settings", "設定"));
};

const toggleRowStar = async (id: string): Promise<void> => {
  const message = searchHitForMessage(id)?.message ?? state.messages.find(item => item.id === id);
  if (!message) return;
  const next = !message.starred;
  await withBusy(`row-star-${message.id}`, async () => {
    await api.setMessageFlags(message.accountId, message.folderPath, message.uid, { starred: next });
    message.starred = next;
    const cachedViewMessage = state.messages.find(item => item.id === message.id);
    if (cachedViewMessage) cachedViewMessage.starred = next;
    if (state.detail?.id === message.id) state.detail.starred = next;
    await refreshMetadata();
    if (state.unifiedFolder === "starred") await loadUnifiedFolder("starred");
    pushToast("success", "Message updated", next ? "Star added." : "Star removed.", "郵件已更新", next ? "粒星加咗。" : "粒星拎走咗。 ");
  });
};

const runPaletteCommand = (commandId: string): void => {
  state.commandPaletteOpen = false;
  resetCommandPaletteSearch();
  if (commandId === "compose") openComposer();
  else if (commandId === "sync") void syncCurrentAccount();
  else if (commandId === "regex") {
    const model = searchFor("mail");
    model.builderOpen = true;
    if (!model.sample) model.sample = sampleForSearch("mail");
    activateTab("mail");
  } else if (commandId === "editor") void api.openExternalEditor().catch(error => pushToast("error", "Editor did not open", errorMessage(error), "編輯器開唔到", errorMessage(error)));
  else if (commandId.startsWith("tab:")) {
    const id = commandId.slice(4) as PageId;
    if (ALL_TAB_IDS.includes(id)) activateTab(id);
  }
  render();
};

const saveChangelogDates = (inputs: ChangelogDateInputs): void => {
  state.changelogDates = inputs;
  persistChangelogDateInputs(sessionStorage, state.changelogDates);
};

const saveHistoryDates = (inputs: ChangelogDateInputs): void => {
  state.filters.historyFrom = inputs.from;
  state.filters.historyTo = inputs.to;
  persistChangelogDateInputs(sessionStorage, inputs, HISTORY_DATE_SESSION_KEY);
};

const setHistoryCalendarMonth = (visibleMonth: string): void => {
  state.historyCalendar.visibleMonth = visibleMonth;
  const days = changelogCalendarWeeks(visibleMonth).flat().filter((day): day is NonNullable<typeof day> => Boolean(day));
  const currentDay = Number(state.historyCalendar.focusDate.slice(8, 10)) || 1;
  const focusDay = days[Math.min(currentDay, days.length) - 1] ?? days[0];
  if (focusDay) state.historyCalendar.focusDate = focusDay.isoDate;
};

const openHistoryCalendar = (): void => {
  const range = validateDateRange(state.filters.historyFrom, state.filters.historyTo, historyDateLocale());
  const latestRecord = state.bootstrap?.history[0];
  const latestDate = latestRecord && Number.isFinite(Date.parse(latestRecord.createdAt))
    ? localIsoDate(new Date(latestRecord.createdAt))
    : localIsoDate();
  const initial = range.from.isoDate ?? range.to.isoDate ?? latestDate;
  state.historyCalendar = {
    open: true,
    visibleMonth: initial.slice(0, 7),
    focusDate: initial,
    selecting: range.from.isoDate && !range.to.isoDate ? "end" : "start",
  };
  pendingFocusKey = `history-calendar-day-${initial}`;
  render();
};

const closeHistoryCalendar = (): void => {
  state.historyCalendar.open = false;
  pendingFocusKey = "history-calendar-trigger";
  render();
};

const moveHistoryCalendarFocus = (days: number): void => {
  const current = new Date(`${historyCalendarFocusDate()}T00:00:00Z`);
  current.setUTCDate(current.getUTCDate() + days);
  const next = current.toISOString().slice(0, 10);
  state.historyCalendar.focusDate = next;
  state.historyCalendar.visibleMonth = next.slice(0, 7);
  pendingFocusKey = `history-calendar-day-${next}`;
  render();
};

const setChangelogCalendarMonth = (visibleMonth: string): void => {
  state.changelogCalendar.visibleMonth = visibleMonth;
  const days = changelogCalendarWeeks(visibleMonth).flat().filter((day): day is NonNullable<typeof day> => Boolean(day));
  const currentDay = Number(state.changelogCalendar.focusDate.slice(8, 10)) || 1;
  const focusDay = days[Math.min(currentDay, days.length) - 1] ?? days[0];
  if (focusDay) state.changelogCalendar.focusDate = focusDay.isoDate;
};

const openChangelogCalendar = (): void => {
  const range = validateDateRange(state.changelogDates.from, state.changelogDates.to, changelogDateLocale());
  const initial = range.from.isoDate ?? range.to.isoDate ?? changelogEntries()[0]?.date ?? localIsoDate();
  state.changelogCalendar = {
    open: true,
    visibleMonth: initial.slice(0, 7),
    focusDate: initial,
    selecting: range.from.isoDate && !range.to.isoDate ? "end" : "start",
  };
  pendingFocusKey = `changelog-calendar-day-${initial}`;
  render();
};

const closeChangelogCalendar = (): void => {
  state.changelogCalendar.open = false;
  pendingFocusKey = "changelog-calendar-trigger";
  render();
};

const moveChangelogCalendarFocus = (days: number): void => {
  const current = new Date(`${changelogCalendarFocusDate()}T00:00:00Z`);
  current.setUTCDate(current.getUTCDate() + days);
  const next = current.toISOString().slice(0, 10);
  state.changelogCalendar.focusDate = next;
  state.changelogCalendar.visibleMonth = next.slice(0, 7);
  pendingFocusKey = `changelog-calendar-day-${next}`;
  render();
};

const handleAction = async (button: HTMLElement): Promise<void> => {
  const action = button.dataset.action;
  if (!action) return;
  const pageId = button.dataset.tabId as PageId | undefined;
  switch (action) {
    case "retry-bootstrap": await initialize(); break;
    case "retry-pim-load": await ensurePimData(true); break;
    case "activate-tab": if (pageId && ALL_TAB_IDS.includes(pageId)) activateTab(pageId); break;
    case "open-notifications": activateTab("notifications"); break;
    case "open-command-palette":
      state.commandPaletteOpen = true; resetCommandPaletteSearch(); render();
      requestAnimationFrame(() => document.querySelector<HTMLInputElement>('[data-focus-key="search-commands"]')?.focus());
      break;
    case "close-command-palette": state.commandPaletteOpen = false; render(); break;
    case "run-command": if (button.dataset.commandId) runPaletteCommand(button.dataset.commandId); break;
    case "toggle-tab-manager": state.tabManagerOpen = !state.tabManagerOpen; state.contextMenu = null; render(); break;
    case "close-tab-manager": state.tabManagerOpen = false; render(); break;
    case "clear-search": {
      const key = button.dataset.searchKey;
      if (key) {
        searchFor(key).pattern = "";
        if (key === "contacts") scheduleContactSearch();
        if (key === "mail") scheduleMailSearch(0);
        render();
      }
      break;
    }
    case "toggle-regex-builder": {
      const key = button.dataset.searchKey;
      if (!key) break;
      const model = searchFor(key);
      model.builderOpen = !model.builderOpen;
      if (model.builderOpen && !model.sample) model.sample = sampleForSearch(key);
      render();
      requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>(`[data-regex-pattern="${CSS.escape(key)}"]`)?.focus());
      break;
    }
    case "close-regex-builder": {
      const key = button.dataset.searchKey;
      if (key) { searchFor(key).builderOpen = false; render(); }
      break;
    }
    case "set-regex-mode": {
      const key = button.dataset.searchKey;
      if (key && (button.dataset.mode === "plain" || button.dataset.mode === "regex")) {
        searchFor(key).mode = button.dataset.mode;
        if (key === "contacts") scheduleContactSearch();
        if (key === "mail") scheduleMailSearch(0);
        render();
      }
      break;
    }
    case "insert-regex-guide": {
      const key = button.dataset.searchKey;
      const guide = button.dataset.guide;
      if (!key || !guide) break;
      const snippets: Record<string, string> = { literal: "literal", class: "[A-Za-z0-9]", anchors: "^…$", group: "(group)", alternation: "one|two", quantifier: "{1,3}" };
      searchFor(key).pattern += snippets[guide] ?? "";
      if (key === "mail") scheduleMailSearch();
      render();
      break;
    }
    case "copy-regex": {
      const key = button.dataset.searchKey;
      if (!key) break;
      const model = searchFor(key);
      const copied = await copyText(model.mode === "regex" ? `/${model.pattern}/${model.flags}` : model.pattern);
      pushToast(copied ? "success" : "error", copied ? "Pattern copied" : "Copy failed", copied ? "The current pattern is on the clipboard." : "The clipboard was unavailable.", copied ? "模式已複製" : "複製失敗", copied ? "目前模式已放到剪貼簿。" : "剪貼簿不可用。 ");
      break;
    }
    case "export-regex": {
      const key = button.dataset.searchKey;
      if (key) await exportText("settings", JSON.stringify({ engine: "JavaScript RegExp ES2023", ...searchFor(key) }, null, 2), "material-email-regex.json", tx("Regex pattern", "正規表達式模式"));
      break;
    }
    case "use-regex": {
      const key = button.dataset.searchKey;
      if (key) {
        searchFor(key).builderOpen = false;
        if (key === "contacts") scheduleContactSearch();
        if (key === "mail") scheduleMailSearch(0);
        render();
      }
      break;
    }
    case "set-contacts-view": {
      const view = button.dataset.contactsView;
      if (view === "people" || view === "lists" || view === "activity") {
        state.contactsView = view;
        render();
      }
      break;
    }
    case "open-pim-editor":
    case "edit-pim": {
      const kind = button.dataset.pimKind as PimEntityKind | undefined;
      const uid = action === "edit-pim" ? button.dataset.pimUid ?? null : null;
      if (!kind || !(["contact", "mailing-list", "calendar-event", "task"] as PimEntityKind[]).includes(kind)) break;
      requestPimEditorOpen(kind, uid, button.dataset.focusKey ?? null);
      break;
    }
    case "close-pim-editor":
      requestPimEditorClose();
      break;
    case "view-mailing-list-members":
      if (button.dataset.pimUid) await loadMailingListMembers(button.dataset.pimUid);
      break;
    case "request-delete-pim": {
      const kind = button.dataset.pimKind as PimEntityKind | undefined;
      const uid = button.dataset.pimUid;
      const label = button.dataset.pimLabel;
      if (kind && uid && label && (["contact", "mailing-list", "calendar-event", "task"] as PimEntityKind[]).includes(kind)) {
        showConfirmation({ kind: "delete-pim", entityKind: kind, uid, label }, button.dataset.focusKey ?? null);
      }
      break;
    }
    case "restore-pim": {
      const kind = button.dataset.pimKind as PimEntityKind | undefined;
      const uid = button.dataset.pimUid;
      const transactionId = button.dataset.transactionId;
      if (kind && uid && transactionId && (["contact", "mailing-list", "calendar-event", "task"] as PimEntityKind[]).includes(kind)) {
        await restorePimEntity(kind, uid, transactionId);
      }
      break;
    }
    case "import-vcard": await importVCard(); break;
    case "export-all-vcard": await exportVCardSelection(); break;
    case "export-contact-vcard": if (button.dataset.pimUid) await exportVCardSelection([button.dataset.pimUid], []); break;
    case "export-list-vcard": if (button.dataset.pimUid) await exportVCardSelection([], [button.dataset.pimUid]); break;
    case "import-ics": await importICalendar(); break;
    case "export-all-ics": {
      const kind = button.dataset.icsKind;
      if (kind === "calendar-event" || kind === "task") await exportICalendar({ scope: "all", entityKinds: [kind] });
      break;
    }
    case "export-selected-ics": {
      const kind = button.dataset.icsKind;
      if (kind === "calendar-event") await exportICalendar({ scope: "selected", eventUids: [...state.selectedCalendarEventUids], taskUids: [] });
      if (kind === "task") await exportICalendar({ scope: "selected", eventUids: [], taskUids: [...state.selectedTaskUids] });
      break;
    }
    case "complete-task": {
      const uid = button.dataset.pimUid;
      const task = state.tasks.find(item => item.uid === uid);
      if (!task) break;
      await withBusy("pim-save", async () => {
        const saved = await api.updateTask(task.uid, { status: "completed", percentComplete: 100, completedAt: task.completedAt ?? new Date().toISOString() });
        await refreshPimData();
        pushToast("success", "Task completed", `${saved.title} is now complete.`, "工作已完成", `${saved.title} 而家完成咗。`);
      });
      break;
    }
    case "pim-history-preset": {
      const days = Number(button.dataset.days ?? 0);
      if (days > 0) {
        const end = new Date();
        const start = new Date();
        start.setDate(start.getDate() - days + 1);
        const localDate = (date: Date): string => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
        state.pimFilters.from = localDate(start);
        state.pimFilters.to = localDate(end);
        await reloadPimHistory();
      }
      break;
    }
    case "clear-pim-filters":
      state.pimFilters.actions.clear();
      state.pimFilters.kinds.clear();
      state.pimFilters.from = "";
      state.pimFilters.to = "";
      state.pimHistoryResults = null;
      render();
      break;
    case "compose": openComposer(); break;
    case "refresh-drafts": await refreshDraftAndOutbox(); break;
    case "refresh-outbox": await refreshDraftAndOutbox(); break;
    case "open-draft": {
      const account = activeAccount(); const id = button.dataset.draftId;
      if (!account || !id) break;
      const draft = await api.getDraft(account.id, id);
      state.compose = { draft, showCopies: Boolean(draft.cc.length || draft.bcc.length), minimized: false, cleanBaseline: composeFingerprint(draft) };
      render();
      break;
    }
    case "delete-draft": {
      const account = activeAccount(); const id = button.dataset.draftId;
      if (!account || !id) break;
      await api.deleteDraft(account.id, id); await refreshDraftAndOutbox();
      break;
    }
    case "retry-pending-operation": {
      const account = activeAccount(); const id = button.dataset.operationId;
      if (!account || !id) break;
      await withBusy("queue-operation", async () => {
        try {
          await api.retryPendingOperation(account.id, id);
          pushToast("success", "Queued change synchronized", "The queue head completed after exactly one manual attempt.", "排隊更改已同步", "隊首啱啱手動試咗一次，並已完成。 ");
        } finally {
          await Promise.all([refreshDraftAndOutbox(), refreshMetadata()]);
        }
      });
      break;
    }
    case "request-discard-pending-operation": {
      const account = activeAccount(); const id = button.dataset.operationId; const label = button.dataset.operationLabel;
      if (account && id && label) showConfirmation({ kind: "discard-pending-operation", accountId: account.id, operationId: id, label }, `pending-operation-${id}`);
      break;
    }
    case "retry-outbox": {
      const account = activeAccount(); const id = button.dataset.outboxId;
      if (!account || !id) break;
      await withBusy("queue-operation", async () => {
        try {
          const result = await api.retryOutbox(account.id, id);
          const disposition = classifyRendererDelivery(result);
          pushToast(
            disposition === "partial" ? "warning" : disposition === "rejected" ? "error" : "success",
            disposition === "partial" ? "Outbox message partially accepted" : disposition === "rejected" ? "Outbox message returned to drafts" : "Outbox message accepted",
            `${result.accepted.length} accepted; ${result.rejected.length} rejected. The manual retry made exactly one delivery attempt.`,
            disposition === "partial" ? "寄件匣郵件部分獲接受" : disposition === "rejected" ? "寄件匣郵件已移返草稿" : "寄件匣郵件獲接受",
            `${result.accepted.length} 個接受；${result.rejected.length} 個被拒絕。今次手動重試只做咗一次傳送嘗試。`,
          );
        } finally {
          await Promise.all([refreshDraftAndOutbox(), refreshMetadata()]);
        }
      });
      break;
    }
    case "cancel-outbox": {
      const account = activeAccount(); const id = button.dataset.outboxId;
      if (!account || !id) break;
      await withBusy("queue-operation", async () => {
        await api.cancelOutbox(account.id, id);
        await Promise.all([refreshDraftAndOutbox(), refreshMetadata()]);
        pushToast("info", "Outbox message moved to drafts", "The queued delivery was cancelled without another server attempt.", "寄件匣郵件已移返草稿", "排隊傳送已取消，冇再試聯絡伺服器。 ");
      });
      break;
    }
    case "sync": await syncCurrentAccount(); break;
    case "select-unified-folder": {
      const folder = button.dataset.unifiedFolder;
      if (folder === "inbox" || folder === "starred" || folder === "unread") await loadUnifiedFolder(folder);
      break;
    }
    case "select-folder": if (button.dataset.folderPath) await loadFolder(button.dataset.folderPath); break;
    case "select-message": {
      const id = button.dataset.messageId ?? "";
      const message = searchHitForMessage(id)?.message ?? state.messages.find(item => item.id === id);
      if (message) await loadMessage(message);
      break;
    }
    case "toggle-row-star": if (button.dataset.messageId) await toggleRowStar(button.dataset.messageId); break;
    case "toggle-selected-star": await toggleSelectedFlag("starred"); break;
    case "toggle-selected-unread": await toggleSelectedFlag("unread"); break;
    case "toggle-remote-content": {
      const detail = state.detail;
      if (!detail?.remoteContentSources.length) break;
      const allowed = !detail.remoteContentAllowed;
      const detailId = detail.id;
      await withBusy(`remote-content-${detailId}`, async () => {
        const updated = await api.setRemoteContentAllowed(detail.accountId, detail.folderPath, detail.uid, allowed);
        if (state.detail?.id !== detailId) return;
        state.detail = updated;
        readerDocumentRevision += 1;
        pendingFocusKey = "remote-content-toggle";
        pushToast(
          allowed ? "warning" : "success",
          allowed ? "Remote images allowed for this message" : "Remote images blocked again",
          allowed ? "Only the listed image origins can receive requests; this message-level choice is stored locally." : "The reader returned to its no-remote-image document.",
          allowed ? "呢封郵件已准許遠端圖片" : "遠端圖片已再次封鎖",
          allowed ? "只有列出嘅圖片來源可以收到請求；呢個逐封郵件選擇會儲存喺本機。" : "閱讀器已返回唔包含遠端圖片嘅文件。",
        );
      });
      break;
    }
    case "archive-message": {
      const destination = folderByRole("archive");
      if (destination) await moveSelectedMessage(destination); else pushToast("warning", "Archive unavailable", "This account has no archive folder.", "封存不可用", "呢個帳戶冇封存資料夾。 ");
      break;
    }
    case "trash-message": {
      const destination = folderByRole("trash");
      if (destination) await moveSelectedMessage(destination); else pushToast("warning", "Trash unavailable", "This account has no trash folder.", "垃圾桶不可用", "呢個帳戶冇垃圾桶資料夾。 ");
      break;
    }
    case "reply": openComposer("reply"); break;
    case "forward": openComposer("forward"); break;
    case "retry-message": {
      const message = activeMessage(); if (message) await loadMessage(message); break;
    }
    case "save-attachment": await saveReaderAttachment(Number(button.dataset.attachmentIndex)); break;
    case "save-all-attachments": await saveReaderAttachment("all"); break;
    case "request-release-quarantined-attachment": {
      const item = state.bootstrap?.quarantinedAttachments.find(candidate => candidate.id === button.dataset.quarantineId);
      if (item) showConfirmation({ kind: "release-quarantined-attachment", item }, button.dataset.focusKey ?? null);
      break;
    }
    case "request-delete-quarantined-attachment": {
      const item = state.bootstrap?.quarantinedAttachments.find(candidate => candidate.id === button.dataset.quarantineId);
      if (item) showConfirmation({ kind: "delete-quarantined-attachment", item }, button.dataset.focusKey ?? null);
      break;
    }
    case "open-account-setup":
      state.setupOpen = true; state.setupContext = state.bootstrap?.accounts.length ? "settings" : "first-run"; state.discoveries = []; state.selectedDiscovery = null; state.setupEmail = ""; render();
      await refreshOAuthAuthorizationStatus().catch(() => pushToast("error", "OAuth status unavailable", "Account setup remains in password mode. No OAuth provider or token state is claimed.", "OAuth 狀態不可用", "帳戶設定會維持密碼模式。唔會聲稱有 OAuth 供應商或者權杖狀態。"));
      break;
    case "refresh-oauth-token-vault":
      await withBusy("oauth-vault", async () => {
        state.oauthTokenVault = await api.getOAuthTokenVaultStatus();
        pushToast("info", "OAuth vault status refreshed", "Only provider registration, record counts, generation, and expiry metadata crossed renderer IPC.", "OAuth 保險庫狀態已重新整理", "只有供應商註冊、記錄數量、代數同到期中繼資料經過 renderer IPC。 ");
      });
      break;
    case "request-clear-oauth-token-vault":
    case "request-revoke-oauth-token-vault": {
      const providerId = button.dataset.oauthProvider;
      const provider = state.oauthTokenVault.providers.find(candidate => candidate.id === providerId);
      if (!provider) break;
      showConfirmation(
        action === "request-clear-oauth-token-vault"
          ? { kind: "clear-oauth-token-vault", provider: provider.id, label: provider.name }
          : { kind: "revoke-oauth-token-vault", provider: provider.id, label: provider.name },
        button.dataset.focusKey ?? null,
      );
      break;
    }
    case "close-account-setup":
      if (state.bootstrap?.accounts.length) {
        if (oauthAuthorizationIsActive()) await cancelOAuthAuthorizationFromSetup();
        state.setupOpen = false; stopOAuthStatusPolling(); render();
      }
      break;
    case "discover-account": await discoverAccount(); break;
    case "start-oauth-authorization": await startOAuthAuthorizationFromSetup(); break;
    case "cancel-oauth-authorization": await cancelOAuthAuthorizationFromSetup(); break;
    case "inspect-tls-certificate": await inspectTlsCertificateFromSetup(button); break;
    case "run-pop3-foundation":
      if (button instanceof HTMLButtonElement) await runPop3FoundationFromSetup(button);
      break;
    case "create-demo":
      await withBusy("create-demo", async () => {
        if (oauthAuthorizationIsActive()) await cancelOAuthAuthorizationFromSetup();
        const account = await api.createDemoAccount();
        await refreshMetadata();
        state.setupOpen = false;
        await loadAccount(account.id, false);
        pushToast("success", "Local demo ready", "The demo workspace opened without contacting a mail server.", "本機示範準備好", "示範工作空間已開啟，冇聯絡任何郵件伺服器。 ");
        if (state.pendingMailto) { const pending = state.pendingMailto; state.pendingMailto = null; handleMailtoActivation(pending); }
      });
      break;
    case "request-remove-account": {
      const account = state.bootstrap?.accounts.find(item => item.id === button.dataset.accountId);
      if (account) showConfirmation({ kind: "remove-account", accountId: account.id, label: account.email });
      break;
    }
    case "detect-editors":
      await withBusy("detect-editors", async () => {
        state.editors = await api.detectEditors();
        if (state.editors.length) pushToast("success", "Editors detected", `${state.editors.length} supported editor${state.editors.length === 1 ? "" : "s"} found.`, "搵到編輯器", `搵到 ${state.editors.length} 個支援嘅編輯器。`);
        else pushToast("warning", "No supported editor detected", "You can enter a path when the desktop bridge supports a custom editor.", "搵唔到支援嘅編輯器", "桌面連接支援自訂編輯器時，可以輸入路徑。 ");
      });
      break;
    case "choose-custom-editor": {
      if (isBusy("choose-custom-editor")) break;
      state.busy.add("choose-custom-editor");
      render();
      try {
        await api.openExternalEditor("");
        await refreshMetadata();
        pushToast("success", "Custom editor approved and opened", "The selected executable is now the saved external editor for this project.", "自訂編輯器已批准並開啟", "所選可執行檔而家係呢個專案已儲存嘅外部編輯器。 ");
      } catch (error) {
        const message = errorMessage(error);
        if (/selection was cancelled|selection was canceled/iu.test(message)) {
          pushToast("info", "Editor selection cancelled", "No editor was launched and the saved selection was unchanged.", "已取消選擇編輯器", "冇開啟編輯器，已儲存嘅選擇亦冇改。 ");
        } else {
          pushToast("error", "Custom editor did not open", message, "自訂編輯器開唔到", message);
        }
      } finally {
        state.busy.delete("choose-custom-editor");
        render();
      }
      break;
    }
    case "open-editor":
      await withBusy("open-editor", async () => { await api.openExternalEditor(); pushToast("success", "Editor launched", "The configured editor accepted the project path.", "編輯器已啟動", "已設定編輯器接受咗專案路徑。 "); });
      break;
    case "reset-appearance":
      savePreferencesPatch(DEFAULT_APPEARANCE);
      pushToast("success", "Appearance reset", "Theme, density, accent, font, scale, and weight returned to their defaults.", "外觀已重設", "主題、密度、重點色、字款、比例同粗幼已還原預設。 ");
      render();
      break;
    case "reset-tabs": state.tabPreferences = defaultTabs(); state.activeTab = "mail"; persistTabs(); render(); break;
    case "toggle-notification-read": {
      const item = state.bootstrap?.notifications.find(notification => notification.id === button.dataset.notificationId);
      if (item) await withBusy(`notification-${item.id}`, async () => { await api.markNotificationRead(item.id, !item.read); item.read = !item.read; });
      break;
    }
    case "request-clear-notifications": showConfirmation({ kind: "clear-notifications" }); break;
    case "toggle-history-calendar":
      if (state.historyCalendar.open) closeHistoryCalendar(); else openHistoryCalendar();
      break;
    case "close-history-calendar": closeHistoryCalendar(); break;
    case "shift-history-calendar": {
      const delta = Number(button.dataset.monthDelta);
      if (delta === -1 || delta === 1) {
        setHistoryCalendarMonth(shiftChangelogMonth(state.historyCalendar.visibleMonth, delta));
        render();
      }
      break;
    }
    case "history-date-preset": {
      const preset = button.dataset.historyDatePreset;
      if (preset === "all" || preset === "last-7-days" || preset === "last-30-days" || preset === "this-month" || preset === "this-year") {
        const inputs = changelogDateRangeForPreset(preset);
        saveHistoryDates(inputs);
        const focusDate = inputs.to || inputs.from || localIsoDate();
        state.historyCalendar.visibleMonth = focusDate.slice(0, 7);
        state.historyCalendar.focusDate = focusDate;
        state.historyCalendar.selecting = "start";
        render();
      }
      break;
    }
    case "select-history-date": {
      const isoDate = button.dataset.historyCalendarDay;
      if (!isoDate) break;
      if (state.historyCalendar.selecting === "start") {
        saveHistoryDates({ from: isoDate, to: "" });
        state.historyCalendar.selecting = "end";
      } else {
        const from = validateDateRange(state.filters.historyFrom, "", historyDateLocale()).from.isoDate;
        saveHistoryDates(!from || isoDate >= from ? { from: from ?? isoDate, to: isoDate } : { from: isoDate, to: from });
        state.historyCalendar.selecting = "start";
      }
      state.historyCalendar.focusDate = isoDate;
      state.historyCalendar.visibleMonth = isoDate.slice(0, 7);
      render();
      break;
    }
    case "clear-history-dates":
      saveHistoryDates({ from: "", to: "" });
      state.historyCalendar.selecting = "start";
      render();
      break;
    case "toggle-changelog-calendar":
      if (state.changelogCalendar.open) closeChangelogCalendar(); else openChangelogCalendar();
      break;
    case "close-changelog-calendar": closeChangelogCalendar(); break;
    case "shift-changelog-calendar": {
      const delta = Number(button.dataset.monthDelta);
      if (delta === -1 || delta === 1) {
        setChangelogCalendarMonth(shiftChangelogMonth(state.changelogCalendar.visibleMonth, delta));
        render();
      }
      break;
    }
    case "changelog-date-preset": {
      const preset = button.dataset.changelogDatePreset;
      if (preset === "all" || preset === "last-30-days" || preset === "this-month" || preset === "this-year") {
        const inputs = changelogDateRangeForPreset(preset);
        saveChangelogDates(inputs);
        const focusDate = inputs.to || inputs.from || localIsoDate();
        state.changelogCalendar.visibleMonth = focusDate.slice(0, 7);
        state.changelogCalendar.focusDate = focusDate;
        state.changelogCalendar.selecting = "start";
        render();
      }
      break;
    }
    case "select-changelog-date": {
      const isoDate = button.dataset.changelogCalendarDay;
      if (!isoDate) break;
      if (state.changelogCalendar.selecting === "start") {
        saveChangelogDates({ from: isoDate, to: "" });
        state.changelogCalendar.selecting = "end";
      } else {
        const from = validateDateRange(state.changelogDates.from, "", changelogDateLocale()).from.isoDate;
        saveChangelogDates(!from || isoDate >= from ? { from: from ?? isoDate, to: isoDate } : { from: isoDate, to: from });
        state.changelogCalendar.selecting = "start";
      }
      state.changelogCalendar.focusDate = isoDate;
      state.changelogCalendar.visibleMonth = isoDate.slice(0, 7);
      render();
      break;
    }
    case "clear-changelog-dates":
      saveChangelogDates({ from: "", to: "" });
      state.changelogCalendar.selecting = "start";
      render();
      break;
    case "export-history": await exportHistory(); break;
    case "copy-changelog": await copyChangelog(); break;
    case "export-changelog": await exportChangelog(); break;
    case "export-settings": await exportSettings(); break;
    case "restore-history": {
      const id = button.dataset.historyId;
      if (id) await withBusy("restore-history", async () => { await api.restoreHistory(id); await refreshMetadata(); pushToast("success", "Settings revision restored", "The restore was appended as a new revision.", "設定修訂已還原", "還原已新增做一個新修訂。 "); });
      break;
    }
    case "toggle-local-revision-diff": if (button.dataset.revisionHash) await toggleLocalRevisionDiff(button.dataset.revisionHash); break;
    case "save-local-revision-label": if (button.dataset.revisionHash) await saveLocalRevisionLabel(button, button.dataset.revisionHash); break;
    case "preview-local-history-prune": await previewLocalHistoryPrune(); break;
    case "inspect-local-history-deletion": await inspectLocalHistoryDeletion(); break;
    case "export-local-history-deletion-evidence": await exportLocalHistoryDeletionEvidence(); break;
    case "request-prune-local-history": {
      const preview = state.localHistoryPrunePreview;
      if (preview?.canPrune && preview.headHash) showConfirmation({ kind: "prune-local-history", preview }, "prune-local-history");
      break;
    }
    case "request-restore-local": if (button.dataset.revisionHash) showConfirmation({ kind: "restore-local", hash: button.dataset.revisionHash, label: button.dataset.revisionLabel ?? button.dataset.revisionHash }); break;
    case "dismiss-dim-sum": state.dimSumVisible = false; render(); break;
    case "request-bulk-close": {
      const ids = bulkClosePreview(); if (ids.length) showConfirmation({ kind: "bulk-close-tabs", tabIds: ids, inverse: state.bulkInverse }); break;
    }
    case "close-tab": if (pageId) closeTab(pageId); break;
    case "reopen-tab": if (pageId) activateTab(pageId); break;
    case "toggle-tab-pin": if (pageId) { state.tabPreferences.pinned = state.tabPreferences.pinned.includes(pageId) ? state.tabPreferences.pinned.filter(id => id !== pageId) : [...state.tabPreferences.pinned, pageId]; state.contextMenu = null; persistTabs(); render(); } break;
    case "move-tab-left": if (pageId) moveTabBy(pageId, -1); break;
    case "move-tab-right": if (pageId) moveTabBy(pageId, 1); break;
    case "open-tab-appearance": if (pageId) openTabAppearanceEditor(pageId); break;
    case "close-tab-appearance": closeTabAppearanceEditor(); break;
    case "reset-tab-style-property": {
      const key = button.dataset.tabStyleKey;
      if (!pageId || !isTabStyleKey(key)) break;
      const next = resetTabStyleProperty(state.tabPreferences.styles[pageId], key);
      if (next) state.tabPreferences.styles[pageId] = next;
      else delete state.tabPreferences.styles[pageId];
      persistTabs();
      announce(tx(`${key} now inherits the workspace tab style.`, `${key} 而家繼承工作空間分頁樣式。`));
      render();
      break;
    }
    case "reset-tab-appearance": if (pageId) { delete state.tabPreferences.styles[pageId]; persistTabs(); appearanceEditorNeedsInitialFocus = true; announce(tx("All tab appearance overrides were removed.", "所有分頁外觀覆寫都已移除。")); render(); } break;
    case "select-group-result": if (button.dataset.group === "workspace" || button.dataset.group === "records" || button.dataset.group === "system") { state.selectedTabGroup = button.dataset.group; render(); } break;
    case "choose-attachments": await chooseComposeAttachments(); break;
    case "remove-compose-attachment": captureComposer(); if (state.compose) { state.compose.draft.attachments.splice(Number(button.dataset.attachmentIndex), 1); render(); } break;
    case "toggle-compose-copies": captureComposer(); if (state.compose) { state.compose.showCopies = !state.compose.showCopies; render(); } break;
    case "minimize-compose": captureComposer(); if (state.compose) { state.compose.minimized = !state.compose.minimized; render(); } break;
    case "request-close-compose": captureComposer(); if (composerIsDirty()) showConfirmation({ kind: "discard-compose" }); else { state.compose = null; render(); } break;
    case "cancel-confirmation": cancelConfirmation(); break;
    case "confirm-action": await handleConfirmation(); break;
  }
};

app.addEventListener("click", event => {
  const button = (event.target as Element).closest<HTMLElement>("[data-action]");
  if (button) { event.preventDefault(); void handleAction(button); return; }
  if (state.historyCalendar.open && !(event.target as Element).closest(".changelog-calendar-anchor")) {
    state.historyCalendar.open = false;
    render();
    return;
  }
  if (state.changelogCalendar.open && !(event.target as Element).closest(".changelog-calendar-anchor")) {
    state.changelogCalendar.open = false;
    render();
    return;
  }
  if (state.contextMenu && !(event.target as Element).closest(".context-menu")) { state.contextMenu = null; render(); }
});

app.addEventListener("focusin", event => {
  const target = event.target;
  if (!(target instanceof HTMLElement) || !target.closest('[data-testid="pim-editor"]')) return;
  state.pimEditorLastFocusKey = target.dataset.focusKey ?? null;
  state.pimEditorLastFocusName = target.getAttribute("name");
});

toastRegion.addEventListener("click", event => {
  const button = (event.target as Element).closest<HTMLElement>("[data-dismiss-toast]");
  if (button?.dataset.dismissToast) dismissToast(button.dataset.dismissToast);
});

const updateTabStyleControl = (control: HTMLInputElement): boolean => {
  const editor = state.appearanceEditor;
  const key = control.dataset.tabStyle;
  if (!editor || !isTabStyleKey(key)) return false;
  if ((key === "background" || key === "foreground") && normalizeTabColor(control.value) === undefined) {
    control.setAttribute("aria-invalid", "true");
    pushToast("warning", "Tab color was not saved", "Enter a local HEX color as #RRGGBB or #RRGGBBAA.", "分頁顏色未儲存", "請輸入本機 HEX 顏色，格式係 #RRGGBB 或 #RRGGBBAA。 ");
    return false;
  }
  const style = setTabStyleProperty(state.tabPreferences.styles[editor.tabId], key, control.value);
  state.tabPreferences.styles[editor.tabId] = style;
  persistTabs();
  return true;
};

const handleControlChange = async (control: HTMLInputElement | HTMLSelectElement): Promise<void> => {
  if (control.closest('[data-testid="pim-editor"]') && control.name) updatePimEditorDirty();
  const providerForm = control.closest<HTMLFormElement>('[data-form="pim-provider-foundation"]');
  if (providerForm) {
    const kindControl = providerForm.elements.namedItem("kind");
    const authControl = providerForm.elements.namedItem("authMode");
    const endpointControl = providerForm.elements.namedItem("endpointUrl");
    const kind = kindControl instanceof HTMLSelectElement && (kindControl.value === "carddav" || kindControl.value === "caldav" || kindControl.value === "ics-file")
      ? kindControl.value
      : state.pimProviderProfile.kind;
    const authMode = kind === "ics-file"
      ? "none"
      : authControl instanceof HTMLSelectElement && (authControl.value === "none" || authControl.value === "basic" || authControl.value === "oauth2")
        ? authControl.value
        : state.pimProviderProfile.authMode;
    state.pimProviderProfile = {
      kind,
      authMode,
      endpointUrl: endpointControl instanceof HTMLInputElement ? endpointControl.value : state.pimProviderProfile.endpointUrl,
    };
    state.pimProviderSnapshot = null;
    if (control.name === "kind") render();
    return;
  }
  const accountSetupForm = control.closest<HTMLFormElement>('[data-form="account-setup"]');
  if (accountSetupForm && CONNECTION_PREFLIGHT_FIELD_NAMES.has(control.name)) updateConnectionPreflight(accountSetupForm);
  if (accountSetupForm && control.name === "incomingProtocol") {
    syncIncomingProtocolMode(accountSetupForm);
    return;
  }
  if (accountSetupForm && control.name === "authMode") {
    syncAccountAuthenticationMode(accountSetupForm);
    if (control.value === "oauth2") await refreshOAuthAuthorizationStatus().catch(() => undefined);
    return;
  }
  const changeAction = control.dataset.actionChange;
  if (changeAction === "select-oauth-provider" && (control.value === "google" || control.value === "microsoft")) {
    state.oauthProvider = control.value;
    updateOAuthAuthorizationPanel();
    return;
  }
  if (changeAction === "switch-account" && control.value) { await loadAccount(control.value, false); return; }
  if (changeAction === "move-message" && control.value) {
    const destination = state.folders.find(folder => folder.path === control.value);
    if (destination) await moveSelectedMessage(destination);
    return;
  }
  if (changeAction === "select-tab-group" && (control.value === "workspace" || control.value === "records" || control.value === "system")) {
    state.selectedTabGroup = control.value; render(); return;
  }
  if (control.dataset.pref) {
    const patch = preferencePatchFromControl(control);
    if (patch) {
      state.localHistoryDeletionEvidence = null;
      state.localHistoryDeletionError = "";
      if (control.dataset.pref === "historyRetentionDays") {
        state.localHistoryPrunePreview = null;
        state.localHistoryPruneError = "";
      }
      savePreferencesPatch(patch);
      render();
    }
    return;
  }
  if (control.dataset.discoveryIndex !== undefined) {
    state.selectedDiscovery = state.discoveries[Number(control.dataset.discoveryIndex)] ?? null;
    render(); return;
  }
  if (control.dataset.regexFlag) {
    if (!(control instanceof HTMLInputElement)) return;
    const model = searchFor(control.dataset.regexFlag);
    const flag = control.value;
    model.flags = control.checked ? `${model.flags}${flag}` : model.flags.replaceAll(flag, "");
    if (control.dataset.regexFlag === "mail") scheduleMailSearch(0);
    render(); return;
  }
  if (control.dataset.icsDuplicatePolicy !== undefined && (control.value === "skip" || control.value === "update")) {
    state.icsDuplicatePolicy = control.value;
    render();
    return;
  }
  if (control.dataset.icsSelect && control.dataset.pimUid && control instanceof HTMLInputElement) {
    const selected = control.dataset.icsSelect === "calendar-event" ? state.selectedCalendarEventUids : state.selectedTaskUids;
    if (control.checked) selected.add(control.dataset.pimUid); else selected.delete(control.dataset.pimUid);
    render();
    return;
  }
  if (control.dataset.pimMemberUid && control instanceof HTMLInputElement) {
    const selected = state.pimDraftMemberUids ?? new Set<string>();
    if (control.checked) selected.add(control.dataset.pimMemberUid); else selected.delete(control.dataset.pimMemberUid);
    state.pimDraftMemberUids = selected;
    return;
  }
  if (control.dataset.pimFilterAction && control instanceof HTMLInputElement) {
    const action = control.dataset.pimFilterAction as PimTransaction["action"];
    if (control.checked) state.pimFilters.actions.add(action); else state.pimFilters.actions.delete(action);
    await reloadPimHistory(); return;
  }
  if (control.dataset.pimFilterKind && control instanceof HTMLInputElement) {
    const kind = control.dataset.pimFilterKind as PimEntityKind;
    if (control.checked) state.pimFilters.kinds.add(kind); else state.pimFilters.kinds.delete(kind);
    await reloadPimHistory(); return;
  }
  if (control.dataset.pimFilterDate) {
    if (control.dataset.pimFilterDate === "from") state.pimFilters.from = control.value;
    else state.pimFilters.to = control.value;
    await reloadPimHistory(); return;
  }
  if (control.dataset.historyDate) {
    if (control.dataset.historyDate === "from") saveHistoryDates({ from: control.value.slice(0, CHANGELOG_DATE_INPUT_LIMIT), to: state.filters.historyTo });
    else saveHistoryDates({ from: state.filters.historyFrom, to: control.value.slice(0, CHANGELOG_DATE_INPUT_LIMIT) });
    render(); return;
  }
  if (control.dataset.historyCalendarMonth !== undefined || control.dataset.historyCalendarYear !== undefined) {
    const picker = control.closest<HTMLElement>(".changelog-calendar");
    const monthControl = picker?.querySelector<HTMLSelectElement>("[data-history-calendar-month]");
    const yearControl = picker?.querySelector<HTMLInputElement>("[data-history-calendar-year]");
    const month = Number(monthControl?.value);
    const year = Number(yearControl?.value);
    if (Number.isInteger(month) && month >= 1 && month <= 12 && Number.isInteger(year) && year >= 1900 && year <= 9999) {
      setHistoryCalendarMonth(`${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`);
      render();
    }
    return;
  }
  if (control.dataset.changelogCalendarMonth !== undefined || control.dataset.changelogCalendarYear !== undefined) {
    const picker = control.closest<HTMLElement>(".changelog-calendar");
    const monthControl = picker?.querySelector<HTMLSelectElement>("[data-changelog-calendar-month]");
    const yearControl = picker?.querySelector<HTMLInputElement>("[data-changelog-calendar-year]");
    const month = Number(monthControl?.value);
    const year = Number(yearControl?.value);
    if (Number.isInteger(month) && month >= 1 && month <= 12 && Number.isInteger(year) && year >= 1900 && year <= 9999) {
      setChangelogCalendarMonth(`${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`);
      render();
    }
    return;
  }
  if (control.dataset.historyAction) {
    if (!(control instanceof HTMLInputElement)) return;
    const action = control.dataset.historyAction as HistoryRecord["kind"];
    if (control.checked) state.filters.historyActions.add(action); else state.filters.historyActions.delete(action);
    render(); return;
  }
  if (control.dataset.bulkOption === "inverse" && control instanceof HTMLInputElement) { state.bulkInverse = control.checked; render(); return; }
  if (control.dataset.bulkOption === "pinned" && control instanceof HTMLInputElement) { state.bulkIncludePinned = control.checked; render(); return; }
  if (control instanceof HTMLInputElement && control.dataset.tabStyle && updateTabStyleControl(control)) render();
};

app.addEventListener("change", event => {
  const control = event.target;
  if (control instanceof HTMLInputElement || control instanceof HTMLSelectElement) void handleControlChange(control);
});

app.addEventListener("input", event => {
  const control = event.target;
  if (!(control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement)) return;
  const accountSetupForm = control.closest<HTMLFormElement>('[data-form="account-setup"]');
  if (accountSetupForm && CONNECTION_PREFLIGHT_FIELD_NAMES.has(control.name)) updateConnectionPreflight(accountSetupForm);
  if (control.closest('[data-testid="pim-editor"]') && control.name) {
    state.pimEditorLastFocusKey = control.dataset.focusKey ?? state.pimEditorLastFocusKey;
    state.pimEditorLastFocusName = control.name;
    updatePimEditorDirty();
  }
  const searchKey = control.dataset.searchKey;
  if (searchKey) {
    searchFor(searchKey).pattern = control.value;
    if (searchKey === "contacts") scheduleContactSearch();
    if (searchKey === "mail") scheduleMailSearch();
    render(); return;
  }
  const patternKey = control.dataset.regexPattern;
  if (patternKey) {
    searchFor(patternKey).pattern = control.value;
    if (patternKey === "contacts") scheduleContactSearch();
    if (patternKey === "mail") scheduleMailSearch();
    render(); return;
  }
  const sampleKey = control.dataset.regexSample;
  if (sampleKey) { searchFor(sampleKey).sample = control.value; render(); return; }
  const historyDate = control.dataset.historyDate;
  if (historyDate === "from" || historyDate === "to") {
    saveHistoryDates({
      from: historyDate === "from" ? control.value.slice(0, CHANGELOG_DATE_INPUT_LIMIT) : state.filters.historyFrom,
      to: historyDate === "to" ? control.value.slice(0, CHANGELOG_DATE_INPUT_LIMIT) : state.filters.historyTo,
    });
    render(); return;
  }
  const changelogDate = control.dataset.changelogDate;
  if (changelogDate === "from" || changelogDate === "to") {
    state.changelogDates[changelogDate] = control.value.slice(0, CHANGELOG_DATE_INPUT_LIMIT);
    persistChangelogDateInputs(sessionStorage, state.changelogDates);
    render(); return;
  }
  if (control.name === "percentComplete" && control instanceof HTMLInputElement) {
    const output = control.closest("label")?.querySelector<HTMLOutputElement>("output");
    if (output) output.value = `${control.value}%`;
    return;
  }
  if (control.dataset.composeField) { captureComposer(); return; }
  if (control.dataset.pref && control instanceof HTMLInputElement) {
    const patch = preferencePatchFromControl(control);
    if (patch && state.bootstrap) {
      state.bootstrap.preferences = { ...state.bootstrap.preferences, ...patch };
      applyPreferences();
      const output = document.querySelector<HTMLOutputElement>(`[data-pref-output="${CSS.escape(control.dataset.pref)}"]`);
      if (output) output.value = control.dataset.pref === "fontScale" ? `${Math.round(Number(control.value) * 100)}%` : control.value;
    }
    return;
  }
  if (control.dataset.tabStyle && control instanceof HTMLInputElement && (control.type === "color" || control.type === "range") && updateTabStyleControl(control)) render();
});

app.addEventListener("submit", event => {
  event.preventDefault();
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  const submitter = (event as SubmitEvent).submitter as HTMLElement | null;
  if (form.dataset.form === "pim-provider-foundation") {
    void runPimProviderFoundationFromSettings(form);
    return;
  }
  if (form.dataset.form === "account-setup") {
    const mode = submitter?.dataset.accountSubmit;
    if (mode === "test" || mode === "add") void handleAccountSubmit(form, mode);
    return;
  }
  if (form.dataset.form === "compose") {
    const mode = submitter?.dataset.composeSubmit;
    if (mode === "send") void sendComposer();
    else if (mode === "draft") void saveComposerDraft();
    return;
  }
  if (form.dataset.form === "pim-contact") { void saveContactForm(form); return; }
  if (form.dataset.form === "pim-mailing-list") { void saveMailingListForm(form); return; }
  if (form.dataset.form === "pim-calendar-event") { void saveCalendarEventForm(form); return; }
  if (form.dataset.form === "pim-task") { void saveTaskForm(form); }
});

app.addEventListener("contextmenu", event => {
  const tab = (event.target as Element).closest<HTMLElement>("[data-tab-context]");
  if (!tab) return;
  event.preventDefault();
  const id = tab.dataset.tabContext as PageId;
  if (!ALL_TAB_IDS.includes(id)) return;
  if (event.shiftKey) {
    openTabAppearanceEditor(id, tab);
    return;
  } else {
    state.contextMenu = { tabId: id, x: event.clientX, y: event.clientY };
    state.appearanceEditor = null;
    tabContextNeedsInitialFocus = true;
  }
  render();
});

app.addEventListener("dragstart", event => {
  const tab = (event.target as Element).closest<HTMLElement>("[data-drag-tab]");
  const id = tab?.dataset.dragTab as PageId | undefined;
  if (!id || !ALL_TAB_IDS.includes(id)) return;
  draggedTab = id;
  event.dataTransfer?.setData("text/plain", id);
  if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
});

app.addEventListener("dragover", event => {
  if ((event.target as Element).closest("[data-drag-tab]")) event.preventDefault();
});

app.addEventListener("drop", event => {
  const target = (event.target as Element).closest<HTMLElement>("[data-drag-tab]");
  const targetId = target?.dataset.dragTab as PageId | undefined;
  const sourceId = draggedTab;
  draggedTab = null;
  if (!sourceId || !targetId || sourceId === targetId) return;
  event.preventDefault();
  const order = state.tabPreferences.order;
  const from = order.indexOf(sourceId);
  const to = order.indexOf(targetId);
  if (from < 0 || to < 0) return;
  order.splice(from, 1);
  order.splice(to, 0, sourceId);
  persistTabs();
  render();
});

const openTabContextFromKeyboard = (tab: HTMLElement, id: PageId): void => {
  const rect = tab.getBoundingClientRect();
  state.contextMenu = { tabId: id, x: rect.left, y: rect.bottom + 4 };
  state.appearanceEditor = null;
  tabContextNeedsInitialFocus = true;
  render();
};

document.addEventListener("keydown", event => {
  const target = event.target;
  const editable = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
  if (state.confirmation) {
    if (event.key === "Escape") {
      event.preventDefault();
      cancelConfirmation();
      return;
    }
    if (event.key === "Tab") {
      const dialog = app.querySelector<HTMLElement>(".confirmation-dialog");
      const controls = dialog ? [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')] : [];
      if (controls.length) {
        event.preventDefault();
        const current = controls.indexOf(document.activeElement as HTMLElement);
        const next = event.shiftKey
          ? controls[(current <= 0 ? controls.length : current) - 1]
          : controls[(current + 1) % controls.length];
        next?.focus();
      }
      return;
    }
    return;
  }
  const historyCalendarDay = target instanceof HTMLElement ? target.closest<HTMLElement>("[data-history-calendar-day]") : null;
  if (state.historyCalendar.open && historyCalendarDay) {
    const isoDate = historyCalendarDay.dataset.historyCalendarDay;
    if (isoDate && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(event.key)) {
      event.preventDefault();
      if (event.key === "ArrowLeft") moveHistoryCalendarFocus(-1);
      else if (event.key === "ArrowRight") moveHistoryCalendarFocus(1);
      else if (event.key === "ArrowUp") moveHistoryCalendarFocus(-7);
      else if (event.key === "ArrowDown") moveHistoryCalendarFocus(7);
      else if (event.key === "Home" || event.key === "End") {
        const weekday = new Date(`${isoDate}T00:00:00Z`).getUTCDay();
        moveHistoryCalendarFocus(event.key === "Home" ? -weekday : 6 - weekday);
      } else {
        const delta = event.key === "PageUp" ? (event.ctrlKey ? -12 : -1) : event.ctrlKey ? 12 : 1;
        setHistoryCalendarMonth(shiftChangelogMonth(state.historyCalendar.visibleMonth, delta));
        pendingFocusKey = `history-calendar-day-${state.historyCalendar.focusDate}`;
        render();
      }
      return;
    }
  }
  const calendarDay = target instanceof HTMLElement ? target.closest<HTMLElement>("[data-changelog-calendar-day]") : null;
  if (state.changelogCalendar.open && calendarDay) {
    const isoDate = calendarDay.dataset.changelogCalendarDay;
    if (isoDate && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(event.key)) {
      event.preventDefault();
      if (event.key === "ArrowLeft") moveChangelogCalendarFocus(-1);
      else if (event.key === "ArrowRight") moveChangelogCalendarFocus(1);
      else if (event.key === "ArrowUp") moveChangelogCalendarFocus(-7);
      else if (event.key === "ArrowDown") moveChangelogCalendarFocus(7);
      else if (event.key === "Home" || event.key === "End") {
        const weekday = new Date(`${isoDate}T00:00:00Z`).getUTCDay();
        moveChangelogCalendarFocus(event.key === "Home" ? -weekday : 6 - weekday);
      } else {
        const delta = event.key === "PageUp" ? (event.ctrlKey ? -12 : -1) : event.ctrlKey ? 12 : 1;
        setChangelogCalendarMonth(shiftChangelogMonth(state.changelogCalendar.visibleMonth, delta));
        pendingFocusKey = `changelog-calendar-day-${state.changelogCalendar.focusDate}`;
        render();
      }
      return;
    }
  }
  if (event.ctrlKey && event.key.toLowerCase() === "k") {
    event.preventDefault(); state.commandPaletteOpen = true; resetCommandPaletteSearch(); render(); requestAnimationFrame(() => document.querySelector<HTMLInputElement>('[data-focus-key="search-commands"]')?.focus()); return;
  }
  if (event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === "n") { event.preventDefault(); openComposer(); return; }
  if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "s") { event.preventDefault(); void syncCurrentAccount(); return; }
  if (event.altKey && event.key.toLowerCase() === "r") {
    event.preventDefault(); const key = state.activeTab === "settings" ? "settings" : state.activeTab === "history" ? "history" : state.activeTab === "notifications" ? "notifications" : state.activeTab === "changelog" ? "changelog" : "mail"; const model = searchFor(key); model.builderOpen = true; if (!model.sample) model.sample = sampleForSearch(key); render(); return;
  }
  if (event.altKey && event.key.toLowerCase() === "e") { event.preventDefault(); void api.openExternalEditor().catch(error => pushToast("error", "Editor did not open", errorMessage(error), "編輯器開唔到", errorMessage(error))); return; }
  if (event.altKey && /^[1-9]$/.test(event.key)) { const id = state.tabPreferences.order[Number(event.key) - 1]; if (id) { event.preventDefault(); activateTab(id); } return; }
  if (event.ctrlKey && event.key === "Enter" && state.compose) {
    event.preventDefault(); document.querySelector<HTMLButtonElement>('[data-compose-submit="send"]')?.click(); return;
  }
  if (event.key === "Escape") {
    if (state.commandPaletteOpen && searchFor("commands").builderOpen) {
      searchFor("commands").builderOpen = false;
      pendingFocusKey = "search-commands";
    }
    else if (state.commandPaletteOpen) state.commandPaletteOpen = false;
    else if (state.historyCalendar.open) { event.preventDefault(); closeHistoryCalendar(); return; }
    else if (state.changelogCalendar.open) { event.preventDefault(); closeChangelogCalendar(); return; }
    else if (state.pimEditor) { event.preventDefault(); requestPimEditorClose(); return; }
    else if (state.appearanceEditor) { event.preventDefault(); closeTabAppearanceEditor(); return; }
    else if (state.contextMenu) { event.preventDefault(); closeTabContextMenu(); return; }
    else if (state.tabManagerOpen) state.tabManagerOpen = false;
    else {
      const openBuilder = Object.values(state.searches).find(model => model.builderOpen);
      if (openBuilder) openBuilder.builderOpen = false;
      else return;
    }
    event.preventDefault(); render(); return;
  }
  const tabButton = target instanceof HTMLElement ? target.closest<HTMLElement>('[role="tab"][data-tab-id]') : null;
  if (tabButton && event.ctrlKey && event.shiftKey && !event.altKey && event.key.toLowerCase() === "e") {
    event.preventDefault();
    const id = tabButton.dataset.tabId as PageId;
    if (ALL_TAB_IDS.includes(id)) openTabAppearanceEditor(id, tabButton.closest<HTMLElement>("[data-tab-context]"));
    return;
  }
  if (tabButton && (event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === "Home" || event.key === "End")) {
    event.preventDefault();
    const visible = visibleTabIds(); const current = visible.indexOf(tabButton.dataset.tabId as PageId);
    const index = event.key === "Home" ? 0 : event.key === "End" ? visible.length - 1 : (current + (event.key === "ArrowRight" ? 1 : -1) + visible.length) % visible.length;
    const id = visible[index]; if (id) activateTab(id, "tab"); return;
  }
  if (tabButton && (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10"))) {
    event.preventDefault(); const id = tabButton.dataset.tabId as PageId; if (ALL_TAB_IDS.includes(id)) openTabContextFromKeyboard(tabButton, id); return;
  }
  const menuItem = target instanceof HTMLElement ? target.closest<HTMLElement>(".context-menu [role='menuitem']") : null;
  if (menuItem && (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End")) {
    const items = [...app.querySelectorAll<HTMLElement>(".context-menu [role='menuitem']:not([disabled])")];
    if (!items.length) return;
    event.preventDefault();
    const current = items.indexOf(menuItem);
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? items.length - 1
        : (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items[nextIndex]?.focus();
    return;
  }
  const contactsTab = target instanceof HTMLElement ? target.closest<HTMLElement>('[role="tab"][data-contacts-view]') : null;
  if (contactsTab && (event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === "Home" || event.key === "End")) {
    event.preventDefault();
    const views: ContactsView[] = ["people", "lists", "activity"];
    const current = views.indexOf(contactsTab.dataset.contactsView as ContactsView);
    const index = event.key === "Home" ? 0 : event.key === "End" ? views.length - 1 : (current + (event.key === "ArrowRight" ? 1 : -1) + views.length) % views.length;
    const view = views[index];
    if (view) {
      state.contactsView = view;
      render();
      requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-contacts-view="${view}"]`)?.focus());
    }
    return;
  }
  const list = target instanceof HTMLElement ? target.closest<HTMLElement>(".message-list") : null;
  if (list && (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End")) {
    event.preventDefault();
    const messages = groupCachedConversations(filteredMessages()).conversations.flatMap(conversation => conversation.messages);
    const current = messages.findIndex(message => message.id === state.selectedMessageId);
    const index = event.key === "Home" ? 0 : event.key === "End" ? messages.length - 1 : Math.min(messages.length - 1, Math.max(0, current + (event.key === "ArrowDown" ? 1 : -1)));
    const message = messages[index]; if (message) void loadMessage(message); return;
  }
  if (!editable && event.key === "/" && state.activeTab === "mail") { event.preventDefault(); document.querySelector<HTMLInputElement>('[data-focus-key="search-mail"]')?.focus(); return; }
  if (state.commandPaletteOpen && event.key === "Enter" && target instanceof HTMLInputElement && target.dataset.searchKey === "commands") {
    const first = filterPaletteCommands(paletteCommands(), searchFor("commands"))[0];
    if (first) { event.preventDefault(); runPaletteCommand(first.id); }
  }
});

window.addEventListener("beforeunload", event => {
  captureComposer();
  updatePimEditorDirty();
  if (composerIsDirty() || state.pimEditorDirty) { event.preventDefault(); event.returnValue = ""; }
});
window.addEventListener("unload", () => disposeMailtoActivation?.());
window.addEventListener("unload", () => disposeExternalLinkReview?.());
window.addEventListener("unload", () => stopOAuthStatusPolling());

if (typeof api?.onMailto === "function") disposeMailtoActivation = api.onMailto(url => handleMailtoActivation(url));
if (typeof api?.onExternalLinkReview === "function") {
  disposeExternalLinkReview = api.onExternalLinkReview(request => {
    if (state.phase !== "ready" || state.confirmation) {
      void api.cancelExternalLink(request.requestId).catch(() => undefined);
      pushToast("warning", "Link review postponed", "Another review is already active, so this browser request was not opened.", "連結審閱延後", "另一個審閱已經進行緊，所以呢次瀏覽器要求冇開啟。 ");
      return;
    }
    showConfirmation({ kind: "external-link", request });
  });
}

const tabFocusKey = (id: PageId): string => `workspace-tab-${id}`;

const appearanceEditorPosition = (anchor: Element | null): Pick<AppearanceEditorState, "x" | "y"> => {
  const rect = anchor?.getBoundingClientRect() ?? { left: 12, bottom: 60 };
  return {
    x: Math.max(12, Math.min(window.innerWidth - 442, rect.left)),
    y: Math.max(60, Math.min(window.innerHeight - 520, rect.bottom + 8)),
  };
};

const openTabAppearanceEditor = (id: PageId, anchor?: Element | null): void => {
  const tab = anchor ?? app.querySelector<HTMLElement>(`[data-tab-context="${CSS.escape(id)}"]`);
  state.contextMenu = null;
  state.appearanceEditor = { tabId: id, ...appearanceEditorPosition(tab) };
  appearanceEditorNeedsInitialFocus = true;
  render();
};

const closeTabAppearanceEditor = (): void => {
  const tabId = state.appearanceEditor?.tabId;
  state.appearanceEditor = null;
  if (tabId) pendingFocusKey = tabFocusKey(tabId);
  render();
};

const closeTabContextMenu = (): void => {
  const tabId = state.contextMenu?.tabId;
  state.contextMenu = null;
  if (tabId) pendingFocusKey = tabFocusKey(tabId);
  render();
};

void initialize();
