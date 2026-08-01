import type { AccountDraft, MailSecurity, ServerSettings } from "./contracts.js";

export type MailEndpoint = "incoming" | "outgoing";
export type ConnectionDiagnosticSeverity = "error" | "warning";
export type ConnectionDiagnosticField = "host" | "port" | "security";
export type ConnectionDiagnosticCode =
  | "hostname-empty"
  | "hostname-format"
  | "hostname-wildcard"
  | "certificate-ip-literal"
  | "certificate-local-name"
  | "port-range"
  | "implicit-tls-on-starttls-port"
  | "starttls-on-implicit-tls-port"
  | "plain-on-implicit-tls-port"
  | "nonstandard-secure-port"
  | "plain-transport";

export interface ConnectionDiagnostic {
  endpoint: MailEndpoint;
  field: ConnectionDiagnosticField;
  code: ConnectionDiagnosticCode;
  severity: ConnectionDiagnosticSeverity;
}

export interface MailConnectionSettings {
  incoming: ServerSettings;
  outgoing: ServerSettings;
}

const IMPLICIT_TLS_PORT: Readonly<Record<MailEndpoint, number>> = Object.freeze({ incoming: 993, outgoing: 465 });
const STARTTLS_PORTS: Readonly<Record<MailEndpoint, readonly number[]>> = Object.freeze({
  incoming: Object.freeze([143]),
  outgoing: Object.freeze([25, 587, 2_525]),
});

const isCanonicalIpv4 = (value: string): boolean => {
  const parts = value.split(".");
  return parts.length === 4 && parts.every(part => {
    if (!/^(?:0|[1-9][0-9]{0,2})$/u.test(part)) return false;
    const octet = Number(part);
    return octet >= 0 && octet <= 255;
  });
};

const isIpv6Literal = (value: string): boolean => {
  if (!value.includes(":") || value.includes("[") || value.includes("]") || value.includes("%")) return false;
  try {
    const parsed = new URL(`https://[${value}]/`);
    return parsed.hostname.startsWith("[") && parsed.hostname.endsWith("]");
  } catch {
    return false;
  }
};

type HostClassification = "dns" | "ip" | "local" | "empty" | "wildcard" | "invalid";

