import { describe, expect, it } from "vitest";
import { classifySendResult, describeRecipientOutcome } from "../src/main/send-outcome";

describe("SMTP recipient outcomes", () => {
  it("distinguishes complete, partial, rejected, and queued delivery", () => {
    expect(classifySendResult({ messageId: "sent", accepted: ["a@example.test"], rejected: [], queued: false })).toBe("sent");
    expect(classifySendResult({ messageId: "partial", accepted: ["a@example.test"], rejected: ["b@example.test"], queued: false })).toBe(
      "partial",
    );
    expect(classifySendResult({ messageId: "rejected", accepted: [], rejected: ["b@example.test"], queued: false })).toBe("rejected");
    expect(classifySendResult({ messageId: "queued", accepted: [], rejected: [], queued: true })).toBe("queued");
  });

  it("reports both accepted and rejected recipient counts", () => {
    expect(describeRecipientOutcome({ messageId: "partial", accepted: ["a@example.test"], rejected: ["b@example.test", "c@example.test"], queued: false })).toBe(
      "1 recipient accepted; 2 rejected.",
    );
  });
});
