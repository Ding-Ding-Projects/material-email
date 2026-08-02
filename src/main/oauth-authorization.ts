import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import {
  OAUTH_PROVIDER_IDS,
  type OAuthAuthorizationFailure,
  type OAuthAuthorizationPhase,
  type OAuthAuthorizationSnapshot,
  type OAuthProviderAvailability,
  type OAuthProviderId,
} from "../shared/oauth.js";

const CALLBACK_PATH = "/oauth/callback";
const CALLBACK_REQUEST_TARGET_LIMIT = 16_384;
const AUTHORIZATION_CODE_LIMIT = 8_192;
const OAUTH_STATE_BYTES = 32;
const PKCE_VERIFIER_BYTES = 64;
const DEFAULT_AUTHORIZATION_TIMEOUT_MS = 5 * 60_000;
const MAX_INVALID_CALLBACKS = 8;

const providerNames: Record<OAuthProviderId, string> = {
  google: "Google",
  microsoft: "Microsoft",
};

const allowedTransitions: Record<OAuthAuthorizationPhase, ReadonlySet<OAuthAuthorizationPhase>> = {
  idle: new Set(["preparing", "error"]),
  preparing: new Set(["opening-browser", "cancelled", "timed-out", "error"]),
  "opening-browser": new Set(["waiting-for-callback", "authorization-received", "cancelled", "timed-out", "error"]),
  "waiting-for-callback": new Set(["authorization-received", "cancelled", "timed-out", "error"]),
  "authorization-received": new Set(["preparing", "error"]),
  cancelled: new Set(["preparing", "error"]),
  "timed-out": new Set(["preparing", "error"]),
  error: new Set(["preparing", "error"]),
};

export interface OAuthProviderConfiguration {
  provider: OAuthProviderId;
  authorizationEndpoint: string;
  clientId: string;
  scopes: readonly string[];
}

export interface OAuthAuthorizationCodeGrant {
  provider: OAuthProviderId;
  code: string;
  codeVerifier: string;
  redirectUri: string;
}

export interface OAuthAuthorizationServiceOptions {
  configurations?: readonly OAuthProviderConfiguration[];
  openExternal: (url: string) => Promise<void>;
  timeoutMs?: number;
  now?: () => number;
  /**
   * Called exactly once per successful callback, synchronously from inside the loopback HTTP
   * handler, with the code this foundation would otherwise discard. Never invoked over IPC and
   * never given to the renderer — this is the one seam where a caller can turn a completed browser
   * round trip into an actual token exchange, which this class still does not do itself.
   */
  onAuthorizationCode?: (grant: OAuthAuthorizationCodeGrant) => void;
}

export interface PkcePair {
  verifier: string;
  challenge: string;
}

export type LoopbackCallbackRejectionReason =
  | "method"
  | "remote-address"
  | "host"
  | "request-target"
  | "path"
  | "state"
  | "unexpected-token"
  | "ambiguous-result"
  | "missing-result";

export type LoopbackCallbackValidation =
  | { kind: "authorization"; code: string }
  | { kind: "provider-error"; error: string }
  | { kind: "rejected"; status: 400 | 404 | 405; reason: LoopbackCallbackRejectionReason };

export interface LoopbackCallbackClaim {
  method: string | undefined;
  hostHeader: string | undefined;
  remoteAddress: string | undefined;
  requestTarget: string | undefined;
}

export interface LoopbackCallbackExpectation {
  host: string;
  path: string;
  state: string;
}

interface ActiveAuthorization {
  provider: OAuthProviderId;
  server: Server;
  expectedHost: string;
  stateBytes: Buffer;
  verifierBytes: Buffer;
  timeout: NodeJS.Timeout | null;
  invalidCallbacks: number;
}

const base64Url = (value: Buffer): string => value.toString("base64url");

export const createPkcePair = (source: (size: number) => Buffer = randomBytes): PkcePair => {
  const verifierBytes = source(PKCE_VERIFIER_BYTES);
  if (verifierBytes.length !== PKCE_VERIFIER_BYTES) throw new Error("PKCE entropy source returned the wrong byte count.");
  const verifier = base64Url(verifierBytes);
  return {
    verifier,
    challenge: createHash("sha256").update(verifier, "ascii").digest("base64url"),
  };
};

const safeTextEqual = (left: string, right: string): boolean => {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
};

