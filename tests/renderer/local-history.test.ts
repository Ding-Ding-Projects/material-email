import { describe, expect, it } from "vitest";
import type { LocalRevision } from "../../src/shared/contracts";
import { diffLineDescription, filterLocalRevisions, localRevisionSearchText } from "../../src/renderer/lib/local-history";

const revisions: LocalRevision[] = [
  { hash: "a".repeat(40), createdAt: "2026-08-01T10:00:00.000Z", subject: "Snapshot application state", label: "Before account cleanup" },
  { hash: "b".repeat(40), createdAt: "2026-08-01T11:00:00.000Z", subject: "Snapshot application state", label: "After account cleanup" },
];

describe("local revision view model", () => {
  it("searches labels, hashes, subjects, and timestamps through the supplied matcher", () => {
    const matches = (value: string): boolean => /before|a{40}/iu.test(value);
    expect(filterLocalRevisions(revisions, "before|a{40}", matches)).toEqual([revisions[0]]);
    expect(localRevisionSearchText(revisions[0]!)).toContain("Snapshot application state");
    expect(filterLocalRevisions(revisions, "", () => false)).toEqual(revisions);
  });

  it("provides bilingual screen-reader descriptions for diff line kinds", () => {
    expect(diffLineDescription("added")).toEqual({ en: "Added line", yue: "新增行" });
    expect(diffLineDescription("removed")).toEqual({ en: "Removed line", yue: "移除行" });
    expect(diffLineDescription("context")).toEqual({ en: "Context line", yue: "上下文行" });
  });
});
