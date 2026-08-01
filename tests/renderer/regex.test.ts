import { describe, expect, it } from "vitest";
import { createMatcher, evaluateSample, normalizeFlags, regexLimits, validatePattern } from "../../src/renderer/lib/regex";

describe("renderer regex safety and matching", () => {
  it("keeps plain-text search literal and case-insensitive when requested", () => {
    const matches = createMatcher({ mode: "plain", pattern: "a+b", flags: "i" });
    expect(matches("Mail A+B arrived")).toBe(true);
    expect(matches("Mail aaab arrived")).toBe(false);
  });

  it("returns capture groups and advances zero-width Unicode matches by code point", () => {
    expect(evaluateSample({ mode: "regex", pattern: "(mail)", flags: "i" }, "Mail mail")).toHaveLength(2);
    expect(evaluateSample({ mode: "regex", pattern: "(?=a)", flags: "" }, "aa")).toHaveLength(2);
    expect(evaluateSample({ mode: "regex", pattern: "(?=.)", flags: "u" }, "😀😀").map(match => match.index)).toEqual([0, 2]);
  });

  it("rejects invalid, nested, adjacent, and overlapping repetition before evaluation", () => {
    expect(validatePattern({ mode: "regex", pattern: "(", flags: "" }).valid).toBe(false);
    for (const pattern of ["(a+)+$", "(a|aa)+$", "a+a+$", ".*.*Z"]) {
      expect(validatePattern({ mode: "regex", pattern, flags: "" }), pattern).toMatchObject({ valid: false });
    }
    expect(validatePattern({ mode: "regex", pattern: "^(Open (Settings|History)|開啟設定)", flags: "iu" }).valid).toBe(true);
  });

  it("keeps Unicode and multiline semantics while enforcing sample and match ceilings", () => {
    const multiline = evaluateSample({ mode: "regex", pattern: "^(郵件😀)$", flags: "mu" }, "header\n郵件😀\nfooter");
    expect(multiline).toEqual([{ value: "郵件😀", index: 7, groups: ["郵件😀"] }]);
    expect(evaluateSample({ mode: "regex", pattern: "(?=a)", flags: "" }, "a".repeat(regexLimits.matches + 20))).toHaveLength(regexLimits.matches);
    expect(createMatcher({ mode: "regex", pattern: "needle$", flags: "" })(`${"x".repeat(regexLimits.sample)}needle`)).toBe(false);
  });

  it("normalizes flags to the supported JavaScript subset", () => {
    expect(normalizeFlags("miigx")).toBe("im");
  });
});
