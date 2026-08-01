import {
  PIM_INTERCHANGE_MAX_BYTES,
  PIM_INTERCHANGE_MAX_LINES,
  PIM_PROVIDER_ENDPOINT_LIMIT,
  type PimInterchangeFormat,
  type PimInterchangeInspection,
  type PimProviderCapabilityName,
  type PimProviderCapabilityStatus,
  type PimProviderFoundationEvent,
  type PimProviderFoundationSnapshot,
  type PimProviderFoundationState,
  type PimProviderFoundationTransition,
  type PimProviderKind,
  type PimProviderProfile,
  type PimProviderProfileInput,
} from "../../shared/contracts.js";

const NEXT_STATE: Readonly<
  Partial<Record<PimProviderFoundationState, Readonly<Partial<Record<PimProviderFoundationEvent, PimProviderFoundationState>>>>>
> = Object.freeze({
  idle: Object.freeze({ start: "validating" }),
  validating: Object.freeze({ "accept-profile": "capability-review", "reject-profile": "rejected" }),
  "capability-review": Object.freeze({ "inspect-local-capabilities": "capability-review", finish: "ready" }),
});

const CAPABILITY_NAMES: readonly PimProviderCapabilityName[] = Object.freeze([
  "local-vcard-boundary",
  "local-icalendar-boundary",
  "collection-discovery",
  "etag-concurrency",
  "sync-token",
  "remote-read",
  "remote-write",
  "scheduling",
  "recurrence-expansion",
  "credential-use",
]);

const hasControlCharacter = (value: string): boolean => /[\u0000-\u001f\u007f]/u.test(value);

export class PimProviderFoundationStateMachine {
  #state: PimProviderFoundationState = "idle";
  readonly #transitions: PimProviderFoundationTransition[] = [];

  get state(): PimProviderFoundationState {
    return this.#state;
  }

  transition(event: PimProviderFoundationEvent): PimProviderFoundationState {
    const from = this.#state;
    const to = NEXT_STATE[from]?.[event];
    if (!to) throw new Error(`PIM provider foundation event ${event} is not valid while the state is ${from}.`);
    this.#state = to;
    this.#transitions.push({ sequence: this.#transitions.length + 1, from, event, to });
    return to;
  }

  transitions(): PimProviderFoundationTransition[] {
    return this.#transitions.map(transition => ({ ...transition }));
  }
}

const parseEndpoint = (input: PimProviderProfileInput): { profile: PimProviderProfile | null; issues: string[] } => {
  const issues: string[] = [];
  const endpointUrl = input.endpointUrl.trim();
  if (!endpointUrl) issues.push("Enter a provider URL.");
  if (endpointUrl.length > PIM_PROVIDER_ENDPOINT_LIMIT) issues.push(`Provider URLs cannot exceed ${PIM_PROVIDER_ENDPOINT_LIMIT} characters.`);
  if (hasControlCharacter(endpointUrl)) issues.push("Provider URLs cannot contain control characters.");

  let endpoint: URL | null = null;
  if (!issues.length) {
    try {
      endpoint = new URL(endpointUrl);
    } catch {
      issues.push("Enter a complete absolute provider URL.");
    }
  }

  if (endpoint) {
    if (endpoint.username || endpoint.password) issues.push("Provider URLs cannot contain a user name or password.");
    if (endpoint.search) issues.push("Provider URLs cannot contain a query string because it may hide credential-like data.");
    if (endpoint.hash) issues.push("Provider URLs cannot contain a fragment.");

    if (input.kind === "ics-file") {
      if (input.authMode !== "none") issues.push("A local ICS file must use the no-credentials authentication mode.");
      if (endpoint.protocol !== "file:") issues.push("A local ICS provider requires a file URL.");
      if (endpoint.hostname) issues.push("Network and UNC file locations are not available in the local ICS foundation.");
      if (!/^\/[A-Za-z]:\//u.test(endpoint.pathname)) issues.push("A local ICS file URL must contain an absolute Windows drive path.");
      if (!/\.ics$/iu.test(endpoint.pathname)) issues.push("A local ICS file URL must end in .ics.");
    } else {
      if (endpoint.protocol !== "https:") issues.push("CardDAV and CalDAV provider URLs must use HTTPS.");
      if (!endpoint.hostname) issues.push("CardDAV and CalDAV provider URLs require a host name.");
    }
  }

  return {
    profile: endpoint && issues.length === 0 ? { ...input, endpointUrl: endpoint.toString() } : null,
    issues,
  };
};

export const validatePimProviderProfile = (input: PimProviderProfileInput): PimProviderProfile => {
  const result = parseEndpoint(input);
  if (!result.profile) throw new Error(result.issues.join(" ") || "The PIM provider profile is invalid.");
  return result.profile;
};

const capabilitiesFor = (kind: PimProviderKind | null): PimProviderCapabilityStatus[] => {
  const locallyAvailable = new Set<PimProviderCapabilityName>();
  if (kind === "carddav") locallyAvailable.add("local-vcard-boundary");
  if (kind === "caldav" || kind === "ics-file") locallyAvailable.add("local-icalendar-boundary");
  return CAPABILITY_NAMES.map(name => {
    const available = locallyAvailable.has(name);
    return {
      name,
      available,
      used: false,
      evidence: available ? "bounded-local-parser" : "not-implemented",
    };
  });
};

export const runPimProviderFoundation = (input: PimProviderProfileInput): PimProviderFoundationSnapshot => {
  const machine = new PimProviderFoundationStateMachine();
  machine.transition("start");
  const validation = parseEndpoint(input);
  if (!validation.profile) {
    machine.transition("reject-profile");
    return {
      profile: null,
      state: machine.state,
      issues: [...validation.issues],
      capabilities: capabilitiesFor(null),
      transitions: machine.transitions(),
      serverContacted: false,
      credentialsUsed: false,
      providerStatePersisted: false,
      liveSynchronization: false,
      recurrenceExpanded: false,
      boundary: "invalid-local-profile",
    };
  }

  machine.transition("accept-profile");
  machine.transition("inspect-local-capabilities");
  machine.transition("finish");
  return {
    profile: validation.profile,
    state: machine.state,
    issues: [],
    capabilities: capabilitiesFor(validation.profile.kind),
    transitions: machine.transitions(),
    serverContacted: false,
    credentialsUsed: false,
    providerStatePersisted: false,
    liveSynchronization: false,
    recurrenceExpanded: false,
    boundary: "local-validation-only",
  };
};

export class PimInterchangeBoundaryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PimInterchangeBoundaryError";
  }
}

