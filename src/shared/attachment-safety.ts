export type AttachmentRiskLevel = "ordinary" | "caution" | "dangerous";

export type AttachmentRiskReason =
  | "windows-executable"
  | "windows-script"
  | "windows-shortcut"
  | "windows-installer"
  | "macro-enabled-document"
  | "double-extension"
  | "trailing-dot-or-space"
  | "bidirectional-control"
  | "mime-extension-mismatch";

export interface AttachmentRiskAssessment {
  level: AttachmentRiskLevel;
  reasons: AttachmentRiskReason[];
}

export interface AttachmentRiskReviewItem extends AttachmentRiskAssessment {
  index: number;
  filename: string;
  contentType: string;
}

export interface AttachmentSaveReview {
  riskyAttachments: AttachmentRiskReviewItem[];
}

interface AttachmentDescriptor {
  filename: string;
  contentType: string;
}

const WINDOWS_EXECUTABLE_EXTENSIONS = new Set([
  ".com", ".cpl", ".dll", ".drv", ".exe", ".ocx", ".pif", ".scr", ".sys",
]);

const WINDOWS_SCRIPT_EXTENSIONS = new Set([
  ".bat", ".cmd", ".hta", ".inf", ".js", ".jse", ".ps1", ".psd1", ".psm1", ".reg", ".scf", ".vbe", ".vbs", ".wsf", ".wsh",
]);

const WINDOWS_SHORTCUT_EXTENSIONS = new Set([
  ".library-ms", ".lnk", ".search-ms", ".url", ".website",
]);

const WINDOWS_INSTALLER_EXTENSIONS = new Set([
  ".appinstaller", ".appx", ".appxbundle", ".msi", ".msix", ".msixbundle", ".msp", ".mst",
]);

const MACRO_ENABLED_EXTENSIONS = new Set([
  ".docm", ".dotm", ".ppam", ".potm", ".ppsm", ".pptm", ".sldm", ".xlam", ".xlsb", ".xlsm", ".xltm",
]);

const DECEPTIVE_LEAD_EXTENSIONS = new Set([
  ".7z", ".bmp", ".csv", ".doc", ".docm", ".docx", ".gif", ".jpeg", ".jpg", ".json", ".odg", ".odp", ".ods", ".odt", ".pdf", ".png", ".ppt", ".pptm", ".pptx", ".rar", ".rtf", ".svg", ".tar", ".tif", ".tiff", ".txt", ".webp", ".xls", ".xlsm", ".xlsx", ".xml", ".zip",
]);

const COMMON_COMPOUND_EXTENSIONS = [
  ".tar.bz2", ".tar.gz", ".tar.lz", ".tar.lz4", ".tar.xz", ".tar.zst",
];

const GENERIC_MIME_TYPES = new Set([
  "", "application/force-download", "application/octet-stream", "application/x-download", "binary/octet-stream",
]);

