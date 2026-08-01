import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ICalendarParseError, parseICalendarBundle, serializeICalendarBundle } from "../../src/main/pim/icalendar";
import { PimService } from "../../src/main/pim/pim-service";

const calendar = (...components: string[]): string => [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//Material Email test//EN",
  ...components,
  "END:VCALENDAR",
  "",
].join("\r\n");

const event = (uid = "event-1", title = "Planning, local"): string => [
  "BEGIN:VEVENT",
  `UID:${uid}`,
  `SUMMARY:${title.replace(/,/g, "\\,")}`,
  "DESCRIPTION:Line one\\nLine two",
  "LOCATION:Room 101",
  "DTSTART;TZID=America/Toronto:20260803T090000",
  "DTEND;TZID=America/Toronto:20260803T100000",
  "RRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=3;BYDAY=MO,WE;WKST=MO",
  "EXDATE;TZID=America/Toronto:20260817T090000",
  "ORGANIZER;CN=Owner:mailto:owner@example.test",
  "ATTENDEE;CN=Ada;ROLE=OPT-PARTICIPANT;PARTSTAT=ACCEPTED;RSVP=TRUE:mailto:ada@example.test",
  "CATEGORIES:planning,local",
  "STATUS:CONFIRMED",
  "TRANSP:OPAQUE",
  "BEGIN:VALARM",
  "ACTION:DISPLAY",
  "TRIGGER:-PT15M",
  "DESCRIPTION:Starts soon",
  "END:VALARM",
  "END:VEVENT",
].join("\r\n");

const task = (uid = "task-1", title = "Ship client"): string => [
  "BEGIN:VTODO",
  `UID:${uid}`,
  `SUMMARY:${title}`,
  "DESCRIPTION:Package the local build",
  "DTSTART;VALUE=DATE:20260801",
  "DUE;VALUE=DATE:20260807",
  "STATUS:IN-PROGRESS",
  "PRIORITY:1",
  "PERCENT-COMPLETE:40",
  "CATEGORIES:release",
  "SEQUENCE:7",
  "END:VTODO",
].join("\r\n");

describe("bounded iCalendar record codec", () => {
  it("maps supported VEVENT and VTODO fields without expanding recurrence", () => {
    const parsed = parseICalendarBundle(calendar(event(), task()));
    expect(parsed.events).toHaveLength(1);
    expect(parsed.events[0]).toMatchObject({
      uid: "event-1",
      title: "Planning, local",
      description: "Line one\nLine two",
      start: { kind: "date-time", timeZone: "America/Toronto" },
      recurrence: { frequency: "weekly", interval: 2, count: 3, byWeekday: ["MO", "WE"] },
      organizer: { email: "owner@example.test" },
      attendees: [{ email: "ada@example.test", role: "optional", participationStatus: "accepted", rsvp: true }],
      alarms: [{ action: "display", trigger: { kind: "relative", minutes: -15 } }],
    });
    expect(parsed.tasks[0]).toMatchObject({
      uid: "task-1",
      title: "Ship client",
      status: "in-progress",
      due: { kind: "date", value: "2026-08-07" },
      priority: 1,
      percentComplete: 40,
      sourceRevision: "SEQUENCE:7",
    });
  });

  it("serializes normalized CRLF iCalendar that round-trips through the bounded parser", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "material-email-ics-codec-"));
    const service = new PimService(directory);
    await service.importICalendar(calendar(event(), task()), "update");
    const events = await service.listCalendarEvents();
    const tasks = await service.listTasks();
    const exported = serializeICalendarBundle(events, tasks);
    expect(exported).toMatch(/^BEGIN:VCALENDAR\r\nVERSION:2\.0\r\n/u);
    expect(exported).not.toMatch(/(?<!\r)\n/u);
    expect(exported.endsWith("\r\n")).toBe(true);
    const roundTrip = parseICalendarBundle(exported);
    expect(roundTrip.events).toHaveLength(1);
    expect(roundTrip.tasks).toHaveLength(1);
    expect(roundTrip.events[0]?.title).toBe("Planning, local");
  });

  it("applies duplicate policies and rolls the entire import back on a late conflict", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "material-email-ics-atomic-"));
    const service = new PimService(directory, { clock: () => new Date("2026-08-01T12:00:00Z") });
    expect(await service.importICalendar(calendar(event(), task()), "update")).toMatchObject({ created: 2, updated: 0 });
    expect(await service.importICalendar(calendar(event("event-1", "Changed"), task("task-1", "Changed")), "skip")).toMatchObject({ skipped: 2, updated: 0 });
    expect((await service.getCalendarEvent("event-1"))?.title).toBe("Planning, local");
    expect(await service.importICalendar(calendar(event("event-1", "Changed"), task("task-1", "Changed")), "update")).toMatchObject({ updated: 2, skipped: 0 });

    const transactionsBefore = await service.listTransactions();
    await expect(service.importICalendar(calendar(event("new-event", "Must roll back"), task("event-1", "Wrong local type")), "update"))
      .rejects.toThrow(/reserved|record type/iu);
    expect(await service.getCalendarEvent("new-event")).toBeNull();
    expect(await service.listTransactions()).toHaveLength(transactionsBefore.length);
  });

  it("rejects unsupported scheduling and incomplete required record fields", () => {
    expect(() => parseICalendarBundle(calendar("METHOD:REQUEST", event()))).toThrow(ICalendarParseError);
    expect(() => parseICalendarBundle(calendar("BEGIN:VEVENT\r\nUID:no-title\r\nDTSTART:20260801T120000Z\r\nDTEND:20260801T130000Z\r\nEND:VEVENT"))).toThrow(/SUMMARY/iu);
  });
});