const hasControlCharacters = (value: string): boolean => /[\u0000-\u001f\u007f]/u.test(value);

export const validateLoopbackCallback = (
  claim: LoopbackCallbackClaim,
  expectation: LoopbackCallbackExpectation,
): LoopbackCallbackValidation => {
  if (claim.method !== "GET") return { kind: "rejected", status: 405, reason: "method" };
  if (claim.remoteAddress !== "127.0.0.1" && claim.remoteAddress !== "::ffff:127.0.0.1") {
    return { kind: "rejected", status: 400, reason: "remote-address" };
  }
  if (claim.hostHeader !== expectation.host) return { kind: "rejected", status: 400, reason: "host" };
  const target = claim.requestTarget ?? "";
  if (!target.startsWith("/") || target.startsWith("//") || target.length > CALLBACK_REQUEST_TARGET_LIMIT) {
    return { kind: "rejected", status: 400, reason: "request-target" };
  }

  let callback: URL;
  try {
    callback = new URL(target, `http://${expectation.host}`);
  } catch {
    return { kind: "rejected", status: 400, reason: "request-target" };
  }
  if (callback.origin !== `http://${expectation.host}` || callback.pathname !== expectation.path || callback.hash) {
    return { kind: "rejected", status: 404, reason: "path" };
  }

  const states = callback.searchParams.getAll("state");
  if (states.length !== 1 || states[0]!.length > 256 || !safeTextEqual(states[0]!, expectation.state)) {
    return { kind: "rejected", status: 400, reason: "state" };
  }
  if (["access_token", "refresh_token", "id_token"].some(parameter => callback.searchParams.has(parameter))) {
    return { kind: "rejected", status: 400, reason: "unexpected-token" };
  }

  const codes = callback.searchParams.getAll("code");
  const errors = callback.searchParams.getAll("error");
  if (codes.length > 1 || errors.length > 1 || (codes.length === 1 && errors.length === 1)) {
    return { kind: "rejected", status: 400, reason: "ambiguous-result" };
  }
  if (errors.length === 1) {
    const error = errors[0] ?? "";
    if (!error || error.length > 128 || hasControlCharacters(error)) {
      return { kind: "rejected", status: 400, reason: "ambiguous-result" };
    }
    return { kind: "provider-error", error };
  }
  if (codes.length === 1) {
    const code = codes[0] ?? "";
    if (!code || code.length > AUTHORIZATION_CODE_LIMIT || hasControlCharacters(code)) {
      return { kind: "rejected", status: 400, reason: "ambiguous-result" };
    }
    return { kind: "authorization", code };
  }
  return { kind: "rejected", status: 400, reason: "missing-result" };
};

