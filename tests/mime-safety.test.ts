import { describe, expect, it } from "vitest";
import {
  assertMimeAttachmentSizes,
  MIME_SAFETY_LIMITS,
  MimeSafetyError,
} from "../src/main/mime-safety";

const safetyCode = (operation: () => void): string | undefined => {
  try {
    operation();
    return undefined;
  } catch (error) {
    expect(error).toBeInstanceOf(MimeSafetyError);
    return (error as MimeSafetyError).code;
  }
};

describe("decoded MIME attachment limits", () => {
  it("accepts the exact per-attachment and combined byte ceilings", () => {
    expect(() => assertMimeAttachmentSizes([
      MIME_SAFETY_LIMITS.attachmentBytes,
      MIME_SAFETY_LIMITS.totalAttachmentBytes - MIME_SAFETY_LIMITS.attachmentBytes,
    ])).not.toThrow();
  });

  it("rejects one decoded attachment above its ceiling", () => {
    expect(safetyCode(() => assertMimeAttachmentSizes([
      MIME_SAFETY_LIMITS.attachmentBytes + 1,
    ]))).toBe("MIME_ATTACHMENT_TOO_LARGE");
  });

  it("rejects an aggregate decoded attachment payload above its ceiling", () => {
    expect(safetyCode(() => assertMimeAttachmentSizes([
      MIME_SAFETY_LIMITS.attachmentBytes,
      MIME_SAFETY_LIMITS.totalAttachmentBytes - MIME_SAFETY_LIMITS.attachmentBytes + 1,
    ]))).toBe("MIME_ATTACHMENTS_TOO_LARGE");
  });
});
