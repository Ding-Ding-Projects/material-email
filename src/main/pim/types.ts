import { z } from "zod";

const shortText = (maximum: number) => z.string().trim().min(1).max(maximum);
const optionalText = (maximum: number) => shortText(maximum).optional();
const clearableText = (maximum: number) => shortText(maximum).nullable().optional();
const uniqueStrings = (values: readonly string[]): boolean => new Set(values.map(value => value.toLowerCase())).size === values.length;

export const uidSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .regex(/^[^\u0000-\u001F\u007F]+$/, "UIDs must not contain control characters.");

export const isoDateTimeSchema = z.iso.datetime({ offset: true }).max(64);

export const localDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a calendar date in YYYY-MM-DD form.")
  .refine(value => {
    const [year, month, day] = value.split("-").map(Number);
    if (year === undefined || month === undefined || day === undefined) return false;
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
  }, "Expected a real calendar date.");

export const contactNameSchema = z
  .object({
    prefix: optionalText(80),
    given: optionalText(120),
    additional: optionalText(120),
    family: optionalText(120),
    suffix: optionalText(80),
  })
  .strict();

export const contactEmailSchema = z
  .object({
    value: z.email().max(320),
    types: z.array(shortText(32).transform(value => value.toLowerCase())).max(12).default([]),
    preferred: z.boolean().default(false),
  })
  .strict();

export const contactPhoneSchema = z
  .object({
    value: shortText(100),
    types: z.array(shortText(32).transform(value => value.toLowerCase())).max(12).default([]),
    preferred: z.boolean().default(false),
  })
  .strict();

export const contactAddressSchema = z
  .object({
    poBox: optionalText(200),
    extended: optionalText(500),
    street: optionalText(500),
    locality: optionalText(200),
    region: optionalText(200),
    postalCode: optionalText(80),
    country: optionalText(200),
    types: z.array(shortText(32).transform(value => value.toLowerCase())).max(12).default([]),
    preferred: z.boolean().default(false),
  })
  .strict()
  .refine(
    value => Boolean(value.poBox ?? value.extended ?? value.street ?? value.locality ?? value.region ?? value.postalCode ?? value.country),
    "An address must contain at least one component.",
  );

const contactFields = {
  displayName: shortText(300),
  name: contactNameSchema.default({}),
  nickname: optionalText(120),
  emails: z.array(contactEmailSchema).max(100).default([]),
  phones: z.array(contactPhoneSchema).max(100).default([]),
  addresses: z.array(contactAddressSchema).max(50).default([]),
  organization: optionalText(300),
  title: optionalText(300),
  notes: optionalText(16_384),
};

const validateContactMethods = (
  value: {
    emails: Array<{ value: string; preferred: boolean }>;
    phones: Array<{ value: string; preferred: boolean }>;
    addresses?: Array<{ preferred: boolean }>;
  },
  context: z.core.$RefinementCtx,
): void => {
  if (!uniqueStrings(value.emails.map(email => email.value))) {
    context.addIssue({ code: "custom", path: ["emails"], message: "Email addresses must be unique within a contact." });
  }
  if (value.emails.filter(email => email.preferred).length > 1) {
    context.addIssue({ code: "custom", path: ["emails"], message: "Only one email address can be preferred." });
  }
  if (!uniqueStrings(value.phones.map(phone => phone.value))) {
    context.addIssue({ code: "custom", path: ["phones"], message: "Phone numbers must be unique within a contact." });
  }
  if (value.phones.filter(phone => phone.preferred).length > 1) {
    context.addIssue({ code: "custom", path: ["phones"], message: "Only one phone number can be preferred." });
  }
  if ((value.addresses ?? []).filter(address => address.preferred).length > 1) {
    context.addIssue({ code: "custom", path: ["addresses"], message: "Only one address can be preferred." });
  }
};

export const createContactSchema = z
  .object({ uid: uidSchema.optional(), ...contactFields })
  .strict()
  .superRefine(validateContactMethods);

export const contactPatchSchema = z
  .object({
    displayName: contactFields.displayName.optional(),
    name: contactNameSchema.nullable().optional(),
    nickname: clearableText(120),
    emails: z.array(contactEmailSchema).max(100).optional(),
    phones: z.array(contactPhoneSchema).max(100).optional(),
    addresses: z.array(contactAddressSchema).max(50).optional(),
    organization: clearableText(300),
    title: clearableText(300),
    notes: clearableText(16_384),
  })
  .strict();

