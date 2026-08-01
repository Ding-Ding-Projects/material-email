import { z } from "zod";
import type {
  AccountSummary,
  ComposeDraft,
  FolderSummary,
  HistoryRecord,
  MessageDetail,
  MessageSummary,
  NotificationRecord,
  Preferences,
  QuarantinedAttachment,
} from "../shared/contracts.js";
import {
  composeDraftSchema,
  folderPathSchema,
  identifierSchema,
  messageUidSchema,
  nativePathSchema,
  preferencesSchema,
} from "./ipc-validation.js";
import { classifyAttachment } from "../shared/attachment-safety.js";

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface StoredAccount extends AccountSummary {
  encryptedSecret?: string;
}

export interface PendingOperation {
  id: string;
  accountId: string;
  kind: "flags" | "move";
  folderPath: string;
  uid: number;
  uidValidity?: string;
  patch?: { unread?: boolean; starred?: boolean };
  destination?: string;
  createdAt: string;
  attempts: number;
  lastError: string;
}

export interface OutboxItem {
  id: string;
  draft: ComposeDraft;
  createdAt: string;
  attempts: number;
  lastError: string;
}

export interface PersistedState {
  schemaVersion: 1;
  accounts: StoredAccount[];
  preferences: Preferences;
  folders: Record<string, FolderSummary[]>;
  messages: Record<string, MessageSummary[]>;
  details: Record<string, MessageDetail>;
  drafts: ComposeDraft[];
  pendingOperations: PendingOperation[];
  outbox: OutboxItem[];
  notifications: NotificationRecord[];
  history: HistoryRecord[];
  quarantinedAttachments: QuarantinedAttachment[];
  approvedEditorPaths: string[];
}

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([z.null(), z.boolean(), z.number().finite(), z.string(), z.array(jsonValueSchema), z.record(z.string(), jsonValueSchema)]),
);
const timestampSchema = z
  .string()
  .min(1)
  .max(64)
  .refine(value => Number.isFinite(Date.parse(value)), "An ISO-compatible timestamp is required.");
const boundedString = (maximum: number) => z.string().max(maximum);
const addressSchema = z.strictObject({ name: boundedString(2_048), address: boundedString(2_048) });
const remoteContentOriginSchema = z
  .string()
  .min(1)
  .max(2_048)
  .refine(value => {
    try {
      const parsed = new URL(value);
      return (parsed.protocol === "http:" || parsed.protocol === "https:")
        && parsed.origin === value
        && !parsed.username
        && !parsed.password;
    } catch {
      return false;
    }
  }, "A plain HTTP(S) origin is required.");
const remoteContentSourceSchema = z
  .strictObject({
    kind: z.literal("image"),
    origin: remoteContentOriginSchema,
    hostname: z.string().min(1).max(253),
    protocol: z.enum(["http:", "https:"]),
  })
  .refine(source => {
    const parsed = new URL(source.origin);
    return source.hostname === parsed.hostname && source.protocol === parsed.protocol;
  }, "The remote-content summary must match its origin.");
const serverSettingsSchema = z.strictObject({
  host: z.string().min(1).max(255),
  port: z.number().int().min(1).max(65_535),
  security: z.enum(["tls", "starttls", "plain"]),
  username: z.string().min(1).max(320),
});
const accountSchema = z
  .strictObject({
    id: identifierSchema,
    displayName: z.string().min(1).max(120),
    email: z.email().max(320),
    incoming: serverSettingsSchema,
    outgoing: serverSettingsSchema,
    authMode: z.enum(["password", "oauth2"]),
    kind: z.enum(["imap", "demo"]),
    createdAt: timestampSchema,
    lastSyncAt: timestampSchema.optional(),
    syncError: boundedString(32_768).optional(),
    encryptedSecret: z.string().min(1).max(131_072).optional(),
  })
  .refine(account => account.kind === "demo" || Boolean(account.encryptedSecret), "Stored mail accounts require an encrypted credential.");
const folderSchema = z.strictObject({
  accountId: identifierSchema,
  path: folderPathSchema,
  name: z.string().min(1).max(2_048),
  role: z.enum(["inbox", "sent", "drafts", "archive", "junk", "trash", "other"]),
  unread: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  total: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  uidValidity: z.string().min(1).max(128).optional(),
});
const attachmentRiskReasonSchema = z.enum([
  "windows-executable",
  "windows-script",
  "windows-shortcut",
  "windows-installer",
  "macro-enabled-document",
  "double-extension",
  "trailing-dot-or-space",
  "bidirectional-control",
  "mime-extension-mismatch",
]);
const attachmentRiskSchema = z.strictObject({
  level: z.enum(["ordinary", "caution", "dangerous"]),
  reasons: z.array(attachmentRiskReasonSchema).max(9),
});
const quarantineRiskSchema = z.strictObject({
  level: z.enum(["caution", "dangerous"]),
  reasons: z.array(attachmentRiskReasonSchema).min(1).max(9),
});
const attachmentSummarySchema = z
  .strictObject({
    filename: z.string().min(1).max(4_096),
    contentType: z.string().min(1).max(1_024),
    size: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    risk: attachmentRiskSchema.optional(),
    contentId: z.string().max(4_096).optional(),
  })
  .transform(attachment => ({
    ...attachment,
    risk: classifyAttachment(attachment.filename, attachment.contentType),
  }));