const normalizedLines = (source: string): string[] => source.replace(/\r\n?/gu, "\n").split("\n");

const assertSourceBounds = (source: string): { byteLength: number; lines: string[] } => {
  const byteLength = Buffer.byteLength(source, "utf8");
  if (byteLength === 0) throw new PimInterchangeBoundaryError("The interchange document is empty.");
  if (byteLength > PIM_INTERCHANGE_MAX_BYTES) {
    throw new PimInterchangeBoundaryError(`The interchange document exceeds the ${PIM_INTERCHANGE_MAX_BYTES}-byte local limit.`);
  }
  if (source.includes("\u0000")) throw new PimInterchangeBoundaryError("The interchange document contains a NUL byte.");
  const lines = normalizedLines(source);
  if (lines.length > PIM_INTERCHANGE_MAX_LINES) {
    throw new PimInterchangeBoundaryError(`The interchange document exceeds the ${PIM_INTERCHANGE_MAX_LINES}-line local limit.`);
  }
  if (lines.some(line => Buffer.byteLength(line, "utf8") > 8_192)) {
    throw new PimInterchangeBoundaryError("An interchange line exceeds the 8192-byte local limit.");
  }
  return { byteLength, lines };
};

interface ComponentInspection {
  counts: Map<string, number>;
  properties: Map<string, string[]>;
}

const inspectComponents = (lines: readonly string[], allowedComponents: ReadonlySet<string>): ComponentInspection => {
  const stack: string[] = [];
  const counts = new Map<string, number>();
  const properties = new Map<string, string[]>();
  let previousWasProperty = false;

  for (const rawLine of lines) {
    if (!rawLine) { previousWasProperty = false; continue; }
    if (/^[ \t]/u.test(rawLine)) {
      if (!previousWasProperty) throw new PimInterchangeBoundaryError("A folded interchange line must follow a property line.");
      continue;
    }
    const colon = rawLine.indexOf(":");
    if (colon < 1) throw new PimInterchangeBoundaryError("Every non-folded interchange line must contain a property separator.");
    const rawName = rawLine.slice(0, colon);
    if (!/^[A-Za-z][A-Za-z0-9-]*(?:;[^:]+)*$/u.test(rawName)) throw new PimInterchangeBoundaryError("An interchange property name or parameter is malformed.");
    const name = rawName.split(";", 1)[0]?.toUpperCase() ?? "";
    const value = rawLine.slice(colon + 1).trim();

    if (name === "BEGIN") {
      const component = value.toUpperCase();
      if (!allowedComponents.has(component)) throw new PimInterchangeBoundaryError(`Unsupported ${component || "unnamed"} component.`);
      stack.push(component);
      counts.set(component, (counts.get(component) ?? 0) + 1);
      previousWasProperty = true;
      continue;
    }
    if (name === "END") {
      const component = value.toUpperCase();
      if (stack.pop() !== component) throw new PimInterchangeBoundaryError(`The ${component || "unnamed"} component is not balanced.`);
      previousWasProperty = true;
      continue;
    }
    if (!stack.length) throw new PimInterchangeBoundaryError("Interchange properties must be inside a component.");
    const values = properties.get(name) ?? [];
    values.push(value);
    properties.set(name, values);
    previousWasProperty = true;
  }

  if (stack.length) throw new PimInterchangeBoundaryError(`The ${stack.at(-1)} component is not closed.`);
  return { counts, properties };
};

