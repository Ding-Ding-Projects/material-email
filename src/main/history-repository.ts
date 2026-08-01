import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  LOCAL_HISTORY_RETENTION_DAYS_MAX,
  LOCAL_HISTORY_RETENTION_DAYS_MIN,
  type LocalHistoryDeletionEvidence,
  type LocalHistoryPrunePreview,
  type LocalHistoryPruneRequest,
  type LocalHistoryPruneResult,
  type LocalRevision,
  type LocalRevisionDiff,
  type LocalRevisionDiffLine,
} from "../shared/contracts.js";
import { userVisibleErrorMessage } from "../shared/user-visible-error.js";

const execFileAsync = promisify(execFile);
const snapshotPath = "state/material-email-state-v1.json";
const labelNotesRef = "material-email-labels";
const snapshotSubject = "Snapshot application state";
const snapshotIdentityEmail = "local-history@material-email.invalid";
const previewByteLimit = 2 * 1024 * 1024;
const previewLineLimit = 400;
const maximumManagedRevisionCount = 2_000;
const millisecondsPerDay = 24 * 60 * 60 * 1_000;

interface RevisionEntry extends LocalRevision {
  appOwned: boolean;
  authorName: string;
  authorEmail: string;
  authorDate: string;
  committerName: string;
  committerEmail: string;
  committerDate: string;
  message: string;
}

const normalizeLabel = (label: string): string => {
  const normalized = label.trim();
  if (!normalized || normalized.length > 120 || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new Error("A revision label must contain 1 to 120 characters without control characters.");
  }
  return normalized;
};

const normalizeRetentionDays = (retentionDays: number): number => {
  if (!Number.isInteger(retentionDays) || retentionDays < LOCAL_HISTORY_RETENTION_DAYS_MIN || retentionDays > LOCAL_HISTORY_RETENTION_DAYS_MAX) {
    throw new Error(`Local history retention must be a whole number from ${LOCAL_HISTORY_RETENTION_DAYS_MIN} to ${LOCAL_HISTORY_RETENTION_DAYS_MAX} days.`);
  }
  return retentionDays;
};

const diffLine = (rawLine: string): LocalRevisionDiffLine => {
  let kind: LocalRevisionDiffLine["kind"] = "context";
  let text = rawLine;
  if (rawLine.startsWith("diff --git ") || rawLine.startsWith("index ") || rawLine.startsWith("--- ") || rawLine.startsWith("+++ ")) {
    kind = "metadata";
  } else if (rawLine.startsWith("@@")) {
    kind = "hunk";
  } else if (rawLine.startsWith("+")) {
    kind = "added";
    text = rawLine.slice(1);
  } else if (rawLine.startsWith("-")) {
    kind = "removed";
    text = rawLine.slice(1);
  } else if (rawLine.startsWith(" ")) {
    text = rawLine.slice(1);
  }
  if (/"encryptedSecret"\s*:/u.test(text)) {
    text = text.replace(/(:\s*)".*"(,?\s*)$/u, '$1"[encrypted value omitted]"$2');
  } else if (/"(?:lastError|syncError)"\s*:/u.test(text)) {
    text = text.replace(/(:\s*)("(?:\\.|[^"\\])*")(,?\s*)$/u, (_match, prefix: string, encoded: string, suffix: string) => {
      const raw = JSON.parse(encoded) as string;
      return `${prefix}${JSON.stringify(userVisibleErrorMessage(raw, { context: "mail" }))}${suffix}`;
    });
  }
  return { kind, text };
};

const publicRevision = (entry: RevisionEntry): LocalRevision => ({
  hash: entry.hash,
  createdAt: entry.createdAt,
  subject: entry.subject,
  label: entry.label,
  isLabeled: entry.isLabeled,
});

