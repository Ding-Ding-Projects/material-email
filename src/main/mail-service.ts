import { ImapFlow, type ImapFlowOptions, type ListResponse } from "imapflow";
import { simpleParser, type AddressObject, type ParsedMail } from "mailparser";
import nodemailer from "nodemailer";
import sanitizeHtml from "sanitize-html";
import { randomUUID } from "node:crypto";
import { classifyAttachment } from "../shared/attachment-safety.js";
import type {
  AccountSummary,
  Address,
  ComposeDraft,
  FolderSummary,
  MessageDetail,
  MessageSummary,
  SendResult,
} from "../shared/contracts.js";

export interface RuntimeAccount extends AccountSummary {
  secret: string;
}

export interface AttachmentContent {
  filename: string;
  contentType: string;
  content: Buffer;
}

export interface MailMoveResult {
  destinationUid?: number;
  destinationUidValidity?: string;
}

export class MailboxGenerationMismatchError extends Error {
  readonly code = "MAILBOX_GENERATION_MISMATCH";

  constructor(folderPath: string, expectedUidValidity: string, liveUidValidity?: string) {
    super(
      liveUidValidity
        ? `The mailbox generation changed for ${folderPath}: expected UIDVALIDITY ${expectedUidValidity}, but the server reports ${liveUidValidity}. Refresh the folder before retrying.`
        : `The mailbox generation for ${folderPath} could not be verified against expected UIDVALIDITY ${expectedUidValidity}. Refresh the folder before retrying.`,
    );
    this.name = "MailboxGenerationMismatchError";
  }
}

const addressList = (value?: AddressObject | AddressObject[] | null): Address[] => {
  if (!value) return [];
  const values = Array.isArray(value) ? value : [value];
  return values.flatMap(item =>
    item.value.map(entry => ({ name: entry.name ?? "", address: entry.address ?? "" })).filter(entry => entry.address),
  );
};

const envelopeAddresses = (value?: Array<{ name?: string; address?: string }> | null): Address[] =>
  (value ?? []).map(entry => ({ name: entry.name ?? "", address: entry.address ?? "" })).filter(entry => entry.address);

const textPreview = (value: string): string => value.replace(/\s+/g, " ").trim().slice(0, 240);

const permanentRecipientRejections = (error: unknown): string[] | null => {
  if (!error || typeof error !== "object") return null;
  const candidate = error as {
    code?: unknown;
    command?: unknown;
    rejected?: unknown;
    rejectedErrors?: unknown;
  };
  if (candidate.code !== "EENVELOPE" || candidate.command !== "RCPT TO" || !Array.isArray(candidate.rejected)) return null;
  const rejected = candidate.rejected.filter((value): value is string => typeof value === "string" && value.length > 0);
  if (!rejected.length || !Array.isArray(candidate.rejectedErrors) || candidate.rejectedErrors.length !== rejected.length) return null;
  const allPermanent = candidate.rejectedErrors.every(value => {
    if (!value || typeof value !== "object") return false;
    const responseCode = (value as { responseCode?: unknown }).responseCode;
    return typeof responseCode === "number" && responseCode >= 500 && responseCode <= 599;
  });
  return allPermanent ? rejected : null;
};

export const sanitizeMessageHtml = (source: string): string =>
  sanitizeHtml(source, {
    allowedTags: ["p", "br", "div", "span", "strong", "b", "em", "i", "u", "s", "ul", "ol", "li", "blockquote", "pre", "code", "table", "thead", "tbody", "tr", "th", "td", "a", "h1", "h2", "h3", "h4", "hr"],
    allowedAttributes: { a: ["href", "title"], td: ["colspan", "rowspan"], th: ["colspan", "rowspan"] },
    allowedSchemes: ["http", "https", "mailto"],
    disallowedTagsMode: "discard",
  });

