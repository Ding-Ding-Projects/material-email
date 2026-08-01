import { createHash, X509Certificate } from "node:crypto";
import { createConnection, isIP, type Socket } from "node:net";
import { domainToASCII } from "node:url";
import {
  checkServerIdentity,
  connect as connectTls,
  type DetailedPeerCertificate,
  type PeerCertificate,
  type TLSSocket,
} from "node:tls";
import type {
  TlsCertificateAuthorizationIssue,
  TlsCertificateChainSummary,
  TlsCertificateInspectionRequest,
  TlsCertificateInspectionResult,
} from "../shared/contracts.js";
import { diagnoseServerConnection } from "../shared/connection-diagnostics.js";

export const TLS_CERTIFICATE_INSPECTION_TIMEOUT_MS = 5_000;
export const TLS_CERTIFICATE_CHAIN_LIMIT = 8;
export const TLS_STARTTLS_RESPONSE_LIMIT_BYTES = 16 * 1024;

interface InspectionOptions {
  timeoutMs?: number;
}

const safeError = (message: string): Error => new Error(`${message} No credentials were sent.`);

const sanitizeNetworkError = (error: unknown, timedOut: boolean): Error => {
  if (timedOut) return safeError("TLS certificate inspection timed out before the bounded handshake completed.");
  const code = error instanceof Error && "code" in error ? String((error as NodeJS.ErrnoException).code ?? "") : "";
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return safeError("TLS certificate inspection could not resolve the configured host.");
  if (code === "ECONNREFUSED") return safeError("TLS certificate inspection was refused at the configured host and port.");
  if (code === "EHOSTUNREACH" || code === "ENETUNREACH") return safeError("TLS certificate inspection could not reach the configured host.");
  if (code === "ECONNRESET" || code === "EPIPE") return safeError("The configured server closed the diagnostic connection before inspection completed.");
  return safeError("TLS certificate inspection could not complete the bounded handshake.");
};

const authorizationIssue = (value: string | Error | null | undefined, hostnameMatch: boolean): TlsCertificateAuthorizationIssue | null => {
  if (!hostnameMatch) return "hostname-mismatch";
  const code = typeof value === "string" ? value : value && "code" in value ? String((value as NodeJS.ErrnoException).code ?? value.message) : value?.message ?? "";
  if (!code) return null;
  if (/EXPIRED/iu.test(code)) return "expired";
  if (/NOT_YET_VALID/iu.test(code)) return "not-yet-valid";
  if (/REVOKED/iu.test(code)) return "revoked";
  if (/SIGNATURE|DECRYPT_CERT/iu.test(code)) return "invalid-signature";
  if (/SELF_SIGNED|UNABLE_TO_VERIFY|UNABLE_TO_GET_ISSUER|CERT_UNTRUSTED|UNKNOWN_CA|DEPTH_ZERO/iu.test(code)) return "untrusted-chain";
  return "unknown";
};

const parseCertificateDate = (value: string): string | null => {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
};

const certificateId = (raw: Buffer): string => createHash("sha256").update(raw).digest("hex").slice(0, 16);

const keySummary = (certificate: X509Certificate): Pick<TlsCertificateChainSummary, "publicKeyAlgorithm" | "publicKeyBits"> => {
  const algorithm = certificate.publicKey.asymmetricKeyType ?? "unknown";
  const details = certificate.publicKey.asymmetricKeyDetails;
  const bits = details && "modulusLength" in details && typeof details.modulusLength === "number" ? details.modulusLength : undefined;
  return { publicKeyAlgorithm: algorithm, ...(bits ? { publicKeyBits: bits } : {}) };
};