const MIME_TYPES_BY_EXTENSION: Readonly<Record<string, readonly string[]>> = {
  ".7z": ["application/x-7z-compressed"],
  ".bmp": ["image/bmp"],
  ".csv": ["text/csv", "application/csv"],
  ".doc": ["application/msword"],
  ".docm": ["application/vnd.ms-word.document.macroenabled.12"],
  ".docx": ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  ".dotm": ["application/vnd.ms-word.template.macroenabled.12"],
  ".exe": ["application/vnd.microsoft.portable-executable", "application/x-dosexec", "application/x-msdownload"],
  ".gif": ["image/gif"],
  ".htm": ["text/html"],
  ".html": ["text/html"],
  ".jpeg": ["image/jpeg"],
  ".jpg": ["image/jpeg"],
  ".json": ["application/json", "text/json"],
  ".msi": ["application/x-msi", "application/x-msdownload", "application/octet-stream"],
  ".odp": ["application/vnd.oasis.opendocument.presentation"],
  ".ods": ["application/vnd.oasis.opendocument.spreadsheet"],
  ".odt": ["application/vnd.oasis.opendocument.text"],
  ".pdf": ["application/pdf"],
  ".png": ["image/png"],
  ".ppt": ["application/vnd.ms-powerpoint"],
  ".pptm": ["application/vnd.ms-powerpoint.presentation.macroenabled.12"],
  ".pptx": ["application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  ".rar": ["application/vnd.rar", "application/x-rar-compressed"],
  ".rtf": ["application/rtf", "text/rtf"],
  ".svg": ["image/svg+xml"],
  ".tif": ["image/tiff"],
  ".tiff": ["image/tiff"],
  ".txt": ["text/plain"],
  ".webp": ["image/webp"],
  ".xls": ["application/vnd.ms-excel"],
  ".xlsb": ["application/vnd.ms-excel.sheet.binary.macroenabled.12"],
  ".xlsm": ["application/vnd.ms-excel.sheet.macroenabled.12"],
  ".xlsx": ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  ".xml": ["application/xml", "text/xml"],
  ".zip": ["application/zip", "application/x-zip-compressed"],
};

const REASON_ORDER: readonly AttachmentRiskReason[] = [
  "windows-executable",
  "windows-script",
  "windows-shortcut",
  "windows-installer",
  "macro-enabled-document",
  "double-extension",
  "trailing-dot-or-space",
  "bidirectional-control",
  "mime-extension-mismatch",
];

const filenameOnly = (value: string): string => value.split(/[\\/]/u).at(-1) ?? value;

const extensionOf = (filename: string): string => {
  const normalized = filename.replace(/[. ]+$/u, "");
  const dot = normalized.lastIndexOf(".");
  return dot > 0 ? normalized.slice(dot).toLocaleLowerCase("en-US") : "";
};

const hasDeceptiveDoubleExtension = (filename: string): boolean => {
  const normalized = filename.replace(/[. ]+$/u, "").toLocaleLowerCase("en-US");
  if (COMMON_COMPOUND_EXTENSIONS.some(extension => normalized.endsWith(extension))) return false;
  const finalDot = normalized.lastIndexOf(".");
  if (finalDot <= 0) return false;
  const previous = normalized.slice(0, finalDot);
  const previousDot = previous.lastIndexOf(".");
  if (previousDot <= 0) return false;
  return DECEPTIVE_LEAD_EXTENSIONS.has(previous.slice(previousDot));
};

const normalizedMimeType = (contentType: string): string =>
  contentType.split(";", 1)[0]?.trim().toLocaleLowerCase("en-US") ?? "";

const hasMimeExtensionMismatch = (extension: string, contentType: string): boolean => {
  const mimeType = normalizedMimeType(contentType);
  if (!extension || GENERIC_MIME_TYPES.has(mimeType)) return false;
  const expected = MIME_TYPES_BY_EXTENSION[extension];
  return expected !== undefined && !expected.includes(mimeType);
};

export const classifyAttachment = (filename: string, contentType: string): AttachmentRiskAssessment => {
  const leaf = filenameOnly(filename);
  const extension = extensionOf(leaf);
  const reasons = new Set<AttachmentRiskReason>();

  if (WINDOWS_EXECUTABLE_EXTENSIONS.has(extension)) reasons.add("windows-executable");
  if (WINDOWS_SCRIPT_EXTENSIONS.has(extension)) reasons.add("windows-script");
  if (WINDOWS_SHORTCUT_EXTENSIONS.has(extension)) reasons.add("windows-shortcut");
  if (WINDOWS_INSTALLER_EXTENSIONS.has(extension)) reasons.add("windows-installer");
  if (MACRO_ENABLED_EXTENSIONS.has(extension)) reasons.add("macro-enabled-document");
  if (hasDeceptiveDoubleExtension(leaf)) reasons.add("double-extension");
  if (/[. ]$/u.test(leaf)) reasons.add("trailing-dot-or-space");
  if (/[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u.test(leaf)) reasons.add("bidirectional-control");
  if (hasMimeExtensionMismatch(extension, contentType)) reasons.add("mime-extension-mismatch");

  const orderedReasons = REASON_ORDER.filter(reason => reasons.has(reason));
  const dangerous = orderedReasons.some(reason =>
    reason === "windows-executable" ||
    reason === "windows-script" ||
    reason === "windows-shortcut" ||
    reason === "windows-installer" ||
    reason === "bidirectional-control",
  );
  return {
    level: dangerous ? "dangerous" : orderedReasons.length ? "caution" : "ordinary",
    reasons: orderedReasons,
  };
};

export const createAttachmentRiskReviewItem = (
  attachment: AttachmentDescriptor,
  index: number,
): AttachmentRiskReviewItem => ({
  index,
  filename: attachment.filename,
  contentType: attachment.contentType,
  ...classifyAttachment(attachment.filename, attachment.contentType),
});

export const createAttachmentSaveReview = (attachments: readonly AttachmentDescriptor[]): AttachmentSaveReview => ({
  riskyAttachments: attachments
    .map(createAttachmentRiskReviewItem)
    .filter(attachment => attachment.level !== "ordinary"),
});

export const attachmentSaveReviewMatches = (
  expected: AttachmentSaveReview,
  received: AttachmentSaveReview | undefined,
): boolean => {
  if (!received || received.riskyAttachments.length !== expected.riskyAttachments.length) return false;
  return expected.riskyAttachments.every((attachment, index) => {
    const candidate = received.riskyAttachments[index];
    return candidate !== undefined &&
      candidate.index === attachment.index &&
      candidate.filename === attachment.filename &&
      candidate.contentType === attachment.contentType &&
      candidate.level === attachment.level &&
      candidate.reasons.length === attachment.reasons.length &&
      candidate.reasons.every((reason, reasonIndex) => reason === attachment.reasons[reasonIndex]);
  });
};