const exactly = (inspection: ComponentInspection, component: string, count: number): void => {
  if ((inspection.counts.get(component) ?? 0) !== count) {
    throw new PimInterchangeBoundaryError(`The document must contain exactly ${count} ${component} component${count === 1 ? "" : "s"}.`);
  }
};

export const inspectPimInterchange = (format: PimInterchangeFormat, source: string): PimInterchangeInspection => {
  const { byteLength, lines } = assertSourceBounds(source);
  if (format === "vcard") {
    const inspection = inspectComponents(lines, new Set(["VCARD"]));
    const contactCount = inspection.counts.get("VCARD") ?? 0;
    if (contactCount < 1 || contactCount > 2_000) {
      throw new PimInterchangeBoundaryError("A bounded vCard document must contain from 1 through 2000 cards.");
    }
    const versions = inspection.properties.get("VERSION") ?? [];
    if (versions.length !== contactCount || versions.some(version => version !== "3.0" && version !== "4.0")) {
      throw new PimInterchangeBoundaryError("Each vCard must declare VERSION:3.0 or VERSION:4.0.");
    }
    return {
      format,
      byteLength,
      lineCount: lines.length,
      contactCount,
      eventCount: 0,
      taskCount: 0,
      timeZoneCount: 0,
      recurrenceRuleCount: 0,
      importable: true,
      exportable: true,
      recurrenceExpanded: false,
      schedulingProcessed: false,
      boundary: "bounded-local-interchange",
    };
  }

  const inspection = inspectComponents(lines, new Set(["VCALENDAR", "VEVENT", "VTODO", "VTIMEZONE", "VALARM", "STANDARD", "DAYLIGHT"]));
  exactly(inspection, "VCALENDAR", 1);
  const versions = inspection.properties.get("VERSION") ?? [];
  if (versions.length !== 1 || versions[0] !== "2.0") throw new PimInterchangeBoundaryError("An iCalendar document must declare VERSION:2.0 exactly once.");
  if ((inspection.properties.get("METHOD") ?? []).length) {
    throw new PimInterchangeBoundaryError("Scheduling METHOD payloads are outside the local ICS import/export boundary.");
  }
  if ((inspection.properties.get("ATTACH") ?? []).length) {
    throw new PimInterchangeBoundaryError("iCalendar attachments are outside the local ICS import/export boundary.");
  }
  const eventCount = inspection.counts.get("VEVENT") ?? 0;
  const taskCount = inspection.counts.get("VTODO") ?? 0;
  if (eventCount + taskCount < 1 || eventCount + taskCount > 5_000) {
    throw new PimInterchangeBoundaryError("A bounded iCalendar document must contain from 1 through 5000 events or tasks.");
  }
  const uids = inspection.properties.get("UID") ?? [];
  if (uids.length !== eventCount + taskCount || uids.some(uid => !uid || uid.length > 512)) {
    throw new PimInterchangeBoundaryError("Every local event or task must contain one non-empty UID no longer than 512 characters.");
  }
  if (new Set(uids).size !== uids.length) {
    throw new PimInterchangeBoundaryError("Local event and task UIDs must be unique within one iCalendar document.");
  }
  return {
    format,
    byteLength,
    lineCount: lines.length,
    contactCount: 0,
    eventCount,
    taskCount,
    timeZoneCount: inspection.counts.get("VTIMEZONE") ?? 0,
    recurrenceRuleCount: (inspection.properties.get("RRULE") ?? []).length,
    importable: true,
    exportable: true,
    recurrenceExpanded: false,
    schedulingProcessed: false,
    boundary: "bounded-local-interchange",
  };
};

export const normalizePimInterchangeForExport = (format: PimInterchangeFormat, source: string): string => {
  inspectPimInterchange(format, source);
  return `${normalizedLines(source).filter((line, index, lines) => line.length > 0 || index < lines.length - 1).join("\r\n").replace(/(?:\r\n)+$/u, "")}\r\n`;
};
