import { randomUUID } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import { AtomicJsonStore, type AtomicStorePaths } from "./atomic-json-store.js";
import {
  calendarEventPatchSchema,
  calendarEventSchema,
  contactPatchSchema,
  contactSchema,
  createCalendarEventSchema,
  createContactSchema,
  createMailingListSchema,
  createTaskSchema,
  mailingListPatchSchema,
  mailingListSchema,
  persistedPimStateSchema,
  pimTransactionSchema,
  taskPatchSchema,
  taskRefreshInputSchema,
  taskSchema,
  transactionFilterSchema,
  transactionSnapshotSchema,
  uidSchema,
  type CalendarEvent,
  type CalendarEventPatch,
  type Contact,
  type ContactPatch,
  type CreateCalendarEventInput,
  type CreateContactInput,
  type CreateMailingListInput,
  type CreateTaskInput,
  type HomeCalendar,
  type MailingList,
  type MailingListPatch,
  type PersistedPimState,
  type PimEntityKind,
  type PimEntityMap,
  type PimTransaction,
  type PimTransactionSnapshot,
  type Task,
  type TaskPatch,
  type TaskRefreshInput,
  type TaskRefreshResult,
  type TransactionAction,
  type TransactionFilter,
  type VCardImportResult,
} from "./types.js";
import { parseVCardBundle, serializeContactVCard, serializeVCardBundle } from "./vcard.js";

export interface PimServiceOptions {
  clock?: () => Date;
  idFactory?: () => string;
}

export class PimNotFoundError extends Error {
  override readonly name = "PimNotFoundError";
}

export class PimConflictError extends Error {
  override readonly name = "PimConflictError";
}

const same = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);

const withoutMetadata = <Entity extends { uid: string; createdAt: string; updatedAt: string; revision: number }>(entity: Entity): Omit<Entity, "uid" | "createdAt" | "updatedAt" | "revision"> => {
  const { uid: _uid, createdAt: _createdAt, updatedAt: _updatedAt, revision: _revision, ...content } = entity;
  return content;
};

const applyPatch = <Base extends object>(base: Base, patch: object, clearedValues: Readonly<Record<string, unknown>> = {}): Base => {
  const result = { ...base } as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (value === null) {
      if (Object.hasOwn(clearedValues, key)) result[key] = clearedValues[key];
      else delete result[key];
    } else {
      result[key] = value;
    }
  }
  return result as Base;
};

const normalizedSearch = (value: string): string =>
  value
    .normalize("NFKD")
    .replace(/\p{Mark}/gu, "")
    .toLocaleLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const temporalSortValue = (value: CalendarEvent["start"]): number =>
  value.kind === "date" ? Date.parse(`${value.value}T00:00:00.000Z`) : Date.parse(value.value);

export class PimService {
  readonly #store: AtomicJsonStore<PersistedPimState>;
  readonly #clock: () => Date;
  readonly #idFactory: () => string;
  #latestTaskRefreshRequest = 0;

