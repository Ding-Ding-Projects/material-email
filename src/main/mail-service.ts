import { ImapFlow, type ImapFlowOptions, type ListResponse } from "imapflow";
import { simpleParser, type AddressObject, type ParsedMail } from "mailparser";
import nodemailer from "nodemailer";
import sanitizeHtml from "sanitize-html";
import { randomUUID } from "node:crypto";
import { classifyAttachment } from "../shared/attachment-safety.js";
import { assessMessageCryptography } from "../shared/message-cryptography.js";
import { identityReplyTo, identitySender, type MailIdentity } from "../shared/identities.js";
import { MESSAGE_TAGS_PER_MESSAGE_LIMIT, normalizeMessageTagName } from "../shared/message-tags.js";
import {
  assertMimeAttachmentSizes,
  assertMimeSourceSize,
  byteLabel,
  MIME_SAFETY_LIMITS,
  mimeSafetyError,
} from "./mime-safety.js";
import type {
  AccountSummary,
  Address,
  ComposeDraft,
  FolderSummary,
  MessageDetail,
  MessageSummary,
  RemoteContentSource,
  SendResult,
  MessageCryptographyAssessment,
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

export interface MailKeywordResult {
  added: string[];
  removed: string[];
  /** Every keyword the message now carries, foreign ones included, so a caller can see nothing was lost. */
  keywords: string[];
}

export class MailKeywordError extends Error {
  readonly code: "KEYWORDS_UNSUPPORTED" | "KEYWORD_UNENCODABLE" | "TOO_MANY_KEYWORDS" | "MESSAGE_UNAVAILABLE" | "KEYWORD_NOT_STORED";

  constructor(code: MailKeywordError["code"], message: string) {
    super(message);
    this.name = "MailKeywordError";
    this.code = code;
  }
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

export const MESSAGE_TAG_KEYWORD_PREFIX = "mtag-";
/** Servers cap keyword length without saying so, so an atom that would exceed this is refused instead of truncated. */
export const MESSAGE_TAG_KEYWORD_LIMIT = 64;
const KEYWORD_PLAIN_CHARACTER = /^[0-9a-z-]$/u;

/**
 * A tag becomes an IMAP keyword atom, which RFC 3501 forbids from holding a space, a control character
 * or any of ( ) { } % * " \ ] and which servers compare case-insensitively. Every UTF-8 byte outside
 * [0-9a-z-] is escaped as `_` plus two lowercase hex digits, so the whole atom stays lowercase: a server
 * that folds case cannot corrupt it, and "Work" and "work" still encode to two distinct atoms rather than
 * silently merging into one. The prefix is the only thing this application claims ownership of.
 */
export const messageTagKeyword = (tagName: string): string => {
  const name = normalizeMessageTagName(tagName);
  if (!name) throw new MailKeywordError("KEYWORD_UNENCODABLE", "A tag needs a name before it can be stored on the mail server.");
  let atom = MESSAGE_TAG_KEYWORD_PREFIX;
  for (const byte of Buffer.from(name, "utf8")) {
    const character = String.fromCharCode(byte);
    atom += KEYWORD_PLAIN_CHARACTER.test(character) ? character : `_${byte.toString(16).padStart(2, "0")}`;
  }
  if (atom.length > MESSAGE_TAG_KEYWORD_LIMIT) {
    throw new MailKeywordError(
      "KEYWORD_UNENCODABLE",
      `The tag ${name} encodes to a ${atom.length}-character mail server keyword, over the ${MESSAGE_TAG_KEYWORD_LIMIT}-character limit. Shorten the tag name; it was not stored.`,
    );
  }
  return atom;
};

/** The tag name an atom was built from, or null when the atom is not one this application wrote. */
export const messageTagKeywordName = (keyword: string): string | null => {
  const atom = keyword.toLowerCase();
  if (!atom.startsWith(MESSAGE_TAG_KEYWORD_PREFIX)) return null;
  const bytes: number[] = [];
  for (let index = MESSAGE_TAG_KEYWORD_PREFIX.length; index < atom.length; index += 1) {
    const character = atom[index] ?? "";
    if (character === "_") {
      const hex = atom.slice(index + 1, index + 3);
      if (!/^[0-9a-f]{2}$/u.test(hex)) return null;
      bytes.push(Number.parseInt(hex, 16));
      index += 2;
      continue;
    }
    if (!KEYWORD_PLAIN_CHARACTER.test(character)) return null;
    bytes.push(character.charCodeAt(0));
  }
  return Buffer.from(bytes).toString("utf8") || null;
};

const isMessageTagKeyword = (flag: string): boolean => flag.toLowerCase().startsWith(MESSAGE_TAG_KEYWORD_PREFIX);

const headerLength = (source: Buffer): number => {
  const endings = [source.indexOf("\r\n\r\n"), source.indexOf("\n\n"), source.indexOf("\r\r")]
    .filter(index => index >= 0);
  return endings.length ? Math.min(...endings) : source.length;
};

const assertMimeHeaderSafety = (source: Buffer): void => {
  const length = headerLength(source);
  if (length > MIME_SAFETY_LIMITS.headerBytes) {
    throw mimeSafetyError(
      "MIME_HEADERS_TOO_LARGE",
      `This message's MIME header block exceeds the ${byteLabel(MIME_SAFETY_LIMITS.headerBytes)} safety limit.`,
    );
  }
  const nullByte = source.indexOf(0);
  if (nullByte >= 0 && nullByte < length) {
    throw mimeSafetyError("MIME_HEADERS_MALFORMED", "This message has a malformed MIME header block.");
  }
  let currentLineBytes = 0;
  for (let index = 0; index < length; index += 1) {
    const byte = source[index];
    if (byte === 0x0a || byte === 0x0d) {
      currentLineBytes = 0;
      continue;
    }
    currentLineBytes += 1;
    if (currentLineBytes > MIME_SAFETY_LIMITS.headerLineBytes) {
      throw mimeSafetyError(
        "MIME_HEADER_LINE_TOO_LONG",
        `This message has a MIME header line longer than the ${byteLabel(MIME_SAFETY_LIMITS.headerLineBytes)} safety limit.`,
      );
    }
  }
};

const assertParsedMimeSafety = (parsed: ParsedMail): void => {
  const textLength = parsed.text?.length ?? 0;
  if (textLength > MIME_SAFETY_LIMITS.textCharacters) {
    throw mimeSafetyError(
      "MIME_TEXT_TOO_LARGE",
      `This message's decoded text body exceeds the ${byteLabel(MIME_SAFETY_LIMITS.textCharacters)} safety limit.`,
    );
  }
  const htmlLength = typeof parsed.html === "string" ? parsed.html.length : 0;
  if (htmlLength > MIME_SAFETY_LIMITS.htmlCharacters) {
    throw mimeSafetyError(
      "MIME_HTML_TOO_LARGE",
      `This message's decoded HTML body exceeds the ${byteLabel(MIME_SAFETY_LIMITS.htmlCharacters)} safety limit.`,
    );
  }
  assertMimeAttachmentSizes(parsed.attachments.map(attachment => attachment.content.length));
};

const parseBoundedMimeSource = async (source: Buffer | string): Promise<ParsedMail> => {
  const sourceBytes = Buffer.isBuffer(source) ? source.length : Buffer.byteLength(source);
  assertMimeSourceSize(sourceBytes);
  const input = Buffer.isBuffer(source) ? source : Buffer.from(source);
  assertMimeHeaderSafety(input);
  let parsed: ParsedMail;
  try {
    parsed = await simpleParser(input, {
      keepCidLinks: true,
      maxHtmlLengthToParse: MIME_SAFETY_LIMITS.htmlCharacters,
      skipTextLinks: true,
      skipTextToHtml: true,
    });
  } catch {
    throw mimeSafetyError("MIME_PARSE_FAILED", "Material Email could not safely parse this message's MIME structure.");
  }
  assertParsedMimeSafety(parsed);
  return parsed;
};

const addressList = (value?: AddressObject | AddressObject[] | null): Address[] => {
  if (!value) return [];
  const values = Array.isArray(value) ? value : [value];
  return values.flatMap(item =>
    item.value.map(entry => ({ name: entry.name ?? "", address: entry.address ?? "" })).filter(entry => entry.address),
  );
};

const boundedMessageReference = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed && trimmed.length <= 4_096 ? trimmed : undefined;
};

const boundedMessageReferences = (value: ParsedMail["references"]): string[] => {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return [...new Set(values.map(item => item.trim()).filter(item => item.length > 0 && item.length <= 4_096))].slice(0, 100);
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

const messageTags = ["p", "br", "div", "span", "strong", "b", "em", "i", "u", "s", "ul", "ol", "li", "blockquote", "pre", "code", "table", "thead", "tbody", "tr", "th", "td", "a", "h1", "h2", "h3", "h4", "hr"];
const messageAttributes = { a: ["href", "title"], td: ["colspan", "rowspan"], th: ["colspan", "rowspan"] };

export interface SanitizedMessageContent {
  html: string;
  remoteContentHtml: string;
  remoteContentSources: RemoteContentSource[];
}

export const sanitizeMessageHtml = (source: string): string =>
  sanitizeHtml(source, {
    allowedTags: messageTags,
    allowedAttributes: messageAttributes,
    allowedSchemes: ["http", "https", "mailto"],
    allowProtocolRelative: false,
    disallowedTagsMode: "discard",
    nestingLimit: 100,
    parseStyleAttributes: false,
  });

const remoteImage = (raw: string | undefined): URL | null => {
  if (!raw) return null;
  try {
    const parsed = new URL(raw.trim());
    if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.username || parsed.password) return null;
    return parsed;
  } catch {
    return null;
  }
};

export const sanitizeMessageContent = (source: string): SanitizedMessageContent => {
  const remoteContentSources: RemoteContentSource[] = [];
  const remoteContentHtml = sanitizeHtml(source, {
    allowedTags: [...messageTags, "img"],
    allowedAttributes: {
      ...messageAttributes,
      img: ["src", "alt", "title", "loading", "referrerpolicy"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    allowedSchemesByTag: { a: ["http", "https", "mailto"], img: ["http", "https"] },
    allowProtocolRelative: false,
    disallowedTagsMode: "discard",
    nestingLimit: 100,
    parseStyleAttributes: false,
    transformTags: {
      img: (_tagName, attributes) => {
        const sourceUrl = remoteImage(attributes.src);
        if (!sourceUrl || remoteContentSources.length >= 1_000) {
          return { tagName: "span", attribs: {}, text: attributes.alt?.slice(0, 2_048) ?? "" };
        }
        remoteContentSources.push({
          kind: "image",
          origin: sourceUrl.origin,
          hostname: sourceUrl.hostname,
          protocol: sourceUrl.protocol as "http:" | "https:",
        });
        return {
          tagName: "img",
          attribs: {
            src: sourceUrl.href,
            alt: attributes.alt?.slice(0, 2_048) ?? "",
            ...(attributes.title ? { title: attributes.title.slice(0, 2_048) } : {}),
            loading: "lazy",
            referrerpolicy: "no-referrer",
          },
        };
      },
    },
  });
  return {
    html: sanitizeMessageHtml(source),
    remoteContentHtml,
    remoteContentSources,
  };
};

const parsedMessageToDetail = (
  accountId: string,
  folderPath: string,
  uid: number,
  parsed: ParsedMail,
  flags: Set<string>,
  size: number,
  cryptography: MessageCryptographyAssessment,
  uidValidity?: string,
): MessageDetail => {
  const text = parsed.text?.trim() ?? "";
  const htmlSource = typeof parsed.html === "string" ? parsed.html : text.replace(/\n/g, "<br>");
  const sanitized = sanitizeMessageContent(htmlSource);
  const inReplyTo = boundedMessageReference(parsed.inReplyTo);
  const references = boundedMessageReferences(parsed.references);
  return {
    id: `${accountId}:${folderPath}:${uid}`,
    accountId,
    folderPath,
    uid,
    ...(uidValidity ? { uidValidity } : {}),
    ...(parsed.messageId ? { messageId: parsed.messageId } : {}),
    ...(inReplyTo ? { inReplyTo } : {}),
    ...(references.length ? { references } : {}),
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
    cryptography,
    text,
    ...sanitized,
    remoteContentAllowed: false,
    attachments: parsed.attachments.map(item => ({
      filename: item.filename ?? "attachment",
      contentType: item.contentType,
      size: item.content.length,
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
  const parsed = await parseBoundedMimeSource(source);
  return parsedMessageToDetail(accountId, folderPath, uid, parsed, flags, Buffer.byteLength(source), assessMessageCryptography(source));
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
          const inReplyTo = boundedMessageReference(envelope?.inReplyTo);
          rows.push({
            id: `${account.id}:${folderPath}:${message.uid}`,
            accountId: account.id,
            folderPath,
            uid: message.uid,
            ...(client.mailbox && client.mailbox.uidValidity ? { uidValidity: client.mailbox.uidValidity.toString() } : {}),
            ...(envelope?.messageId ? { messageId: envelope.messageId } : {}),
            ...(inReplyTo ? { inReplyTo } : {}),
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
        const fetched = await client.fetchOne(uid, {
          uid: true,
          source: { start: 0, maxLength: MIME_SAFETY_LIMITS.sourceBytes + 1 },
          envelope: true,
          flags: true,
          size: true,
        }, { uid: true });
        if (!fetched || !fetched.source) throw new Error("The message is no longer available on the server.");
        if (fetched.size !== undefined) assertMimeSourceSize(fetched.size);
        const parsed = await parseBoundedMimeSource(fetched.source);
        return parsedMessageToDetail(
          account.id,
          folderPath,
          uid,
          parsed,
          fetched.flags ?? new Set(),
          fetched.size ?? fetched.source.length,
          assessMessageCryptography(fetched.source),
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
        const fetched = await client.fetchOne(uid, {
          source: { start: 0, maxLength: MIME_SAFETY_LIMITS.sourceBytes + 1 },
          size: true,
        }, { uid: true });
        if (!fetched || !fetched.source) throw new Error("The message is no longer available on the server.");
        if (fetched.size !== undefined) assertMimeSourceSize(fetched.size);
        const parsed = await parseBoundedMimeSource(fetched.source);
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

  /**
   * Stores a message's tags as IMAP keywords so a tag survives on the server and other clients can see
   * it. Only atoms carrying the tag prefix are added or removed, so a keyword another client wrote is
   * left exactly as it was.
   */
  async setMessageKeywords(
    account: RuntimeAccount,
    folderPath: string,
    uid: number,
    tagNames: readonly string[],
    expectedUidValidity: string,
  ): Promise<MailKeywordResult> {
    if (tagNames.length > MESSAGE_TAGS_PER_MESSAGE_LIMIT) {
      throw new MailKeywordError(
        "TOO_MANY_KEYWORDS",
        `Material Email stores at most ${MESSAGE_TAGS_PER_MESSAGE_LIMIT} tags on one message; ${tagNames.length} were requested and none were stored.`,
      );
    }
    const desired = new Set(tagNames.map(name => messageTagKeyword(name)));
    return this.#withImap(account, async client => {
      const lock = await client.getMailboxLock(folderPath);
      try {
        return await this.#applyKeywords(client, folderPath, uid, desired, expectedUidValidity);
      } catch (error) {
        if (error instanceof MailKeywordError || error instanceof MailboxGenerationMismatchError) throw error;
        // A provider failure proves nothing about what the server kept, so it fails closed under one
        // stable message instead of surfacing the library's own error text.
        throw new MailKeywordError("KEYWORD_NOT_STORED", "The mail server did not confirm the tag change.");
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

  async createFolder(account: RuntimeAccount, folderPath: string): Promise<FolderSummary> {
    return this.#withImap(account, async client => {
      const created = await client.mailboxCreate(folderPath);
      if (!created) throw new Error("The mail server did not confirm the new folder.");
      const listed = await client.list({ statusQuery: { messages: true, unseen: true, uidValidity: true } });
      const mailbox = listed.find(candidate => candidate.path === created.path);
      if (!mailbox) throw new Error("The mail server created the folder but did not list it back.");
      return this.#folder(account.id, mailbox);
    });
  }

  /**
   * Renames a folder in place. Servers move the whole subtree, so callers must refresh the folder
   * list rather than patching the single path they asked about.
   */
  async renameFolder(account: RuntimeAccount, folderPath: string, destinationPath: string): Promise<string> {
    return this.#withImap(account, async client => {
      const renamed = await client.mailboxRename(folderPath, destinationPath);
      if (!renamed) throw new Error("The mail server did not confirm the folder rename.");
      return renamed.newPath;
    });
  }

  async deleteFolder(account: RuntimeAccount, folderPath: string): Promise<void> {
    await this.#withImap(account, async client => {
      const deleted = await client.mailboxDelete(folderPath);
      if (!deleted) throw new Error("The mail server did not confirm the folder removal.");
    });
  }

  /**
   * Marks every message in a folder read in one server round trip. Returns the number of messages
   * that were unread beforehand, so the caller reports what actually changed.
   */
  async markFolderRead(account: RuntimeAccount, folderPath: string, expectedUidValidity: string): Promise<number> {
    return this.#withImap(account, async client => {
      const lock = await client.getMailboxLock(folderPath);
      try {
        this.#assertMailboxGeneration(client, folderPath, expectedUidValidity);
        const unread = await client.search({ seen: false }, { uid: true });
        if (!unread || !unread.length) return 0;
        const bounded = unread.slice(0, 50_000);
        if (!(await client.messageFlagsAdd(bounded, ["\\Seen"], { uid: true }))) {
          throw new Error("The mail server did not confirm the read-state change.");
        }
        return bounded.length;
      } finally {
        lock.release();
      }
    });
  }

  /**
   * `identity` selects the From address and an optional Reply-To. Without one the account's own
   * name and address are used, which is what every draft written before identities existed expects.
   */
  async sendMessage(account: RuntimeAccount, draft: ComposeDraft, identity: MailIdentity | null = null): Promise<SendResult> {
    const transport = this.#smtpTransport(account);
    const replyTo = identity ? identityReplyTo(identity) : null;
    try {
      try {
        const result = await transport.sendMail({
          from: identity ? identitySender(identity) : { name: account.displayName, address: account.email },
          ...(replyTo ? { replyTo } : {}),
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

  async #applyKeywords(
    client: ImapFlow,
    folderPath: string,
    uid: number,
    desired: ReadonlySet<string>,
    expectedUidValidity: string,
  ): Promise<MailKeywordResult> {
    this.#assertMailboxGeneration(client, folderPath, expectedUidValidity);
    const current = await this.#messageKeywords(client, uid);
    const added = [...desired].filter(keyword => !current.has(keyword)).sort();
    const removed = [...current.keys()].filter(keyword => isMessageTagKeyword(keyword) && !desired.has(keyword)).sort();
    if (!added.length && !removed.length) return { added, removed, keywords: [...current.values()].sort() };
    this.#assertKeywordSupport(client, folderPath, [...added, ...removed]);
    if (added.length && !(await client.messageFlagsAdd(uid, added, { uid: true }))) {
      throw new MailKeywordError("KEYWORD_NOT_STORED", "The mail server did not confirm the tag change.");
    }
    if (removed.length && !(await client.messageFlagsRemove(uid, removed, { uid: true }))) {
      throw new MailKeywordError("KEYWORD_NOT_STORED", "The mail server did not confirm the tag change.");
    }
    // A server can answer OK to STORE and keep nothing, so the keywords are read back rather than assumed.
    const stored = await this.#messageKeywords(client, uid);
    const ours = [...stored.keys()].filter(isMessageTagKeyword);
    if (ours.length !== desired.size || ours.some(keyword => !desired.has(keyword))) {
      throw new MailKeywordError("KEYWORD_NOT_STORED", "The mail server accepted the tag change but did not keep the keywords.");
    }
    return { added, removed, keywords: [...stored.values()].sort() };
  }

  /** The message's keywords as folded atom to the atom the server reported, system flags excluded. */
  async #messageKeywords(client: ImapFlow, uid: number): Promise<Map<string, string>> {
    const fetched = await client.fetchOne(uid, { uid: true, flags: true }, { uid: true });
    if (!fetched || !fetched.flags) throw new MailKeywordError("MESSAGE_UNAVAILABLE", "The message is no longer available on the server.");
    return new Map([...fetched.flags].filter(flag => !flag.startsWith("\\")).map(flag => [flag.toLowerCase(), flag]));
  }

  /**
   * ImapFlow reads an absent PERMANENTFLAGS as "any flag is allowed", but a server that never advertised
   * one is exactly the server that answers OK and drops the keyword, so an absent set refuses here.
   */
  #assertKeywordSupport(client: ImapFlow, folderPath: string, keywords: readonly string[]): void {
    const permanent = client.mailbox ? client.mailbox.permanentFlags : undefined;
    const refusal = `The mail server does not accept tag keywords in ${folderPath}, so the tags were left unchanged there.`;
    if (!permanent || !permanent.size) throw new MailKeywordError("KEYWORDS_UNSUPPORTED", refusal);
    if (permanent.has("\\*")) return;
    const advertised = new Set([...permanent].map(flag => flag.toLowerCase()));
    if (keywords.some(keyword => !advertised.has(keyword))) throw new MailKeywordError("KEYWORDS_UNSUPPORTED", refusal);
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
