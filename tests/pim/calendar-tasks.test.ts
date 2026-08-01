import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PimService, type TaskRefreshInput } from "../../src/main/pim";

interface Deferred<Value> {
  promise: Promise<Value>;
  resolve: (value: Value) => void;
}

const deferred = <Value>(): Deferred<Value> => {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>(fulfill => {
    resolve = fulfill;
  });
  return { promise, resolve };
};

describe("local calendar events", () => {
  it("creates the default Home calendar and preserves recurrence, attendees, alarms, updates, deletion, and append-only restoration", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "material-email-calendar-"));
    const service = new PimService(directory);
    expect(await service.getHomeCalendar()).toMatchObject({ uid: "home", name: "Home", kind: "local", readOnly: false });

    const event = await service.createCalendarEvent({
      uid: "weekly-planning",
      title: "Weekly planning",
      description: "Review the local backlog",
      start: { kind: "date-time", value: "2026-08-03T09:00:00-04:00", timeZone: "America/Toronto" },
      end: { kind: "date-time", value: "2026-08-03T10:00:00-04:00", timeZone: "America/Toronto" },
      recurrence: {
        frequency: "weekly",
        interval: 2,
        count: 12,
        byWeekday: ["MO", "WE"],
        weekStart: "MO",
        additionalDates: [{ kind: "date-time", value: "2026-08-04T09:00:00-04:00", timeZone: "America/Toronto" }],
        exceptionDates: [{ kind: "date-time", value: "2026-08-17T09:00:00-04:00", timeZone: "America/Toronto" }],
      },
      organizer: { email: "owner@example.test", name: "Owner", role: "chair", participationStatus: "accepted" },
      attendees: [
        { email: "ada@example.test", name: "Ada", participationStatus: "accepted" },
        { email: "grace@example.test", name: "Grace", role: "optional", rsvp: true },
      ],
      alarms: [
        { uid: "alarm-display", trigger: { kind: "relative", minutes: -15 }, description: "Planning starts soon" },
        { uid: "alarm-audio", action: "audio", trigger: { kind: "absolute", at: "2026-08-03T12:40:00Z" } },
      ],
      categories: ["planning", "local"],
    });
    expect(event.calendarUid).toBe("home");
    expect(event.recurrence).toMatchObject({ frequency: "weekly", interval: 2, count: 12, byWeekday: ["MO", "WE"] });
    expect(event.attendees).toHaveLength(2);
    expect(event.alarms).toHaveLength(2);

    const generation = await service.storageGeneration();
    expect(await service.updateCalendarEvent(event.uid, { title: event.title })).toEqual(event);
    expect(await service.storageGeneration()).toBe(generation);
    const updated = await service.updateCalendarEvent(event.uid, { location: "Room 101" });
    expect(updated.revision).toBe(2);
    expect(updated.recurrence).toEqual(event.recurrence);

    expect(await service.deleteCalendarEvent(event.uid)).toBe(true);
    const restored = await service.restoreCalendarEvent(event.uid);
    expect(restored).toMatchObject({ uid: event.uid, location: "Room 101", revision: 3 });
    expect(restored.recurrence).toEqual(event.recurrence);
    expect((await service.listTransactions({ entityKinds: ["calendar-event"] })).map(transaction => transaction.action)).toEqual([
      "created",
      "updated",
      "deleted",
      "restored",
    ]);

    await expect(
      service.createCalendarEvent({
        title: "Backwards",
        start: { kind: "date-time", value: "2026-08-03T11:00:00Z" },
        end: { kind: "date-time", value: "2026-08-03T10:00:00Z" },
      }),
    ).rejects.toThrow("after its start");
  });
});