const parsedMessageToDetail = (
  accountId: string,
  folderPath: string,
  uid: number,
  parsed: ParsedMail,
  flags: Set<string>,
  size: number,
  uidValidity?: string,
): MessageDetail => {
  const text = parsed.text?.trim() ?? "";
  const htmlSource = typeof parsed.html === "string" ? parsed.html : text.replace(/\n/g, "<br>");
  return {
    id: `${accountId}:${folderPath}:${uid}`,
    accountId,
    folderPath,
    uid,
    ...(uidValidity ? { uidValidity } : {}),
    ...(parsed.messageId ? { messageId: parsed.messageId } : {}),
    from: addressList(parsed.from),
    to: addressList(parsed.to),
    cc: addressList(parsed.cc),
    replyTo: addressList(parsed.replyTo),
    subject: parsed.subject?.trim() || "(No subject)",
    date: (parsed.date ?? new Date()).toISOString(),
    preview: textPreview(text),
    unread: !flags.has("\\Seen"),
    starred: flags.has("\\Flagged"),
    hasAttachments: parsed.attachments.length > 0,
    size,
    text,
    html: sanitizeMessageHtml(htmlSource),
    attachments: parsed.attachments.map(item => ({
      filename: item.filename ?? "attachment",
      contentType: item.contentType,
      size: item.size,
      risk: classifyAttachment(item.filename ?? "attachment", item.contentType),
      ...(item.cid ? { contentId: item.cid } : {}),
    })),
  };
};

export const parseMessageSource = async (
  accountId: string,
  folderPath: string,
  uid: number,
  source: Buffer | string,
  flags = new Set<string>(),
): Promise<MessageDetail> => {
  const parsed = await simpleParser(source);
  return parsedMessageToDetail(accountId, folderPath, uid, parsed, flags, Buffer.byteLength(source));
};

export class MailService {
  async testAccount(account: RuntimeAccount): Promise<{ incoming: true; outgoing: true }> {
    await this.#withImap(account, async () => undefined);
    const transport = this.#smtpTransport(account);
    try {
      await transport.verify();
    } finally {
      transport.close();
    }
    return { incoming: true, outgoing: true };
  }

  async listFolders(account: RuntimeAccount): Promise<FolderSummary[]> {
    return this.#withImap(account, async client => {
      const mailboxes = await client.list({ statusQuery: { messages: true, unseen: true, uidValidity: true } });
      return mailboxes
        .filter(mailbox => !mailbox.flags.has("\\Noselect"))
        .map(mailbox => this.#folder(account.id, mailbox))
        .sort((a, b) => this.#folderRank(a.role) - this.#folderRank(b.role) || a.name.localeCompare(b.name));
    });
  }

