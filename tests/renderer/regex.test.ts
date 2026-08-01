import { describe, expect, it } from "vitest";
import { createMatcher, evaluateSample, normalizeFlags, validatePattern } from "../../src/renderer/lib/regex";

describe("renderer regex safety and matching", () => {
  it("keeps plain-text search literal and case-insensitive when requested", () => {
    const matches = createMatcher({ mode: "plain", pattern: "a+b", flags: "i" });
    expect(matches("Mail A+B arrived")).toBe(true);
    expect(matches("Mail aaab arrived")).toBe(false);
  });

  it("returns capture groups and advances zero-width matches", () => {
    expect(evaluateSample({ mode: "regex", pattern: "(mail)", flags: "i" }, "Mail mail")).toHaveLength(2);
    expect(evaluateSample({ mode: "regex", pattern: "(?=a)", flags: "" }, "aa")).toHaveLength(2);
  });

  it("rejects invalid and risky nested patterns", () => {
    expect(validatePattern({ mode: "regex", pattern: "(", flags: "" }).valid).toBe(false);
    expect(validatePattern({ mode: "regex", pattern: "(a+)+$", flags: "" }).valid).toBe(false);
  });

  it("normalizes flags to the supported JavaScript subset", () => {
    expect(normalizeFlags("miigx")).toBe("im");
  });
});
