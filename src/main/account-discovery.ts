import type { SrvRecord } from "node:dns";
import { resolveSrv } from "node:dns/promises";
import { z } from "zod";
import type { AccountDiscoveryResult, MailSecurity, ServerSettings } from "../shared/contracts.js";

const emailSchema = z.email();

const providerPresets: Record<string, Omit<AccountDiscoveryResult, "email" | "displayName">> = {
  "gmail.com": {
    source: "provider-preset",
    incoming: { host: "imap.gmail.com", port: 993, security: "tls", username: "" },
    outgoing: { host: "smtp.gmail.com", port: 465, security: "tls", username: "" },
    authModes: ["oauth2", "password"],
  },
  "googlemail.com": {
    source: "provider-preset",
    incoming: { host: "imap.gmail.com", port: 993, security: "tls", username: "" },
    outgoing: { host: "smtp.gmail.com", port: 465, security: "tls", username: "" },
    authModes: ["oauth2", "password"],
  },
  "outlook.com": {
    source: "provider-preset",
    incoming: { host: "outlook.office365.com", port: 993, security: "tls", username: "" },
    outgoing: { host: "smtp.office365.com", port: 587, security: "starttls", username: "" },
    authModes: ["oauth2", "password"],
  },
  "hotmail.com": {
    source: "provider-preset",
    incoming: { host: "outlook.office365.com", port: 993, security: "tls", username: "" },
    outgoing: { host: "smtp.office365.com", port: 587, security: "starttls", username: "" },
    authModes: ["oauth2", "password"],
  },
  "yahoo.com": {
    source: "provider-preset",
    incoming: { host: "imap.mail.yahoo.com", port: 993, security: "tls", username: "" },
    outgoing: { host: "smtp.mail.yahoo.com", port: 465, security: "tls", username: "" },
    authModes: ["oauth2", "password"],
  },
  "icloud.com": {
    source: "provider-preset",
    incoming: { host: "imap.mail.me.com", port: 993, security: "tls", username: "" },
    outgoing: { host: "smtp.mail.me.com", port: 587, security: "starttls", username: "" },
    authModes: ["password"],
  },
};

const withUsername = (settings: ServerSettings, email: string): ServerSettings => ({ ...settings, username: email });

const normalizeSrv = (records: readonly SrvRecord[]): SrvRecord | undefined =>
  records
    .filter(record => Number.isInteger(record.port) && record.port > 0 && record.port <= 65_535 && record.name.trim().length > 0)
    .toSorted((left, right) => left.priority - right.priority || right.weight - left.weight || left.name.localeCompare(right.name))[0];

const normalizeHost = (value: string): string => value.trim().replace(/\.$/, "").toLowerCase();

export const discoverSrvConfiguration = (
  email: string,
  imapsRecords: readonly SrvRecord[],
  submissionRecords: readonly SrvRecord[],
): AccountDiscoveryResult | null => {
  const parsedEmail = emailSchema.parse(email.trim().toLowerCase());
  const incoming = normalizeSrv(imapsRecords);
  const outgoing = normalizeSrv(submissionRecords);
  if (!incoming || !outgoing) return null;
  const outgoingSecurity: MailSecurity = outgoing.port === 465 ? "tls" : "starttls";
  return {
    source: "dns-srv",
    displayName: parsedEmail.split("@")[0] || parsedEmail,
    email: parsedEmail,
    incoming: { host: normalizeHost(incoming.name), port: incoming.port, security: "tls", username: parsedEmail },
    outgoing: { host: normalizeHost(outgoing.name), port: outgoing.port, security: outgoingSecurity, username: parsedEmail },
    authModes: ["password"],
  };
};

const withTimeout = <T>(operation: Promise<T>, milliseconds: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Mail service DNS discovery timed out.")), milliseconds);
    timer.unref();
    operation.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      error => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });

export class AccountDiscoveryService {
  async discover(value: string): Promise<AccountDiscoveryResult[]> {
    const email = emailSchema.parse(value.trim().toLowerCase());
    const domain = email.split("@")[1]!;
    const results: AccountDiscoveryResult[] = [];

    const preset = providerPresets[domain];
    if (preset) {
      results.push({
        ...preset,
        displayName: email.split("@")[0] || email,
        email,
        incoming: withUsername(preset.incoming, email),
        outgoing: withUsername(preset.outgoing, email),
      });
    }

    try {
      const [imaps, submission] = await Promise.all([
        withTimeout(resolveSrv(`_imaps._tcp.${domain}`), 4_000),
        withTimeout(resolveSrv(`_submission._tcp.${domain}`), 4_000),
      ]);
      const discovered = discoverSrvConfiguration(email, imaps, submission);
      if (discovered && !results.some(item => JSON.stringify(item.incoming) === JSON.stringify(discovered.incoming))) {
        results.unshift(discovered);
      }
    } catch {
      // DNS discovery is advisory. Editable presets and conventional settings remain available.
    }

    results.push({
      source: "conventional",
      displayName: email.split("@")[0] || email,
      email,
      incoming: { host: `imap.${domain}`, port: 993, security: "tls", username: email },
      outgoing: { host: `smtp.${domain}`, port: 587, security: "starttls", username: email },
      authModes: ["password"],
    });
    return results;
  }
}