const summarizeChain = (peer: DetailedPeerCertificate): Pick<TlsCertificateInspectionResult, "chain" | "chainComplete" | "chainTruncated"> => {
  const chain: TlsCertificateChainSummary[] = [];
  const visited = new Set<string>();
  let current: DetailedPeerCertificate | undefined = peer;
  let chainComplete = false;
  while (current?.raw && chain.length < TLS_CERTIFICATE_CHAIN_LIMIT) {
    const id = certificateId(current.raw);
    if (visited.has(id)) {
      chainComplete = true;
      break;
    }
    visited.add(id);
    const issuer = current.issuerCertificate?.raw ? certificateId(current.issuerCertificate.raw) : null;
    const selfSigned = issuer === id;
    const parsed = new X509Certificate(current.raw);
    chain.push({
      position: chain.length,
      certificateId: id,
      issuerId: issuer,
      validFrom: parseCertificateDate(parsed.validFrom),
      validTo: parseCertificateDate(parsed.validTo),
      ...keySummary(parsed),
      selfSigned,
    });
    if (selfSigned) {
      chainComplete = true;
      break;
    }
    current = current.issuerCertificate;
  }
  return {
    chain,
    chainComplete,
    chainTruncated: Boolean(current?.issuerCertificate?.raw) && !chainComplete && chain.length >= TLS_CERTIFICATE_CHAIN_LIMIT,
  };
};

const waitForConnect = (socket: Socket): Promise<void> => new Promise((resolve, reject) => {
  const cleanup = (): void => {
    socket.off("connect", onConnect);
    socket.off("error", onError);
    socket.off("close", onClose);
  };
  const onConnect = (): void => { cleanup(); resolve(); };
  const onError = (error: Error): void => { cleanup(); reject(error); };
  const onClose = (): void => { cleanup(); reject(new Error("Socket closed before connect.")); };
  socket.once("connect", onConnect);
  socket.once("error", onError);
  socket.once("close", onClose);
});

const waitForSecureConnect = (socket: TLSSocket): Promise<void> => new Promise((resolve, reject) => {
  const cleanup = (): void => {
    socket.off("secureConnect", onSecure);
    socket.off("error", onError);
    socket.off("close", onClose);
  };
  const onSecure = (): void => { cleanup(); resolve(); };
  const onError = (error: Error): void => { cleanup(); reject(error); };
  const onClose = (): void => { cleanup(); reject(new Error("Socket closed before TLS handshake.")); };
  socket.once("secureConnect", onSecure);
  socket.once("error", onError);
  socket.once("close", onClose);
});

const readBoundedResponse = (
  socket: Socket,
  complete: (lines: string[]) => boolean,
): Promise<string[]> => new Promise((resolve, reject) => {
  let bytes = 0;
  let text = "";
  const cleanup = (): void => {
    socket.off("data", onData);
    socket.off("error", onError);
    socket.off("close", onClose);
  };
  const onError = (error: Error): void => { cleanup(); reject(error); };
  const onClose = (): void => { cleanup(); reject(new Error("Socket closed during STARTTLS negotiation.")); };
  const onData = (chunk: Buffer): void => {
    bytes += chunk.length;
    if (bytes > TLS_STARTTLS_RESPONSE_LIMIT_BYTES) {
      cleanup();
      reject(new Error("STARTTLS response exceeded the local bound."));
      return;
    }
    text += chunk.toString("utf8");
    const lines = text.split(/\r?\n/u).filter(Boolean);
    if (complete(lines)) { cleanup(); resolve(lines); }
  };
  socket.on("data", onData);
  socket.once("error", onError);
  socket.once("close", onClose);
});

const smtpStarttls = async (socket: Socket): Promise<void> => {
  const greeting = await readBoundedResponse(socket, lines => lines.some(line => /^220 /u.test(line)));
  if (!greeting.some(line => /^220 /u.test(line))) throw new Error("SMTP greeting was not accepted.");
  socket.write("EHLO material-email.invalid\r\n", "ascii");
  const capabilities = await readBoundedResponse(socket, lines => lines.some(line => /^250 /u.test(line)));
  if (!capabilities.some(line => /^250[ -]STARTTLS(?:\s|$)/iu.test(line))) throw new Error("SMTP server did not advertise STARTTLS.");
  socket.write("STARTTLS\r\n", "ascii");
  const response = await readBoundedResponse(socket, lines => lines.some(line => /^220 /u.test(line)));
  if (!response.some(line => /^220 /u.test(line))) throw new Error("SMTP STARTTLS was not accepted.");
};

