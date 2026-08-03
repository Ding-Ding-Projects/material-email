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
  type MessageFilterInput,
  type MessageTagPatch,
  type PimProviderProfileInput,
  type Pop3AccountOptions,
  type Preferences,
  type TlsCertificateInspectionRequest,
} from "../shared/contracts.js";
import { OAUTH_PROVIDER_IDS, type OAuthProviderId } from "../shared/oauth.js";
import { MESSAGE_TAGS_PER_MESSAGE_LIMIT, MESSAGE_TAG_CATALOG_LIMIT, MESSAGE_TAG_NAME_LIMIT } from "../shared/message-tags.js";
import {
  MESSAGE_FILTER_ACTION_LIMIT,
  MESSAGE_FILTER_CONDITION_LIMIT,
  MESSAGE_FILTER_LIMIT,
  MESSAGE_FILTER_NAME_LIMIT,
  MESSAGE_FILTER_VALUE_LIMIT,
} from "../shared/message-filters.js";
import { validateTabAppearanceThemeDocument, type TabAppearanceThemeDocument } from "../shared/tab-appearance-theme.js";
import {
  IDENTITY_NAME_LIMIT,
  IDENTITY_ORGANIZATION_LIMIT,
  IDENTITY_SIGNATURE_LIMIT,
  type MailIdentityInput,
} from "../shared/identities.js";

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

const oauthProviderIdSchema = z.enum(OAUTH_PROVIDER_IDS);

const accountDraftBaseShape = {
  displayName: z.string().trim().min(1).max(120).refine(noControlCharacters, "Display names cannot contain control characters."),
  email: emailSchema,
  incoming: serverSettingsSchema,
  outgoing: serverSettingsSchema,
  authMode: z.enum(["password", "oauth2"]),
  // Empty for oauth2: the renderer never sends a password for that mode, and the actual access
  // token comes from a freshly completed sign-in the main process already holds, never from this
  // field. Non-empty is enforced per authMode below rather than here, where both modes share a shape.
  secret: z.string().max(16_384),
  oauthProvider: oauthProviderIdSchema.optional(),
};

/** authMode and oauthProvider/secret must agree: exactly one credential source, never both or neither. */
const requireConsistentAuthMode = (value: { authMode: "password" | "oauth2"; secret: string; oauthProvider?: OAuthProviderId | undefined }, context: z.RefinementCtx): void => {
  if (value.authMode === "password") {
    if (!value.secret) context.addIssue({ code: "custom", path: ["secret"], message: "A password is required for password authentication." });
    if (value.oauthProvider !== undefined) context.addIssue({ code: "custom", path: ["oauthProvider"], message: "Password authentication does not take an OAuth provider." });
  } else {
    if (value.oauthProvider === undefined) context.addIssue({ code: "custom", path: ["oauthProvider"], message: "OAuth authentication requires a provider." });
    if (value.secret) context.addIssue({ code: "custom", path: ["secret"], message: "OAuth authentication does not take a password." });
  }
};

