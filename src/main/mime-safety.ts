const MEBIBYTE = 1024 * 1024;

export const MIME_SAFETY_LIMITS = Object.freeze({
  sourceBytes: 32 * MEBIBYTE,
  headerBytes: 64 * 1024,
  headerLineBytes: 8 * 1024,
  textCharacters: 2 * MEBIBYTE,
  htmlCharacters: 4 * MEBIBYTE,
  attachmentCount: 100,
  attachmentBytes: 20 * MEBIBYTE,
  totalAttachmentBytes: 24 * MEBIBYTE,
});

export type MimeSafetyErrorCode =
  | "MIME_SOURCE_TOO_LARGE"
  | "MIME_HEADERS_TOO_LARGE"
  | "MIME_HEADER_LINE_TOO_LONG"
  | "MIME_HEADERS_MALFORMED"
  | "MIME_PARSE_FAILED"
  | "MIME_TEXT_TOO_LARGE"
  | "MIME_HTML_TOO_LARGE"
  | "MIME_TOO_MANY_ATTACHMENTS"
  | "MIME_ATTACHMENT_TOO_LARGE"
  | "MIME_ATTACHMENTS_TOO_LARGE";

export class MimeSafetyError extends Error {
  constructor(readonly code: MimeSafetyErrorCode, message: string) {
    super(message);
    this.name = "MimeSafetyError";
  }
}

const retrySafeMessage =
  "The message was left unopened and unchanged; select it again to retry after the server copy changes.";

export const byteLabel = (value: number): string =>
  value < MEBIBYTE ? `${Math.round(value / 1024)} KiB` : `${(value / MEBIBYTE).toFixed(1)} MiB`;

export const mimeSafetyError = (code: MimeSafetyErrorCode, description: string): MimeSafetyError =>
  new MimeSafetyError(code, `${description} ${retrySafeMessage}`);

export const assertMimeSourceSize = (sourceBytes: number): void => {
  if (sourceBytes <= MIME_SAFETY_LIMITS.sourceBytes) return;
  throw mimeSafetyError(
    "MIME_SOURCE_TOO_LARGE",
    `This message is ${byteLabel(sourceBytes)}, above Material Email's ${byteLabel(MIME_SAFETY_LIMITS.sourceBytes)} raw MIME parsing limit.`,
  );
};

export const assertMimeAttachmentSizes = (attachmentSizes: readonly number[]): void => {
  if (attachmentSizes.length > MIME_SAFETY_LIMITS.attachmentCount) {
    throw mimeSafetyError(
      "MIME_TOO_MANY_ATTACHMENTS",
      `This message contains more than ${MIME_SAFETY_LIMITS.attachmentCount} MIME attachments.`,
    );
  }
  let totalAttachmentBytes = 0;
  for (const contentBytes of attachmentSizes) {
    if (contentBytes > MIME_SAFETY_LIMITS.attachmentBytes) {
      throw mimeSafetyError(
        "MIME_ATTACHMENT_TOO_LARGE",
        `This message contains an attachment larger than the ${byteLabel(MIME_SAFETY_LIMITS.attachmentBytes)} decoded-byte safety limit.`,
      );
    }
    totalAttachmentBytes += contentBytes;
    if (totalAttachmentBytes > MIME_SAFETY_LIMITS.totalAttachmentBytes) {
      throw mimeSafetyError(
        "MIME_ATTACHMENTS_TOO_LARGE",
        `This message's attachments exceed the ${byteLabel(MIME_SAFETY_LIMITS.totalAttachmentBytes)} combined decoded-byte safety limit.`,
      );
    }
  }
};