const imapStarttls = async (socket: Socket): Promise<void> => {
  const greeting = await readBoundedResponse(socket, lines => lines.length > 0);
  if (!greeting.some(line => /^\* OK(?:\s|$)/iu.test(line))) throw new Error("IMAP greeting was not accepted.");
  socket.write("MATERIAL1 STARTTLS\r\n", "ascii");
  const response = await readBoundedResponse(socket, lines => lines.some(line => /^MATERIAL1 (?:OK|NO|BAD)(?:\s|$)/iu.test(line)));
  if (!response.some(line => /^MATERIAL1 OK(?:\s|$)/iu.test(line))) throw new Error("IMAP STARTTLS was not accepted.");
};

const tlsServername = (host: string): string | undefined => isIP(host) ? undefined : domainToASCII(host) || host;

const inspectSocket = (
  request: TlsCertificateInspectionRequest,
  socket: TLSSocket,
  timeoutMs: number,
): TlsCertificateInspectionResult => {
  const peer = socket.getPeerCertificate(true);
  if (!peer?.raw) throw new Error("TLS peer did not provide a certificate.");
  const hostnameMatch = !checkServerIdentity(request.host, peer as PeerCertificate);
  const chain = summarizeChain(peer);
  const cipher = socket.getCipher();
  return {
    outcome: "inspected",
    endpoint: request.endpoint,
    transport: request.security === "tls" ? "implicit-tls" : "starttls",
    inspectedAt: new Date().toISOString(),
    timeoutMs,
    authorized: socket.authorized,
    hostnameMatch,
    authorizationIssue: socket.authorized ? null : authorizationIssue(socket.authorizationError, hostnameMatch),
    protocol: socket.getProtocol(),
    cipher: cipher.standardName ?? cipher.name ?? null,
    ...chain,
  };
};

export const inspectTlsCertificate = async (
  request: TlsCertificateInspectionRequest,
  options: InspectionOptions = {},
): Promise<TlsCertificateInspectionResult> => {
  const timeoutMs = Math.max(50, Math.min(options.timeoutMs ?? TLS_CERTIFICATE_INSPECTION_TIMEOUT_MS, TLS_CERTIFICATE_INSPECTION_TIMEOUT_MS));
  const localErrors = diagnoseServerConnection(request.endpoint, { ...request, username: "certificate-diagnostic" })
    .filter(diagnostic => diagnostic.severity === "error");
  if (localErrors.length) throw safeError("Correct the blocking local host, port, and security diagnostics before live inspection.");
  if (request.security === "plain") {
    return {
      outcome: "not-applicable",
      endpoint: request.endpoint,
      transport: "plain",
      inspectedAt: new Date().toISOString(),
      timeoutMs,
      authorized: null,
      hostnameMatch: null,
      authorizationIssue: null,
      protocol: null,
      cipher: null,
      chain: [],
      chainComplete: false,
      chainTruncated: false,
    };
  }

  let activeSocket: Socket | TLSSocket | undefined;
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    activeSocket?.destroy(new Error("TLS certificate inspection timeout."));
  }, timeoutMs);
  try {
    let tlsSocket: TLSSocket;
    if (request.security === "tls") {
      tlsSocket = connectTls({ host: request.host, port: request.port, servername: tlsServername(request.host), rejectUnauthorized: false });
      activeSocket = tlsSocket;
      await waitForSecureConnect(tlsSocket);
    } else {
      const socket = createConnection({ host: request.host, port: request.port });
      activeSocket = socket;
      await waitForConnect(socket);
      socket.setNoDelay(true);
      if (request.endpoint === "incoming") await imapStarttls(socket);
      else await smtpStarttls(socket);
      tlsSocket = connectTls({ socket, servername: tlsServername(request.host), rejectUnauthorized: false });
      activeSocket = tlsSocket;
      await waitForSecureConnect(tlsSocket);
    }
    return inspectSocket(request, tlsSocket, timeoutMs);
  } catch (error) {
    throw sanitizeNetworkError(error, timedOut);
  } finally {
    clearTimeout(timeout);
    activeSocket?.destroy();
  }
};
