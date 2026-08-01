import { describe, expect, it } from "vitest";
import type { HistoryRecord, LocalRevision } from "../../src/shared/contracts";
import { deletionEvidenceDescription, diffLineDescription, filterHistoryRecords, filterLocalRevisions, localRevisionSearchText, retentionPreviewDescription } from "../../src/renderer/lib/local-history";
import { changelogDateRangeForPreset } from "../../src/renderer/lib/changelog";

const revisions: LocalRevision[] = [
  { hash: "a".repeat(40), createdAt: "2026-08-01T10:00:00.000Z", subject: "Snapshot application state", label: "Before account cleanup", isLabeled: true },
  { hash: "b".repeat(40), createdAt: "2026-08-01T11:00:00.000Z", subject: "Snapshot application state", label: "After account cleanup", isLabeled: false },
];

describe("local revision view model", () => {
  it("composes history date ranges with action and regex predicates", () => {
    const records: HistoryRecord[] = [
      { id: "one", kind: "created", entityType: "account", entityId: "account-1", label: "Created account", createdAt: "2026-07-25T12:00:00.000Z", snapshot: {} },
      { id: "two", kind: "settings-changed", entityType: "settings", entityId: "preferences", label: "Changed appearance", createdAt: "2026-07-29T12:00:00.000Z", snapshot: {} },
      { id: "three", kind: "settings-changed", entityType: "settings", entityId: "preferences", label: "Changed language", createdAt: "2026-08-01T12:00:00.000Z", snapshot: {} },
    ];
    const actions = new Set<HistoryRecord["kind"]>(["settings-changed"]);
    const matches = (value: string): boolean => /appearance|language/iu.test(value);

    expect(filterHistoryRecords(records, "appearance|language", matches, actions, "2026-07-28", "2026-07-31")).toEqual([records[1]]);
    expect(filterHistoryRecords(records, "appearance|language", matches, actions, "2026-08-02", null)).toEqual([]);
    expect(filterHistoryRecords(records, "", () => false, new Set(), null, null)).toEqual(records);
    expect(changelogDateRangeForPreset("last-7-days", "2026-08-01")).toEqual({ from: "2026-07-26", to: "2026-08-01" });
  });

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

  it("describes the dry-run retention result in factual English and Cantonese", () => {
    const summary = retentionPreviewDescription({
      retentionDays: 365,
      cutoffAt: "2025-08-01T12:00:00.000Z",
      headHash: "c".repeat(40),
      totalRevisionCount: 6,
      eligibleRevisions: [revisions[1]!],
      protectedCurrentCount: 1,
      protectedLabeledCount: 2,
      protectedRecentCount: 2,
      blockedNonAppOwnedCount: 0,
      canPrune: true,
    });
    expect(summary.en).toBe("1 eligible; 1 current, 2 labeled, and 2 recent revisions protected.");
    expect(summary.yue).toBe("1 個符合；1 個目前、2 個有標籤，同 2 個近期修訂受保護。");
  });

  it("states deletion evidence and the missing erasure guarantee bilingually", () => {
    const summary = deletionEvidenceDescription({
      generatedAt: "2026-08-01T12:00:00.000Z",
      policy: "active-history-pruning-only",
      gitVersion: "git version 2.51.0.windows.1",
      activeRevisionCount: 4,
      activeLabeledRevisionCount: 1,
      reflogOnlyRevisionCount: 3,
      mainReflogPresent: true,
      looseObjectCount: 12,
      looseObjectSizeKiB: 8,
      packedObjectCount: 0,
      packCount: 0,
      packSizeKiB: 0,
      prunePackableObjectCount: 0,
      garbageObjectCount: 0,
      garbageSizeKiB: 0,
      cryptographicErasureProvided: false,
      reflogExpiryPerformed: false,
      gitGarbageCollectionPerformed: false,
      backupCopiesAudited: false,
      storageMediaAudited: false,
    });
    expect(summary.en).toBe("4 active revisions; 1 labeled; 3 reflog-only. Cryptographic erasure is not provided.");
    expect(summary.yue).toBe("4 個現役修訂；1 個有標籤；3 個只喺 reflog。冇提供密碼學抹除。");
  });
});