export const pop3AccountOptionsSchema = z.strictObject({
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
  z.strictObject({ ...accountDraftBaseShape, incomingProtocol: z.literal("imap").default("imap") }).superRefine(requireConsistentAuthMode),
  z.strictObject({ ...accountDraftBaseShape, incomingProtocol: z.literal("pop3"), pop3: pop3AccountOptionsSchema }).superRefine((value, context) => {
    if (value.authMode !== "password") context.addIssue({ code: "custom", path: ["authMode"], message: "POP3 account testing requires password authentication." });
    if (value.incoming.security !== "tls" && value.incoming.security !== "starttls") {
      context.addIssue({ code: "custom", path: ["incoming", "security"], message: "POP3 account testing requires implicit TLS or STARTTLS." });
    }
    if (/[\r\n\0]/u.test(value.secret)) context.addIssue({ code: "custom", path: ["secret"], message: "POP3 credentials cannot contain line breaks or NUL." });
    requireConsistentAuthMode(value, context);
  }),
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
  identityId: identifierSchema.optional(),
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

/**
 * Names and organizations become header values, so the boundary refuses a line break outright
 * rather than relying on the model folding it away.
 */
const identityLineSchema = (limit: number) =>
  z.string().max(limit).refine(noHeaderBreaks, "Identity names cannot contain line breaks or NUL.");
const identityAddressSchema = z
  .string()
  .min(1)
  .max(320)
  .refine(noHeaderBreaks, "Addresses cannot contain line breaks or NUL.");

export const mailIdentityInputSchema = z.strictObject({
  id: identifierSchema.optional(),
  accountId: identifierSchema,
  displayName: identityLineSchema(IDENTITY_NAME_LIMIT).min(1),
  email: identityAddressSchema,
  replyTo: identityAddressSchema.or(z.literal("")).optional(),
  organization: identityLineSchema(IDENTITY_ORGANIZATION_LIMIT).optional(),
  signature: z.string().max(IDENTITY_SIGNATURE_LIMIT).optional(),
  signaturePlacement: z.enum(["below-body", "below-quote"]).optional(),
  isDefault: z.boolean().optional(),
}) as z.ZodType<MailIdentityInput>;

/**
 * Deliberately carries no `.default()`. Zod's `.partial()` wraps a field in `.optional()`, but a
 * field already holding `.default()` still substitutes that default the moment the key is absent —
 * `.optional()` only stops a schema from rejecting `undefined`, it does not reach back and disarm a
 * default underneath it. A patch built from this object would therefore inject the default value of
 * every field the caller never mentioned, and merging that patch over stored preferences would silently
 * revert them. Full-object parsing gets its defaults from {@link preferencesSchema} below instead,
 * which is the only place they belong: filling a gap left by a state file older than the field.
 */
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
  narratorEnabled: z.boolean(),
  narratorLanguage: z.enum(["en", "yue", "bilingual"]),
  nativeNotificationsEnabled: z.boolean(),
  historyRetentionDays: historyRetentionDaysSchema,
  externalEditorPath: nativePathSchema.optional(),
  selectedAccountId: identifierSchema.optional(),
  selectedFolderPath: folderPathSchema.optional(),
});

/**
 * A profile or settings revision written while the dim-sum surprise was still optional carries its
 * retired switch, and a strict object would reject the entire record over that one dead key, locking
 * the owner out of their own mail. Accept it, drop it, and let the profile rejoin the draw. The
 * renderer never sends it, so the patch schema stays strict.
 *
 * `nativeNotificationsEnabled` and `historyRetentionDays` get their defaults here, and only here, so
 * a state file written before those fields existed still loads with sane values.
 */
export const preferencesSchema = preferencesObjectSchema
  .extend({
    nativeNotificationsEnabled: z.boolean().default(false),
    historyRetentionDays: historyRetentionDaysSchema.default(LOCAL_HISTORY_RETENTION_DAYS_DEFAULT),
    dimSumEnabled: z.boolean().optional(),
  })
  .transform(preferences => {
    const retained = { ...preferences };
    delete retained.dimSumEnabled;
    return retained;
  }) as unknown as z.ZodType<Preferences>;
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

export const tabAppearanceThemeSchema = z.custom<TabAppearanceThemeDocument>(
  value => validateTabAppearanceThemeDocument(value).ok,
  "A strictly validated Material Email tab appearance theme is required.",
);

const folderNameSchema = z
  .string()
  .min(1)
  .max(255)
  .refine(noHeaderBreaks, "Folder names cannot contain line breaks or NUL.")
  .refine(value => !/[/\\]/u.test(value), "A folder name cannot contain a path separator.")
  .refine(value => value.trim() === value, "A folder name cannot start or end with whitespace.");
