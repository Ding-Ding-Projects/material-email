import { describe, expect, it } from "vitest";
import { assessExternalLink } from "../src/shared/external-link-safety";
import { EXTERNAL_LINK_REVIEW_TTL_MS, ExternalLinkReviewQueue } from "../src/main/external-link-review";

const requestId = "abcdefghijklmnopqrstuvwxyzABCDEF";

describe("external link review queue", () => {
  it("normalizes a web URL into an opaque short-lived request", () => {
    let now = 1_000;
    const queue = new ExternalLinkReviewQueue({ now: () => now });
    const request = queue.create("https://Example.COM:443/help?q=1");
    expect(request).toMatchObject({ normalizedUrl: "https://example.com/help?q=1", hostname: "example.com", expiresAt: now + EXTERNAL_LINK_REVIEW_TTL_MS });
    expect(request?.requestId).toMatch(/^[A-Za-z0-9_-]{32}$/u);
    expect(request?.requestId).not.toContain("example");
  });

  it("does not queue unsupported or malformed protocols", () => {
    const queue = new ExternalLinkReviewQueue({ createRequestId: () => requestId });
    expect(queue.create("javascript:alert(1)")).toBeNull();
    expect(queue.create("file:///C:/private.txt")).toBeNull();
    expect(queue.create("not a URL")).toBeNull();
  });

  it("consumes confirmation and cancellation exactly once", () => {
    const confirmed = new ExternalLinkReviewQueue({ createRequestId: () => requestId });
    confirmed.create("https://example.com/path");
    expect(confirmed.takeForConfirmation(requestId)).toBe("https://example.com/path");
    expect(() => confirmed.takeForConfirmation(requestId)).toThrow(/missing or already used/u);

    const cancelled = new ExternalLinkReviewQueue({ createRequestId: () => requestId });
    cancelled.create("http://example.com");
    expect(cancelled.cancel(requestId)).toBe(true);
    expect(cancelled.cancel(requestId)).toBe(false);
  });

  it("expires and consumes stale confirmations", () => {
    let now = 5_000;
    const queue = new ExternalLinkReviewQueue({ now: () => now, createRequestId: () => requestId, ttlMs: 25 });
    queue.create("https://example.com");
    now += 25;
    expect(() => queue.takeForConfirmation(requestId)).toThrow(/expired/u);
    expect(() => queue.takeForConfirmation(requestId)).toThrow(/missing or already used/u);
  });

  it("reassesses the stored URL before opening", () => {
    let calls = 0;
    const queue = new ExternalLinkReviewQueue({
      createRequestId: () => requestId,
      assess: raw => ++calls === 1
        ? assessExternalLink(raw)
        : { normalizedUrl: "file:///C:/private.txt", hostname: "", risk: "ordinary", reasons: [] },
    });
    queue.create("https://example.com");
    expect(() => queue.takeForConfirmation(requestId)).toThrow(/allowed protocol/u);
    expect(calls).toBe(2);
  });
});
