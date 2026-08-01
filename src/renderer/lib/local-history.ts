import type { HistoryRecord, LocalHistoryDeletionEvidence, LocalHistoryPrunePreview, LocalRevision, LocalRevisionDiffLine } from "../../shared/contracts";

export const historyRecordSearchText = (record: HistoryRecord): string =>
  `${record.label}\n${record.kind}\n${record.entityType}\n${record.entityId}`;

export const filterHistoryRecords = (
  records: readonly HistoryRecord[],
  query: string,
  matches: (value: string) => boolean,
  actions: ReadonlySet<HistoryRecord["kind"]>,
  from: string | null,
  to: string | null,
): HistoryRecord[] => records.filter(record => {
  if (actions.size && !actions.has(record.kind)) return false;
  const timestamp = Date.parse(record.createdAt);
  if (from) {
    const start = Date.parse(`${from}T00:00:00`);
    if (Number.isFinite(start) && timestamp < start) return false;
  }
  if (to) {
    const end = Date.parse(`${to}T23:59:59.999`);
    if (Number.isFinite(end) && timestamp > end) return false;
  }
  return !query || matches(historyRecordSearchText(record));
});

export const localRevisionSearchText = (revision: LocalRevision): string =>
  `${revision.label}\n${revision.subject}\n${revision.hash}\n${revision.createdAt}`;

export const filterLocalRevisions = (
  revisions: readonly LocalRevision[],
  pattern: string,
  matches: (value: string) => boolean,
): LocalRevision[] => pattern ? revisions.filter(revision => matches(localRevisionSearchText(revision))) : [...revisions];

export const diffLineDescription = (kind: LocalRevisionDiffLine["kind"]): { en: string; yue: string } => {
  switch (kind) {
    case "added": return { en: "Added line", yue: "新增行" };
    case "removed": return { en: "Removed line", yue: "移除行" };
    case "hunk": return { en: "Changed range", yue: "更改範圍" };
    case "metadata": return { en: "Diff metadata", yue: "差異資料" };
    default: return { en: "Context line", yue: "上下文行" };
  }
};

export const retentionPreviewDescription = (preview: LocalHistoryPrunePreview): { en: string; yue: string } => ({
  en: `${preview.eligibleRevisions.length} eligible; ${preview.protectedCurrentCount} current, ${preview.protectedLabeledCount} labeled, and ${preview.protectedRecentCount} recent revisions protected.`,
  yue: `${preview.eligibleRevisions.length} 個符合；${preview.protectedCurrentCount} 個目前、${preview.protectedLabeledCount} 個有標籤，同 ${preview.protectedRecentCount} 個近期修訂受保護。`,
});

export const deletionEvidenceDescription = (evidence: LocalHistoryDeletionEvidence): { en: string; yue: string } => ({
  en: `${evidence.activeRevisionCount} active revisions; ${evidence.activeLabeledRevisionCount} labeled; ${evidence.reflogOnlyRevisionCount} reflog-only. Cryptographic erasure is not provided.`,
  yue: `${evidence.activeRevisionCount} 個現役修訂；${evidence.activeLabeledRevisionCount} 個有標籤；${evidence.reflogOnlyRevisionCount} 個只喺 reflog。冇提供密碼學抹除。`,
});