const messageTagIdSchema = z.string().min(1).max(MESSAGE_TAG_NAME_LIMIT).regex(/^[\p{Letter}\p{Number}-]+$/u);
const messageTagNameSchema = z.string().min(1).max(MESSAGE_TAG_NAME_LIMIT).refine(noControlCharacters, "Control characters are not allowed.");
const messageTagColourSchema = z.string().regex(/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/iu);
const messageTagPatchSchema = z.strictObject({
  name: messageTagNameSchema.optional(),
  colour: messageTagColourSchema.optional(),
  ordinal: z.number().int().min(0).max(MESSAGE_TAG_CATALOG_LIMIT).optional(),
}) as z.ZodType<MessageTagPatch>;
const messageFilterConditionInputSchema = z.strictObject({
  field: z.enum([
    "from", "to", "cc", "recipient", "subject", "body", "account", "folder", "tag", "size", "age-days", "attachments", "read-state", "star-state",
  ]),
  operator: z.enum(["contains", "not-contains", "is", "is-not", "starts-with", "ends-with", "regex", "greater-than", "less-than"]),
  value: z.string().max(MESSAGE_FILTER_VALUE_LIMIT),
  caseSensitive: z.boolean(),
});
const messageFilterActionInputSchema = z.strictObject({
  kind: z.enum([
    "mark-read", "mark-unread", "star", "unstar", "add-tag", "remove-tag", "move", "archive", "trash", "mark-junk", "mark-not-junk", "stop",
  ]),
  value: z.string().max(MESSAGE_FILTER_VALUE_LIMIT),
});
const messageFilterInputSchema = z.strictObject({
  id: identifierSchema.optional(),
  name: z.string().min(1).max(MESSAGE_FILTER_NAME_LIMIT).refine(noControlCharacters, "Control characters are not allowed."),
  enabled: z.boolean(),
  match: z.enum(["all", "any"]),
  runOnSync: z.boolean(),
  accountId: identifierSchema.nullable(),
  conditions: z.array(messageFilterConditionInputSchema).min(1).max(MESSAGE_FILTER_CONDITION_LIMIT),
  actions: z.array(messageFilterActionInputSchema).min(1).max(MESSAGE_FILTER_ACTION_LIMIT),
}) as z.ZodType<MessageFilterInput>;

export const ipcPayloadSchemas = {
  none: z.tuple([]),
  accountDiscover: z.tuple([emailSchema]),
  oauthProvider: z.tuple([z.enum(OAUTH_PROVIDER_IDS)]),
  oauthRedirectUrl: z.tuple([z.string().trim().min(1).max(8_192)]),
  tlsCertificateInspection: z.tuple([tlsCertificateInspectionSchema]),
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
  identitySave: z.tuple([mailIdentityInputSchema]),
  identityId: z.tuple([identifierSchema]),
  accountItem: z.tuple([identifierSchema, identifierSchema]),
  preferences: z.tuple([preferencesPatchSchema]),
  notificationRead: z.tuple([identifierSchema, z.boolean()]),
  notificationDismissed: z.tuple([identifierSchema, z.boolean()]),
  nativeNotification: z.tuple([z.enum(["info", "success", "warning", "error"])]),
  historyId: z.tuple([identifierSchema]),
  revisionHash: z.tuple([revisionHashSchema]),
  revisionLabel: z.tuple([revisionHashSchema, revisionLabelSchema]),
  historyPrunePreview: z.tuple([historyRetentionDaysSchema]),
  historyPrune: z.tuple([localHistoryPruneRequestSchema]),
  exportData: z.tuple([z.enum(["history", "settings", "changelog"]), z.string().max(32 * 1024 * 1024), suggestedFilenameSchema]),
  tabAppearanceThemeExport: z.tuple([tabAppearanceThemeSchema]),
  editorOpen: z.union([z.tuple([]), z.tuple([z.undefined()]), z.tuple([nativePathSchema])]),
  externalLinkRequest: z.tuple([externalLinkRequestIdSchema]),
  folderName: z.tuple([identifierSchema, folderPathSchema, folderNameSchema]),
  messageTagCreate: z.tuple([messageTagNameSchema, messageTagColourSchema]),
  messageTagUpdate: z.tuple([messageTagIdSchema, messageTagPatchSchema]),
  messageTagId: z.tuple([messageTagIdSchema]),
  messageTagSet: z.tuple([identifierSchema, folderPathSchema, messageUidSchema, z.array(messageTagIdSchema).max(MESSAGE_TAGS_PER_MESSAGE_LIMIT)]),
  messageFilterSave: z.tuple([messageFilterInputSchema]),
  messageFilterId: z.tuple([identifierSchema]),
  messageFilterOrder: z.tuple([z.array(identifierSchema).max(MESSAGE_FILTER_LIMIT)]),
  junkTrain: z.tuple([identifierSchema, folderPathSchema, messageUidSchema, z.enum(["junk", "good"])]),
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
