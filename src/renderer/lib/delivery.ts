import type { SendResult } from "../../shared/contracts";

export type RendererDeliveryDisposition = "queued" | "rejected" | "partial" | "sent";

export const classifyRendererDelivery = (result: SendResult): RendererDeliveryDisposition => {
  if (result.queued) return "queued";
  if (result.accepted.length === 0) return "rejected";
  if (result.rejected.length > 0) return "partial";
  return "sent";
};

export const shouldKeepComposerOpen = (result: SendResult): boolean => classifyRendererDelivery(result) === "rejected";
