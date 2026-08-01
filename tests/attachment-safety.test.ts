import { describe, expect, it } from "vitest";
import {
  attachmentSaveReviewMatches,
  classifyAttachment,
  createAttachmentSaveReview,
} from "../src/shared/attachment-safety";

describe("attachment safety classification", () => {
  it.each([
    ["PAYROLL.EXE", "application/x-msdownload", "windows-executable"],
    ["run.CmD", "text/plain", "windows-script"],
    ["portal.LNK", "application/octet-stream", "windows-shortcut"],
    ["update.MSIXBUNDLE", "application/octet-stream", "windows-installer"],
  ] as const)("classifies the case-insensitive Windows risk in %s", (filename, contentType, reason) => {
    expect(classifyAttachment(filename, contentType)).toEqual(expect.objectContaining({
      level: "dangerous",
      reasons: expect.arrayContaining([reason]),
    }));
  });

  it("reports both an executable and a deceptive double extension", () => {
    expect(classifyAttachment("invoice.pdf.exe", "application/pdf")).toEqual({
      level: "dangerous",
      reasons: ["windows-executable", "double-extension", "mime-extension-mismatch"],
    });
  });

  it.each(["quarterly.pdf.", "quarterly.pdf "])("warns about Windows trailing-name ambiguity in %s", filename => {
    expect(classifyAttachment(filename, "application/pdf")).toEqual({
      level: "caution",
      reasons: ["trailing-dot-or-space"],
    });
  });

  it("treats bidirectional filename controls as dangerous even when the final extension looks ordinary", () => {
    expect(classifyAttachment("photo\u202Egnp.txt", "text/plain")).toEqual({
      level: "dangerous",
      reasons: ["bidirectional-control"],
    });
  });

  it.each([
    ["budget.xlsm", "application/vnd.ms-excel.sheet.macroenabled.12"],
    ["briefing.PPTM", "application/vnd.ms-powerpoint.presentation.macroenabled.12"],
  ])("classifies macro-enabled Office format %s as caution", (filename, contentType) => {
    expect(classifyAttachment(filename, contentType)).toEqual({
      level: "caution",
      reasons: ["macro-enabled-document"],
    });
  });

  it("flags a known MIME type that conflicts with the filename extension", () => {
    expect(classifyAttachment("contract.pdf", "image/png; name=contract.pdf")).toEqual({
      level: "caution",
      reasons: ["mime-extension-mismatch"],
    });
  });

  it.each([
    ["contract.pdf", "APPLICATION/PDF; charset=binary"],
    ["notes.txt", "text/plain"],
    ["README", "application/octet-stream"],
    ["backup.tar.gz", "application/gzip"],
    ["photos.zip", "application/zip"],
    ["report.final.pdf", "application/pdf"],
  ])("keeps ordinary attachment %s ordinary", (filename, contentType) => {
    expect(classifyAttachment(filename, contentType)).toEqual({ level: "ordinary", reasons: [] });
  });

  it("builds a deterministic review containing only risky attachments", () => {
    const review = createAttachmentSaveReview([
      { filename: "notes.txt", contentType: "text/plain" },
      { filename: "invoice.pdf.exe", contentType: "application/pdf" },
      { filename: "forecast.xlsm", contentType: "application/vnd.ms-excel.sheet.macroenabled.12" },
    ]);

    expect(review.riskyAttachments.map(item => ({ index: item.index, filename: item.filename, level: item.level }))).toEqual([
      { index: 1, filename: "invoice.pdf.exe", level: "dangerous" },
      { index: 2, filename: "forecast.xlsm", level: "caution" },
    ]);
    expect(attachmentSaveReviewMatches(review, structuredClone(review))).toBe(true);
    expect(attachmentSaveReviewMatches(review, {
      riskyAttachments: review.riskyAttachments.map(item => item.index === 1 ? { ...item, filename: "renamed.exe" } : item),
    })).toBe(false);
  });
});
