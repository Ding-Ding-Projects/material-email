import { readFile } from "node:fs/promises";
import { createServer as createNetServer, type Server as NetServer, type Socket } from "node:net";
import path from "node:path";
import { createSecureContext, createServer as createTlsServer, TLSSocket, type Server as TlsServer } from "node:tls";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { POP3_TEST_LIMITS, Pop3TestError, testPop3Account, type Pop3TestInput } from "../src/main/pop3-test-transport";

let key = "";
let cert = "";
const servers: Array<NetServer | TlsServer> = [];
const sockets = new Set<Socket>();

interface FixtureTranscript {
  commands: string[];
  connections: number;
  closed: number;
}

const listen = async (server: NetServer | TlsServer): Promise<number> => {
  servers.push(server);
  server.on("connection", socket => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("POP3 fixture did not expose a TCP port.");
  return address.port;
};

const closeServer = async (server: NetServer | TlsServer): Promise<void> => {
  for (const socket of sockets) socket.destroy();
  await new Promise<void>(resolve => server.close(() => resolve()));
};

const attachProtocol = (socket: Socket | TLSSocket, transcript: FixtureTranscript, onStls?: () => void): void => {
  socket.on("error", () => undefined);
  let buffer = "";
  socket.on("data", chunk => {
    buffer += chunk.toString("utf8");
    while (buffer.includes("\r\n")) {
      const boundary = buffer.indexOf("\r\n");
      const command = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      transcript.commands.push(command);
      if (command === "CAPA") {
        socket.write(`+OK capabilities\r\n${onStls ? "STLS\r\n" : ""}UIDL\r\nUSER\r\nTOP\r\n.\r\n`);
      } else if (command === "STLS" && onStls) {
        socket.write("+OK begin TLS\r\n", onStls);
        return;
      } else if (command === "USER fixture-user") {
        socket.write("+OK user accepted\r\n");
      } else if (command === "PASS fixture-secret") {
        socket.write("+OK authenticated\r\n");
      } else if (command === "STAT") {
        socket.write("+OK 2 300\r\n");
      } else if (/^UIDL [12]$/u.test(command)) {
        const number = command.slice(-1);
        socket.write(`+OK ${number} fixture-uid-${number}\r\n`);
      } else if (/^LIST [12]$/u.test(command)) {
        const number = command.slice(-1);
        socket.write(`+OK ${number} ${number === "1" ? "100" : "200"}\r\n`);
      } else if (command === "QUIT") {
        socket.end("+OK goodbye\r\n");
      } else {
        socket.end("-ERR unsupported\r\n");
      }
    }
  });
};

const implicitFixture = async (): Promise<{ port: number; transcript: FixtureTranscript }> => {
  const transcript = { commands: [], connections: 0, closed: 0 } satisfies FixtureTranscript;
  const server = createTlsServer({ key, cert }, socket => {
    transcript.connections += 1;
    socket.once("close", () => { transcript.closed += 1; });
    attachProtocol(socket, transcript);
    socket.write("+OK fixture POP3 ready\r\n");
  });
  server.on("tlsClientError", () => undefined);
  return { port: await listen(server), transcript };
};

const starttlsFixture = async (): Promise<{ port: number; transcript: FixtureTranscript }> => {
  const transcript = { commands: [], connections: 0, closed: 0 } satisfies FixtureTranscript;
  const server = createNetServer(socket => {
    transcript.connections += 1;
    socket.once("close", () => { transcript.closed += 1; });
    const upgrade = (): void => {
      socket.removeAllListeners("data");
      const secure = new TLSSocket(socket, { isServer: true, secureContext: createSecureContext({ key, cert }) });
      attachProtocol(secure, transcript);
    };
    attachProtocol(socket, transcript, upgrade);
    socket.write("+OK fixture POP3 ready\r\n");
  });
  return { port: await listen(server), transcript };
};

const input = (port: number, security: Pop3TestInput["security"]): Pop3TestInput => ({
  host: "127.0.0.1",
  port,
  security,
  username: "fixture-user",
  secret: "fixture-secret",
  messageLimit: 2,
});

const tls = () => ({ ca: cert, servername: "fixture.invalid" });

beforeAll(async () => {
  [key, cert] = await Promise.all([
    readFile(path.resolve("tests/fixtures/tls/fixture-key.pem"), "utf8"),
    readFile(path.resolve("tests/fixtures/tls/fixture-cert.pem"), "utf8"),
  ]);
});

afterEach(async () => {
  await Promise.all(servers.splice(0).map(closeServer));
});

afterAll(() => {
  for (const socket of sockets) socket.destroy();
});

describe("bounded live POP3 account-test transport", () => {
  it.each([
    ["implicit TLS", "tls" as const, implicitFixture, "implicit-tls" as const],
    ["required STARTTLS", "starttls" as const, starttlsFixture, "starttls" as const],
  ])("tests CAPA, USER/PASS, STAT, UIDL, and LIST over %s without deletion or retrieval", async (_label, security, fixture, transport) => {
    const { port, transcript } = await fixture();
    const result = await testPop3Account(input(port, security), { tls: tls() });

    expect(result).toMatchObject({
      incoming: true,
      outgoing: false,
      incomingProtocol: "pop3",
      transport,
      tlsAuthorized: true,
      messageCount: 2,
      mailboxOctets: 300,
      sampledMessageCount: 2,
      uidlVerified: true,
      listVerified: true,
      leaveOnServer: true,
      deletionAttempted: false,
      messagesRetrieved: false,
      credentialsPersisted: false,
      fullSynchronization: false,
      quitConfirmed: true,
    });
    expect(result.tlsProtocol).toMatch(/^TLSv1\.[23]$/u);
    expect(result.tlsCipher).toBeTruthy();
    expect(transcript.commands.filter(command => command === "CAPA")).toHaveLength(security === "starttls" ? 2 : 1);
    expect(transcript.commands).toEqual(expect.arrayContaining([
      "USER fixture-user",
      "PASS fixture-secret",
      "STAT",
      "UIDL 1",
      "LIST 1",
      "UIDL 2",
      "LIST 2",
      "QUIT",
    ]));
    expect(transcript.commands.some(command => command.startsWith("RETR") || command.startsWith("TOP "))).toBe(false);
    expect(transcript.commands.some(command => command.startsWith("DELE"))).toBe(false);
    await expect.poll(() => transcript.closed).toBe(1);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("fixture-user");
    expect(serialized).not.toContain("fixture-secret");
    expect(serialized).not.toContain("fixture-uid");
    expect(serialized).not.toContain("fixture POP3 ready");
  });

  it("cancels a silent greeting within a bounded deadline and closes the socket", async () => {
    const connections: Socket[] = [];
    const server = createTlsServer({ key, cert }, socket => {
      connections.push(socket);
      socket.on("error", () => undefined);
    });
    server.on("tlsClientError", () => undefined);
    const port = await listen(server);
    const controller = new AbortController();
    const pending = testPop3Account(input(port, "tls"), {
      signal: controller.signal,
      tls: tls(),
      limits: { greetingTimeoutMs: 1_000, sessionTimeoutMs: 2_000 },
    });
    await expect.poll(() => connections.length).toBe(1);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "ECANCELLED" });
    await expect.poll(() => connections[0]?.destroyed).toBe(true);
  });

  it("bounds greeting lines and multiline CAPA bodies without echoing server or credential data", async () => {
    const oversizedGreeting = createTlsServer({ key, cert }, socket => socket.write(`+OK ${"x".repeat(128)}\r\n`));
    oversizedGreeting.on("tlsClientError", () => undefined);
    const greetingPort = await listen(oversizedGreeting);
    await expect(testPop3Account(input(greetingPort, "tls"), { tls: tls(), limits: { lineBytes: 64 } })).rejects.toMatchObject({ code: "ETOOBIG" });
    await closeServer(servers.pop()!);

    const oversizedBody = createTlsServer({ key, cert }, socket => {
      socket.setEncoding("utf8");
      socket.write("+OK ready\r\n");
      socket.once("data", () => socket.write(`+OK capabilities\r\n${"UIDL\r\n".repeat(20)}.\r\n`));
    });
    oversizedBody.on("tlsClientError", () => undefined);
    const bodyPort = await listen(oversizedBody);
    let error: unknown;
    try {
      await testPop3Account({ ...input(bodyPort, "tls"), secret: "never-echo-this-secret" }, { tls: tls(), limits: { bodyBytes: 32 } });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(Pop3TestError);
    expect(error).toMatchObject({ code: "ETOOBIG" });
    expect(String(error)).not.toContain("never-echo-this-secret");
    expect(String(error)).not.toContain("capabilities");
    expect(POP3_TEST_LIMITS.lineBytes).toBe(8 * 1024);
    expect(POP3_TEST_LIMITS.bodyBytes).toBe(64 * 1024);
  });
});