  async listMessages(account: RuntimeAccount, folderPath: string, limit = 250): Promise<MessageSummary[]> {
    return this.#withImap(account, async client => {
      const lock = await client.getMailboxLock(folderPath);
      try {
        const exists = client.mailbox ? client.mailbox.exists : 0;
        if (!exists) return [];
        const start = Math.max(1, exists - limit + 1);
        const rows: MessageSummary[] = [];
        for await (const message of client.fetch(`${start}:*`, {
          uid: true,
          envelope: true,
          flags: true,
          internalDate: true,
          size: true,
          bodyStructure: true,
        })) {
          const envelope = message.envelope;
          const flags = message.flags ?? new Set<string>();
          rows.push({
            id: `${account.id}:${folderPath}:${message.uid}`,
            accountId: account.id,
            folderPath,
            uid: message.uid,
            ...(client.mailbox && client.mailbox.uidValidity ? { uidValidity: client.mailbox.uidValidity.toString() } : {}),
            ...(envelope?.messageId ? { messageId: envelope.messageId } : {}),
            from: envelopeAddresses(envelope?.from),
            to: envelopeAddresses(envelope?.to),
            cc: envelopeAddresses(envelope?.cc),
            subject: envelope?.subject?.trim() || "(No subject)",
            date: new Date(envelope?.date ?? message.internalDate ?? Date.now()).toISOString(),
            preview: envelope?.subject?.trim() || "",
            unread: !flags.has("\\Seen"),
            starred: flags.has("\\Flagged"),
            hasAttachments: this.#hasAttachment(message.bodyStructure),
            size: message.size ?? 0,
          });
        }
        return rows.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
      } finally {
        lock.release();
      }
    });
  }

  async getMessage(account: RuntimeAccount, folderPath: string, uid: number, expectedUidValidity: string): Promise<MessageDetail> {
    return this.#withImap(account, async client => {
      const lock = await client.getMailboxLock(folderPath);
      try {
        this.#assertMailboxGeneration(client, folderPath, expectedUidValidity);
        const fetched = await client.fetchOne(uid, { uid: true, source: true, envelope: true, flags: true, size: true }, { uid: true });
        if (!fetched || !fetched.source) throw new Error("The message is no longer available on the server.");
        const parsed = await simpleParser(fetched.source);
        return parsedMessageToDetail(
          account.id,
          folderPath,
          uid,
          parsed,
          fetched.flags ?? new Set(),
          fetched.size ?? fetched.source.length,
          expectedUidValidity,
        );
      } finally {
        lock.release();
      }
    });
  }

  async getAttachments(account: RuntimeAccount, folderPath: string, uid: number, expectedUidValidity: string): Promise<AttachmentContent[]> {
    return this.#withImap(account, async client => {
      const lock = await client.getMailboxLock(folderPath);
      try {
        this.#assertMailboxGeneration(client, folderPath, expectedUidValidity);
        const fetched = await client.fetchOne(uid, { source: true }, { uid: true });
        if (!fetched || !fetched.source) throw new Error("The message is no longer available on the server.");
        const parsed = await simpleParser(fetched.source);
        return parsed.attachments.map((attachment, index) => ({
          filename: attachment.filename || `attachment-${index + 1}`,
          contentType: attachment.contentType,
          content: Buffer.from(attachment.content),
        }));
      } finally {
        lock.release();
      }
    });
  }

  async setFlags(
    account: RuntimeAccount,
    folderPath: string,
    uid: number,
    patch: { unread?: boolean; starred?: boolean },
    expectedUidValidity: string,
  ): Promise<void> {
    await this.#withImap(account, async client => {
      const lock = await client.getMailboxLock(folderPath);
      try {
        this.#assertMailboxGeneration(client, folderPath, expectedUidValidity);
        if (patch.unread !== undefined) {
          const method = patch.unread ? client.messageFlagsRemove.bind(client) : client.messageFlagsAdd.bind(client);
          if (!(await method(uid, ["\\Seen"], { uid: true }))) throw new Error("The mail server did not confirm the read-state change.");
        }
        if (patch.starred !== undefined) {
          const method = patch.starred ? client.messageFlagsAdd.bind(client) : client.messageFlagsRemove.bind(client);
          if (!(await method(uid, ["\\Flagged"], { uid: true }))) throw new Error("The mail server did not confirm the star change.");
        }
      } finally {
        lock.release();
      }
    });
  }

  async moveMessage(
    account: RuntimeAccount,
    folderPath: string,
    uid: number,
    destination: string,
    expectedUidValidity: string,
  ): Promise<MailMoveResult> {
    return this.#withImap(account, async client => {
      const lock = await client.getMailboxLock(folderPath);
      try {
        this.#assertMailboxGeneration(client, folderPath, expectedUidValidity);
        if (!client.capabilities.has("MOVE")) {
          throw new Error("The mail server does not advertise MOVE; the message was left in its source folder to avoid an unsafe copy/delete fallback.");
        }
        const result = await client.messageMove(uid, destination, { uid: true });
        if (!result) throw new Error("The mail server did not confirm the move.");
        const destinationUid = result.uidMap?.get(uid);
        if (destinationUid !== undefined && (!Number.isSafeInteger(destinationUid) || destinationUid < 1)) {
          throw new Error("The mail server returned an invalid destination UID for the moved message.");
        }
        return {
          ...(destinationUid !== undefined ? { destinationUid } : {}),
          ...(result.uidValidity !== undefined ? { destinationUidValidity: result.uidValidity.toString() } : {}),
        };
      } finally {
        lock.release();
      }
    });
  }

  async sendMessage(account: RuntimeAccount, draft: ComposeDraft): Promise<SendResult> {
    const transport = this.#smtpTransport(account);
    try {
      try {
        const result = await transport.sendMail({
          from: { name: account.displayName, address: account.email },
          to: draft.to,
          cc: draft.cc,
          bcc: draft.bcc,
          subject: draft.subject,
          text: draft.text,
          ...(draft.inReplyTo ? { inReplyTo: draft.inReplyTo } : {}),
          ...(draft.references ? { references: draft.references } : {}),
          attachments: draft.attachments.map(filePath => ({ path: filePath })),
        });
        return {
          messageId: result.messageId,
          accepted: result.accepted.map(String),
          rejected: result.rejected.map(String),
          queued: false,
        };
      } catch (error) {
        const rejected = permanentRecipientRejections(error);
        if (!rejected) throw error;
        return { messageId: `<rejected-${randomUUID()}@material-email.local>`, accepted: [], rejected, queued: false };
      }
    } finally {
      transport.close();
    }
  }

  #imapClient(account: RuntimeAccount): ImapFlow {
    const options: ImapFlowOptions = {
      host: account.incoming.host,
      port: account.incoming.port,
      secure: account.incoming.security === "tls",
      doSTARTTLS: account.incoming.security === "starttls",
      auth:
        account.authMode === "oauth2"
          ? { user: account.incoming.username, accessToken: account.secret }
          : { user: account.incoming.username, pass: account.secret },
      logger: false,
      disableAutoIdle: true,
      emitLogs: false,
    };
    return new ImapFlow(options);
  }

  #smtpTransport(account: RuntimeAccount) {
    return nodemailer.createTransport({
      host: account.outgoing.host,
      port: account.outgoing.port,
      secure: account.outgoing.security === "tls",
      requireTLS: account.outgoing.security === "starttls",
      auth:
        account.authMode === "oauth2"
          ? { type: "OAuth2", user: account.outgoing.username, accessToken: account.secret }
          : { user: account.outgoing.username, pass: account.secret },
      connectionTimeout: 20_000,
      greetingTimeout: 20_000,
      socketTimeout: 60_000,
    });
  }

  async #withImap<T>(account: RuntimeAccount, operation: (client: ImapFlow) => Promise<T>): Promise<T> {
    const client = this.#imapClient(account);
    try {
      await client.connect();
      return await operation(client);
    } finally {
      if (client.usable) await client.logout().catch(() => undefined);
      else client.close();
    }
  }

  #assertMailboxGeneration(client: ImapFlow, folderPath: string, expectedUidValidity: string): void {
    const liveUidValidity =
      client.mailbox && client.mailbox.uidValidity !== undefined ? client.mailbox.uidValidity.toString() : undefined;
    if (liveUidValidity !== expectedUidValidity) {
      throw new MailboxGenerationMismatchError(folderPath, expectedUidValidity, liveUidValidity);
    }
  }

  #folder(accountId: string, mailbox: ListResponse): FolderSummary {
    const specialUse = mailbox.specialUse?.toLowerCase();
    const normalized = mailbox.path.toLowerCase();
    const role: FolderSummary["role"] =
      specialUse === "\\inbox" || normalized === "inbox"
        ? "inbox"
        : specialUse === "\\sent"
          ? "sent"
          : specialUse === "\\drafts"
            ? "drafts"
            : specialUse === "\\archive"
              ? "archive"
              : specialUse === "\\junk"
                ? "junk"
                : specialUse === "\\trash"
                  ? "trash"
                  : "other";
    return {
      accountId,
      path: mailbox.path,
      name: mailbox.name,
      role,
      unread: mailbox.status?.unseen ?? 0,
      total: mailbox.status?.messages ?? 0,
      ...(mailbox.status?.uidValidity ? { uidValidity: mailbox.status.uidValidity.toString() } : {}),
    };
  }

  #folderRank(role: FolderSummary["role"]): number {
    return ["inbox", "drafts", "sent", "archive", "junk", "trash", "other"].indexOf(role);
  }

  #hasAttachment(node: unknown): boolean {
    if (!node || typeof node !== "object") return false;
    const value = node as { disposition?: string; childNodes?: unknown[] };
    if (value.disposition?.toLowerCase() === "attachment") return true;
    return value.childNodes?.some(child => this.#hasAttachment(child)) ?? false;
  }

}
