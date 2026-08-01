import { randomUUID } from "node:crypto";
import { access, mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";

interface StoredEnvelope<T extends object> {
  formatVersion: 1;
  generation: number;
  payload: T;
}

interface Candidate<T extends object> {
  path: string;
  priority: number;
  exists: boolean;
  envelope?: StoredEnvelope<T>;
  error?: unknown;
}

interface LockOwner {
  formatVersion: 1;
  token: string;
  pid: number;
  createdAt: number;
}

interface LockSnapshot {
  device: number;
  inode: number;
  birthtimeMs: number;
  modifiedAtMs: number;
  isDirectory: boolean;
  owner?: LockOwner;
}

const lockOwnerFileName = "owner.json";
const lockRecoveryGuardFileName = "recovery.guard";
const lockStaleAfterMs = 1_000;
const lockAcquireTimeoutMs = 5_000;
const lockReleaseTimeoutMs = 2_000;
const lockRetryMinimumMs = 10;
const lockRetryMaximumMs = 50;
const lockTokenPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export interface AtomicStorePaths {
  current: string;
  next: string;
  backup: string;
}

export interface MutationDecision<Result> {
  changed: boolean;
  result: Result;
}

export class PimPersistenceError extends Error {
  override readonly name = "PimPersistenceError";

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
  }
}

export class AtomicJsonStore<T extends object> {
  readonly #schema: z.ZodType<T>;
  readonly #defaults: () => T;
  readonly #paths: AtomicStorePaths;
  readonly #lockPath: string;
  #data: T | null = null;
  #generation = 0;
  #queue: Promise<void> = Promise.resolve();

  constructor(filePath: string, schema: z.ZodType<T>, defaults: () => T) {
    const current = path.resolve(filePath);
    this.#paths = { current, next: `${current}.next`, backup: `${current}.backup` };
    this.#lockPath = `${current}.lock`;
    this.#schema = schema;
    this.#defaults = defaults;
  }

