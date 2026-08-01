import path from "node:path";
import { z } from "zod";
import {
  LOCAL_HISTORY_RETENTION_DAYS_DEFAULT,
  LOCAL_HISTORY_RETENTION_DAYS_MAX,
  LOCAL_HISTORY_RETENTION_DAYS_MIN,
  PIM_PROVIDER_ENDPOINT_LIMIT,
  POP3_MESSAGE_LIMIT_MAX,
  POP3_MESSAGE_LIMIT_MIN,
  type AccountDraft,
  type AttachmentSaveReview,
  type ComposeDraft,
  type CachedMailSearchQuery,
  type LocalHistoryPruneRequest,
  type ICalendarExportRequest,
  type PimProviderProfileInput,
  type Pop3AccountOptions,
  type Preferences,
  type TlsCertificateInspectionRequest,
} from "../shared/contracts.js";
import { OAUTH_PROVIDER_IDS } from "../shared/oauth.js";

const noControlCharacters = (value: string): boolean => !/[\u0000-\u001f\u007f]/u.test(value);
const noHeaderBreaks = (value: string): boolean => !/[\r\n\u0000]/u.test(value);

export const identifierSchema = z.string().trim().min(1).max(512).refine(noControlCharacters, "Control characters are not allowed.");
export const folderPathSchema = z.string().min(1).max(2_048).refine(noHeaderBreaks, "Folder paths cannot contain line breaks or NUL.");
export const messageUidSchema = z.number().int().min(1).max(0xffff_ffff);
export const attachmentIndexSchema = z.number().int().min(0).max(9_999);
export const quarantineIdSchema = z.uuid();
export const revisionHashSchema = z.string().regex(/^[a-f0-9]{7,40}$/iu);
export const fullRevisionHashSchema = z.string().regex(/^[a-f0-9]{40}$/iu);
export const historyRetentionDaysSchema = z.number().int().min(LOCAL_HISTORY_RETENTION_DAYS_MIN).max(LOCAL_HISTORY_RETENTION_DAYS_MAX);
export const revisionLabelSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .refine(noControlCharacters, "Revision labels cannot contain control characters.");
export const externalLinkRequestIdSchema = z.string().regex(/^[A-Za-z0-9_-]{32}$/u);
export const nativePathSchema = z
  .string()
  .min(1)
  .max(32_767)
  .refine(noControlCharacters, "File paths cannot contain control characters.")
  .refine(value => path.win32.isAbsolute(value), "An absolute Windows path is required.");

const emailSchema = z.email().max(320);
const hostSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine(noControlCharacters, "Host names cannot contain control characters.");
const usernameSchema = z
  .string()
  .trim()
  .min(1)
  .max(320)
  .refine(noControlCharacters, "User names cannot contain control characters.");
const serverSettingsSchema = z.strictObject({
  host: hostSchema,
  port: z.number().int().min(1).max(65_535),
  security: z.enum(["tls", "starttls", "plain"]),
  username: usernameSchema,
});

const tlsCertificateInspectionSchema = z.strictObject({
  endpoint: z.enum(["incoming", "outgoing"]),
  host: hostSchema,
  port: z.number().int().min(1).max(65_535),
  security: z.enum(["tls", "starttls", "plain"]),
}) as z.ZodType<TlsCertificateInspectionRequest>;

const accountDraftBaseShape = {
  displayName: z.string().trim().min(1).max(120).refine(noControlCharacters, "Display names cannot contain control characters."),
  email: emailSchema,
  incoming: serverSettingsSchema,
  outgoing: serverSettingsSchema,
  authMode: z.enum(["password", "oauth2"]),
  secret: z.string().min(1).max(16_384),
};

export const pop3AccountOptionsSchema = z.strictObject({
  transport: z.enum(["local-demo", "live-network"]),
  retrievalMode: z.literal("new-only"),
  leaveOnServer: z.literal(true),
  messageLimit: z.number().int().min(POP3_MESSAGE_LIMIT_MIN).max(POP3_MESSAGE_LIMIT_MAX),
}) as z.ZodType<Pop3AccountOptions>;

export const pimProviderProfileInputSchema = z.strictObject({
  kind: z.enum(["carddav", "caldav", "ics-file"]),
  endpointUrl: z.string().max(PIM_PROVIDER_ENDPOINT_LIMIT),
  authMode: z.enum(["none", "basic", "oauth2"]),
}) as z.ZodType<PimProviderProfileInput>;