export const contactSchema = z
  .object({
    uid: uidSchema,
    ...contactFields,
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
    revision: z.number().int().positive(),
  })
  .strict()
  .superRefine(validateContactMethods);

const mailingListFields = {
  name: shortText(300),
  nickname: optionalText(120),
  description: optionalText(4_096),
  memberUids: z.array(uidSchema).max(10_000).default([]).refine(uniqueStrings, "A contact can appear in a mailing list only once."),
};

export const createMailingListSchema = z.object({ uid: uidSchema.optional(), ...mailingListFields }).strict();
export const mailingListPatchSchema = z
  .object({
    name: mailingListFields.name.optional(),
    nickname: clearableText(120),
    description: clearableText(4_096),
    memberUids: z.array(uidSchema).max(10_000).refine(uniqueStrings, "A contact can appear in a mailing list only once.").optional(),
  })
  .strict();
export const mailingListSchema = z
  .object({
    uid: uidSchema,
    ...mailingListFields,
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
    revision: z.number().int().positive(),
  })
  .strict();

export const temporalValueSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("date"), value: localDateSchema }).strict(),
  z.object({ kind: z.literal("date-time"), value: isoDateTimeSchema, timeZone: optionalText(100) }).strict(),
]);

export const recurrenceSchema = z
  .object({
    frequency: z.enum(["daily", "weekly", "monthly", "yearly"]),
    interval: z.number().int().min(1).max(10_000).default(1),
    count: z.number().int().min(1).max(1_000_000).optional(),
    until: temporalValueSchema.optional(),
    byWeekday: z.array(z.enum(["MO", "TU", "WE", "TH", "FR", "SA", "SU"])).max(7).optional(),
    byMonthDay: z
      .array(z.number().int().min(-31).max(31).refine(value => value !== 0, "Month days cannot be zero."))
      .max(62)
      .optional(),
    weekStart: z.enum(["MO", "TU", "WE", "TH", "FR", "SA", "SU"]).optional(),
    additionalDates: z.array(temporalValueSchema).max(10_000).default([]),
    exceptionDates: z.array(temporalValueSchema).max(10_000).default([]),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.count !== undefined && value.until !== undefined) {
      context.addIssue({ code: "custom", path: ["until"], message: "Recurrence count and until are mutually exclusive." });
    }
    if (value.byWeekday && new Set(value.byWeekday).size !== value.byWeekday.length) {
      context.addIssue({ code: "custom", path: ["byWeekday"], message: "Recurrence weekdays must be unique." });
    }
    if (value.byMonthDay && new Set(value.byMonthDay).size !== value.byMonthDay.length) {
      context.addIssue({ code: "custom", path: ["byMonthDay"], message: "Recurrence month days must be unique." });
    }
  });

export const attendeeSchema = z
  .object({
    email: z.email().max(320),
    name: optionalText(300),
    role: z.enum(["required", "optional", "chair", "non-participant"]).default("required"),
    participationStatus: z.enum(["needs-action", "accepted", "declined", "tentative", "delegated"]).default("needs-action"),
    rsvp: z.boolean().default(false),
  })
  .strict();

export const alarmSchema = z
  .object({
    uid: uidSchema,
    action: z.enum(["display", "audio"]).default("display"),
    trigger: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("relative"), minutes: z.number().int().min(-5_256_000).max(5_256_000) }).strict(),
      z.object({ kind: z.literal("absolute"), at: isoDateTimeSchema }).strict(),
    ]),
    description: optionalText(1_000),
  })
  .strict();

const calendarEventFields = {
  calendarUid: z.literal("home").default("home"),
  title: shortText(500),
  description: optionalText(32_768),
  location: optionalText(1_000),
  start: temporalValueSchema,
  end: temporalValueSchema,
  recurrence: recurrenceSchema.optional(),
  organizer: attendeeSchema.optional(),
  attendees: z.array(attendeeSchema).max(1_000).default([]),
  alarms: z.array(alarmSchema).max(100).default([]),
  categories: z.array(shortText(100)).max(100).default([]),
  status: z.enum(["tentative", "confirmed", "cancelled"]).default("confirmed"),
  transparency: z.enum(["opaque", "transparent"]).default("opaque"),
};