  get paths(): AtomicStorePaths {
    return { ...this.#paths };
  }

  async read(): Promise<T> {
    await this.#queue;
    return this.#withExclusiveLock(async lockToken => structuredClone(await this.#loadLatest(lockToken)));
  }

  async generation(): Promise<number> {
    await this.#queue;
    return this.#withExclusiveLock(async lockToken => {
      await this.#loadLatest(lockToken);
      return this.#generation;
    });
  }

  async mutate<Result>(mutator: (draft: T) => MutationDecision<Result> | Promise<MutationDecision<Result>>): Promise<Result> {
    let result!: Result;
    const operation = this.#queue.then(() =>
      this.#withExclusiveLock(async lockToken => {
        const current = await this.#loadLatest(lockToken);
        const base: StoredEnvelope<T> = {
          formatVersion: 1,
          generation: this.#generation,
          payload: structuredClone(current),
        };
        const draft = structuredClone(current);
        const decision = await mutator(draft);
        result = decision.result;
        if (!decision.changed) return;

        const validated = this.#schema.parse(draft);
        await this.#assertDiskMatches(base);
        const generation = base.generation + 1;
        await this.#commit({ formatVersion: 1, generation, payload: validated }, lockToken);
        this.#data = validated;
        this.#generation = generation;
      }),
    );
    this.#queue = operation.catch(() => undefined);
    await operation;
    return structuredClone(result);
  }

  async #loadLatest(lockToken: string): Promise<T> {
    await this.#assertLockOwnership(lockToken);
    await mkdir(path.dirname(this.#paths.current), { recursive: true });

    const candidates = await this.#readCandidates();
    const selected = this.#selectCandidate(candidates);
    if (!selected) {
      const invalid = candidates.filter(candidate => candidate.exists);
      if (invalid.length) {
        const names = invalid.map(candidate => path.basename(candidate.path)).join(", ");
        throw new PimPersistenceError(`The local PIM state is invalid in ${names}; no valid crash-recovery copy is available.`, {
          cause: invalid[0]?.error,
        });
      }
      if (this.#data !== null) {
        throw new PimPersistenceError(
          "The local PIM state disappeared after it had been loaded; refusing to replace it with defaults.",
        );
      }
      const defaults = this.#schema.parse(this.#defaults());
      await this.#commit({ formatVersion: 1, generation: 0, payload: defaults }, lockToken);
      this.#data = defaults;
      this.#generation = 0;
      return defaults;
    }

    this.#assertCompatibleWithCache(selected.envelope);
    if (selected.path !== this.#paths.current) {
      await this.#commit(selected.envelope, lockToken);
    } else {
      await Promise.all([rm(this.#paths.next, { force: true }), rm(this.#paths.backup, { force: true })]);
    }
    this.#data = selected.envelope.payload;
    this.#generation = selected.envelope.generation;
    return this.#data;
  }

  async #readCandidates(): Promise<Candidate<T>[]> {
    return Promise.all([
      this.#readCandidate(this.#paths.current, 3),
      this.#readCandidate(this.#paths.next, 2),
      this.#readCandidate(this.#paths.backup, 1),
    ]);
  }

  #selectCandidate(candidates: Candidate<T>[]): (Candidate<T> & { envelope: StoredEnvelope<T> }) | undefined {
    return candidates
      .filter((candidate): candidate is Candidate<T> & { envelope: StoredEnvelope<T> } => candidate.envelope !== undefined)
      .sort((left, right) => right.envelope.generation - left.envelope.generation || right.priority - left.priority)[0];
  }

  #assertCompatibleWithCache(observed: StoredEnvelope<T>): void {
    if (this.#data === null) return;
    if (observed.generation < this.#generation) {
      throw new PimPersistenceError(
        `The local PIM state generation moved backwards from ${this.#generation} to ${observed.generation}; refusing to overwrite newer cached state.`,
      );
    }
    if (observed.generation === this.#generation && !this.#sameEnvelopePayload(observed.payload, this.#data)) {
      throw new PimPersistenceError(
        `The local PIM state contains conflicting payloads for generation ${observed.generation}; refusing to choose one silently.`,
      );
    }
  }

  async #assertDiskMatches(expected: StoredEnvelope<T>): Promise<void> {
    const candidates = await this.#readCandidates();
    const selected = this.#selectCandidate(candidates);
    if (
      !selected ||
      selected.envelope.generation !== expected.generation ||
      !this.#sameEnvelopePayload(selected.envelope.payload, expected.payload)
    ) {
      throw new PimPersistenceError(
        "The local PIM state changed while a mutation was in progress; the mutation was not committed.",
      );
    }
  }

  #sameEnvelopePayload(left: T, right: T): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
  }

  async #readCandidate(candidatePath: string, priority: number): Promise<Candidate<T>> {
    try {
      const source = await readFile(candidatePath, "utf8");
      const envelopeSchema = z
        .object({
          formatVersion: z.literal(1),
          generation: z.number().int().nonnegative(),
          payload: this.#schema,
        })
        .strict();
      return { path: candidatePath, priority, exists: true, envelope: envelopeSchema.parse(JSON.parse(source)) };
    } catch (error) {
      const code = error instanceof Error && "code" in error ? (error as NodeJS.ErrnoException).code : undefined;
      if (code === "ENOENT") return { path: candidatePath, priority, exists: false };
      return { path: candidatePath, priority, exists: true, error };
    }
  }

  async #commit(envelope: StoredEnvelope<T>, lockToken: string): Promise<void> {
    await this.#assertLockOwnership(lockToken);
    const directory = path.dirname(this.#paths.current);
    await mkdir(directory, { recursive: true });
    const serialized = `${JSON.stringify(envelope, null, 2)}\n`;
    const handle = await open(this.#paths.next, "w", 0o600);
    try {
      await handle.writeFile(serialized, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await this.#syncDirectory(directory);
    await this.#assertLockOwnership(lockToken);

    await rm(this.#paths.backup, { force: true });
    const hadCurrent = await this.#exists(this.#paths.current);
    if (hadCurrent) await rename(this.#paths.current, this.#paths.backup);
    try {
      await rename(this.#paths.next, this.#paths.current);
      await this.#syncDirectory(directory);
    } catch (error) {
      if (!(await this.#exists(this.#paths.current)) && (await this.#exists(this.#paths.backup))) {
        await rename(this.#paths.backup, this.#paths.current).catch(() => undefined);
      }
      throw new PimPersistenceError("The local PIM state could not be committed atomically.", { cause: error });
    }
    try {
      await rm(this.#paths.backup, { force: true });
      await this.#syncDirectory(directory);
    } catch {
      // The validated primary is already durable. A stale lower-generation backup is harmless
      // and will be removed on the next successful load or commit.
    }
  }

  async #withExclusiveLock<Result>(operation: (lockToken: string) => Promise<Result>): Promise<Result> {
    const lockToken = await this.#acquireLock();
    let result!: Result;
    let operationError: unknown;
    let operationFailed = false;
    try {
      result = await operation(lockToken);
    } catch (error) {
      operationError = error;
      operationFailed = true;
    }

    let releaseError: unknown;
    try {
      await this.#releaseLock(lockToken);
    } catch (error) {
      releaseError = error;
    }

    if (operationFailed) throw operationError;
    if (releaseError !== undefined) throw releaseError;
    return result;
  }

  async #acquireLock(): Promise<string> {
    const directory = path.dirname(this.#lockPath);
    await mkdir(directory, { recursive: true });
    const token = randomUUID();
    const pendingPath = `${this.#lockPath}.pending-${process.pid}-${token}`;
    await mkdir(pendingPath, { mode: 0o700 });
    let published = false;
    try {
      const owner: LockOwner = { formatVersion: 1, token, pid: process.pid, createdAt: Date.now() };
      const ownerHandle = await open(path.join(pendingPath, lockOwnerFileName), "wx", 0o600);
      try {
        await ownerHandle.writeFile(`${JSON.stringify(owner)}\n`, "utf8");
        await ownerHandle.sync();
      } finally {
        await ownerHandle.close();
      }
      await this.#syncDirectory(pendingPath);

      const startedAt = Date.now();
      let attempt = 0;
      while (!published) {
        try {
          await rename(pendingPath, this.#lockPath);
          published = true;
          await this.#syncDirectory(directory);
          return token;
        } catch (error) {
          const lockExists = await this.#exists(this.#lockPath);
          if (!this.#isLockContentionError(error)) {
            throw new PimPersistenceError("The local PIM state lock could not be acquired.", { cause: error });
          }
          if (lockExists) await this.#recoverStaleLock();
        }

        if (Date.now() - startedAt >= lockAcquireTimeoutMs) {
          throw new PimPersistenceError(
            `The local PIM state remained locked for ${lockAcquireTimeoutMs}ms; no changes were committed.`,
          );
        }
        const retryMs = Math.min(lockRetryMinimumMs * 2 ** Math.min(attempt, 3), lockRetryMaximumMs);
        attempt += 1;
        await delay(retryMs);
      }
      throw new PimPersistenceError("The local PIM state lock could not be acquired.");
    } finally {
      if (!published) await rm(pendingPath, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  async #releaseLock(lockToken: string): Promise<void> {
    await this.#assertLockOwnership(lockToken);
    const releasedPath = `${this.#lockPath}.released-${lockToken}`;
    const startedAt = Date.now();
    let attempt = 0;
    while (true) {
      try {
        await rename(this.#lockPath, releasedPath);
        break;
      } catch (error) {
        if ((await this.#exists(releasedPath)) && !(await this.#exists(this.#lockPath))) break;
        const code = this.#errorCode(error);
        const transient = new Set(["EACCES", "EBUSY", "EPERM"]).has(code ?? "");
        if (!transient || Date.now() - startedAt >= lockReleaseTimeoutMs) {
          throw new PimPersistenceError(
            `The local PIM state lock could not be released safely${code ? ` (${code})` : ""}.`,
            { cause: error },
          );
        }
        await this.#assertLockOwnership(lockToken);
        const retryMs = Math.min(lockRetryMinimumMs * 2 ** Math.min(attempt, 3), lockRetryMaximumMs);
        attempt += 1;
        await delay(retryMs);
      }
    }
    await this.#syncDirectory(path.dirname(this.#lockPath));
    await rm(releasedPath, { recursive: true, force: true }).catch(() => undefined);
  }

  async #assertLockOwnership(lockToken: string): Promise<void> {
    const snapshot = await this.#readLockSnapshot();
    if (snapshot?.owner?.token !== lockToken || snapshot.owner.pid !== process.pid) {
      throw new PimPersistenceError("Exclusive ownership of the local PIM state lock was lost; no write was attempted.");
    }
  }

  async #recoverStaleLock(): Promise<boolean> {
    const observed = await this.#readLockSnapshot();
    if (!observed || !this.#isRecoverableStaleLock(observed)) return false;
    if (!observed.isDirectory) return false;

    const guardPath = path.join(this.#lockPath, lockRecoveryGuardFileName);
    try {
      const guardHandle = await open(guardPath, "wx", 0o600);
      try {
        await guardHandle.writeFile(`${this.#lockFingerprint(observed)}\n`, "utf8");
        await guardHandle.sync();
      } finally {
        await guardHandle.close();
      }
    } catch (error) {
      const code = this.#errorCode(error);
      if (code === "ENOENT") return true;
      if (code !== "EEXIST") return false;
    }

    const confirmed = await this.#readLockSnapshot();
    if (!confirmed || !this.#sameLockIdentity(observed, confirmed)) return !confirmed;
    const freshness = confirmed.owner ? confirmed.modifiedAtMs : observed.modifiedAtMs;
    if (!this.#isRecoverableStaleLock(confirmed, freshness)) return false;

    const stalePath = `${this.#lockPath}.stale-${this.#lockFingerprint(observed)}`;
    try {
      await rename(this.#lockPath, stalePath);
      await this.#syncDirectory(path.dirname(this.#lockPath));
      // Keep the non-empty tombstone as a fence. A delayed contender that observed
      // this owner cannot rename a newer lock over the same recovery destination.
      return true;
    } catch (error) {
      const code = this.#errorCode(error);
      if (code === "ENOENT") return true;
      if (new Set(["EACCES", "EBUSY", "EEXIST", "ENOTEMPTY", "EPERM"]).has(code ?? "")) return false;
      throw new PimPersistenceError("A stale local PIM state lock could not be quarantined safely.", { cause: error });
    }
  }

  async #readLockSnapshot(): Promise<LockSnapshot | null> {
    let lockStats;
    try {
      lockStats = await stat(this.#lockPath);
    } catch (error) {
      if (this.#errorCode(error) === "ENOENT") return null;
      throw new PimPersistenceError("The local PIM state lock could not be inspected.", { cause: error });
    }

    let owner: LockOwner | undefined;
    let ownerModifiedAtMs: number | undefined;
    try {
      const ownerPath = path.join(this.#lockPath, lockOwnerFileName);
      const [source, ownerStats] = await Promise.all([readFile(ownerPath, "utf8"), stat(ownerPath)]);
      ownerModifiedAtMs = ownerStats.mtimeMs;
      const parsed: unknown = JSON.parse(source);
      if (this.#isLockOwner(parsed)) owner = parsed;
    } catch {
      // Missing, partial, or malformed metadata becomes reclaimable only after
      // the stale grace period. Fresh unknown locks are never stolen.
    }

    return {
      device: lockStats.dev,
      inode: lockStats.ino,
      birthtimeMs: lockStats.birthtimeMs,
      modifiedAtMs: ownerModifiedAtMs ?? lockStats.mtimeMs,
      isDirectory: lockStats.isDirectory(),
      ...(owner ? { owner } : {}),
    };
  }

  #isLockOwner(value: unknown): value is LockOwner {
    if (typeof value !== "object" || value === null) return false;
    const candidate = value as Partial<LockOwner>;
    return (
      candidate.formatVersion === 1 &&
      typeof candidate.token === "string" &&
      lockTokenPattern.test(candidate.token) &&
      typeof candidate.pid === "number" &&
      Number.isSafeInteger(candidate.pid) &&
      candidate.pid > 0 &&
      typeof candidate.createdAt === "number" &&
      Number.isFinite(candidate.createdAt) &&
      candidate.createdAt >= 0
    );
  }

  #isRecoverableStaleLock(snapshot: LockSnapshot, modifiedAtMs = snapshot.modifiedAtMs): boolean {
    if (Date.now() - modifiedAtMs < lockStaleAfterMs) return false;
    return snapshot.owner ? !this.#isProcessAlive(snapshot.owner.pid) : true;
  }

  #isProcessAlive(pid: number): boolean {
    if (pid === process.pid) return true;
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      const code = this.#errorCode(error);
      if (code === "ESRCH" || code === "EINVAL") return false;
      return true;
    }
  }

  #sameLockIdentity(left: LockSnapshot, right: LockSnapshot): boolean {
    return (
      left.device === right.device &&
      left.inode === right.inode &&
      left.birthtimeMs === right.birthtimeMs &&
      left.owner?.token === right.owner?.token
    );
  }

  #lockFingerprint(snapshot: LockSnapshot): string {
    if (snapshot.owner) return snapshot.owner.token;
    return [snapshot.device, snapshot.inode, Math.trunc(snapshot.birthtimeMs)]
      .map(value => value.toString(36).replace(/[^a-z0-9-]/giu, "-"))
      .join("-");
  }

  #isLockContentionError(error: unknown): boolean {
    return new Set(["EACCES", "EBUSY", "EEXIST", "ENOTEMPTY", "EPERM"]).has(this.#errorCode(error) ?? "");
  }

  #errorCode(error: unknown): string | undefined {
    return error instanceof Error && "code" in error ? (error as NodeJS.ErrnoException).code : undefined;
  }

  async #exists(filePath: string): Promise<boolean> {
    try {
      await access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async #syncDirectory(directory: string): Promise<void> {
    try {
      const handle = await open(directory, "r");
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
    } catch (error) {
      const code = error instanceof Error && "code" in error ? (error as NodeJS.ErrnoException).code : undefined;
      if (!new Set(["EACCES", "EBADF", "EINVAL", "EISDIR", "ENOTSUP", "EPERM"]).has(code ?? "")) throw error;
    }
  }
}