const classifyHostname = (rawHost: string): HostClassification => {
  const host = rawHost.trim();
  if (!host) return "empty";
  if (host.includes("*")) return "wildcard";
  if (host.length > 255 || /[\u0000-\u0020\u007f]/u.test(host)) return "invalid";
  if (isCanonicalIpv4(host) || isIpv6Literal(host)) return "ip";
  if (host.includes("://") || /[\\/@?#\[\]]/u.test(host)) return "invalid";

  try {
    const parsed = new URL(`https://${host}/`);
    if (parsed.username || parsed.password || parsed.port || parsed.pathname !== "/" || parsed.search || parsed.hash) return "invalid";
    const asciiHost = parsed.hostname.toLowerCase().replace(/\.$/u, "");
    if (!asciiHost || asciiHost.length > 253) return "invalid";
    const labels = asciiHost.split(".");
    if (labels.some(label => !/^(?!-)[a-z0-9-]{1,63}(?<!-)$/u.test(label))) return "invalid";
    if (labels.length === 1 || asciiHost === "localhost" || /\.(?:local|localhost|lan|internal)$/u.test(asciiHost)) return "local";
    return "dns";
  } catch {
    return "invalid";
  }
};

const hostDiagnostics = (endpoint: MailEndpoint, host: string): ConnectionDiagnostic[] => {
  const classification = classifyHostname(host);
  if (classification === "dns") return [];
  if (classification === "ip") {
    return [{ endpoint, field: "host", code: "certificate-ip-literal", severity: "warning" }];
  }
  if (classification === "local") {
    return [{ endpoint, field: "host", code: "certificate-local-name", severity: "warning" }];
  }
  return [{
    endpoint,
    field: "host",
    code: classification === "empty" ? "hostname-empty" : classification === "wildcard" ? "hostname-wildcard" : "hostname-format",
    severity: "error",
  }];
};

const securityPortDiagnostics = (
  endpoint: MailEndpoint,
  port: number,
  security: MailSecurity,
): ConnectionDiagnostic[] => {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    return [{ endpoint, field: "port", code: "port-range", severity: "error" }];
  }

  const implicitTlsPort = IMPLICIT_TLS_PORT[endpoint];
  const starttlsPorts = STARTTLS_PORTS[endpoint];
  const diagnostics: ConnectionDiagnostic[] = [];
  if (security === "tls" && starttlsPorts.includes(port)) {
    diagnostics.push({ endpoint, field: "security", code: "implicit-tls-on-starttls-port", severity: "error" });
  } else if (security === "starttls" && port === implicitTlsPort) {
    diagnostics.push({ endpoint, field: "security", code: "starttls-on-implicit-tls-port", severity: "error" });
  } else if (security === "plain" && port === implicitTlsPort) {
    diagnostics.push({ endpoint, field: "security", code: "plain-on-implicit-tls-port", severity: "error" });
  } else if ((security === "tls" && port !== implicitTlsPort) || (security === "starttls" && !starttlsPorts.includes(port))) {
    diagnostics.push({ endpoint, field: "port", code: "nonstandard-secure-port", severity: "warning" });
  }
  if (security === "plain") diagnostics.push({ endpoint, field: "security", code: "plain-transport", severity: "warning" });
  return diagnostics;
};

export const diagnoseServerConnection = (endpoint: MailEndpoint, settings: ServerSettings): ConnectionDiagnostic[] => [
  ...hostDiagnostics(endpoint, settings.host),
  ...securityPortDiagnostics(endpoint, settings.port, settings.security),
];

export const diagnoseMailConnection = (settings: MailConnectionSettings): ConnectionDiagnostic[] => [
  ...diagnoseServerConnection("incoming", settings.incoming),
  ...diagnoseServerConnection("outgoing", settings.outgoing),
];

export const blockingConnectionDiagnostics = (settings: MailConnectionSettings): ConnectionDiagnostic[] =>
  diagnoseMailConnection(settings).filter(diagnostic => diagnostic.severity === "error");

const blockingDiagnosticSummary = (diagnostic: ConnectionDiagnostic): string => {
  const endpoint = diagnostic.endpoint === "incoming" ? "incoming IMAP" : "outgoing SMTP";
  switch (diagnostic.code) {
    case "hostname-empty": return `${endpoint} host is required`;
    case "hostname-wildcard": return `${endpoint} host must be an exact server name, not a certificate wildcard`;
    case "hostname-format": return `${endpoint} host must contain only a server host name, without a scheme, path, credentials, brackets, or port`;
    case "port-range": return `${endpoint} port must be an integer from 1 through 65535`;
    case "implicit-tls-on-starttls-port": return `${endpoint} uses implicit TLS on a conventional STARTTLS port`;
    case "starttls-on-implicit-tls-port": return `${endpoint} uses STARTTLS on the conventional implicit-TLS port`;
    case "plain-on-implicit-tls-port": return `${endpoint} uses plain transport on the conventional implicit-TLS port`;
    default: return `${endpoint} settings are not ready`;
  }
};

export const assertConnectionPreflight = (draft: Pick<AccountDraft, "incoming" | "outgoing">): void => {
  const blocking = blockingConnectionDiagnostics(draft);
  if (!blocking.length) return;
  throw new Error(`Connection settings need attention before any server is contacted: ${blocking.map(blockingDiagnosticSummary).join("; ")}.`);
};

export const conventionalMailPorts = Object.freeze({
  incoming: Object.freeze({ tls: IMPLICIT_TLS_PORT.incoming, starttls: STARTTLS_PORTS.incoming }),
  outgoing: Object.freeze({ tls: IMPLICIT_TLS_PORT.outgoing, starttls: STARTTLS_PORTS.outgoing }),
});
