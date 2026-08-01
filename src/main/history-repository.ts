import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { LocalRevision } from "../shared/contracts.js";

const execFileAsync = promisify(execFile);

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
      await writeFile(path.join(stateDirectory, "material-email-state-v1.json"), source, { encoding: "utf8", mode: 0o600 });
      await this.#git(["add", "--", "state/material-email-state-v1.json"]);
      const status = await this.#git(["status", "--porcelain", "--", "state/material-email-state-v1.json"]);
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
    return output
      .split("\u001e")
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => {
        const [hash = "", createdAt = "", subject = ""] = line.split("\u001f");
        return { hash, createdAt, subject };
      });
  }

  async read(hash: string): Promise<string> {
    await this.#queue;
    await this.#ensureRepository();
    if (!/^[a-f0-9]{7,40}$/i.test(hash)) throw new Error("The local revision identifier is invalid.");
    const commit = (await this.#git(["rev-parse", "--verify", `${hash}^{commit}`])).trim();
    await this.#git(["merge-base", "--is-ancestor", commit, "HEAD"]);
    return this.#git(["show", `${commit}:state/material-email-state-v1.json`], 64 * 1024 * 1024);
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
}