const uniqueValues = <Value>(values: readonly Value[]): boolean => new Set(values).size === values.length;
const pimIcsUidSchema = identifierSchema.max(255);
export const iCalendarExportRequestSchema = z.discriminatedUnion("scope", [
  z.strictObject({
    scope: z.literal("all"),
    entityKinds: z.array(z.enum(["calendar-event", "task"])).min(1).max(2).refine(uniqueValues, "Record types must be unique."),
  }),
  z.strictObject({
    scope: z.literal("selected"),
    eventUids: z.array(pimIcsUidSchema).max(5_000).refine(uniqueValues, "Event UIDs must be unique."),
    taskUids: z.array(pimIcsUidSchema).max(5_000).refine(uniqueValues, "Task UIDs must be unique."),
  }).superRefine((value, context) => {
    const count = value.eventUids.length + value.taskUids.length;
    if (count < 1 || count > 5_000) context.addIssue({ code: "custom", message: "Select from 1 through 5000 records." });
  }),
]) as z.ZodType<ICalendarExportRequest>;

export const accountDraftSchema = z.union([
  z.strictObject({ ...accountDraftBaseShape, incomingProtocol: z.literal("imap").default("imap") }),
  z.strictObject({ ...accountDraftBaseShape, incomingProtocol: z.literal("pop3"), pop3: pop3AccountOptionsSchema }),
]) as z.ZodType<AccountDraft>;

const recipientSchema = z
  .string()
  .trim()
  .min(1)
  .max(998)
  .refine(noHeaderBreaks, "Recipient values cannot contain line breaks or NUL.");

export const composeDraftSchema = z.strictObject({
  id: identifierSchema.optional(),
  accountId: identifierSchema,
  to: z.array(recipientSchema).max(500),
  cc: z.array(recipientSchema).max(500),
  bcc: z.array(recipientSchema).max(500),
  subject: z.string().max(998).refine(noHeaderBreaks, "Subjects cannot contain line breaks or NUL."),
  text: z.string().max(8 * 1024 * 1024),
  inReplyTo: z.string().min(1).max(998).refine(noHeaderBreaks, "Message identifiers cannot contain line breaks or NUL.").optional(),
  references: z
    .array(z.string().min(1).max(998).refine(noHeaderBreaks, "References cannot contain line breaks or NUL."))
    .max(100)
    .optional(),
  attachments: z.array(nativePathSchema).max(100),
}) as z.ZodType<ComposeDraft>;