  constructor(appDataDirectory: string, options: PimServiceOptions = {}) {
    if (typeof appDataDirectory !== "string" || !appDataDirectory.trim()) throw new TypeError("A caller-provided application-data directory is required.");
    this.#clock = options.clock ?? (() => new Date());
    this.#idFactory = options.idFactory ?? randomUUID;
    const statePath = path.join(path.resolve(appDataDirectory), "pim", "material-email-pim-v1.json");
    this.#store = new AtomicJsonStore(statePath, persistedPimStateSchema, () => {
      const now = this.#now();
      return {
        schemaVersion: 1,
        homeCalendar: {
          uid: "home",
          name: "Home",
          kind: "local",
          color: "#6750A4",
          readOnly: false,
          createdAt: now,
          updatedAt: now,
        },
        contacts: [],
        mailingLists: [],
        calendarEvents: [],
        tasks: [],
        transactions: [],
        nextTransactionSequence: 1,
        taskMutationVersion: 0,
      };
    });
  }

  get persistencePaths(): AtomicStorePaths {
    return this.#store.paths;
  }

  async storageGeneration(): Promise<number> {
    return this.#store.generation();
  }

  async getHomeCalendar(): Promise<HomeCalendar> {
    return (await this.#store.read()).homeCalendar;
  }

  async createContact(input: CreateContactInput): Promise<Contact> {
    const parsed = createContactSchema.parse(input);
    return this.#store.mutate(state => {
      const uid = this.#availableUid(state, "contact", parsed.uid);
      const now = this.#now();
      const { uid: _requestedUid, ...content } = parsed;
      const contact = contactSchema.parse({ uid, ...content, createdAt: now, updatedAt: now, revision: 1 });
      state.contacts.push(contact);
      this.#record(state, "created", "contact", contact.uid, null, contact, now);
      return { changed: true, result: contact };
    });
  }

  async getContact(uid: string): Promise<Contact | null> {
    const validatedUid = uidSchema.parse(uid);
    return (await this.#store.read()).contacts.find(contact => contact.uid === validatedUid) ?? null;
  }

  async listContacts(): Promise<Contact[]> {
    const state = await this.#store.read();
    return state.contacts.sort((left, right) => left.displayName.localeCompare(right.displayName) || left.uid.localeCompare(right.uid));
  }

  async searchContacts(query: string): Promise<Contact[]> {
    if (typeof query !== "string" || query.length > 1_000) throw new TypeError("Contact search text must be at most 1,000 characters.");
    const tokens = normalizedSearch(query).split(" ").filter(Boolean);
    const contacts = await this.listContacts();
    if (!tokens.length) return contacts;
    return contacts.filter(contact => {
      const values = [
        contact.displayName,
        contact.nickname,
        contact.name.prefix,
        contact.name.given,
        contact.name.additional,
        contact.name.family,
        contact.name.suffix,
        contact.organization,
        contact.title,
        contact.notes,
        ...contact.emails.flatMap(email => [email.value, ...email.types]),
        ...contact.phones.flatMap(phone => [phone.value, ...phone.types]),
        ...contact.addresses.flatMap(address => [
          address.poBox,
          address.extended,
          address.street,
          address.locality,
          address.region,
          address.postalCode,
          address.country,
          ...address.types,
        ]),
      ];
      const haystack = normalizedSearch(values.filter((value): value is string => Boolean(value)).join("\n"));
      return tokens.every(token => haystack.includes(token));
    });
  }

  async updateContact(uid: string, patch: ContactPatch): Promise<Contact> {
    const validatedUid = uidSchema.parse(uid);
    const parsedPatch = contactPatchSchema.parse(patch);
    return this.#store.mutate(state => {
      const index = state.contacts.findIndex(contact => contact.uid === validatedUid);
      const current = state.contacts[index];
      if (!current) throw new PimNotFoundError(`Contact ${validatedUid} does not exist.`);
      const candidateContent = applyPatch(withoutMetadata(current), parsedPatch, { name: {} });
      const candidate = contactSchema.parse({
        uid: current.uid,
        ...candidateContent,
        createdAt: current.createdAt,
        updatedAt: current.updatedAt,
        revision: current.revision,
      });
      if (same(withoutMetadata(current), withoutMetadata(candidate))) return { changed: false, result: current };
      const now = this.#now();
      const updated = contactSchema.parse({ ...candidate, uid: current.uid, createdAt: current.createdAt, updatedAt: now, revision: current.revision + 1 });
      state.contacts[index] = updated;
      this.#record(state, "updated", "contact", current.uid, current, updated, now);
      return { changed: true, result: updated };
    });
  }

  async deleteContact(uid: string): Promise<boolean> {
    const validatedUid = uidSchema.parse(uid);
    return this.#store.mutate(state => {
      const index = state.contacts.findIndex(contact => contact.uid === validatedUid);
      const current = state.contacts[index];
      if (!current) return { changed: false, result: false };
      state.contacts.splice(index, 1);
      this.#record(state, "deleted", "contact", current.uid, current, null, this.#now());
      return { changed: true, result: true };
    });
  }

  async restoreContact(uid: string, sourceTransactionId?: string): Promise<Contact> {
    return this.#restore("contact", uid, sourceTransactionId, contactSchema, state => state.contacts);
  }

  async createMailingList(input: CreateMailingListInput): Promise<MailingList> {
    const parsed = createMailingListSchema.parse(input);
    return this.#store.mutate(state => {
      this.#assertContactsExist(state, parsed.memberUids);
      const uid = this.#availableUid(state, "mailing-list", parsed.uid);
      const now = this.#now();
      const { uid: _requestedUid, ...content } = parsed;
      const mailingList = mailingListSchema.parse({ uid, ...content, createdAt: now, updatedAt: now, revision: 1 });
      state.mailingLists.push(mailingList);
      this.#record(state, "created", "mailing-list", mailingList.uid, null, mailingList, now);
      return { changed: true, result: mailingList };
    });
  }

  async getMailingList(uid: string): Promise<MailingList | null> {
    const validatedUid = uidSchema.parse(uid);
    return (await this.#store.read()).mailingLists.find(mailingList => mailingList.uid === validatedUid) ?? null;
  }

  async listMailingLists(): Promise<MailingList[]> {
    const state = await this.#store.read();
    return state.mailingLists.sort((left, right) => left.name.localeCompare(right.name) || left.uid.localeCompare(right.uid));
  }

  async listMailingListMembers(uid: string): Promise<Contact[]> {
    const state = await this.#store.read();
    const mailingList = state.mailingLists.find(candidate => candidate.uid === uidSchema.parse(uid));
    if (!mailingList) throw new PimNotFoundError(`Mailing list ${uid} does not exist.`);
    const positions = new Map(mailingList.memberUids.map((memberUid, index) => [memberUid, index]));
    return state.contacts
      .filter(contact => positions.has(contact.uid))
      .sort((left, right) => (positions.get(left.uid) ?? 0) - (positions.get(right.uid) ?? 0));
  }

  async updateMailingList(uid: string, patch: MailingListPatch): Promise<MailingList> {
    const validatedUid = uidSchema.parse(uid);
    const parsedPatch = mailingListPatchSchema.parse(patch);
    return this.#store.mutate(state => {
      const index = state.mailingLists.findIndex(mailingList => mailingList.uid === validatedUid);
      const current = state.mailingLists[index];
      if (!current) throw new PimNotFoundError(`Mailing list ${validatedUid} does not exist.`);
      if (parsedPatch.memberUids) this.#assertContactsExist(state, parsedPatch.memberUids);
      const candidate = mailingListSchema.parse({
        uid: current.uid,
        ...applyPatch(withoutMetadata(current), parsedPatch),
        createdAt: current.createdAt,
        updatedAt: current.updatedAt,
        revision: current.revision,
      });
      if (same(withoutMetadata(current), withoutMetadata(candidate))) return { changed: false, result: current };
      const now = this.#now();
      const updated = mailingListSchema.parse({ ...candidate, uid: current.uid, createdAt: current.createdAt, updatedAt: now, revision: current.revision + 1 });
      state.mailingLists[index] = updated;
      this.#record(state, "updated", "mailing-list", current.uid, current, updated, now);
      return { changed: true, result: updated };
    });
  }

  async deleteMailingList(uid: string): Promise<boolean> {
    const validatedUid = uidSchema.parse(uid);
    return this.#store.mutate(state => {
      const index = state.mailingLists.findIndex(mailingList => mailingList.uid === validatedUid);
      const current = state.mailingLists[index];
      if (!current) return { changed: false, result: false };
      state.mailingLists.splice(index, 1);
      this.#record(state, "deleted", "mailing-list", current.uid, current, null, this.#now());
      return { changed: true, result: true };
    });
  }

  async restoreMailingList(uid: string, sourceTransactionId?: string): Promise<MailingList> {
    return this.#restore("mailing-list", uid, sourceTransactionId, mailingListSchema, state => state.mailingLists);
  }

  async exportContactVCard(uid: string): Promise<string> {
    const contact = await this.getContact(uid);
    if (!contact) throw new PimNotFoundError(`Contact ${uid} does not exist.`);
    return serializeContactVCard(contact);
  }

  async exportVCard(contactUids?: readonly string[], mailingListUids?: readonly string[]): Promise<string> {
    const state = await this.#store.read();
    const selectedContacts = contactUids === undefined ? state.contacts : this.#selectByUid(state.contacts, contactUids, "Contact");
    const selectedLists = mailingListUids === undefined ? state.mailingLists : this.#selectByUid(state.mailingLists, mailingListUids, "Mailing list");
    return serializeVCardBundle(selectedContacts, selectedLists);
  }

  async importVCard(source: string): Promise<VCardImportResult> {
    const parsed = parseVCardBundle(source);
    return this.#store.mutate(state => {
      const now = this.#now();
      const result: VCardImportResult = { contacts: [], mailingLists: [], created: 0, updated: 0, unchanged: 0 };
      let changed = false;

      for (const rawContact of parsed.contacts) {
        const input = createContactSchema.parse(rawContact);
        const uid = input.uid ?? this.#availableUid(state, "contact");
        const { uid: _inputUid, ...content } = input;
        const index = state.contacts.findIndex(contact => contact.uid === uid);
        const current = state.contacts[index];
        if (current) {
          const candidate = contactSchema.parse({
            uid,
            ...content,
            createdAt: current.createdAt,
            updatedAt: current.updatedAt,
            revision: current.revision,
          });
          if (same(withoutMetadata(current), withoutMetadata(candidate))) {
            result.contacts.push(current);
            result.unchanged += 1;
            continue;
          }
          const updated = contactSchema.parse({ ...candidate, uid, createdAt: current.createdAt, updatedAt: now, revision: current.revision + 1 });
          state.contacts[index] = updated;
          this.#record(state, "updated", "contact", uid, current, updated, now);
          result.contacts.push(updated);
          result.updated += 1;
        } else {
          if (this.#isHistoricalUid(state, "contact", uid)) {
            throw new PimConflictError(`Contact UID ${uid} belongs to deleted history; restore that contact before importing an update.`);
          }
          const revision = this.#latestRevision(state, "contact", uid) + 1;
          const created = contactSchema.parse({ uid, ...content, createdAt: now, updatedAt: now, revision });
          state.contacts.push(created);
          this.#record(state, "created", "contact", uid, null, created, now);
          result.contacts.push(created);
          result.created += 1;
        }
        changed = true;
      }

      for (const rawList of parsed.mailingLists) {
        const { memberEmailAddresses, ...rawInput } = rawList;
        const inputWithoutEmailMembers = createMailingListSchema.parse(rawInput);
        const resolvedEmailMembers = memberEmailAddresses.map(address => {
          const matches = state.contacts.filter(contact => contact.emails.some(email => email.value.toLowerCase() === address.toLowerCase()));
          if (matches.length !== 1) {
            throw new PimConflictError(
              matches.length
                ? `Mailing-list member ${address} matches more than one contact.`
                : `Mailing-list member ${address} does not match an imported or existing contact.`,
            );
          }
          return matches[0]!.uid;
        });
        const input = createMailingListSchema.parse({
          ...inputWithoutEmailMembers,
          memberUids: [...new Set([...inputWithoutEmailMembers.memberUids, ...resolvedEmailMembers])],
        });
        this.#assertContactsExist(state, input.memberUids);
        const uid = input.uid ?? this.#availableUid(state, "mailing-list");
        const { uid: _inputUid, ...content } = input;
        const index = state.mailingLists.findIndex(mailingList => mailingList.uid === uid);
        const current = state.mailingLists[index];
        if (current) {
          const candidate = mailingListSchema.parse({
            uid,
            ...content,
            createdAt: current.createdAt,
            updatedAt: current.updatedAt,
            revision: current.revision,
          });
          if (same(withoutMetadata(current), withoutMetadata(candidate))) {
            result.mailingLists.push(current);
            result.unchanged += 1;
            continue;
          }
          const updated = mailingListSchema.parse({ ...candidate, uid, createdAt: current.createdAt, updatedAt: now, revision: current.revision + 1 });
          state.mailingLists[index] = updated;
          this.#record(state, "updated", "mailing-list", uid, current, updated, now);
          result.mailingLists.push(updated);
          result.updated += 1;
        } else {
          if (this.#isHistoricalUid(state, "mailing-list", uid)) {
            throw new PimConflictError(`Mailing-list UID ${uid} belongs to deleted history; restore that list before importing an update.`);
          }
          const revision = this.#latestRevision(state, "mailing-list", uid) + 1;
          const created = mailingListSchema.parse({ uid, ...content, createdAt: now, updatedAt: now, revision });
          state.mailingLists.push(created);
          this.#record(state, "created", "mailing-list", uid, null, created, now);
          result.mailingLists.push(created);
          result.created += 1;
        }
        changed = true;
      }
      return { changed, result };
    });
  }

  async createCalendarEvent(input: CreateCalendarEventInput): Promise<CalendarEvent> {
    const parsed = createCalendarEventSchema.parse(input);
    return this.#store.mutate(state => {
      const uid = this.#availableUid(state, "calendar-event", parsed.uid);
      const now = this.#now();
      const { uid: _requestedUid, ...content } = parsed;
      const event = calendarEventSchema.parse({ uid, ...content, createdAt: now, updatedAt: now, revision: 1 });
      state.calendarEvents.push(event);
      this.#record(state, "created", "calendar-event", event.uid, null, event, now);
      return { changed: true, result: event };
    });
  }

  async getCalendarEvent(uid: string): Promise<CalendarEvent | null> {
    const validatedUid = uidSchema.parse(uid);
    return (await this.#store.read()).calendarEvents.find(event => event.uid === validatedUid) ?? null;
  }

  async listCalendarEvents(): Promise<CalendarEvent[]> {
    const state = await this.#store.read();
    return state.calendarEvents
      .sort((left, right) => temporalSortValue(left.start) - temporalSortValue(right.start) || left.title.localeCompare(right.title));
  }

  async updateCalendarEvent(uid: string, patch: CalendarEventPatch): Promise<CalendarEvent> {
    const validatedUid = uidSchema.parse(uid);
    const parsedPatch = calendarEventPatchSchema.parse(patch);
    return this.#store.mutate(state => {
      const index = state.calendarEvents.findIndex(event => event.uid === validatedUid);
      const current = state.calendarEvents[index];
      if (!current) throw new PimNotFoundError(`Calendar event ${validatedUid} does not exist.`);
      const candidate = calendarEventSchema.parse({
        uid: current.uid,
        ...applyPatch(withoutMetadata(current), parsedPatch),
        createdAt: current.createdAt,
        updatedAt: current.updatedAt,
        revision: current.revision,
      });
      if (same(withoutMetadata(current), withoutMetadata(candidate))) return { changed: false, result: current };
      const now = this.#now();
      const updated = calendarEventSchema.parse({ ...candidate, uid: current.uid, createdAt: current.createdAt, updatedAt: now, revision: current.revision + 1 });
      state.calendarEvents[index] = updated;
      this.#record(state, "updated", "calendar-event", current.uid, current, updated, now);
      return { changed: true, result: updated };
    });
  }

  async deleteCalendarEvent(uid: string): Promise<boolean> {
    const validatedUid = uidSchema.parse(uid);
    return this.#store.mutate(state => {
      const index = state.calendarEvents.findIndex(event => event.uid === validatedUid);
      const current = state.calendarEvents[index];
      if (!current) return { changed: false, result: false };
      state.calendarEvents.splice(index, 1);
      this.#record(state, "deleted", "calendar-event", current.uid, current, null, this.#now());
      return { changed: true, result: true };
    });
  }

  async restoreCalendarEvent(uid: string, sourceTransactionId?: string): Promise<CalendarEvent> {
    return this.#restore("calendar-event", uid, sourceTransactionId, calendarEventSchema, state => state.calendarEvents);
  }

  async createTask(input: CreateTaskInput): Promise<Task> {
    const parsed = createTaskSchema.parse(input);
    return this.#store.mutate(state => {
      const uid = this.#availableUid(state, "task", parsed.uid);
      const now = this.#now();
      const { uid: _requestedUid, ...rawContent } = parsed;
      const content = this.#normalizeTaskContent(rawContent, now);
      const task = taskSchema.parse({ uid, ...content, createdAt: now, updatedAt: now, revision: 1 });
      state.tasks.push(task);
      state.taskMutationVersion += 1;
      this.#record(state, "created", "task", task.uid, null, task, now);
      return { changed: true, result: task };
    });
  }

  async getTask(uid: string): Promise<Task | null> {
    const validatedUid = uidSchema.parse(uid);
    return (await this.#store.read()).tasks.find(task => task.uid === validatedUid) ?? null;
  }

  async listTasks(): Promise<Task[]> {
    const state = await this.#store.read();
    return state.tasks.sort((left, right) => {
      const leftDue = left.due ? temporalSortValue(left.due) : Number.POSITIVE_INFINITY;
      const rightDue = right.due ? temporalSortValue(right.due) : Number.POSITIVE_INFINITY;
      const leftPriority = left.priority === 0 ? 10 : left.priority;
      const rightPriority = right.priority === 0 ? 10 : right.priority;
      return leftDue - rightDue || leftPriority - rightPriority || left.title.localeCompare(right.title);
    });
  }

  async updateTask(uid: string, patch: TaskPatch): Promise<Task> {
    const validatedUid = uidSchema.parse(uid);
    const parsedPatch = taskPatchSchema.parse(patch);
    return this.#store.mutate(state => {
      const index = state.tasks.findIndex(task => task.uid === validatedUid);
      const current = state.tasks[index];
      if (!current) throw new PimNotFoundError(`Task ${validatedUid} does not exist.`);
      const now = this.#now();
      const candidateContent = this.#normalizeTaskContent(applyPatch(withoutMetadata(current), parsedPatch), now);
      const candidate = taskSchema.parse({
        uid: current.uid,
        ...candidateContent,
        createdAt: current.createdAt,
        updatedAt: current.updatedAt,
        revision: current.revision,
      });
      if (same(withoutMetadata(current), withoutMetadata(candidate))) return { changed: false, result: current };
      const updated = taskSchema.parse({ ...candidate, uid: current.uid, createdAt: current.createdAt, updatedAt: now, revision: current.revision + 1 });
      state.tasks[index] = updated;
      state.taskMutationVersion += 1;
      this.#record(state, "updated", "task", current.uid, current, updated, now);
      return { changed: true, result: updated };
    });
  }

  async deleteTask(uid: string): Promise<boolean> {
    const validatedUid = uidSchema.parse(uid);
    return this.#store.mutate(state => {
      const index = state.tasks.findIndex(task => task.uid === validatedUid);
      const current = state.tasks[index];
      if (!current) return { changed: false, result: false };
      state.tasks.splice(index, 1);
      state.taskMutationVersion += 1;
      this.#record(state, "deleted", "task", current.uid, current, null, this.#now());
      return { changed: true, result: true };
    });
  }

  async restoreTask(uid: string, sourceTransactionId?: string): Promise<Task> {
    return this.#restore("task", uid, sourceTransactionId, taskSchema, state => state.tasks, true);
  }

  async refreshTasks(loader: (requestId: number) => Promise<readonly TaskRefreshInput[]>): Promise<TaskRefreshResult> {
    const requestId = ++this.#latestTaskRefreshRequest;
    const baselineMutationVersion = (await this.#store.read()).taskMutationVersion;
    const rawTasks = await loader(requestId);
    if (requestId !== this.#latestTaskRefreshRequest) return { requestId, applied: false, reason: "superseded", created: 0, updated: 0, unchanged: 0 };
    if ((await this.#store.read()).taskMutationVersion !== baselineMutationVersion) {
      return { requestId, applied: false, reason: "local-state-changed", created: 0, updated: 0, unchanged: 0 };
    }
    const refreshed = z.array(taskRefreshInputSchema).max(100_000).parse(rawTasks);
    const uniqueUids = new Set(refreshed.map(task => task.uid));
    if (uniqueUids.size !== refreshed.length) throw new PimConflictError("A task refresh cannot contain duplicate UIDs.");

    return this.#store.mutate(state => {
      if (requestId !== this.#latestTaskRefreshRequest) {
        return { changed: false, result: { requestId, applied: false, reason: "superseded", created: 0, updated: 0, unchanged: 0 } as TaskRefreshResult };
      }
      if (state.taskMutationVersion !== baselineMutationVersion) {
        return { changed: false, result: { requestId, applied: false, reason: "local-state-changed", created: 0, updated: 0, unchanged: 0 } as TaskRefreshResult };
      }

      const result: TaskRefreshResult = { requestId, applied: true, reason: "applied", created: 0, updated: 0, unchanged: 0 };
      const now = this.#now();
      for (const incoming of refreshed) {
        const { uid, ...rawPatch } = incoming;
        const index = state.tasks.findIndex(task => task.uid === uid);
        const current = state.tasks[index];
        if (!current) {
          if (this.#isHistoricalUid(state, "task", uid)) {
            throw new PimConflictError(`Task UID ${uid} belongs to deleted history; restore that task before refreshing an update.`);
          }
          const parsedNew = createTaskSchema.parse({ uid, ...applyPatch({}, rawPatch) });
          const { uid: _newUid, ...newContent } = parsedNew;
          const content = this.#normalizeTaskContent(newContent, now);
          const revision = this.#latestRevision(state, "task", uid) + 1;
          const created = taskSchema.parse({ uid, ...content, createdAt: now, updatedAt: now, revision });
          state.tasks.push(created);
          this.#record(state, "created", "task", uid, null, created, now);
          result.created += 1;
          continue;
        }
        const content = this.#normalizeTaskContent(applyPatch(withoutMetadata(current), rawPatch), now);
        const candidate = taskSchema.parse({
          uid,
          ...content,
          createdAt: current.createdAt,
          updatedAt: current.updatedAt,
          revision: current.revision,
        });
        if (same(withoutMetadata(current), withoutMetadata(candidate))) {
          result.unchanged += 1;
          continue;
        }
        const updated = taskSchema.parse({ ...candidate, uid, createdAt: current.createdAt, updatedAt: now, revision: current.revision + 1 });
        state.tasks[index] = updated;
        this.#record(state, "updated", "task", uid, current, updated, now);
        result.updated += 1;
      }
      const changed = result.created + result.updated > 0;
      if (changed) state.taskMutationVersion += 1;
      return { changed, result };
    });
  }

  async listTransactions(filter: TransactionFilter = {}): Promise<PimTransaction[]> {
    const validatedFilter = transactionFilterSchema.parse(filter);
    const { from, to } = validatedFilter;
    if (from && to && Date.parse(from) > Date.parse(to)) throw new TypeError("Transaction filter start must not follow its end.");
    const actions = validatedFilter.actions ? new Set(validatedFilter.actions) : null;
    const kinds = validatedFilter.entityKinds ? new Set(validatedFilter.entityKinds) : null;
    const uids = validatedFilter.entityUids ? new Set(validatedFilter.entityUids) : null;
    const fromTime = from ? Date.parse(from) : Number.NEGATIVE_INFINITY;
    const toTime = to ? Date.parse(to) : Number.POSITIVE_INFINITY;
    const state = await this.#store.read();
    return state.transactions.filter(transaction => {
      const time = Date.parse(transaction.occurredAt);
      return (
        (!actions || actions.has(transaction.action)) &&
        (!kinds || kinds.has(transaction.entityKind)) &&
        (!uids || uids.has(transaction.entityUid)) &&
        time >= fromTime &&
        time <= toTime
      );
    });
  }

  async #restore<Kind extends PimEntityKind>(
    kind: Kind,
    uid: string,
    sourceTransactionId: string | undefined,
    schema: z.ZodType<PimEntityMap[Kind]>,
    collectionFor: (state: PersistedPimState) => PimEntityMap[Kind][],
    taskMutation = false,
  ): Promise<PimEntityMap[Kind]> {
    const validatedUid = uidSchema.parse(uid);
    const validatedTransactionId = sourceTransactionId === undefined ? undefined : uidSchema.parse(sourceTransactionId);
    return this.#store.mutate(state => {
      const collection = collectionFor(state);
      const index = collection.findIndex(entity => entity.uid === validatedUid);
      const current = collection[index];
      const source = this.#restoreSource(state, kind, validatedUid, validatedTransactionId);
      if (!source) throw new PimNotFoundError(`No restorable ${kind} revision exists for ${validatedUid}.`);
      if (current && same(withoutMetadata(current), withoutMetadata(source))) return { changed: false, result: current };
      const now = this.#now();
      const restored = schema.parse({
        ...source,
        uid: validatedUid,
        createdAt: source.createdAt,
        updatedAt: now,
        revision: this.#latestRevision(state, kind, validatedUid) + 1,
      });
      if (index >= 0) collection[index] = restored;
      else collection.push(restored);
      if (taskMutation) state.taskMutationVersion += 1;
      this.#record(state, "restored", kind, validatedUid, current ?? null, restored, now);
      return { changed: true, result: restored };
    });
  }

  #restoreSource<Kind extends PimEntityKind>(
    state: PersistedPimState,
    kind: Kind,
    uid: string,
    transactionId?: string,
  ): PimEntityMap[Kind] | null {
    const transaction = transactionId
      ? state.transactions.find(candidate => candidate.id === transactionId && candidate.entityKind === kind && candidate.entityUid === uid)
      : [...state.transactions].reverse().find(candidate => candidate.entityKind === kind && candidate.entityUid === uid && (candidate.before ?? candidate.after));
    if (!transaction) return null;
    const snapshot = transaction.action === "created" ? transaction.after : (transaction.before ?? transaction.after);
    if (!snapshot || snapshot.entityKind !== kind) return null;
    return snapshot.value as PimEntityMap[Kind];
  }

  #normalizeTaskContent<Content extends Record<string, unknown>>(content: Content, now: string): Content {
    const normalized: Record<string, unknown> = { ...content };
    if (normalized.status === "completed") {
      normalized.percentComplete = 100;
      normalized.completedAt ??= now;
    } else {
      delete normalized.completedAt;
      if (typeof normalized.percentComplete === "number" && normalized.percentComplete >= 100) normalized.percentComplete = 99;
    }
    return normalized as Content;
  }

  #assertContactsExist(state: PersistedPimState, memberUids: readonly string[]): void {
    const contacts = new Set(state.contacts.map(contact => contact.uid));
    const missing = memberUids.filter(uid => !contacts.has(uid));
    if (missing.length) throw new PimConflictError(`Mailing-list members do not exist: ${missing.join(", ")}.`);
  }

  #selectByUid<Entity extends { uid: string }>(entities: readonly Entity[], requestedUids: readonly string[], label: string): Entity[] {
    const validated = requestedUids.map(uid => uidSchema.parse(uid));
    const byUid = new Map(entities.map(entity => [entity.uid, entity]));
    return validated.map(uid => {
      const entity = byUid.get(uid);
      if (!entity) throw new PimNotFoundError(`${label} ${uid} does not exist.`);
      return entity;
    });
  }

  #availableUid(state: PersistedPimState, kind: PimEntityKind, requested?: string): string {
    const collection = this.#entityCollection(state, kind);
    const isKnown = (uid: string): boolean =>
      collection.some(entity => entity.uid === uid) || this.#isHistoricalUid(state, kind, uid);
    if (requested) {
      const uid = uidSchema.parse(requested);
      if (isKnown(uid)) throw new PimConflictError(`${kind} UID ${uid} already exists or is reserved by its history.`);
      return uid;
    }
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const uid = uidSchema.parse(this.#idFactory());
      if (!isKnown(uid)) return uid;
    }
    throw new PimConflictError(`Could not allocate a unique ${kind} UID.`);
  }

  #isHistoricalUid(state: PersistedPimState, kind: PimEntityKind, uid: string): boolean {
    return state.transactions.some(transaction => transaction.entityKind === kind && transaction.entityUid === uid);
  }

  #entityCollection(state: PersistedPimState, kind: PimEntityKind): Array<{ uid: string; revision: number }> {
    switch (kind) {
      case "contact":
        return state.contacts;
      case "mailing-list":
        return state.mailingLists;
      case "calendar-event":
        return state.calendarEvents;
      case "task":
        return state.tasks;
    }
  }

  #latestRevision(state: PersistedPimState, kind: PimEntityKind, uid: string): number {
    let revision = this.#entityCollection(state, kind).find(entity => entity.uid === uid)?.revision ?? 0;
    for (const transaction of state.transactions) {
      if (transaction.entityKind !== kind || transaction.entityUid !== uid) continue;
      revision = Math.max(revision, transaction.before?.value.revision ?? 0, transaction.after?.value.revision ?? 0);
    }
    return revision;
  }

  #record<Kind extends PimEntityKind>(
    state: PersistedPimState,
    action: TransactionAction,
    kind: Kind,
    uid: string,
    before: PimEntityMap[Kind] | null,
    after: PimEntityMap[Kind] | null,
    occurredAt: string,
  ): PimTransaction {
    const beforeSnapshot = before ? transactionSnapshotSchema.parse({ entityKind: kind, value: before }) : null;
    const afterSnapshot = after ? transactionSnapshotSchema.parse({ entityKind: kind, value: after }) : null;
    let id = uidSchema.parse(this.#idFactory());
    for (let attempt = 0; state.transactions.some(transaction => transaction.id === id); attempt += 1) {
      if (attempt >= 100) throw new PimConflictError("Could not allocate a unique PIM transaction UID.");
      id = uidSchema.parse(this.#idFactory());
    }
    const transaction = pimTransactionSchema.parse({
      id,
      sequence: state.nextTransactionSequence,
      occurredAt,
      action,
      entityKind: kind,
      entityUid: uid,
      before: beforeSnapshot as PimTransactionSnapshot | null,
      after: afterSnapshot as PimTransactionSnapshot | null,
    });
    state.nextTransactionSequence += 1;
    state.transactions.push(transaction);
    return transaction;
  }

  #now(): string {
    const date = this.#clock();
    if (!(date instanceof Date) || !Number.isFinite(date.getTime())) throw new TypeError("The PIM clock returned an invalid date.");
    return date.toISOString();
  }
}
