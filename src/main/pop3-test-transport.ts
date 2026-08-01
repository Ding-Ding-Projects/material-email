import { isIP, createConnection, type Socket } from "node:net";
import {
  connect as connectTls,
  type ConnectionOptions as TlsConnectionOptions,
  type TLSSocket,
} from "node:tls";
import type { Pop3AccountTestCapabilities, Pop3AccountTestResult } from "../shared/contracts.js";

export interface Pop3TestLimits {
  connectTimeoutMs: number;
  tlsHandshakeTimeoutMs: number;
  greetingTimeoutMs: number;
  commandTimeoutMs: number;
  bodyTimeoutMs: number;
  sessionTimeoutMs: number;
  lineBytes: number;
  bodyBytes: number;
  bodyLines: number;
  commandBytes: number;
}

export const POP3_TEST_LIMITS: Readonly<Pop3TestLimits> = Object.freeze({
  connectTimeoutMs: 5_000,
  tlsHandshakeTimeoutMs: 5_000,
  greetingTimeoutMs: 5_000,
  commandTimeoutMs: 5_000,
  bodyTimeoutMs: 5_000,
  sessionTimeoutMs: 30_000,
  lineBytes: 8 * 1024,
  bodyBytes: 64 * 1024,
  bodyLines: 512,
  commandBytes: 17 * 1024,
});

type Pop3Command = "CAPA" | "STLS" | "USER" | "PASS" | "STAT" | "UIDL" | "LIST" | "QUIT";

export interface Pop3TestInput {
  host: string;
  port: number;
  security: "tls" | "starttls";
  username: string;
  secret: string;
  messageLimit: number;
}

export type Pop3TestCapabilities = Pop3AccountTestCapabilities;
export type Pop3TestResult = Pop3AccountTestResult;

export interface Pop3TestTransportOptions {
  signal?: AbortSignal;
  limits?: Partial<Pop3TestLimits>;
  tls?: Pick<TlsConnectionOptions, "ca" | "rejectUnauthorized" | "servername" | "checkServerIdentity">;
}

type Pop3TestErrorCode = "EINPUT" | "ECANCELLED" | "ETIMEDOUT" | "ETLS" | "EAUTH" | "EPROTOCOL" | "ETOOBIG" | "ECONNECTION";

export class Pop3TestError extends Error {
  readonly code: Pop3TestErrorCode;

  constructor(code: Pop3TestErrorCode, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "Pop3TestError";
    this.code = code;
  }
}

interface PendingLine {
  resolve(line: Buffer): void;
  reject(error: Error): void;
  cleanup(): void;
}

const cancelledError = (): Pop3TestError => new Pop3TestError("ECANCELLED", "The POP3 account test was cancelled and its connection was closed.");
const timeoutError = (): Pop3TestError => new Pop3TestError("ETIMEDOUT", "The POP3 server did not respond before the bounded account-test deadline.");
const protocolError = (): Pop3TestError => new Pop3TestError("EPROTOCOL", "The POP3 server returned a response that the bounded account test could not safely accept.");
const sizeError = (): Pop3TestError => new Pop3TestError("ETOOBIG", "The POP3 server response exceeded the bounded account-test size limit.");

class Pop3LineReader {
  readonly #socket: Socket | TLSSocket;
  readonly #maxLineBytes: number;
  #buffer = Buffer.alloc(0);
  readonly #lines: Buffer[] = [];
  #pending: PendingLine | null = null;
  #terminalError: Error | null = null;