const temporalOrder = (value: z.output<typeof temporalValueSchema>): number =>
  value.kind === "date" ? Date.parse(`${value.value}T00:00:00.000Z`) : Date.parse(value.value);

const validateEvent = (
  value: {
    start: z.output<typeof temporalValueSchema>;
    end: z.output<typeof temporalValueSchema>;
    recurrence?: z.output<typeof recurrenceSchema> | undefined;
    attendees: Array<{ email: string }>;
    alarms: Array<{ uid: string }>;
  },
  context: z.core.$RefinementCtx,
): void => {
  if (value.start.kind !== value.end.kind) {
    context.addIssue({ code: "custom", path: ["end"], message: "Event start and end must use the same date representation." });
  } else if (temporalOrder(value.end) <= temporalOrder(value.start)) {
    context.addIssue({ code: "custom", path: ["end"], message: "Event end must be after its start." });
  }
  if (!uniqueStrings(value.attendees.map(attendee => attendee.email))) {
    context.addIssue({ code: "custom", path: ["attendees"], message: "Event attendee email addresses must be unique." });
  }
  if (new Set(value.alarms.map(alarm => alarm.uid)).size !== value.alarms.length) {
    context.addIssue({ code: "custom", path: ["alarms"], message: "Event alarm UIDs must be unique." });
  }
  if (value.recurrence?.until && value.recurrence.until.kind !== value.start.kind) {
    context.addIssue({ code: "custom", path: ["recurrence", "until"], message: "Recurrence until must use the event start's date representation." });
  }
};

export const createCalendarEventSchema = z
  .object({ uid: uidSchema.optional(), ...calendarEventFields })
  .strict()
  .superRefine(validateEvent);

export const calendarEventPatchSchema = z
  .object({
    title: calendarEventFields.title.optional(),
    description: clearableText(32_768),
    location: clearableText(1_000),
    start: temporalValueSchema.optional(),
    end: temporalValueSchema.optional(),
    recurrence: recurrenceSchema.nullable().optional(),
    organizer: attendeeSchema.nullable().optional(),
    attendees: z.array(attendeeSchema).max(1_000).optional(),
    alarms: z.array(alarmSchema).max(100).optional(),
    categories: z.array(shortText(100)).max(100).optional(),
    status: z.enum(["tentative", "confirmed", "cancelled"]).optional(),
    transparency: z.enum(["opaque", "transparent"]).optional(),
  })
  .strict();

export const calendarEventSchema = z
  .object({
    uid: uidSchema,
    ...calendarEventFields,
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
    revision: z.number().int().positive(),
  })
  .strict()
  .superRefine(validateEvent);

const taskFields = {
  calendarUid: z.literal("home").default("home"),
  title: shortText(500),
  description: optionalText(32_768),
  status: z.enum(["needs-action", "in-progress", "completed", "cancelled"]).default("needs-action"),
  entry: temporalValueSchema.optional(),
  due: temporalValueSchema.optional(),
  priority: z.number().int().min(0).max(9).default(0),
  percentComplete: z.number().int().min(0).max(100).default(0),
  completedAt: isoDateTimeSchema.optional(),
  categories: z.array(shortText(100)).max(100).default([]),
  recurrence: recurrenceSchema.optional(),
  sourceRevision: optionalText(500),
};

const validateTask = (
  value: {
    entry?: z.output<typeof temporalValueSchema> | null | undefined;
    due?: z.output<typeof temporalValueSchema> | null | undefined;
  },
  context: z.core.$RefinementCtx,
): void => {
  if (value.entry && value.due && value.entry.kind === value.due.kind && temporalOrder(value.due) < temporalOrder(value.entry)) {
    context.addIssue({ code: "custom", path: ["due"], message: "Task due date cannot be before its entry date." });
  }
};

export const createTaskSchema = z.object({ uid: uidSchema.optional(), ...taskFields }).strict().superRefine(validateTask);
export const taskPatchSchema = z
  .object({
    title: taskFields.title.optional(),
    description: clearableText(32_768),
    status: z.enum(["needs-action", "in-progress", "completed", "cancelled"]).optional(),
    entry: temporalValueSchema.nullable().optional(),
    due: temporalValueSchema.nullable().optional(),
    priority: z.number().int().min(0).max(9).optional(),
    percentComplete: z.number().int().min(0).max(100).optional(),
    completedAt: isoDateTimeSchema.nullable().optional(),
    categories: z.array(shortText(100)).max(100).optional(),
    recurrence: recurrenceSchema.nullable().optional(),
    sourceRevision: clearableText(500),
  })
  .strict();

