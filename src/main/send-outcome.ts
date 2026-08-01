import type { SendResult } from "../shared/contracts.js";

export type SendDisposition = "queued" | "sent" | "partial" | "rejected";

export const classifySendResult = (result: SendResult): SendDisposition => {
  if (result.queued) return "queued";
  if (result.accepted.length === 0) return "rejected";
  if (result.rejected.length > 0) return "partial";
  return "sent";
};

export const describeRecipientOutcome = (result: SendResult): string => {
  const accepted = `${result.accepted.length} recipient${result.accepted.length === 1 ? "" : "s"} accepted`;
  const rejected = `${result.rejected.length} rejected`;
  return `${accepted}; ${rejected}.`;
};