const messageSummaryShape = {
  id: z.string().min(1).max(4_096),
  accountId: identifierSchema,
  folderPath: folderPathSchema,
  uid: messageUidSchema,
  uidValidity: z.string().min(1).max(128).optional(),
  messageId: z.string().max(4_096).optional(),
  inReplyTo: z.string().max(4_096).optional(),
  references: z.array(z.string().min(1).max(4_096)).max(100).optional(),
  from: z.array(addressSchema).max(1_000),
  to: z.array(addressSchema).max(1_000),
  cc: z.array(addressSchema).max(1_000),
  subject: boundedString(65_536),
  date: timestampSchema,
  preview: boundedString(4_096),
  unread: z.boolean(),
  starred: z.boolean(),
  hasAttachments: z.boolean(),
  size: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
};
const messageSummarySchema = z.strictObject(messageSummaryShape);
const messageDetailSchema = z.strictObject({
  ...messageSummaryShape,
  text: boundedString(16 * 1024 * 1024),
  html: boundedString(16 * 1024 * 1024),
  remoteContentHtml: boundedString(16 * 1024 * 1024).default(""),
  remoteContentSources: z.array(remoteContentSourceSchema).max(1_000).default([]),
  remoteContentAllowed: z.boolean().default(false),
  attachments: z.array(attachmentSummarySchema).max(1_000),
  replyTo: z.array(addressSchema).max(1_000),
});
const pendingOperationSchema = z
  .strictObject({
    id: identifierSchema,
    accountId: identifierSchema,
    kind: z.enum(["flags", "move"]),
    folderPath: folderPathSchema,
    uid: messageUidSchema,
    uidValidity: z.string().min(1).max(128).optional(),
    patch: z.strictObject({ unread: z.boolean().optional(), starred: z.boolean().optional() }).optional(),
    destination: folderPathSchema.optional(),
    createdAt: timestampSchema,
    attempts: z.number().int().nonnegative().max(1_000_000),
    lastError: boundedString(32_768),
  })
  .refine(
    operation =>
      (operation.kind === "flags" &&
        operation.patch !== undefined &&
        (operation.patch.unread !== undefined || operation.patch.starred !== undefined)) ||
      (operation.kind === "move" && operation.destination !== undefined),
    "Queued operations must contain the data required by their kind.",
  );
const outboxItemSchema = z.strictObject({
  id: identifierSchema,
  draft: composeDraftSchema,
  createdAt: timestampSchema,
  attempts: z.number().int().nonnegative().max(1_000_000),
  lastError: boundedString(32_768),
});
const notificationSchema = z.strictObject({
  id: identifierSchema,
  kind: z.enum(["info", "success", "warning", "error"]),
  title: boundedString(1_024),
  body: boundedString(32_768),
  createdAt: timestampSchema,
  read: z.boolean(),
  action: z.strictObject({ label: boundedString(1_024), command: boundedString(4_096) }).optional(),
});
const historyRecordSchema = z.strictObject({
  id: identifierSchema,
  kind: z.enum(["created", "updated", "deleted", "restored", "undone", "imported", "settings-changed", "pruned"]),
  entityType: z.enum(["account", "message", "draft", "contact", "calendar", "task", "settings", "history"]),
  entityId: z.string().max(4_096),
  label: boundedString(8_192),
  createdAt: timestampSchema,
  snapshot: jsonValueSchema,
});
const quarantinedAttachmentSchema = z.strictObject({
  id: z.uuid(),
  filename: z.string().min(1).max(4_096),
  contentType: z.string().min(1).max(1_024),
  size: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  risk: quarantineRiskSchema,
  quarantinedAt: timestampSchema,
  source: z.strictObject({
    accountId: identifierSchema,
    folderPath: folderPathSchema,
    uid: messageUidSchema,
    uidValidity: z.string().min(1).max(128),
    attachmentIndex: z.number().int().min(0).max(9_999),
    messageId: z.string().min(1).max(4_096).optional(),
  }),
});

const folderRecordSchema = z
  .record(z.string().max(512), z.array(folderSchema).max(10_000))
  .refine(value => Object.keys(value).length <= 100, "Too many account folder collections are stored.");
const messageRecordSchema = z
  .record(z.string().max(4_096), z.array(messageSummarySchema).max(10_000))
  .refine(value => Object.keys(value).length <= 10_000, "Too many message collections are stored.");
const detailRecordSchema = z
  .record(z.string().max(4_096), messageDetailSchema)
  .refine(value => Object.keys(value).length <= 50_000, "Too many message details are stored.");

export const persistedStateSchema = z.strictObject({
  schemaVersion: z.literal(1),
  accounts: z.array(accountSchema).max(100),
  preferences: preferencesSchema,
  folders: folderRecordSchema,
  messages: messageRecordSchema,
  details: detailRecordSchema,
  drafts: z.array(composeDraftSchema).max(1_000),
  pendingOperations: z.array(pendingOperationSchema).max(5_000),
  outbox: z.array(outboxItemSchema).max(1_000),
  notifications: z.array(notificationSchema).max(500),
  history: z.array(historyRecordSchema).max(2_000),
  quarantinedAttachments: z.array(quarantinedAttachmentSchema).max(1_000).default([]),
  approvedEditorPaths: z.array(nativePathSchema).max(100).default([]),
});

export const parsePersistedState = (value: unknown): PersistedState => persistedStateSchema.parse(value) as PersistedState;
