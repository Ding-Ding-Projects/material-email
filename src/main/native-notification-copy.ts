import type { NotificationRecord, Preferences } from "../shared/contracts.js";

export const nativeNotificationCopy = (kind: NotificationRecord["kind"], preferences: Pick<Preferences, "language" | "funnyEnglish" | "funnyCantonese">): string => {
  const english = kind === "error" ? "An email task needs your attention." : kind === "warning" ? "An email task needs review." : kind === "success" ? "An email task finished." : "Material Email has an update.";
  const cantonese = kind === "error" ? "有封郵件工作要你留意。" : kind === "warning" ? "有封郵件工作要你覆核。" : kind === "success" ? "郵件工作完成喇。" : "Material Email 有新消息。";
  const englishStyled = preferences.funnyEnglish >= 4 ? `${english} The inbox has raised a tiny eyebrow.` : english;
  const cantoneseStyled = preferences.funnyCantonese >= 4 ? `${cantonese} 個收件匣輕輕挑咗下眉。` : cantonese;
  return preferences.language === "yue" ? cantoneseStyled : preferences.language === "bilingual" ? `${englishStyled} · ${cantoneseStyled}` : englishStyled;
};
