import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PimService } from "../../src/main/pim";

const makeClock = (): (() => Date) => {
  let tick = 0;
  return () => new Date(Date.UTC(2026, 6, 31, 12, 0, tick++));
};

const makeService = async (): Promise<{ directory: string; service: PimService }> => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "material-email-pim-"));
  return { directory, service: new PimService(directory, { clock: makeClock() }) };
};

describe("PimService contacts and mailing lists", () => {
  it("keeps stable UIDs through CRUD, suppresses no-ops, searches all structured fields, and restores append-only", async () => {
    const { directory, service } = await makeService();
    const contact = await service.createContact({
      uid: "contact-ada",
      displayName: "Ada Lovelace",
      name: { given: "Ada", family: "Lovelace" },
      emails: [
        { value: "ada@example.test", types: ["work"], preferred: true },
        { value: "countess@example.test", types: ["home"] },
      ],
      phones: [
        { value: "+44 20 7946 0958", types: ["work"], preferred: true },
        { value: "+44 20 7000 0000", types: ["mobile"] },
      ],
      addresses: [
        {
          street: "12 St James's Square",
          locality: "London",
          postalCode: "SW1Y 4LB",
          country: "United Kingdom",
          types: ["work"],
          preferred: true,
        },
      ],
      organization: "Analytical Engine Society",
      title: "Mathematician",
      notes: "First programmer",
    });

    expect(contact.uid).toBe("contact-ada");
    expect(await service.searchContacts("countess London")).toEqual([contact]);
    expect(await service.searchContacts("+44 20 7000")).toEqual([contact]);
    expect(await service.searchContacts("analytical mathematician")).toEqual([contact]);

    const list = await service.createMailingList({
      uid: "list-pioneers",
      name: "Computing Pioneers",
      nickname: "pioneers",
      memberUids: [contact.uid],
    });
    expect((await service.listMailingListMembers(list.uid)).map(member => member.uid)).toEqual([contact.uid]);

    const listGeneration = await service.storageGeneration();
    expect(await service.updateMailingList(list.uid, { name: list.name })).toEqual(list);
    expect(await service.storageGeneration()).toBe(listGeneration);
    const renamedList = await service.updateMailingList(list.uid, { name: "Computing and Mathematics Pioneers" });
    expect(renamedList).toMatchObject({ uid: list.uid, revision: 2, name: "Computing and Mathematics Pioneers" });
    expect(await service.deleteMailingList(list.uid)).toBe(true);
    expect(await service.deleteMailingList(list.uid)).toBe(false);
    expect(await service.getMailingList(list.uid)).toBeNull();
    const restoredList = await service.restoreMailingList(list.uid);
    expect(restoredList).toMatchObject({ uid: list.uid, revision: 3, name: "Computing and Mathematics Pioneers" });

    const generationBeforeNoop = await service.storageGeneration();
    const noop = await service.updateContact(contact.uid, { displayName: contact.displayName });
    expect(noop).toEqual(contact);
    expect(await service.storageGeneration()).toBe(generationBeforeNoop);

    const updated = await service.updateContact(contact.uid, { title: "Mathematician and writer" });
    expect(updated.uid).toBe(contact.uid);
    expect(updated.revision).toBe(2);
    expect(updated.title).toBe("Mathematician and writer");

    expect(await service.deleteContact(contact.uid)).toBe(true);
    expect(await service.deleteContact(contact.uid)).toBe(false);
    expect(await service.getContact(contact.uid)).toBeNull();

    const restored = await service.restoreContact(contact.uid);
    expect(restored.uid).toBe(contact.uid);
    expect(restored.revision).toBe(3);
    expect(restored.title).toBe("Mathematician and writer");
    expect((await service.listMailingListMembers(list.uid)).map(member => member.uid)).toEqual([contact.uid]);

    const actions = (await service.listTransactions({ entityKinds: ["contact"], entityUids: [contact.uid] })).map(transaction => transaction.action);
    expect(actions).toEqual(["created", "updated", "deleted", "restored"]);
    const sequences = (await service.listTransactions()).map(transaction => transaction.sequence);
    expect(sequences).toEqual([...sequences].sort((left, right) => left - right));
    expect(new Set(sequences).size).toBe(sequences.length);

    expect((await service.listTransactions({ entityKinds: ["mailing-list"] })).map(transaction => transaction.action)).toEqual([
      "created",
      "updated",
      "deleted",
      "restored",
    ]);

    const reopened = new PimService(directory);
    expect(await reopened.getContact(contact.uid)).toEqual(restored);
    expect(await reopened.getMailingList(list.uid)).toEqual(restoredList);
  });

  it("validates inputs strictly and preserves existing state after rejected changes", async () => {
    const { service } = await makeService();
    await expect(
      service.createContact({
        displayName: "Unsafe payload",
        emails: [{ value: "valid@example.test" }],
        secret: "must-not-be-stored",
      } as never),
    ).rejects.toThrow();
    expect(await service.listContacts()).toEqual([]);

    const contact = await service.createContact({ displayName: "Grace Hopper", emails: [{ value: "grace@example.test" }] });
    await expect(service.createMailingList({ name: "Broken list", memberUids: ["missing-contact"] })).rejects.toThrow("do not exist");
    expect(await service.getContact(contact.uid)).toEqual(contact);
    expect(await service.listMailingLists()).toEqual([]);
  });

  it("uses explicit null patches to clear optional fields without persisting null entity values", async () => {
    const { service } = await makeService();
    const contact = await service.createContact({ displayName: "Clear Me", notes: "Temporary note" });
    const clearedContact = await service.updateContact(contact.uid, { notes: null });
    expect(clearedContact).not.toHaveProperty("notes");

    const list = await service.createMailingList({ name: "Temporary list", description: "Temporary description" });
    const clearedList = await service.updateMailingList(list.uid, { description: null });
    expect(clearedList).not.toHaveProperty("description");

    const event = await service.createCalendarEvent({
      title: "Temporary event",
      location: "Temporary room",
      start: { kind: "date-time", value: "2026-08-01T12:00:00Z" },
      end: { kind: "date-time", value: "2026-08-01T13:00:00Z" },
      recurrence: { frequency: "daily", count: 2 },
    });
    const clearedEvent = await service.updateCalendarEvent(event.uid, { location: null, recurrence: null });
    expect(clearedEvent).not.toHaveProperty("location");
    expect(clearedEvent).not.toHaveProperty("recurrence");

    const task = await service.createTask({ title: "Temporary task", due: { kind: "date", value: "2026-08-02" } });
    const clearedTask = await service.updateTask(task.uid, { due: null });
    expect(clearedTask).not.toHaveProperty("due");
  });

  it("never reuses a tombstoned stable UID through vCard import", async () => {
    const { service } = await makeService();
    const original = await service.createContact({ uid: "reserved-contact", displayName: "Original identity" });
    const exported = await service.exportContactVCard(original.uid);
    await service.deleteContact(original.uid);
    const transactionCount = (await service.listTransactions()).length;

    await expect(service.importVCard(exported.replace("Original identity", "Different identity"))).rejects.toThrow("belongs to deleted history");
    expect(await service.getContact(original.uid)).toBeNull();
    expect(await service.listTransactions()).toHaveLength(transactionCount);
  });
});
