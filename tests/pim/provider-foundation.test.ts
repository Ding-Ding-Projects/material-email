import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  inspectPimInterchange,
  normalizePimInterchangeForExport,
  PimInterchangeBoundaryError,
  PimProviderFoundationStateMachine,
  runPimProviderFoundation,
  validatePimProviderProfile,
} from "../../src/main/pim/provider-foundation";

describe("bounded local PIM provider foundation", () => {
  it("uses one deterministic state trace and rejects out-of-order events", () => {
    const machine = new PimProviderFoundationStateMachine();
    expect(() => machine.transition("finish")).toThrow(/not valid while the state is idle/iu);
    for (const event of ["start", "accept-profile", "inspect-local-capabilities", "finish"] as const) machine.transition(event);
    expect(machine.state).toBe("ready");
    expect(machine.transitions()).toEqual([
      { sequence: 1, from: "idle", event: "start", to: "validating" },
      { sequence: 2, from: "validating", event: "accept-profile", to: "capability-review" },
      { sequence: 3, from: "capability-review", event: "inspect-local-capabilities", to: "capability-review" },
      { sequence: 4, from: "capability-review", event: "finish", to: "ready" },
    ]);
  });

  it("accepts canonical HTTPS CardDAV and CalDAV profiles without using their auth label", () => {
    const carddav = runPimProviderFoundation({ kind: "carddav", endpointUrl: " https://DAV.Example.test:443/address-books/ ", authMode: "basic" });
    const caldav = runPimProviderFoundation({ kind: "caldav", endpointUrl: "https://calendar.example.test/dav/", authMode: "oauth2" });
    expect(carddav).toMatchObject({
      state: "ready",
      boundary: "local-validation-only",
      profile: { kind: "carddav", endpointUrl: "https://dav.example.test/address-books/", authMode: "basic" },
      serverContacted: false,
      credentialsUsed: false,
      providerStatePersisted: false,
      liveSynchronization: false,
      recurrenceExpanded: false,
    });
    expect(carddav.capabilities).toContainEqual({ name: "local-vcard-boundary", available: true, used: false, evidence: "bounded-local-parser" });
    expect(caldav.capabilities).toContainEqual({ name: "local-icalendar-boundary", available: true, used: false, evidence: "bounded-local-parser" });
    expect(caldav.capabilities.filter(capability => capability.name === "credential-use" || capability.name.startsWith("remote-")).every(capability => !capability.available && !capability.used)).toBe(true);
  });

  it("rejects insecure or credential-bearing DAV URLs locally", () => {
    for (const endpointUrl of [
      "http://dav.example.test/address-books/",
      "https://alice:secret@dav.example.test/address-books/",
      "https://dav.example.test/address-books/?access_token=hidden",
      "https://dav.example.test/address-books/#private",
    ]) {
      const snapshot = runPimProviderFoundation({ kind: "carddav", endpointUrl, authMode: "basic" });
      expect(snapshot).toMatchObject({ state: "rejected", boundary: "invalid-local-profile", profile: null, serverContacted: false, credentialsUsed: false });
      expect(snapshot.issues).not.toHaveLength(0);
      expect(snapshot.transitions.at(-1)).toMatchObject({ event: "reject-profile", to: "rejected" });
    }
  });

  it("limits ICS profiles to absolute local Windows file URLs and no auth", () => {
    expect(validatePimProviderProfile({ kind: "ics-file", endpointUrl: "file:///C:/Calendars/Home%20Calendar.ics", authMode: "none" })).toEqual({
      kind: "ics-file",
      endpointUrl: "file:///C:/Calendars/Home%20Calendar.ics",
      authMode: "none",
    });
    expect(() => validatePimProviderProfile({ kind: "ics-file", endpointUrl: "https://example.test/calendar.ics", authMode: "none" })).toThrow(/file URL/iu);
    expect(() => validatePimProviderProfile({ kind: "ics-file", endpointUrl: "file://server/share/calendar.ics", authMode: "none" })).toThrow(/UNC|network/iu);
    expect(() => validatePimProviderProfile({ kind: "ics-file", endpointUrl: "file:///C:/Calendars/Home.ics", authMode: "basic" })).toThrow(/no-credentials/iu);
  });

  it("inspects bounded vCard 3/4 envelopes without interpreting remote properties", () => {
    const source = "BEGIN:VCARD\r\nVERSION:4.0\r\nFN:Ada Lovelace\r\nEND:VCARD\r\nBEGIN:VCARD\r\nVERSION:3.0\r\nFN:Grace Hopper\r\nEND:VCARD\r\n";
    expect(inspectPimInterchange("vcard", source)).toMatchObject({
      format: "vcard",
      contactCount: 2,
      eventCount: 0,
      taskCount: 0,
      importable: true,
      exportable: true,
      recurrenceExpanded: false,
      schedulingProcessed: false,
      boundary: "bounded-local-interchange",
    });
  });

  it("counts iCalendar event, task, timezone, and recurrence metadata without expanding it", () => {
    const source = [
      "BEGIN:VCALENDAR", "VERSION:2.0", "BEGIN:VTIMEZONE", "TZID:America/Toronto", "END:VTIMEZONE",
      "BEGIN:VEVENT", "UID:event-1", "DTSTART:20260801T120000Z", "RRULE:FREQ=WEEKLY;COUNT=3", "END:VEVENT",
      "BEGIN:VTODO", "UID:task-1", "SUMMARY:Review", "END:VTODO", "END:VCALENDAR",
    ].join("\n");
    expect(inspectPimInterchange("icalendar", source)).toMatchObject({ eventCount: 1, taskCount: 1, timeZoneCount: 1, recurrenceRuleCount: 1, recurrenceExpanded: false });
    const exported = normalizePimInterchangeForExport("icalendar", source);
    expect(exported).toContain("RRULE:FREQ=WEEKLY;COUNT=3\r\n");
    expect(exported.endsWith("\r\n")).toBe(true);
    expect(exported).not.toContain("\n\n");
  });

  it("refuses scheduling, attachments, malformed envelopes, and oversized input", () => {
    const wrap = (body: string): string => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${body}\r\nEND:VCALENDAR\r\n`;
    expect(() => inspectPimInterchange("icalendar", wrap("METHOD:REQUEST\r\nBEGIN:VEVENT\r\nUID:1\r\nEND:VEVENT"))).toThrow(/METHOD/iu);
    expect(() => inspectPimInterchange("icalendar", wrap("BEGIN:VEVENT\r\nUID:1\r\nATTACH:https:\/\/example.test\/x\r\nEND:VEVENT"))).toThrow(/attachments/iu);
    expect(() => inspectPimInterchange("vcard", "BEGIN:VCARD\r\nVERSION:4.0\r\n")).toThrow(PimInterchangeBoundaryError);
    expect(() => inspectPimInterchange("vcard", `BEGIN:VCARD\r\nVERSION:4.0\r\nNOTE:${"x".repeat(1_048_576)}\r\nEND:VCARD`)).toThrow(/exceeds/iu);
  });

  it("requires stable unique UIDs for every local event and task", () => {
    const wrap = (body: string): string => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${body}\r\nEND:VCALENDAR\r\n`;
    expect(() => inspectPimInterchange("icalendar", wrap("BEGIN:VEVENT\r\nSUMMARY:Missing UID\r\nEND:VEVENT"))).toThrow(/UID/iu);
    expect(() => inspectPimInterchange("icalendar", wrap("BEGIN:VEVENT\r\nUID:same\r\nEND:VEVENT\r\nBEGIN:VTODO\r\nUID:same\r\nEND:VTODO"))).toThrow(/unique/iu);
  });

  it("contains no network, credential-store, persistence, or recurrence engine dependency", async () => {
    const source = await readFile("src/main/pim/provider-foundation.ts", "utf8");
    expect(source).not.toMatch(/from\s+["']node:(?:net|tls|dns|http|https)["']|\b(?:fetch|safeStorage|JsonStore|writeFile|readFile|rrule|ical-expander|console)\b/u);
  });
});
