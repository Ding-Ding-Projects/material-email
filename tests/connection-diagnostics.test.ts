import { describe, expect, it } from "vitest";
import type { MailConnectionSettings } from "../src/shared/connection-diagnostics";
import {
  assertConnectionPreflight,
  blockingConnectionDiagnostics,
  diagnoseMailConnection,
  diagnoseServerConnection,
} from "../src/shared/connection-diagnostics";

const validSettings = (): MailConnectionSettings => ({
  incoming: { host: "imap.example.test", port: 993, security: "tls", username: "reader@example.test" },
  outgoing: { host: "smtp.example.test", port: 587, security: "starttls", username: "reader@example.test" },
});

describe("local mail connection diagnostics", () => {
  it("accepts conventional fully qualified TLS and STARTTLS settings", () => {
    expect(diagnoseMailConnection(validSettings())).toEqual([]);
    expect(() => assertConnectionPreflight(validSettings())).not.toThrow();
  });

  it("blocks host values that cannot be used as exact certificate reference identities", () => {
    for (const [host, code] of [
      ["https://imap.example.test", "hostname-format"],
      ["imap.example.test:993", "hostname-format"],
      ["imap.example.test/mail", "hostname-format"],
      ["*.example.test", "hostname-wildcard"],
      ["[2001:db8::1]", "hostname-format"],
    ] as const) {
      expect(diagnoseServerConnection("incoming", { ...validSettings().incoming, host })).toContainEqual(
        expect.objectContaining({ endpoint: "incoming", field: "host", code, severity: "error" }),
      );
    }
  });

  it("warns, without claiming a mismatch, when certificate identity needs an exact IP SAN or private-name certificate", () => {
    for (const host of ["192.0.2.12", "2001:db8::12"]) {
      expect(diagnoseServerConnection("incoming", { ...validSettings().incoming, host })).toEqual([
        { endpoint: "incoming", field: "host", code: "certificate-ip-literal", severity: "warning" },
      ]);
    }
    for (const host of ["mail", "mail.internal", "localhost"]) {
      expect(diagnoseServerConnection("outgoing", { ...validSettings().outgoing, host })).toContainEqual(
        { endpoint: "outgoing", field: "host", code: "certificate-local-name", severity: "warning" },
      );
    }
    expect(blockingConnectionDiagnostics({ ...validSettings(), incoming: { ...validSettings().incoming, host: "192.0.2.12" } })).toEqual([]);
  });

  it("blocks conventional implicit-TLS and STARTTLS port inversions for both protocols", () => {
    const cases = [
      ["incoming", 143, "tls", "implicit-tls-on-starttls-port"],
      ["incoming", 993, "starttls", "starttls-on-implicit-tls-port"],
      ["incoming", 993, "plain", "plain-on-implicit-tls-port"],
      ["outgoing", 587, "tls", "implicit-tls-on-starttls-port"],
      ["outgoing", 465, "starttls", "starttls-on-implicit-tls-port"],
      ["outgoing", 465, "plain", "plain-on-implicit-tls-port"],
    ] as const;
    for (const [endpoint, port, security, code] of cases) {
      const settings = endpoint === "incoming" ? validSettings().incoming : validSettings().outgoing;
      expect(diagnoseServerConnection(endpoint, { ...settings, port, security })).toContainEqual(
        expect.objectContaining({ endpoint, code, severity: "error" }),
      );
    }
  });

  it("uses POP3 ports only when the incoming protocol is explicitly POP3", () => {
    const pop3 = { ...validSettings(), incomingProtocol: "pop3" as const, incoming: { ...validSettings().incoming, host: "pop.example.test", port: 995 } };
    expect(diagnoseMailConnection(pop3)).toEqual([]);
    expect(diagnoseMailConnection({ ...pop3, incoming: { ...pop3.incoming, port: 110 } })).toContainEqual(
      expect.objectContaining({ endpoint: "incoming", code: "implicit-tls-on-starttls-port", severity: "error" }),
    );
    expect(diagnoseMailConnection({ ...pop3, incoming: { ...pop3.incoming, port: 995, security: "starttls" } })).toContainEqual(
      expect.objectContaining({ endpoint: "incoming", code: "starttls-on-implicit-tls-port", severity: "error" }),
    );
  });

  it("keeps custom secure ports advisory and always warns about explicit plain transport", () => {
    expect(diagnoseServerConnection("incoming", { ...validSettings().incoming, port: 1_993 })).toEqual([
      { endpoint: "incoming", field: "port", code: "nonstandard-secure-port", severity: "warning" },
    ]);
    expect(diagnoseServerConnection("outgoing", { ...validSettings().outgoing, port: 2_587, security: "plain" })).toEqual([
      { endpoint: "outgoing", field: "security", code: "plain-transport", severity: "warning" },
    ]);
  });

  it("summarizes every blocking local issue without echoing credentials", () => {
    const invalid = validSettings();
    invalid.incoming.host = "*.example.test";
    invalid.outgoing.port = 465;
    expect(() => assertConnectionPreflight(invalid)).toThrow(/before any server is contacted.*certificate wildcard.*STARTTLS on the conventional implicit-TLS port/iu);
  });
});
