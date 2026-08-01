import { readFile } from "node:fs/promises";
import { createServer as createNetServer, type Server as NetServer, type Socket } from "node:net";
import path from "node:path";
import { createSecureContext, createServer as createTlsServer, TLSSocket } from "node:tls";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { TlsCertificateInspectionRequest } from "../src/shared/contracts";
import {
  inspectTlsCertificate,
  TLS_CERTIFICATE_INSPECTION_TIMEOUT_MS,
  TLS_STARTTLS_RESPONSE_LIMIT_BYTES,
} from "../src/main/tls-certificate-diagnostics";

let key = "";
let cert = "";
const servers: NetServer[] = [];

const listen = async (server: NetServer): Promise<number> => {
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture server did not expose a TCP port.");
  return address.port;
};

const closeServer = async (server: NetServer): Promise<void> => new Promise(resolve => server.close(() => resolve()));

const upgradeFixtureSocket = (socket: Socket): void => {
  socket.removeAllListeners("data");
  const secure = new TLSSocket(socket, { isServer: true, secureContext: createSecureContext({ key, cert }) });
  secure.on("error", () => undefined);
};

const starttlsServer = (endpoint: "incoming" | "outgoing"): NetServer => createNetServer(socket => {
  socket.on("error", () => undefined);
  socket.setEncoding("utf8");
  let buffer = "";
  socket.on("data", chunk => {
    buffer += chunk;
    if (endpoint === "outgoing" && /^EHLO /imu.test(buffer)) {
      buffer = "";
      socket.write("250-fixture.invalid\r\n250 STARTTLS\r\n");
      return;
    }
    if (endpoint === "outgoing" && /^STARTTLS\r?$/imu.test(buffer.trim())) {
      buffer = "";
      socket.write("220 Ready to start TLS\r\n", () => upgradeFixtureSocket(socket));
      return;
    }
    if (endpoint === "incoming" && /^MATERIAL1 STARTTLS\r?$/imu.test(buffer.trim())) {
      buffer = "";
      socket.write("MATERIAL1 OK Begin TLS\r\n", () => upgradeFixtureSocket(socket));
    }
  });
  socket.write(endpoint === "incoming" ? "* OK fixture IMAP ready\r\n" : "220 fixture.invalid ESMTP ready\r\n");
});

const request = (port: number, endpoint: "incoming" | "outgoing", security: "tls" | "starttls" | "plain"): TlsCertificateInspectionRequest => ({
  endpoint,
  host: "127.0.0.1",
  port,
  security,
});

beforeAll(async () => {
  [key, cert] = await Promise.all([
    readFile(path.resolve("tests/fixtures/tls/fixture-key.pem"), "utf8"),
    readFile(path.resolve("tests/fixtures/tls/fixture-cert.pem"), "utf8"),
  ]);
});

afterEach(async () => {
  await Promise.all(servers.splice(0).map(closeServer));
});

describe("opt-in TLS certificate inspection", () => {
  it("inspects implicit TLS with a total five-second ceiling and returns only redacted chain metadata", async () => {
    const server = createTlsServer({ key, cert }, socket => socket.end());
    server.on("tlsClientError", () => undefined);
    const result = await inspectTlsCertificate(request(await listen(server), "incoming", "tls"));

    expect(result).toMatchObject({
      outcome: "inspected",
      endpoint: "incoming",
      transport: "implicit-tls",
      timeoutMs: TLS_CERTIFICATE_INSPECTION_TIMEOUT_MS,
      authorized: false,
      hostnameMatch: false,
      authorizationIssue: "hostname-mismatch",
      chainComplete: true,
      chainTruncated: false,
    });
    expect(result.protocol).toMatch(/^TLSv1\.[23]$/u);
    expect(result.cipher).toBeTruthy();
    expect(result.chain).toHaveLength(1);
    expect(result.chain[0]).toMatchObject({ position: 0, certificateId: expect.stringMatching(/^[a-f0-9]{16}$/u), publicKeyAlgorithm: "rsa", publicKeyBits: 2048, selfSigned: true });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/fixture\.invalid|Material Email Test Fixture|subjectAltName|serialNumber|fingerprint|BEGIN CERTIFICATE/iu);
    expect(Object.keys(result.chain[0] ?? {})).toEqual(["position", "certificateId", "issuerId", "validFrom", "validTo", "publicKeyAlgorithm", "publicKeyBits", "selfSigned"]);
  });

  it("negotiates bounded IMAP and SMTP STARTTLS without sending authentication commands", async () => {
    for (const endpoint of ["incoming", "outgoing"] as const) {
      const server = starttlsServer(endpoint);
      const result = await inspectTlsCertificate(request(await listen(server), endpoint, "starttls"));
      expect(result).toMatchObject({ outcome: "inspected", endpoint, transport: "starttls", hostnameMatch: false });
      expect(result.chain).toHaveLength(1);
    }
  });

  it("times out a silent STARTTLS peer using one bounded deadline and a bounded response buffer", async () => {
    const server = createNetServer(socket => socket.on("error", () => undefined));
    const port = await listen(server);
    const started = Date.now();
    await expect(inspectTlsCertificate(request(port, "outgoing", "starttls"), { timeoutMs: 75 })).rejects.toThrow(
      /timed out.*No credentials were sent/iu,
    );
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(TLS_STARTTLS_RESPONSE_LIMIT_BYTES).toBe(16 * 1024);
  });

  it("does no network work for plain transport and blocks malformed hosts before opening a socket", async () => {
    await expect(inspectTlsCertificate(request(9, "incoming", "plain"))).resolves.toMatchObject({
      outcome: "not-applicable",
      transport: "plain",
      chain: [],
    });
    await expect(inspectTlsCertificate({ ...request(443, "incoming", "tls"), host: "https://example.test" })).rejects.toThrow(
      /blocking local.*No credentials were sent/iu,
    );
  });
});