describe("local tasks and refresh supersession", () => {
  it("supports task lifecycle fields and filters multiple transaction actions", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "material-email-tasks-"));
    const service = new PimService(directory);
    const task = await service.createTask({
      uid: "ship-client",
      title: "Ship the client",
      status: "in-progress",
      entry: { kind: "date", value: "2026-07-31" },
      due: { kind: "date", value: "2026-08-07" },
      priority: 1,
      percentComplete: 40,
      categories: ["release"],
    });
    expect(task).toMatchObject({ calendarUid: "home", status: "in-progress", priority: 1, percentComplete: 40 });

    const completed = await service.updateTask(task.uid, { status: "completed" });
    expect(completed.status).toBe("completed");
    expect(completed.percentComplete).toBe(100);
    expect(completed.completedAt).toBeDefined();
    const generation = await service.storageGeneration();
    expect(await service.updateTask(task.uid, { status: "completed" })).toEqual(completed);
    expect(await service.storageGeneration()).toBe(generation);

    expect(await service.deleteTask(task.uid)).toBe(true);
    const restored = await service.restoreTask(task.uid);
    expect(restored).toMatchObject({ uid: task.uid, status: "completed", priority: 1, revision: 3 });
    const filtered = await service.listTransactions({ actions: ["created", "deleted"], entityKinds: ["task"] });
    expect(filtered.map(transaction => transaction.action)).toEqual(["created", "deleted"]);
    expect(filtered.every(transaction => transaction.entityKind === "task")).toBe(true);
  });

  it("discards an older overlapping refresh after a newer refresh wins", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "material-email-refresh-order-"));
    const service = new PimService(directory);
    await service.createTask({ uid: "refresh-me", title: "Original", priority: 5, due: { kind: "date", value: "2026-08-20" } });
    const slow = deferred<readonly TaskRefreshInput[]>();
    const fast = deferred<readonly TaskRefreshInput[]>();

    const slowResult = service.refreshTasks(() => slow.promise);
    const fastResult = service.refreshTasks(() => fast.promise);
    fast.resolve([{ uid: "refresh-me", title: "Newest snapshot", priority: 1, due: null, sourceRevision: "rev-2" }]);
    expect(await fastResult).toMatchObject({ applied: true, reason: "applied", updated: 1 });
    slow.resolve([{ uid: "refresh-me", title: "Stale and invalid snapshot", priority: 99, sourceRevision: "rev-1" }] as never);
    expect(await slowResult).toMatchObject({ applied: false, reason: "superseded", updated: 0 });
    const refreshed = await service.getTask("refresh-me");
    expect(refreshed).toMatchObject({ title: "Newest snapshot", priority: 1, sourceRevision: "rev-2" });
    expect(refreshed).not.toHaveProperty("due");
  });

  it("does not let an in-flight refresh overwrite a local edit", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "material-email-refresh-local-"));
    const service = new PimService(directory);
    await service.createTask({ uid: "local-edit", title: "Before edit" });
    const payload = deferred<readonly TaskRefreshInput[]>();
    const started = deferred<void>();
    const refresh = service.refreshTasks(() => {
      started.resolve();
      return payload.promise;
    });
    await started.promise;
    await service.updateTask("local-edit", { title: "Edited locally" });
    payload.resolve([{ uid: "local-edit", title: "Late refresh" }]);

    expect(await refresh).toMatchObject({ applied: false, reason: "local-state-changed" });
    expect(await service.getTask("local-edit")).toMatchObject({ title: "Edited locally" });
  });

  it("rejects refresh attempts that reuse a deleted task UID", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "material-email-refresh-tombstone-"));
    const service = new PimService(directory);
    await service.createTask({ uid: "deleted-task", title: "Original task" });
    await service.deleteTask("deleted-task");
    const transactionCount = (await service.listTransactions()).length;

    await expect(service.refreshTasks(async () => [{ uid: "deleted-task", title: "Different task" }])).rejects.toThrow(
      "belongs to deleted history",
    );
    expect(await service.getTask("deleted-task")).toBeNull();
    expect(await service.listTransactions()).toHaveLength(transactionCount);
  });
});
