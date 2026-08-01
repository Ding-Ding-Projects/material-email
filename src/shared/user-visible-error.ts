export type UserVisibleErrorContext = "general" | "mail" | "search";

export interface UserVisibleErrorOptions {
  context?: UserVisibleErrorContext;
  fallback?: string;
}

const GENERAL_FALLBACK = "The operation could not complete. Review the current settings and try again.";
const MAIL_FALLBACK = "The mail server operation could not complete. Check the account server settings and network, then retry.";
const SEARCH_FALLBACK = "The search could not complete. Review the search settings and try again.";
const MAX_VISIBLE_ERROR_CHARACTERS = 480;
const MAIL_ERROR_CODES = new Set([
  "EAUTH", "AUTHENTICATIONFAILED", "ECONNREFUSED", "ECONNRESET", "EHOSTUNREACH", "ENETDOWN", "ENETUNREACH",
  "EPIPE", "ETIMEDOUT", "ESOCKETTIMEDOUT", "ETIMEOUT", "ENOTFOUND", "EAI_AGAIN", "EAI_FAIL",
]);
const PUBLIC_MAIL_MESSAGES = new Set([
  MAIL_FALLBACK,
  "The server refused the connection. Check the server address, port, security mode, and network, then retry.",
  "The server address could not be resolved. Check the server name and network, then retry.",
  "The server did not respond before the connection timed out. Check the server settings and network, then retry.",
  "The server rejected the account sign-in. Check the credential or provider authorization, then retry.",
  "The secure connection could not be verified. Review the server name, security mode, and certificate diagnostics before retrying.",
  "The network connection ended before the mail operation completed. Check the network and retry.",
]);

const errorCode = (error: unknown): string => {
  if (!error || typeof error !== "object" || !("code" in error)) return "";
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code.toUpperCase() : "";
};

const rawErrorMessage = (error: unknown): string => {
  if (error === null || error === undefined) return "";
  const raw = error instanceof Error ? error.message : String(error);
  return raw
    .replace(/^Error invoking remote method '[^']+': Error:\s*/iu, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
};

const containsSensitiveImplementationDetail = (message: string): boolean =>
  /\b(?:https?|wss?|ftp|file):\/\/\S+/iu.test(message)
  || /(?:^|[\s("'`])(?:[A-Za-z]:[\\/]|\\\\[^\\\s]+\\[^\\\s]+|\/(?:Users|home|tmp|var|private|opt|mnt|Volumes|etc)(?:\/[^\s:]+)+)/u.test(message)
  || /\b(?:authorization|access[_ -]?token|refresh[_ -]?token|password|secret|query|pattern)=\S+/iu.test(message)
  || /\b(?:Nodemailer|ImapFlow|node:[A-Za-z0-9_./-]+)\b/u.test(message)
  || /\bat\s+(?:async\s+)?[A-Za-z0-9_.$<>]+\s*\([^)]*:\d+:\d+\)/u.test(message);

const mailFailureMessage = (message: string, code: string): string => {
  if (PUBLIC_MAIL_MESSAGES.has(message)) return message;
  if (code === "ECONNREFUSED" || /\b(?:ECONNREFUSED|connection refused)\b/iu.test(message)) {
    return "The server refused the connection. Check the server address, port, security mode, and network, then retry.";
  }
  if (["ENOTFOUND", "EAI_AGAIN", "EAI_FAIL"].includes(code) || /\b(?:ENOTFOUND|EAI_AGAIN|getaddrinfo)\b/iu.test(message)) {
    return "The server address could not be resolved. Check the server name and network, then retry.";
  }
  if (["ETIMEDOUT", "ESOCKETTIMEDOUT", "ETIMEOUT"].includes(code) || /\b(?:ETIMEDOUT|ESOCKETTIMEDOUT|timed? out)\b/iu.test(message)) {
    return "The server did not respond before the connection timed out. Check the server settings and network, then retry.";
  }
  if (["EAUTH", "AUTHENTICATIONFAILED"].includes(code) || /\b(?:authentication failed|invalid (?:login|credentials)|login failed|EAUTH)\b/iu.test(message)) {
    return "The server rejected the account sign-in. Check the credential or provider authorization, then retry.";
  }
  if (/\b(?:certificate|self[- ]signed|ERR_TLS|CERT_[A-Z_]+|TLS handshake|SSL handshake)\b/iu.test(message)) {
    return "The secure connection could not be verified. Review the server name, security mode, and certificate diagnostics before retrying.";
  }
  if (["ENETUNREACH", "EHOSTUNREACH", "ENETDOWN", "ECONNRESET", "EPIPE"].includes(code)
    || /\b(?:ENETUNREACH|EHOSTUNREACH|ENETDOWN|ECONNRESET|socket hang up|network (?:is )?unreachable)\b/iu.test(message)) {
    return "The network connection ended before the mail operation completed. Check the network and retry.";
  }
  if (/^The mail server (?:does not advertise MOVE|did not confirm (?:the move|the read-state change|the star change)|returned an invalid destination UID)/u.test(message)
    || message === "The message is no longer available on the server.") {
    return message;
  }
  return MAIL_FALLBACK;
};

export const userVisibleErrorMessage = (error: unknown, options: UserVisibleErrorOptions = {}): string => {
  const context = options.context ?? "general";
  const fallback = options.fallback ?? (context === "mail" ? MAIL_FALLBACK : context === "search" ? SEARCH_FALLBACK : GENERAL_FALLBACK);
  const message = rawErrorMessage(error);
  if (!message) return fallback;
  if (context === "search" || /^Invalid regular expression:/iu.test(message)) return SEARCH_FALLBACK;
  const code = errorCode(error);
  if (context === "mail") {
    return mailFailureMessage(message, code);
  }
  if (message.length > MAX_VISIBLE_ERROR_CHARACTERS || containsSensitiveImplementationDetail(message)) return fallback;
  if (MAIL_ERROR_CODES.has(code) || /\b(?:SMTP|IMAP|POP3|Nodemailer|ImapFlow|ECONN|EAI_|ENET|EHOST|socket)\b/iu.test(message)) {
    return mailFailureMessage(message, code);
  }
  return message;
};

export const userVisibleErrorLimits = Object.freeze({ message: MAX_VISIBLE_ERROR_CHARACTERS });