  constructor(socket: Socket | TLSSocket, maxLineBytes: number) {
    this.#socket = socket;
    this.#maxLineBytes = maxLineBytes;
    socket.on("data", this.#onData);
    socket.on("error", this.#onError);
    socket.on("end", this.#onEnd);
    socket.on("close", this.#onClose);
  }

  get isEmpty(): boolean {
    return this.#buffer.length === 0 && this.#lines.length === 0;
  }

  dispose(): void {
    this.#socket.off("data", this.#onData);
    this.#socket.off("error", this.#onError);
    this.#socket.off("end", this.#onEnd);
    this.#socket.off("close", this.#onClose);
    if (this.#pending) {
      const pending = this.#pending;
      this.#pending = null;
      pending.cleanup();
      pending.reject(new Pop3TestError("ECONNECTION", "The POP3 connection closed before the account test completed."));
    }
    this.#buffer = Buffer.alloc(0);
    this.#lines.length = 0;
  }

  readLine(timeoutMs: number, signal?: AbortSignal): Promise<Buffer> {
    if (signal?.aborted) return Promise.reject(cancelledError());
    const queued = this.#lines.shift();
    if (queued) return Promise.resolve(queued);
    if (this.#terminalError) return Promise.reject(this.#terminalError);
    if (this.#pending) return Promise.reject(protocolError());

    return new Promise<Buffer>((resolve, reject) => {
      let settled = false;
      const finish = (callback: () => void): void => {
        if (settled) return;
        settled = true;
        if (this.#pending === pending) this.#pending = null;
        pending.cleanup();
        callback();
      };
      const timer = setTimeout(() => finish(() => reject(timeoutError())), timeoutMs);
      const onAbort = (): void => finish(() => reject(cancelledError()));
      signal?.addEventListener("abort", onAbort, { once: true });
      const pending: PendingLine = {
        resolve: line => finish(() => resolve(line)),
        reject: error => finish(() => reject(error)),
        cleanup: () => {
          clearTimeout(timer);
          signal?.removeEventListener("abort", onAbort);
        },
      };
      this.#pending = pending;
    });
  }

  readonly #onData = (chunk: Buffer): void => {
    if (this.#terminalError) return;
    this.#buffer = this.#buffer.length ? Buffer.concat([this.#buffer, chunk]) : Buffer.from(chunk);
    while (true) {
      const lf = this.#buffer.indexOf(0x0a);
      if (lf < 0) {
        if (this.#buffer.length > this.#maxLineBytes) this.#fail(sizeError());
        return;
      }
      if (lf === 0 || this.#buffer[lf - 1] !== 0x0d) {
        this.#fail(protocolError());
        return;
      }
      if (lf + 1 > this.#maxLineBytes) {
        this.#fail(sizeError());
        return;
      }
      const line = this.#buffer.subarray(0, lf - 1);
      this.#buffer = this.#buffer.subarray(lf + 1);
      if (this.#pending) {
        const pending = this.#pending;
        pending.resolve(Buffer.from(line));
      } else {
        this.#lines.push(Buffer.from(line));
      }
    }
  };

  readonly #onError = (error: Error): void => this.#fail(
    error instanceof Pop3TestError
      ? error
      : new Pop3TestError("ECONNECTION", "The POP3 connection ended before the bounded account test completed.", error),
  );

  readonly #onEnd = (): void => this.#fail(new Pop3TestError("ECONNECTION", "The POP3 server closed the connection before the account test completed."));
  readonly #onClose = (): void => {
    if (!this.#terminalError) this.#onEnd();
  };

  #fail(error: Error): void {
    if (this.#terminalError) return;
    this.#terminalError = error;
    if (!this.#pending) return;
    const pending = this.#pending;
    pending.reject(error);
  }
}

const positiveLimit = (value: number): number => {
  if (!Number.isInteger(value) || value < 1) throw new Pop3TestError("EINPUT", "The POP3 account-test safety limits are invalid.");
  return value;
};

const resolveLimits = (overrides: Pop3TestTransportOptions["limits"]): Pop3TestLimits => ({
  connectTimeoutMs: positiveLimit(overrides?.connectTimeoutMs ?? POP3_TEST_LIMITS.connectTimeoutMs),
  tlsHandshakeTimeoutMs: positiveLimit(overrides?.tlsHandshakeTimeoutMs ?? POP3_TEST_LIMITS.tlsHandshakeTimeoutMs),
  greetingTimeoutMs: positiveLimit(overrides?.greetingTimeoutMs ?? POP3_TEST_LIMITS.greetingTimeoutMs),
  commandTimeoutMs: positiveLimit(overrides?.commandTimeoutMs ?? POP3_TEST_LIMITS.commandTimeoutMs),
  bodyTimeoutMs: positiveLimit(overrides?.bodyTimeoutMs ?? POP3_TEST_LIMITS.bodyTimeoutMs),
  sessionTimeoutMs: positiveLimit(overrides?.sessionTimeoutMs ?? POP3_TEST_LIMITS.sessionTimeoutMs),
  lineBytes: positiveLimit(overrides?.lineBytes ?? POP3_TEST_LIMITS.lineBytes),
  bodyBytes: positiveLimit(overrides?.bodyBytes ?? POP3_TEST_LIMITS.bodyBytes),
  bodyLines: positiveLimit(overrides?.bodyLines ?? POP3_TEST_LIMITS.bodyLines),
  commandBytes: positiveLimit(overrides?.commandBytes ?? POP3_TEST_LIMITS.commandBytes),
});

const assertInput = (input: Pop3TestInput): void => {
  if (!input.host.trim() || !Number.isInteger(input.port) || input.port < 1 || input.port > 65_535) {
    throw new Pop3TestError("EINPUT", "The POP3 server address or port is invalid.");
  }
  if (input.security !== "tls" && input.security !== "starttls") {
    throw new Pop3TestError("EINPUT", "POP3 account testing requires implicit TLS or STARTTLS and never sends credentials over plain transport.");
  }
  if (!Number.isInteger(input.messageLimit) || input.messageLimit < 1 || input.messageLimit > 50) {
    throw new Pop3TestError("EINPUT", "The POP3 account-test sample limit must be from 1 through 50.");
  }
  for (const [kind, value, maximum] of [["username", input.username, 1_024], ["credential", input.secret, 16_384]] as const) {
    const bytes = Buffer.byteLength(value, "utf8");
    if (!value || bytes > maximum || /[\r\n\0]/u.test(value)) {
      throw new Pop3TestError("EINPUT", `The POP3 ${kind} cannot be sent safely.`);
    }
  }
};

const waitForSocket = (
  socket: Socket | TLSSocket,
  event: "connect" | "secureConnect",
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<void> => {
  if (signal?.aborted) {
    socket.destroy();
    return Promise.reject(cancelledError());
  }
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const cleanup = (): void => {
      clearTimeout(timer);
      socket.off(event, onReady);
      socket.off("error", onError);
      socket.off("close", onClose);
      signal?.removeEventListener("abort", onAbort);
    };
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const onReady = (): void => finish(resolve);
    const onError = (error: Error): void => finish(() => reject(
      event === "secureConnect"
        ? new Pop3TestError("ETLS", "The secure POP3 connection could not be verified.", error)
        : new Pop3TestError("ECONNECTION", "The POP3 server connection could not be opened.", error),
    ));
    const onClose = (): void => finish(() => reject(new Pop3TestError("ECONNECTION", "The POP3 connection closed before it became ready.")));
    const onAbort = (): void => {
      socket.destroy();
      finish(() => reject(cancelledError()));
    };
    const timer = setTimeout(() => {
      socket.destroy();
      finish(() => reject(timeoutError()));
    }, timeoutMs);
    socket.once(event, onReady);
    socket.once("error", onError);
    socket.once("close", onClose);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
};

const writeSocket = (socket: Socket | TLSSocket, payload: Buffer, timeoutMs: number, signal?: AbortSignal): Promise<void> => {
  if (signal?.aborted) return Promise.reject(cancelledError());
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const cleanup = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const onAbort = (): void => {
      socket.destroy();
      finish(() => reject(cancelledError()));
    };
    const timer = setTimeout(() => {
      socket.destroy();
      finish(() => reject(timeoutError()));
    }, timeoutMs);
    signal?.addEventListener("abort", onAbort, { once: true });
    socket.write(payload, error => finish(() => error
      ? reject(new Pop3TestError("ECONNECTION", "The POP3 command could not be sent.", error))
      : resolve()));
  });
};

const parsePositiveInteger = (raw: string): number => {
  if (!/^(?:0|[1-9][0-9]{0,15})$/u.test(raw)) throw protocolError();
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) throw protocolError();
  return value;
};

interface Pop3Status {
  ok: boolean;
  text: string;
}

const parseStatus = (line: Buffer): Pop3Status => {
  const text = line.toString("utf8");
  if (/^\+OK(?:[ \t]|$)/iu.test(text)) return { ok: true, text };
  if (/^-ERR(?:[ \t]|$)/iu.test(text)) return { ok: false, text };
  throw protocolError();
};

const statusPayload = (status: Pop3Status): string => status.text.replace(/^[+-](?:OK|ERR)(?:[ \t]+|$)/iu, "").trim();

class Pop3Session {
  #socket: Socket | TLSSocket;
  #reader: Pop3LineReader;
  readonly #limits: Pop3TestLimits;
  readonly #signal: AbortSignal | undefined;
  readonly #deadline: number;

  constructor(socket: Socket | TLSSocket, limits: Pop3TestLimits, signal?: AbortSignal, deadline = Date.now() + limits.sessionTimeoutMs) {
    this.#socket = socket;
    this.#reader = new Pop3LineReader(socket, limits.lineBytes);
    this.#limits = limits;
    this.#signal = signal;
    this.#deadline = deadline;
  }

  dispose(): void {
    this.#reader.dispose();
  }

  async greeting(): Promise<void> {
    const status = parseStatus(await this.#reader.readLine(this.#boundedTimeout(this.#limits.greetingTimeoutMs), this.#signal));
    if (!status.ok) throw new Pop3TestError("EPROTOCOL", "The POP3 server refused the connection before authentication.");
  }

  async command(command: Pop3Command, argument?: string): Promise<Pop3Status> {
    const encoded = Buffer.from(`${command}${argument === undefined ? "" : ` ${argument}`}\r\n`, "utf8");
    if (encoded.length > this.#limits.commandBytes) throw new Pop3TestError("EINPUT", "The POP3 command exceeds the bounded account-test size limit.");
    const timeout = this.#boundedTimeout(this.#limits.commandTimeoutMs);
    await writeSocket(this.#socket, encoded, timeout, this.#signal);
    return parseStatus(await this.#reader.readLine(timeout, this.#signal));
  }

  async required(command: Pop3Command, argument?: string, code: Pop3TestErrorCode = "EPROTOCOL"): Promise<Pop3Status> {
    const status = await this.command(command, argument);
    if (!status.ok) {
      throw new Pop3TestError(
        code,
        code === "EAUTH"
          ? "The POP3 server rejected the account sign-in."
          : code === "ETLS"
            ? "The POP3 server did not permit the required STARTTLS upgrade."
            : "The POP3 server rejected a required bounded account-test command.",
      );
    }
    return status;
  }

  async multiline(command: Pop3Command): Promise<Buffer[]> {
    await this.required(command);
    const lines: Buffer[] = [];
    let bytes = 0;
    const deadline = Date.now() + this.#boundedTimeout(this.#limits.bodyTimeoutMs);
    while (true) {
      const remaining = Math.min(deadline - Date.now(), this.#deadline - Date.now());
      if (remaining <= 0) throw timeoutError();
      const line = await this.#reader.readLine(remaining, this.#signal);
      bytes += line.length + 2;
      if (bytes > this.#limits.bodyBytes) throw sizeError();
      if (line.length === 1 && line[0] === 0x2e) return lines;
      if (lines.length >= this.#limits.bodyLines) throw sizeError();
      lines.push(line.length > 1 && line[0] === 0x2e && line[1] === 0x2e ? line.subarray(1) : line);
    }
  }

  takeSocketForTls(): Socket {
    if (!(this.#socket instanceof Object) || !this.#reader.isEmpty) throw protocolError();
    const socket = this.#socket as Socket;
    this.#reader.dispose();
    return socket;
  }

  replaceWithTls(socket: TLSSocket): void {
    this.#socket = socket;
    this.#reader = new Pop3LineReader(socket, this.#limits.lineBytes);
  }

  #boundedTimeout(stageTimeoutMs: number): number {
    const remaining = this.#deadline - Date.now();
    if (remaining <= 0) throw timeoutError();
    return Math.max(1, Math.min(stageTimeoutMs, remaining));
  }
}

const parseCapabilities = (lines: readonly Buffer[]): Set<string> => {
  const capabilities = new Set<string>();
  for (const line of lines) {
    const text = line.toString("ascii");
    if (!/^[\x21-\x7e](?:[\x20-\x7e]*[\x21-\x7e])?$/u.test(text)) throw protocolError();
    const [name] = text.trim().split(/[ \t]+/u);
    if (!name || name.length > 64) throw protocolError();
    capabilities.add(name.toUpperCase());
  }
  return capabilities;
};

const parseStat = (status: Pop3Status): { messageCount: number; mailboxOctets: number } => {
  const fields = statusPayload(status).split(/[ \t]+/u);
  if (fields.length !== 2 || fields[0] === undefined || fields[1] === undefined) throw protocolError();
  return { messageCount: parsePositiveInteger(fields[0]), mailboxOctets: parsePositiveInteger(fields[1]) };
};

const assertUidl = (status: Pop3Status, expectedNumber: number, seen: Set<string>): void => {
  const fields = statusPayload(status).split(/[ \t]+/u);
  if (fields.length !== 2 || fields[0] === undefined || fields[1] === undefined) throw protocolError();
  if (parsePositiveInteger(fields[0]) !== expectedNumber) throw protocolError();
  const uidl = fields[1];
  if (Buffer.byteLength(uidl, "utf8") > 1_024 || !/^[\x21-\x7e]+$/u.test(uidl) || seen.has(uidl)) throw protocolError();
  seen.add(uidl);
};

const assertList = (status: Pop3Status, expectedNumber: number): void => {
  const fields = statusPayload(status).split(/[ \t]+/u);
  if (fields.length !== 2 || fields[0] === undefined || fields[1] === undefined) throw protocolError();
  if (parsePositiveInteger(fields[0]) !== expectedNumber) throw protocolError();
  parsePositiveInteger(fields[1]);
};

const tlsOptions = (input: Pop3TestInput, options: Pop3TestTransportOptions): TlsConnectionOptions => ({
  host: input.host,
  port: input.port,
  minVersion: "TLSv1.2",
  ...(isIP(input.host) ? {} : { servername: input.host }),
  ...options.tls,
});

const sanitizedTransportError = (error: unknown): Pop3TestError => {
  if (error instanceof Pop3TestError) return error;
  if (error && typeof error === "object") {
    const code = "code" in error && typeof error.code === "string" ? error.code.toUpperCase() : "";
    if (["ETIMEDOUT", "ESOCKETTIMEDOUT", "ETIMEOUT"].includes(code)) return timeoutError();
    if (/^(?:ERR_TLS|CERT_|DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT)/u.test(code)) {
      return new Pop3TestError("ETLS", "The secure POP3 connection could not be verified.", error);
    }
  }
  return new Pop3TestError("ECONNECTION", "The POP3 account test could not complete its bounded connection.", error);
};

export const testPop3Account = async (input: Pop3TestInput, options: Pop3TestTransportOptions = {}): Promise<Pop3TestResult> => {
  assertInput(input);
  const limits = resolveLimits(options.limits);
  const signal = options.signal;
  const deadline = Date.now() + limits.sessionTimeoutMs;
  const stageTimeout = (maximum: number): number => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw timeoutError();
    return Math.max(1, Math.min(maximum, remaining));
  };
  let plainSocket: Socket | null = null;
  let secureSocket: TLSSocket | null = null;
  let session: Pop3Session | null = null;
  const abortActiveConnection = (): void => {
    secureSocket?.destroy();
    plainSocket?.destroy();
  };
  signal?.addEventListener("abort", abortActiveConnection, { once: true });

  try {
    let preTlsCapabilities: Set<string> | null = null;
    if (input.security === "tls") {
      secureSocket = connectTls(tlsOptions(input, options));
      await waitForSocket(secureSocket, "secureConnect", stageTimeout(limits.tlsHandshakeTimeoutMs), signal);
      session = new Pop3Session(secureSocket, limits, signal, deadline);
      await session.greeting();
    } else {
      plainSocket = createConnection({ host: input.host, port: input.port });
      await waitForSocket(plainSocket, "connect", stageTimeout(limits.connectTimeoutMs), signal);
      session = new Pop3Session(plainSocket, limits, signal, deadline);
      await session.greeting();
      preTlsCapabilities = parseCapabilities(await session.multiline("CAPA"));
      if (!preTlsCapabilities.has("STLS")) throw new Pop3TestError("ETLS", "The POP3 server does not advertise the required STARTTLS upgrade.");
      await session.required("STLS", undefined, "ETLS");
      const upgradeSocket = session.takeSocketForTls();
      secureSocket = connectTls({ socket: upgradeSocket, minVersion: "TLSv1.2", ...(isIP(input.host) ? {} : { servername: input.host }), ...options.tls });
      await waitForSocket(secureSocket, "secureConnect", stageTimeout(limits.tlsHandshakeTimeoutMs), signal);
      session.replaceWithTls(secureSocket);
    }

    const capabilities = parseCapabilities(await session.multiline("CAPA"));
    if (!capabilities.has("UIDL")) throw new Pop3TestError("EPROTOCOL", "The POP3 server does not advertise UIDL, so the leave-on-server account test stopped safely.");
    await session.required("USER", input.username, "EAUTH");
    await session.required("PASS", input.secret, "EAUTH");
    const mailbox = parseStat(await session.required("STAT"));
    const sampledMessageCount = Math.min(mailbox.messageCount, input.messageLimit);
    const seenUidls = new Set<string>();
    if (sampledMessageCount === 0) {
      await session.multiline("UIDL");
      await session.multiline("LIST");
    } else {
      for (let number = 1; number <= sampledMessageCount; number += 1) {
        assertUidl(await session.required("UIDL", String(number)), number, seenUidls);
        assertList(await session.required("LIST", String(number)), number);
      }
    }
    await session.required("QUIT");

    const protocol = secureSocket.getProtocol();
    const cipher = secureSocket.getCipher().name;
    if (!protocol || !cipher) throw new Pop3TestError("ETLS", "The secure POP3 connection did not expose negotiated TLS metadata.");
    return {
      incoming: true,
      outgoing: false,
      incomingProtocol: "pop3",
      transport: input.security === "tls" ? "implicit-tls" : "starttls",
      tlsAuthorized: secureSocket.authorized,
      tlsProtocol: protocol,
      tlsCipher: cipher,
      capabilities: {
        capa: true,
        stls: input.security === "starttls" && Boolean(preTlsCapabilities?.has("STLS")),
        uidl: true,
        user: capabilities.has("USER"),
        pipelining: capabilities.has("PIPELINING"),
        top: capabilities.has("TOP"),
      },
      messageCount: mailbox.messageCount,
      mailboxOctets: mailbox.mailboxOctets,
      sampledMessageCount,
      uidlVerified: true,
      listVerified: true,
      leaveOnServer: true,
      deletionAttempted: false,
      messagesRetrieved: false,
      credentialsPersisted: false,
      fullSynchronization: false,
      quitConfirmed: true,
    };
  } catch (error) {
    throw sanitizedTransportError(error);
  } finally {
    signal?.removeEventListener("abort", abortActiveConnection);
    session?.dispose();
    secureSocket?.destroy();
    plainSocket?.destroy();
  }
};