const gitStorageCount = (values: ReadonlyMap<string, string>, key: string): number => {
  const value = Number(values.get(key));
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Git object evidence did not contain a valid ${key} count.`);
  return value;
};

export class HistoryRepository {
  readonly #repositoryPath: string;
  readonly #validateSnapshot: ((value: unknown) => unknown) | undefined;
  #ready: Promise<void> | null = null;
  #queue: Promise<void> = Promise.resolve();

  constructor(repositoryPath: string, validateSnapshot?: (value: unknown) => unknown) {
    this.#repositoryPath = repositoryPath;
    this.#validateSnapshot = validateSnapshot;
  }

  async snapshot(sourceFile: string): Promise<void> {
    const operation = this.#queue.then(async () => {
      await this.#ensureRepository();
      const source = await readFile(sourceFile, "utf8");
      this.#validateSnapshot?.(JSON.parse(source) as unknown);
      let previousHead = "";
      try {
        previousHead = (await this.#git(["rev-parse", "HEAD"])).trim();
      } catch {
        // The first snapshot has no parent yet.
      }
      const stateDirectory = path.join(this.#repositoryPath, "state");
      await mkdir(stateDirectory, { recursive: true });
      await writeFile(path.join(stateDirectory, path.basename(snapshotPath)), source, { encoding: "utf8", mode: 0o600 });
      await this.#git(["add", "--", snapshotPath]);
      const status = await this.#git(["status", "--porcelain", "--", snapshotPath]);
      if (!status.trim()) return;
      await this.#git([
        "commit",
        "-m",
        snapshotSubject,
        "-m",
        "Recorded the complete encrypted local state; even time travel should leave footprints.\n已記錄完整加密本機狀態；時光旅行都要留低腳印。",
      ]);
      if (previousHead) {
        const currentHead = (await this.#git(["rev-parse", "HEAD"])).trim();
        await this.#git(["merge-base", "--is-ancestor", previousHead, currentHead]);
      }
    });
    this.#queue = operation.catch(() => undefined);
    await operation;
  }

  async list(limit = 200): Promise<LocalRevision[]> {
    await this.#queue;
    await this.#ensureRepository();
    return (await this.#revisionEntries(limit)).map(publicRevision);
  }

  async diff(hash: string): Promise<LocalRevisionDiff> {
    await this.#queue;
    await this.#ensureRepository();
    const commit = await this.#resolveCommit(hash);
    const revision = await this.#revisionFor(commit);
    const ancestry = (await this.#git(["rev-list", "--parents", "-n", "1", commit])).trim().split(/\s+/u);
    const parentHash = ancestry[1];
    const args = parentHash
      ? ["diff", "--no-color", "--no-ext-diff", "--unified=2", parentHash, commit, "--", snapshotPath]
      : ["diff-tree", "--root", "--no-commit-id", "-p", "--no-color", "--no-ext-diff", "--unified=2", commit, "--", snapshotPath];
    const preview = await this.#gitPreview(args, previewByteLimit);
    const allLines = preview.output.replaceAll("\r\n", "\n").split("\n");
    const lines = allLines.slice(0, previewLineLimit).map(diffLine);
    return {
      revision,
      ...(parentHash ? { parentHash } : {}),
      lines,
      truncated: preview.truncated || allLines.length > previewLineLimit,
    };
  }

  async label(hash: string, label: string): Promise<LocalRevision> {
    const normalized = normalizeLabel(label);
    let revision!: LocalRevision;
    const operation = this.#queue.then(async () => {
      await this.#ensureRepository();
      const commit = await this.#resolveCommit(hash);
      await this.#git(["notes", `--ref=${labelNotesRef}`, "add", "-f", "-m", normalized, commit]);
      revision = await this.#revisionFor(commit);
    });
    this.#queue = operation.catch(() => undefined);
    await operation;
    return revision;
  }

  async previewPrune(retentionDays: number, now = new Date()): Promise<LocalHistoryPrunePreview> {
    await this.#queue;
    await this.#ensureRepository();
    const normalizedDays = normalizeRetentionDays(retentionDays);
    const cutoffAt = new Date(now.getTime() - normalizedDays * millisecondsPerDay);
    if (!Number.isFinite(cutoffAt.getTime())) throw new Error("The local history retention cutoff is invalid.");
    return this.#previewAtCutoff(normalizedDays, cutoffAt);
  }

  async prune(request: LocalHistoryPruneRequest, now = new Date()): Promise<LocalHistoryPruneResult> {
    let result!: LocalHistoryPruneResult;
    const operation = this.#queue.then(async () => {
      await this.#ensureRepository();
      const retentionDays = normalizeRetentionDays(request.retentionDays);
      const cutoffAt = new Date(request.cutoffAt);
      const newestAllowedCutoff = now.getTime() - retentionDays * millisecondsPerDay;
      if (!Number.isFinite(cutoffAt.getTime()) || cutoffAt.getTime() > newestAllowedCutoff + 1_000) {
        throw new Error("The local history preview cutoff is invalid or newer than the selected retention policy permits.");
      }
      const preview = await this.#previewAtCutoff(retentionDays, cutoffAt);
      if (!preview.headHash || preview.headHash !== request.expectedHeadHash) {
        throw new Error("Local history changed after the preview. Preview the retention policy again before pruning.");
      }
      const eligibleHashes = preview.eligibleRevisions.map(revision => revision.hash);
      if (eligibleHashes.length !== request.expectedEligibleHashes.length
        || eligibleHashes.some((hash, index) => hash !== request.expectedEligibleHashes[index])) {
        throw new Error("The eligible local revisions changed after the preview. Preview the retention policy again before pruning.");
      }
      if (preview.blockedNonAppOwnedCount) {
        throw new Error("Local history contains a commit that Material Email did not create, so automatic pruning was blocked.");
      }
      if (!eligibleHashes.length) throw new Error("The retention preview contains no eligible local revisions to prune.");
      const worktreeStatus = await this.#git(["status", "--porcelain"]);
      if (worktreeStatus.trim()) throw new Error("Local history has uncommitted repository changes, so automatic pruning was blocked.");

      const entries = (await this.#revisionEntries(maximumManagedRevisionCount)).reverse();
      const eligible = new Set(eligibleHashes);
      const retained = entries.filter(entry => !eligible.has(entry.hash));
      let rewrittenParent = "";
      for (const entry of retained) {
        const tree = (await this.#git(["rev-parse", `${entry.hash}^{tree}`])).trim();
        const args = ["commit-tree", tree];
        if (rewrittenParent) args.push("-p", rewrittenParent);
        args.push("-m", entry.message);
        rewrittenParent = (await this.#git(args, 4 * 1024 * 1024, {
          GIT_AUTHOR_NAME: entry.authorName,
          GIT_AUTHOR_EMAIL: entry.authorEmail,
          GIT_AUTHOR_DATE: entry.authorDate,
          GIT_COMMITTER_NAME: entry.committerName,
          GIT_COMMITTER_EMAIL: entry.committerEmail,
          GIT_COMMITTER_DATE: entry.committerDate,
        })).trim();
        if (entry.isLabeled) {
          await this.#git(["notes", `--ref=${labelNotesRef}`, "add", "-f", "-m", entry.label, rewrittenParent]);
        }
      }
      if (!rewrittenParent) throw new Error("Local history pruning refused to remove the current revision.");
      const previousHeadHash = preview.headHash;
      const previousTree = (await this.#git(["rev-parse", `${previousHeadHash}^{tree}`])).trim();
      const rewrittenTree = (await this.#git(["rev-parse", `${rewrittenParent}^{tree}`])).trim();
      if (previousTree !== rewrittenTree) {
        throw new Error("Local history pruning could not prove that the current application state was preserved.");
      }
      const currentHead = (await this.#git(["rev-parse", "HEAD"])).trim();
      if (currentHead !== previousHeadHash) {
        throw new Error("Local history changed while pruning was prepared. Nothing was pruned; preview again.");
      }
      const headReference = (await this.#git(["symbolic-ref", "-q", "HEAD"])).trim();
      if (headReference !== "refs/heads/main") throw new Error("Local history is not on its app-owned main branch, so automatic pruning was blocked.");
      await this.#git(["update-ref", "-m", "Prune application-owned local revisions", headReference, rewrittenParent, previousHeadHash]);
      result = {
        prunedRevisionCount: eligibleHashes.length,
        retainedRevisionCount: retained.length,
        previousHeadHash,
        currentHeadHash: rewrittenParent,
        cutoffAt: cutoffAt.toISOString(),
        semanticEventRecorded: false,
      };
    });
    this.#queue = operation.catch(() => undefined);
    await operation;
    return result;
  }

  async inspectDeletionEvidence(now = new Date()): Promise<LocalHistoryDeletionEvidence> {
    await this.#queue;
    await this.#ensureRepository();
    const activeHashes = new Set((await this.#git(["rev-list", "HEAD"], 16 * 1024 * 1024)).split(/\r?\n/u).map(hash => hash.trim()).filter(Boolean));
    const labeledCommits = await this.#labeledCommits();
    const activeLabeledRevisionCount = [...labeledCommits].filter(hash => activeHashes.has(hash)).length;
    let mainReflogPresent = true;
    try {
      await this.#git(["reflog", "exists", "refs/heads/main"]);
    } catch {
      mainReflogPresent = false;
    }
    const reflogOnlyRevisionCount = mainReflogPresent
      ? Number((await this.#git(["rev-list", "--count", "--reflog", "--not", "--all"])).trim())
      : 0;
    if (!Number.isSafeInteger(reflogOnlyRevisionCount) || reflogOnlyRevisionCount < 0) {
      throw new Error("Git reflog evidence did not contain a valid revision count.");
    }
    const storageOutput = await this.#git(["count-objects", "-v"]);
    const storage = new Map(storageOutput.split(/\r?\n/u).map(line => {
      const separator = line.indexOf(":");
      return separator > 0 ? [line.slice(0, separator).trim(), line.slice(separator + 1).trim()] as const : ["", ""] as const;
    }).filter(([key]) => Boolean(key)));
    return {
      generatedAt: now.toISOString(),
      policy: "active-history-pruning-only",
      gitVersion: (await this.#git(["--version"])).trim(),
      activeRevisionCount: activeHashes.size,
      activeLabeledRevisionCount,
      reflogOnlyRevisionCount,
      mainReflogPresent,
      looseObjectCount: gitStorageCount(storage, "count"),
      looseObjectSizeKiB: gitStorageCount(storage, "size"),
      packedObjectCount: gitStorageCount(storage, "in-pack"),
      packCount: gitStorageCount(storage, "packs"),
      packSizeKiB: gitStorageCount(storage, "size-pack"),
      prunePackableObjectCount: gitStorageCount(storage, "prune-packable"),
      garbageObjectCount: gitStorageCount(storage, "garbage"),
      garbageSizeKiB: gitStorageCount(storage, "size-garbage"),
      cryptographicErasureProvided: false,
      reflogExpiryPerformed: false,
      gitGarbageCollectionPerformed: false,
      backupCopiesAudited: false,
      storageMediaAudited: false,
    };
  }

  async read(hash: string): Promise<string> {
    await this.#queue;
    await this.#ensureRepository();
    const commit = await this.#resolveCommit(hash);
    return this.#git(["show", `${commit}:${snapshotPath}`], 64 * 1024 * 1024);
  }

  async #previewAtCutoff(retentionDays: number, cutoffAt: Date): Promise<LocalHistoryPrunePreview> {
    const entries = await this.#revisionEntries(maximumManagedRevisionCount, true);
    const headHash = entries[0]?.hash ?? null;
    const blockedNonAppOwnedCount = entries.filter(entry => !entry.appOwned).length;
    const eligibleRevisions = entries
      .filter(entry => entry.hash !== headHash && entry.appOwned && !entry.isLabeled && Date.parse(entry.createdAt) < cutoffAt.getTime())
      .map(publicRevision);
    const protectedLabeledCount = entries.filter(entry => entry.hash !== headHash && entry.appOwned && entry.isLabeled).length;
    const protectedRecentCount = entries.filter(entry => {
      if (entry.hash === headHash || !entry.appOwned || entry.isLabeled) return false;
      const createdAt = Date.parse(entry.createdAt);
      return !Number.isFinite(createdAt) || createdAt >= cutoffAt.getTime();
    }).length;
    return {
      retentionDays,
      cutoffAt: cutoffAt.toISOString(),
      headHash,
      totalRevisionCount: entries.length,
      eligibleRevisions,
      protectedCurrentCount: headHash ? 1 : 0,
      protectedLabeledCount,
      protectedRecentCount,
      blockedNonAppOwnedCount,
      canPrune: eligibleRevisions.length > 0 && blockedNonAppOwnedCount === 0,
    };
  }

  async #revisionEntries(limit: number, requireComplete = false): Promise<RevisionEntry[]> {
    let total = 0;
    try {
      total = Number((await this.#git(["rev-list", "--count", "HEAD"])).trim());
    } catch {
      return [];
    }
    if (requireComplete && total > maximumManagedRevisionCount) {
      throw new Error(`Local history has ${total} revisions, above the ${maximumManagedRevisionCount}-revision safety limit for automatic pruning.`);
    }
    const boundedLimit = Math.max(1, Math.min(maximumManagedRevisionCount, limit));
    const format = "%H%x1f%cI%x1f%s%x1f%an%x1f%ae%x1f%aI%x1f%cn%x1f%ce%x1f%cI%x1f%P%x1e";
    const output = await this.#git(["log", `-${boundedLimit}`, `--format=${format}`]);
    const labeledCommits = await this.#labeledCommits();
    const entries: RevisionEntry[] = [];
    for (const record of output.split("\u001e").map(value => value.trim()).filter(Boolean)) {
      const [hash = "", createdAt = "", subject = "", authorName = "", authorEmail = "", authorDate = "", committerName = "", committerEmail = "", committerDate = "", parents = ""] = record.split("\u001f");
      const isLabeled = labeledCommits.has(hash);
      const label = isLabeled ? await this.#labelFor(hash, subject) : subject;
      const parentCount = parents.trim() ? parents.trim().split(/\s+/u).length : 0;
      entries.push({
        hash,
        createdAt,
        subject,
        label,
        isLabeled,
        appOwned: subject === snapshotSubject
          && authorEmail === snapshotIdentityEmail
          && committerEmail === snapshotIdentityEmail
          && parentCount <= 1,
        authorName,
        authorEmail,
        authorDate,
        committerName,
        committerEmail,
        committerDate,
        message: await this.#git(["show", "-s", "--format=%B", hash]).then(value => value.trimEnd()),
      });
    }
    return entries;
  }

  async #resolveCommit(hash: string): Promise<string> {
    if (!/^[a-f0-9]{7,40}$/iu.test(hash)) throw new Error("The local revision identifier is invalid.");
    const commit = (await this.#git(["rev-parse", "--verify", `${hash}^{commit}`])).trim();
    await this.#git(["merge-base", "--is-ancestor", commit, "HEAD"]);
    return commit;
  }

  async #revisionFor(commit: string): Promise<LocalRevision> {
    const [hash = commit, createdAt = "", subject = ""] = (await this.#git(["show", "-s", "--format=%H%x1f%cI%x1f%s", commit])).trim().split("\u001f");
    const note = await this.#noteFor(hash);
    return { hash, createdAt, subject, label: note ?? subject, isLabeled: note !== null };
  }

  async #labeledCommits(): Promise<Set<string>> {
    try {
      const output = await this.#git(["notes", `--ref=${labelNotesRef}`, "list"]);
      return new Set(output.split(/\r?\n/u).map(line => line.trim().split(/\s+/u)[1]).filter((hash): hash is string => Boolean(hash)));
    } catch {
      return new Set();
    }
  }

  async #noteFor(commit: string): Promise<string | null> {
    try {
      const label = (await this.#git(["notes", `--ref=${labelNotesRef}`, "show", commit])).trim();
      return label || null;
    } catch {
      return null;
    }
  }

  async #labelFor(commit: string, fallback: string): Promise<string> {
    return (await this.#noteFor(commit)) ?? fallback;
  }

  async #ensureRepository(): Promise<void> {
    if (this.#ready) return this.#ready;
    this.#ready = (async () => {
      await mkdir(this.#repositoryPath, { recursive: true });
      try {
        await this.#git(["rev-parse", "--is-inside-work-tree"]);
      } catch {
        await this.#git(["init", "--initial-branch=main"]);
        await this.#git(["config", "user.name", "Material Email"]);
        await this.#git(["config", "user.email", snapshotIdentityEmail]);
        await this.#git(["config", "commit.gpgSign", "false"]);
      }
    })();
    return this.#ready;
  }

  async #git(args: string[], maxBuffer = 4 * 1024 * 1024, environment: NodeJS.ProcessEnv = {}): Promise<string> {
    const { stdout } = await execFileAsync("git", ["-C", this.#repositoryPath, ...args], {
      windowsHide: true,
      maxBuffer,
      encoding: "utf8",
      env: { ...process.env, ...environment },
    });
    return stdout;
  }

  async #gitPreview(args: string[], maxBuffer: number): Promise<{ output: string; truncated: boolean }> {
    try {
      return { output: await this.#git(args, maxBuffer), truncated: false };
    } catch (error) {
      const boundedError = error as { code?: unknown; stdout?: unknown };
      if (boundedError.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" && typeof boundedError.stdout === "string") {
        return { output: boundedError.stdout, truncated: true };
      }
      throw error;
    }
  }
}