const callbackDocument = (outcome: "received" | "cancelled"): string => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'">
<title>Material Email OAuth callback</title></head><body><main>
<h1>${outcome === "received" ? "Return to Material Email" : "Authorization was not completed"}</h1>
<p>${outcome === "received" ? "The local callback was validated. Material Email did not exchange or save a token. You may close this tab." : "The provider returned an error. Material Email did not save a code or token. You may close this tab."}</p>
<p lang="zh-HK">${outcome === "received" ? "本機回呼已驗證。Material Email 冇交換或者儲存權杖，你可以關閉呢個分頁。" : "供應商傳回錯誤。Material Email 冇儲存授權碼或者權杖，你可以關閉呢個分頁。"}</p>
</main></body></html>`;

const sendResponse = (response: ServerResponse, status: number, body: string, contentType = "text/plain; charset=utf-8"): void => {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": contentType,
    "Content-Length": Buffer.byteLength(body),
    "Content-Security-Policy": "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    Connection: "close",
  });
  response.end(body);
};

const listenOnLoopback = (server: Server): Promise<number> => new Promise((resolve, reject) => {
  const onError = (error: Error): void => {
    server.off("listening", onListening);
    reject(error);
  };
  const onListening = (): void => {
    server.off("error", onError);
    const address = server.address();
    if (!address || typeof address === "string") reject(new Error("OAuth callback listener did not expose a TCP port."));
    else resolve(address.port);
  };
  server.once("error", onError);
  server.once("listening", onListening);
  server.listen({ host: "127.0.0.1", port: 0, exclusive: true });
});

const closeServer = (server: Server): Promise<void> => {
  if (!server.listening) return Promise.resolve();
  return new Promise(resolve => {
    server.close(() => resolve());
    server.closeIdleConnections();
  });
};

const validateConfiguration = (configuration: OAuthProviderConfiguration): OAuthProviderConfiguration => {
  if (!OAUTH_PROVIDER_IDS.includes(configuration.provider)) throw new Error("Unsupported OAuth provider configuration.");
  const endpoint = new URL(configuration.authorizationEndpoint);
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new Error("OAuth authorization endpoints must be clean HTTPS URLs.");
  }
  if (!configuration.clientId || configuration.clientId.length > 512 || hasControlCharacters(configuration.clientId)) {
    throw new Error("OAuth client identifiers must be bounded text.");
  }
  if (
    configuration.scopes.length === 0
    || configuration.scopes.length > 50
    || configuration.scopes.some(scope => !scope || scope.length > 256 || /\s/u.test(scope) || hasControlCharacters(scope))
  ) throw new Error("OAuth scopes must be bounded, non-empty tokens.");
  return { ...configuration, scopes: [...configuration.scopes] };
};

export class OAuthAuthorizationService {
  readonly #configurations = new Map<OAuthProviderId, OAuthProviderConfiguration>();
  readonly #providers: OAuthProviderAvailability[];
  readonly #openExternal: (url: string) => Promise<void>;
  readonly #timeoutMs: number;
  readonly #now: () => number;
  readonly #onAuthorizationCode: ((grant: OAuthAuthorizationCodeGrant) => void) | undefined;
  #active: ActiveAuthorization | null = null;
  #snapshot: Omit<OAuthAuthorizationSnapshot, "providers"> = {
    phase: "idle",
    provider: null,
    expiresAt: null,
    failure: null,
  };

  constructor(options: OAuthAuthorizationServiceOptions) {
    this.#openExternal = options.openExternal;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_AUTHORIZATION_TIMEOUT_MS;
    this.#now = options.now ?? Date.now;
    this.#onAuthorizationCode = options.onAuthorizationCode;
    if (!Number.isInteger(this.#timeoutMs) || this.#timeoutMs < 10 || this.#timeoutMs > 10 * 60_000) {
      throw new Error("OAuth authorization timeout is outside the supported bound.");
    }
    for (const candidate of options.configurations ?? []) {
      const configuration = validateConfiguration(candidate);
      if (this.#configurations.has(configuration.provider)) throw new Error("OAuth provider configurations must be unique.");
      this.#configurations.set(configuration.provider, configuration);
    }
    this.#providers = OAUTH_PROVIDER_IDS.map(id => ({ id, name: providerNames[id], configured: this.#configurations.has(id) }));
  }

  status(): OAuthAuthorizationSnapshot {
    return { ...this.#snapshot, providers: this.#providers.map(provider => ({ ...provider })) };
  }

  async start(provider: OAuthProviderId): Promise<OAuthAuthorizationSnapshot> {
    if (this.#active) return this.status();
    const configuration = this.#configurations.get(provider);
    if (!configuration) {
      this.#transition("error", provider, null, "provider-not-configured");
      return this.status();
    }

    this.#transition("preparing", provider, null, null);
    const stateBytes = randomBytes(OAUTH_STATE_BYTES);
    const verifierBytes = randomBytes(PKCE_VERIFIER_BYTES);
    const verifier = base64Url(verifierBytes);
    const challenge = createHash("sha256").update(verifier, "ascii").digest("base64url");
    const server = createServer((request, response) => this.#handleCallback(server, request, response));
    server.maxHeadersCount = 32;
    server.headersTimeout = 5_000;
    server.requestTimeout = 5_000;
    server.keepAliveTimeout = 1_000;

    let port: number;
    try {
      port = await listenOnLoopback(server);
    } catch {
      stateBytes.fill(0);
      verifierBytes.fill(0);
      this.#transition("error", provider, null, "callback-listener-failed");
      return this.status();
    }

    const expiresAtMs = this.#now() + this.#timeoutMs;
    const expectedHost = `127.0.0.1:${port}`;
    const session: ActiveAuthorization = {
      provider,
      server,
      expectedHost,
      stateBytes,
      verifierBytes,
      timeout: null,
      invalidCallbacks: 0,
    };
    this.#active = session;
    server.on("error", () => {
      if (this.#active === session) void this.#terminate(session, "error", "callback-listener-failed");
    });
    session.timeout = setTimeout(() => {
      if (this.#active === session) void this.#terminate(session, "timed-out", null);
    }, this.#timeoutMs);
    session.timeout.unref();

    const redirectUri = `http://${expectedHost}${CALLBACK_PATH}`;
    const authorizationUrl = new URL(configuration.authorizationEndpoint);
    authorizationUrl.searchParams.set("client_id", configuration.clientId);
    authorizationUrl.searchParams.set("redirect_uri", redirectUri);
    authorizationUrl.searchParams.set("response_type", "code");
    authorizationUrl.searchParams.set("scope", configuration.scopes.join(" "));
    authorizationUrl.searchParams.set("state", base64Url(stateBytes));
    authorizationUrl.searchParams.set("code_challenge", challenge);
    authorizationUrl.searchParams.set("code_challenge_method", "S256");

    this.#transition("opening-browser", provider, new Date(expiresAtMs).toISOString(), null);
    try {
      await this.#openExternal(authorizationUrl.toString());
    } catch {
      if (this.#active === session) await this.#terminate(session, "error", "browser-open-failed");
      return this.status();
    }
    if (this.#active === session && this.#snapshot.phase === "opening-browser") {
      this.#transition("waiting-for-callback", provider, new Date(expiresAtMs).toISOString(), null);
    }
    return this.status();
  }

  async cancel(): Promise<OAuthAuthorizationSnapshot> {
    const session = this.#active;
    if (session) await this.#terminate(session, "cancelled", null);
    return this.status();
  }

  async dispose(): Promise<void> {
    const session = this.#active;
    if (session) await this.#terminate(session, "cancelled", null);
  }

  #transition(
    phase: OAuthAuthorizationPhase,
    provider: OAuthProviderId | null,
    expiresAt: string | null,
    failure: OAuthAuthorizationFailure | null,
  ): void {
    if (!allowedTransitions[this.#snapshot.phase].has(phase)) throw new Error("Invalid OAuth authorization state transition.");
    this.#snapshot = { phase, provider, expiresAt, failure };
  }

  #terminate(
    session: ActiveAuthorization,
    phase: "authorization-received" | "cancelled" | "timed-out" | "error",
    failure: OAuthAuthorizationFailure | null,
  ): Promise<void> {
    if (this.#active !== session) return Promise.resolve();
    this.#active = null;
    if (session.timeout) clearTimeout(session.timeout);
    session.stateBytes.fill(0);
    session.verifierBytes.fill(0);
    this.#transition(phase, session.provider, null, failure);
    return closeServer(session.server);
  }

  #handleCallback(server: Server, request: IncomingMessage, response: ServerResponse): void {
    const session = this.#active;
    if (!session || session.server !== server) {
      sendResponse(response, 410, "This OAuth callback is no longer active.");
      return;
    }
    const validation = validateLoopbackCallback(
      {
        method: request.method,
        hostHeader: request.headers.host,
        remoteAddress: request.socket.remoteAddress,
        requestTarget: request.url,
      },
      { host: session.expectedHost, path: CALLBACK_PATH, state: base64Url(session.stateBytes) },
    );
    if (validation.kind === "rejected") {
      session.invalidCallbacks += 1;
      sendResponse(response, validation.status, "The local OAuth callback was rejected.");
      if (session.invalidCallbacks >= MAX_INVALID_CALLBACKS) void this.#terminate(session, "error", "callback-invalid");
      return;
    }
    if (validation.kind === "provider-error") {
      const failure = validation.error === "access_denied" ? "provider-denied" : "provider-error";
      const closing = this.#terminate(session, "error", failure);
      sendResponse(response, 200, callbackDocument("cancelled"), "text/html; charset=utf-8");
      void closing;
      return;
    }

    // The code and verifier are captured as values now, before #terminate zeroes the raw buffer
    // they came from. This class still performs no token exchange itself; the grant is handed to
    // the caller's callback so a real exchange can happen exactly once, outside of this file.
    if (this.#onAuthorizationCode) {
      this.#onAuthorizationCode({
        provider: session.provider,
        code: validation.code,
        codeVerifier: base64Url(session.verifierBytes),
        redirectUri: `http://${session.expectedHost}${CALLBACK_PATH}`,
      });
    }
    const closing = this.#terminate(session, "authorization-received", null);
    sendResponse(response, 200, callbackDocument("received"), "text/html; charset=utf-8");
    void closing;
  }
}