const preferencesObjectSchema = z.strictObject({
  language: z.enum(["en", "yue", "bilingual"]),
  funnyEnglish: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
  funnyCantonese: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
  theme: z.enum(["light", "dark", "system"]),
  density: z.enum(["compact", "comfortable", "relaxed"]),
  accent: z.string().regex(/^#[a-f0-9]{6}(?:[a-f0-9]{2})?$/iu),
  fontFamily: z.string().trim().min(1).max(256).refine(noControlCharacters, "Font names cannot contain control characters."),
  fontScale: z.number().finite().min(0.5).max(3),
  fontWeight: z.number().int().min(100).max(1_000),
  dimSumEnabled: z.boolean(),
  narratorEnabled: z.boolean(),
  narratorLanguage: z.enum(["en", "yue", "bilingual"]),
  nativeNotificationsEnabled: z.boolean().default(false),
  historyRetentionDays: historyRetentionDaysSchema.default(LOCAL_HISTORY_RETENTION_DAYS_DEFAULT),
  externalEditorPath: nativePathSchema.optional(),
  selectedAccountId: identifierSchema.optional(),
  selectedFolderPath: folderPathSchema.optional(),
});

export const preferencesSchema = preferencesObjectSchema as z.ZodType<Preferences>;
export const preferencesPatchSchema = preferencesObjectSchema.partial() as z.ZodType<Partial<Preferences>>;

type MessageFlagPatch = { unread?: boolean; starred?: boolean };

const flagPatchSchema = z
  .strictObject({ unread: z.boolean().optional(), starred: z.boolean().optional() })
  .refine(value => value.unread !== undefined || value.starred !== undefined, "At least one message flag is required.") as z.ZodType<MessageFlagPatch>;
const suggestedFilenameSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine(
    value =>
      value !== "." &&
      value !== ".." &&
      path.win32.basename(value) === value &&
      !/[<>:"/\\|?*\u0000-\u001f\u007f]/u.test(value),
    "A plain filename is required.",
  );

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
const attachmentRiskReviewItemSchema = z.strictObject({
  index: attachmentIndexSchema,
  filename: z.string().min(1).max(4_096).refine(noHeaderBreaks, "Attachment filenames cannot contain line breaks or NUL."),
  contentType: z.string().min(1).max(1_024).refine(noHeaderBreaks, "Attachment content types cannot contain line breaks or NUL."),
  level: z.enum(["caution", "dangerous"]),
  reasons: z.array(attachmentRiskReasonSchema).min(1).max(9),
});
const attachmentSaveReviewSchema = z.strictObject({
  riskyAttachments: z.array(attachmentRiskReviewItemSchema).min(1).max(100),
}) as z.ZodType<AttachmentSaveReview>;

const localHistoryPruneRequestSchema = z.strictObject({
  retentionDays: historyRetentionDaysSchema,
  cutoffAt: z.iso.datetime({ offset: true }),
  expectedHeadHash: fullRevisionHashSchema,
  expectedEligibleHashes: z
    .array(fullRevisionHashSchema)
    .min(1)
    .max(2_000)
    .refine(hashes => new Set(hashes).size === hashes.length, "Eligible revision identifiers must be unique."),
}) as z.ZodType<LocalHistoryPruneRequest>;

const cachedMailSearchSchema = z.strictObject({
  mode: z.enum(["plain", "regex"]),
  pattern: z.string().min(1).max(2_048),
  flags: z.string().max(4).regex(/^[imsu]*$/u),
  limit: z.number().int().min(1).max(200),
}) as z.ZodType<CachedMailSearchQuery>;

export const ipcPayloadSchemas = {
  none: z.tuple([]),
  accountDiscover: z.tuple([emailSchema]),
  oauthProvider: z.tuple([z.enum(OAUTH_PROVIDER_IDS)]),
  tlsCertificateInspection: z.tuple([tlsCertificateInspectionSchema]),
  pop3Foundation: z.tuple([pop3AccountOptionsSchema]),
  pimProviderFoundation: z.tuple([pimProviderProfileInputSchema]),
  pimIcsImport: z.tuple([z.enum(["skip", "update"])]),
  pimIcsExport: z.tuple([iCalendarExportRequestSchema]),
  accountDraft: z.tuple([accountDraftSchema]),
  accountId: z.tuple([identifierSchema]),
  accountFolder: z.tuple([identifierSchema, folderPathSchema]),
  unifiedFolder: z.tuple([z.enum(["inbox", "starred", "unread"])]),
  cachedMailSearch: z.tuple([cachedMailSearchSchema]),
  accountFolderMessage: z.tuple([identifierSchema, folderPathSchema, messageUidSchema]),
  remoteContentConsent: z.tuple([identifierSchema, folderPathSchema, messageUidSchema, z.boolean()]),
  saveAttachment: z.union([
    z.tuple([identifierSchema, folderPathSchema, messageUidSchema, attachmentIndexSchema]),
    z.tuple([identifierSchema, folderPathSchema, messageUidSchema, attachmentIndexSchema, attachmentSaveReviewSchema]),
  ]),
  saveAllAttachments: z.union([
    z.tuple([identifierSchema, folderPathSchema, messageUidSchema]),
    z.tuple([identifierSchema, folderPathSchema, messageUidSchema, attachmentSaveReviewSchema]),
  ]),
  quarantineItem: z.tuple([quarantineIdSchema]),
  messageFlags: z.tuple([identifierSchema, folderPathSchema, messageUidSchema, flagPatchSchema]),
  moveMessage: z.tuple([identifierSchema, folderPathSchema, messageUidSchema, folderPathSchema]),
  composeDraft: z.tuple([composeDraftSchema]),
  accountItem: z.tuple([identifierSchema, identifierSchema]),
  preferences: z.tuple([preferencesPatchSchema]),
  notificationRead: z.tuple([identifierSchema, z.boolean()]),
  nativeNotification: z.tuple([z.enum(["info", "success", "warning", "error"])]),
  historyId: z.tuple([identifierSchema]),
  revisionHash: z.tuple([revisionHashSchema]),
  revisionLabel: z.tuple([revisionHashSchema, revisionLabelSchema]),
  historyPrunePreview: z.tuple([historyRetentionDaysSchema]),
  historyPrune: z.tuple([localHistoryPruneRequestSchema]),
  exportData: z.tuple([z.enum(["history", "settings", "changelog"]), z.string().max(32 * 1024 * 1024), suggestedFilenameSchema]),
  editorOpen: z.union([z.tuple([]), z.tuple([z.undefined()]), z.tuple([nativePathSchema])]),
  externalLinkRequest: z.tuple([externalLinkRequestIdSchema]),
} as const;

export const parseIpcArgs = <Schema extends z.ZodType>(channel: string, schema: Schema, args: unknown[]): z.output<Schema> => {
  const result = schema.safeParse(args);
  if (result.success) return result.data;
  const details = result.error.issues
    .slice(0, 4)
    .map(issue => `${issue.path.length ? issue.path.join(".") : "payload"}: ${issue.message}`)
    .join("; ");
  throw new Error(`Invalid ${channel} IPC payload${details ? ` (${details})` : ""}.`);
};
