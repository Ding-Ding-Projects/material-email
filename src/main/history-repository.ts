import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { LocalRevision, LocalRevisionDiff, LocalRevisionDiffLine } from "../shared/contracts.js";

const execFileAsync = promisify(execFile);
const snapshotPath = "state/material-email-state-v1.json";
const labelNotesRef = "material-email-labels";
const previewByteLimit = 2 * 1024 * 1024;
const previewLineLimit = 400;

const normalizeLabel = (label: string): string => {
  const normalized = label.trim();
  if (!normalized || normalized.length > 120 || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new Error("A revision label must contain 1 to 120 characters without control characters.");
  }
  return normalized;
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
  }
  return { kind, text };
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
        "Snapshot application state",
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
    const output = await this.#git(["log", `-${Math.max(1, Math.min(2000, limit))}`, "--format=%H%x1f%cI%x1f%s%x1e"]);
    const revisions = output
      .split("\u001e")
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => {
        const [hash = "", createdAt = "", subject = ""] = line.split("\u001f");
        return { hash, createdAt, subject };
      });
    const labeled: LocalRevision[] = [];
    for (const revision of revisions) {
      labeled.push({ ...revision, label: await this.#labelFor(revision.hash, revision.subject) });
    }
    return labeled;
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

  async read(hash: string): Promise<string> {
    await this.#queue;
    await this.#ensureRepository();
    const commit = await this.#resolveCommit(hash);
    return this.#git(["show", `${commit}:${snapshotPath}`], 64 * 1024 * 1024);
  }

  async #resolveCommit(hash: string): Promise<string> {
    if (!/^[a-f0-9]{7,40}$/iu.test(hash)) throw new Error("The local revision identifier is invalid.");
    const commit = (await this.#git(["rev-parse", "--verify", `${hash}^{commit}`])).trim();
    await this.#git(["merge-base", "--is-ancestor", commit, "HEAD"]);
    return commit;
  }

  async #revisionFor(commit: string): Promise<LocalRevision> {
    const [hash = commit, createdAt = "", subject = ""] = (await this.#git(["show", "-s", "--format=%H%x1f%cI%x1f%s", commit])).trim().split("\u001f");
    return { hash, createdAt, subject, label: await this.#labelFor(hash, subject) };
  }

  async #labelFor(commit: string, fallback: string): Promise<string> {
    try {
      const label = (await this.#git(["notes", `--ref=${labelNotesRef}`, "show", commit])).trim();
      return label || fallback;
    } catch {
      return fallback;
    }
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
        await this.#git(["config", "user.email", "local-history@material-email.invalid"]);
        await this.#git(["config", "commit.gpgSign", "false"]);
      }
    })();
    return this.#ready;
  }

  async #git(args: string[], maxBuffer = 4 * 1024 * 1024): Promise<string> {
    const { stdout } = await execFileAsync("git", ["-C", this.#repositoryPath, ...args], {
      windowsHide: true,
      maxBuffer,
      encoding: "utf8",
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