export const taskSchema = z
  .object({
    uid: uidSchema,
    ...taskFields,
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
    revision: z.number().int().positive(),
  })
  .strict()
  .superRefine(validateTask);

export const taskRefreshInputSchema = z
  .object({
    uid: uidSchema,
    calendarUid: z.literal("home").optional(),
    title: taskFields.title,
    description: clearableText(32_768),
    status: z.enum(["needs-action", "in-progress", "completed", "cancelled"]).optional(),
    entry: temporalValueSchema.nullable().optional(),
    due: temporalValueSchema.nullable().optional(),
    priority: z.number().int().min(0).max(9).optional(),
    percentComplete: z.number().int().min(0).max(100).optional(),
    completedAt: isoDateTimeSchema.nullable().optional(),
    categories: z.array(shortText(100)).max(100).optional(),
    recurrence: recurrenceSchema.nullable().optional(),
    sourceRevision: clearableText(500),
  })
  .strict()
  .superRefine(validateTask);

export const homeCalendarSchema = z
  .object({
    uid: z.literal("home"),
    name: z.literal("Home"),
    kind: z.literal("local"),
    color: z.string().regex(/^#[0-9A-F]{6}$/i),
    readOnly: z.literal(false),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict();

export const pimEntityKindSchema = z.enum(["contact", "mailing-list", "calendar-event", "task"]);
export const transactionActionSchema = z.enum(["created", "updated", "deleted", "restored"]);

export const transactionSnapshotSchema = z.discriminatedUnion("entityKind", [
  z.object({ entityKind: z.literal("contact"), value: contactSchema }).strict(),
  z.object({ entityKind: z.literal("mailing-list"), value: mailingListSchema }).strict(),
  z.object({ entityKind: z.literal("calendar-event"), value: calendarEventSchema }).strict(),
  z.object({ entityKind: z.literal("task"), value: taskSchema }).strict(),
]);

export const pimTransactionSchema = z
  .object({
    id: uidSchema,
    sequence: z.number().int().positive(),
    occurredAt: isoDateTimeSchema,
    action: transactionActionSchema,
    entityKind: pimEntityKindSchema,
    entityUid: uidSchema,
    before: transactionSnapshotSchema.nullable(),
    after: transactionSnapshotSchema.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.before && (value.before.entityKind !== value.entityKind || value.before.value.uid !== value.entityUid)) {
      context.addIssue({ code: "custom", path: ["before"], message: "The before snapshot must identify the transaction entity." });
    }
    if (value.after && (value.after.entityKind !== value.entityKind || value.after.value.uid !== value.entityUid)) {
      context.addIssue({ code: "custom", path: ["after"], message: "The after snapshot must identify the transaction entity." });
    }
    if (value.action === "created" && (value.before !== null || value.after === null)) {
      context.addIssue({ code: "custom", path: ["action"], message: "A create transaction requires only an after snapshot." });
    }
    if (value.action === "updated" && (value.before === null || value.after === null)) {
      context.addIssue({ code: "custom", path: ["action"], message: "An update transaction requires before and after snapshots." });
    }
    if (value.action === "deleted" && (value.before === null || value.after !== null)) {
      context.addIssue({ code: "custom", path: ["action"], message: "A delete transaction requires only a before snapshot." });
    }
    if (value.action === "restored" && value.after === null) {
      context.addIssue({ code: "custom", path: ["action"], message: "A restore transaction requires an after snapshot." });
    }
  });

export const transactionFilterSchema = z
  .object({
    actions: z.array(transactionActionSchema).max(4).optional(),
    entityKinds: z.array(pimEntityKindSchema).max(4).optional(),
    entityUids: z.array(uidSchema).max(10_000).optional(),
    from: isoDateTimeSchema.optional(),
    to: isoDateTimeSchema.optional(),
  })
  .strict();

export const persistedPimStateSchema = z
  .object({
    schemaVersion: z.literal(1),
    homeCalendar: homeCalendarSchema,
    contacts: z.array(contactSchema),
    mailingLists: z.array(mailingListSchema),
    calendarEvents: z.array(calendarEventSchema),
    tasks: z.array(taskSchema),
    transactions: z.array(pimTransactionSchema),
    nextTransactionSequence: z.number().int().positive(),
    taskMutationVersion: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((value, context) => {
    const collections = [value.contacts, value.mailingLists, value.calendarEvents, value.tasks];
    for (const [index, collection] of collections.entries()) {
      if (new Set(collection.map(entity => entity.uid)).size !== collection.length) {
        context.addIssue({ code: "custom", path: [["contacts", "mailingLists", "calendarEvents", "tasks"][index] ?? ""], message: "Entity UIDs must be unique within their collection." });
      }
    }
    if (new Set(value.transactions.map(transaction => transaction.id)).size !== value.transactions.length) {
      context.addIssue({ code: "custom", path: ["transactions"], message: "Transaction UIDs must be unique." });
    }
    for (let index = 1; index < value.transactions.length; index += 1) {
      if (value.transactions[index - 1]!.sequence >= value.transactions[index]!.sequence) {
        context.addIssue({ code: "custom", path: ["transactions", index, "sequence"], message: "Transaction sequence numbers must increase." });
      }
    }
    const expectedNext = (value.transactions.at(-1)?.sequence ?? 0) + 1;
    if (value.nextTransactionSequence < expectedNext) {
      context.addIssue({ code: "custom", path: ["nextTransactionSequence"], message: "The next transaction sequence would reuse an existing value." });
    }
  });

export type ContactName = z.output<typeof contactNameSchema>;
export type ContactEmail = z.output<typeof contactEmailSchema>;
export type ContactPhone = z.output<typeof contactPhoneSchema>;
export type ContactAddress = z.output<typeof contactAddressSchema>;
export type CreateContactInput = z.input<typeof createContactSchema>;
export type ContactPatch = z.input<typeof contactPatchSchema>;
export type Contact = z.output<typeof contactSchema>;
export type CreateMailingListInput = z.input<typeof createMailingListSchema>;
export type MailingListPatch = z.input<typeof mailingListPatchSchema>;
export type MailingList = z.output<typeof mailingListSchema>;
export type TemporalValue = z.output<typeof temporalValueSchema>;
export type Recurrence = z.output<typeof recurrenceSchema>;
export type Attendee = z.output<typeof attendeeSchema>;
export type Alarm = z.output<typeof alarmSchema>;
export type CreateCalendarEventInput = z.input<typeof createCalendarEventSchema>;
export type CalendarEventPatch = z.input<typeof calendarEventPatchSchema>;
export type CalendarEvent = z.output<typeof calendarEventSchema>;
export type CreateTaskInput = z.input<typeof createTaskSchema>;
export type TaskPatch = z.input<typeof taskPatchSchema>;
export type Task = z.output<typeof taskSchema>;
export type TaskRefreshInput = z.input<typeof taskRefreshInputSchema>;
export type HomeCalendar = z.output<typeof homeCalendarSchema>;
export type PimEntityKind = z.output<typeof pimEntityKindSchema>;
export type TransactionAction = z.output<typeof transactionActionSchema>;
export type PimTransaction = z.output<typeof pimTransactionSchema>;
export type PimTransactionSnapshot = z.output<typeof transactionSnapshotSchema>;
export type PersistedPimState = z.output<typeof persistedPimStateSchema>;

export interface PimEntityMap {
  contact: Contact;
  "mailing-list": MailingList;
  "calendar-event": CalendarEvent;
  task: Task;
}

export interface TransactionFilter {
  actions?: readonly TransactionAction[];
  entityKinds?: readonly PimEntityKind[];
  entityUids?: readonly string[];
  from?: string;
  to?: string;
}

export interface VCardImportResult {
  contacts: Contact[];
  mailingLists: MailingList[];
  created: number;
  updated: number;
  unchanged: number;
}

export type ICalendarDuplicatePolicy = "skip" | "update";

export interface ICalendarImportResult {
  events: CalendarEvent[];
  tasks: Task[];
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
}

export type ICalendarExportRequest =
  | { scope: "all"; entityKinds: readonly ("calendar-event" | "task")[] }
  | { scope: "selected"; eventUids: readonly string[]; taskUids: readonly string[] };

export interface ICalendarExportResult {
  status: "saved" | "cancelled";
  eventCount: number;
  taskCount: number;
}

export interface TaskRefreshResult {
  requestId: number;
  applied: boolean;
  reason: "applied" | "superseded" | "local-state-changed";
  created: number;
  updated: number;
  unchanged: number;
}
