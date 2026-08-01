import { describe, expect, it } from "vitest";
import type { SendResult } from "../../src/shared/contracts";
import { classifyRendererDelivery, shouldKeepComposerOpen } from "../../src/renderer/lib/delivery";

const result = (patch: Partial<SendResult>): SendResult => ({
  messageId: "<delivery@example.test>",
  accepted: [],
  rejected: [],
  queued: false,
  ...patch,
});

describe("renderer delivery outcomes", () => {
  it("keeps the composer open when the server accepts no recipients", () => {
    const rejected = result({ rejected: ["first@example.test", "second@example.test"] });
    expect(classifyRendererDelivery(rejected)).toBe("rejected");
    expect(shouldKeepComposerOpen(rejected)).toBe(true);
  });

  it.each([
    ["queued", result({ queued: true })],
    ["partial", result({ accepted: ["accepted@example.test"], rejected: ["rejected@example.test"] })],
    ["sent", result({ accepted: ["accepted@example.test"] })],
  ] as const)("closes the composer for a %s outcome", (disposition, delivery) => {
    expect(classifyRendererDelivery(delivery)).toBe(disposition);
    expect(shouldKeepComposerOpen(delivery)).toBe(false);
  });
});
