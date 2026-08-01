import type { LocalRevision, LocalRevisionDiffLine } from "../../shared/contracts";

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
