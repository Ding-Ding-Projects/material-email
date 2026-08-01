import { randomUUID } from "node:crypto";
import { copyFile, mkdir, open, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";

export interface JsonStoreOptions<T extends object> {
  validate?: (value: unknown) => T;
  maxBytes?: number;
}

export interface JsonStoreRecoveryNotice {
  recoveredFrom: string;
  quarantinedOriginal?: string;
}

export class JsonStoreCorruptionError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "JsonStoreCorruptionError";
  }
}

interface DecodedCandidate<T> {
  filePath: string;
  modifiedAt: number;
  value: T;
}

interface RecoverySearch<T> {
  candidate: DecodedCandidate<T> | null;
  foundFiles: boolean;
}

const errorCode = (error: unknown): string | undefined =>
  error instanceof Error && "code" in error ? (error as NodeJS.ErrnoException).code : undefined;

export class JsonStore<T extends object> {
  readonly #filePath: string;
  readonly #backupPath: string;
  readonly #defaults: () => T;
  readonly #validate: (value: unknown) => T;
  readonly #maxBytes: number;
  #data: T | null = null;
  #loading: Promise<T> | null = null;
  #recoveryNotice: JsonStoreRecoveryNotice | null = null;
  #queue: Promise<void> = Promise.resolve();
  readonly #afterWrite: ((filePath: string) => Promise<void>) | undefined;

  constructor(
    filePath: string,
    defaults: () => T,
    afterWrite?: (filePath: string) => Promise<void>,
    options: JsonStoreOptions<T> = {},
  ) {
    this.#filePath = filePath;
    this.#backupPath = `${filePath}.backup`;
    this.#defaults = defaults;
    this.#afterWrite = afterWrite;
    this.#validate = options.validate ?? (value => value as T);
    this.#maxBytes = options.maxBytes ?? 64 * 1024 * 1024;
  }

  async load(): Promise<T> {
    if (this.#data) return this.#data;
    if (!this.#loading) {
      this.#loading = this.#loadFromDisk().finally(() => {
        this.#loading = null;
      });
    }
    this.#data = await this.#loading;
    return this.#data;
  }

  async read(): Promise<T> {
    await this.#queue;
    return structuredClone(await this.load());
  }

  async update(mutator: (draft: T) => void | Promise<void>): Promise<T> {
    let result!: T;
    const operation = this.#queue.then(async () => {
      const current = await this.load();
      const draft = structuredClone(current);
      await mutator(draft);
      const committed = await this.#write(draft);
      this.#data = committed;
      result = structuredClone(committed);
    });
    this.#queue = operation.catch(() => undefined);
    await operation;
    return result;
  }

  async replace(value: T): Promise<T> {
    return this.update(draft => {
      for (const key of Object.keys(draft)) delete (draft as Record<string, unknown>)[key];
      Object.assign(draft, structuredClone(value));
    });
  }

  takeRecoveryNotice(): JsonStoreRecoveryNotice | null {
    const notice = this.#recoveryNotice;
    this.#recoveryNotice = null;
    return notice ? { ...notice } : null;
  }

  async #loadFromDisk(): Promise<T> {
    await mkdir(path.dirname(this.#filePath), { recursive: true });
    try {
      return (await this.#decode(this.#filePath)).value;
    } catch (error) {
      if (errorCode(error) === "ENOENT") {
        const recovery = await this.#findRecoveryCandidate();
        if (recovery.candidate) return this.#restoreCandidate(recovery.candidate);
        if (recovery.foundFiles) {
          throw new JsonStoreCorruptionError(
            "The primary state is missing and recovery files exist, but none are valid. Defaults were not written over the recovery evidence.",
          );
        }
        return this.#write(this.#defaults());
      }
      if (!(error instanceof JsonStoreCorruptionError)) throw error;
      const recovery = await this.#findRecoveryCandidate();
      if (!recovery.candidate) {
        throw new JsonStoreCorruptionError(
          "The state file is corrupt and no valid recovery copy exists. The original was left untouched in application data.",
          { cause: error },
        );
      }
      return this.#restoreCandidate(recovery.candidate, error);
    }
  }

  async #decode(candidatePath: string): Promise<DecodedCandidate<T>> {
    const information = await stat(candidatePath);
    if (!information.isFile()) throw new JsonStoreCorruptionError("A state or recovery path is not a regular file.");
    if (information.size > this.#maxBytes) {
      throw new JsonStoreCorruptionError(`A state or recovery file exceeds the ${this.#maxBytes}-byte safety limit.`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(candidatePath, "utf8")) as unknown;
    } catch (error) {
      if (error instanceof SyntaxError) throw new JsonStoreCorruptionError("A state or recovery file contains invalid JSON.", { cause: error });
      throw error;
    }
    try {
      return { filePath: candidatePath, modifiedAt: information.mtimeMs, value: this.#validate(parsed) };
    } catch (error) {
      throw new JsonStoreCorruptionError("A state or recovery file does not match the required schema.", { cause: error });
    }
  }

  async #findRecoveryCandidate(): Promise<RecoverySearch<T>> {
    const directory = path.dirname(this.#filePath);
    const base = path.basename(this.#filePath);
    let names: string[];
    try {
      names = await readdir(directory);
    } catch (error) {
      if (errorCode(error) === "ENOENT") return { candidate: null, foundFiles: false };
      throw error;
    }
    const candidates = names
      .filter(name =>
        name === `${base}.backup` ||
        (name.startsWith(`${base}.`) && (name.endsWith(".tmp") || name.includes(".previous.") || name.includes(".backup.candidate."))),
      )
      .map(name => path.join(directory, name));
    const valid: DecodedCandidate<T>[] = [];
    for (const candidate of candidates) {
      try {
        valid.push(await this.#decode(candidate));
      } catch {
        // Invalid recovery debris is preserved for diagnosis and is never promoted.
      }
    }
    return {
      candidate: valid.toSorted((left, right) => right.modifiedAt - left.modifiedAt)[0] ?? null,
      foundFiles: candidates.length > 0,
    };
  }

  async #restoreCandidate(candidate: DecodedCandidate<T>, originalError?: Error): Promise<T> {
    const quarantinePath = `${this.#filePath}.corrupt.${new Date().toISOString().replace(/[:.]/gu, "-")}.${randomUUID()}`;
    let quarantined = false;
    try {
      await rename(this.#filePath, quarantinePath);
      quarantined = true;
    } catch (error) {
      if (errorCode(error) !== "ENOENT") {
        throw new JsonStoreCorruptionError("The corrupt state could not be preserved, so automatic recovery was refused.", { cause: error });
      }
    }

    const recoveryTemporary = `${this.#filePath}.${process.pid}.${randomUUID()}.tmp`;
    let restored: T;
    try {
      await copyFile(candidate.filePath, recoveryTemporary);
      await this.#syncFile(recoveryTemporary);
      await this.#decode(recoveryTemporary);
      await rename(recoveryTemporary, this.#filePath);
      await this.#syncDirectory(path.dirname(this.#filePath));
      restored = (await this.#decode(this.#filePath)).value;
    } catch (error) {
      await rm(recoveryTemporary, { force: true }).catch(() => undefined);
      if (quarantined) {
        try {
          await rename(quarantinePath, this.#filePath);
        } catch (restoreError) {
          throw new JsonStoreCorruptionError(
            "Recovery failed, but both the quarantined original and the recovery candidate were preserved in application data.",
            { cause: restoreError },
          );
        }
      }
      throw new JsonStoreCorruptionError("A valid recovery copy was found, but it could not be restored.", {
        cause: originalError ?? (error instanceof Error ? error : undefined),
      });
    }
    this.#recoveryNotice = {
      recoveredFrom: candidate.filePath,
      ...(quarantined ? { quarantinedOriginal: quarantinePath } : {}),
    };
    if (this.#afterWrite) await this.#afterWrite(this.#filePath);
    return restored;
  }

  #serializeAndValidate(value: T): { serialized: string; value: T } {
    let firstPass: string;
    try {
      firstPass = JSON.stringify(value, null, 2);
    } catch (error) {
      throw new JsonStoreCorruptionError("The requested state cannot be serialized safely.", { cause: error });
    }
    if (Buffer.byteLength(firstPass) > this.#maxBytes) {
      throw new JsonStoreCorruptionError(`The requested state exceeds the ${this.#maxBytes}-byte safety limit.`);
    }
    let validated: T;
    try {
      validated = this.#validate(JSON.parse(firstPass) as unknown);
    } catch (error) {
      throw new JsonStoreCorruptionError("The requested state does not match the required schema; the current state was not changed.", {
        cause: error,
      });
    }
    const serialized = `${JSON.stringify(validated, null, 2)}\n`;
    if (Buffer.byteLength(serialized) > this.#maxBytes) {
      throw new JsonStoreCorruptionError(`The validated state exceeds the ${this.#maxBytes}-byte safety limit.`);
    }
    return { serialized, value: validated };
  }

  async #write(value: T): Promise<T> {
    const prepared = this.#serializeAndValidate(value);
    const temporary = `${this.#filePath}.${process.pid}.${randomUUID()}.tmp`;
    await this.#writeSyncedFile(temporary, prepared.serialized);
    await this.#syncDirectory(path.dirname(this.#filePath));
    try {
      let hasCurrent = true;
      try {
        await this.#decode(this.#filePath);
      } catch (error) {
        if (errorCode(error) === "ENOENT") hasCurrent = false;
        else throw error;
      }
      if (hasCurrent) await this.#refreshBackup();
      await this.#replaceLiveFile(temporary, hasCurrent);
      const committed = await this.#decode(this.#filePath);
      if (this.#afterWrite) await this.#afterWrite(this.#filePath);
      return committed.value;
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
  }

  async #refreshBackup(): Promise<void> {
    const candidate = `${this.#backupPath}.candidate.${process.pid}.${randomUUID()}`;
    await copyFile(this.#filePath, candidate);
    await this.#syncFile(candidate);
    await this.#decode(candidate);
    try {
      await rename(candidate, this.#backupPath);
      await this.#syncDirectory(path.dirname(this.#filePath));
      return;
    } catch (error) {
      if (!new Set(["EEXIST", "EPERM"]).has(errorCode(error) ?? "")) throw error;
    }

    const displaced = `${this.#backupPath}.previous.${process.pid}.${randomUUID()}`;
    let hadBackup = true;
    try {
      await rename(this.#backupPath, displaced);
    } catch (error) {
      if (errorCode(error) === "ENOENT") hadBackup = false;
      else throw error;
    }
    try {
      await rename(candidate, this.#backupPath);
    } catch (error) {
      if (hadBackup) await rename(displaced, this.#backupPath).catch(() => undefined);
      throw error;
    }
    if (hadBackup) await rm(displaced, { force: true }).catch(() => undefined);
    await this.#syncDirectory(path.dirname(this.#filePath));
  }

  async #replaceLiveFile(temporary: string, hasCurrent: boolean): Promise<void> {
    try {
      await rename(temporary, this.#filePath);
      await this.#syncDirectory(path.dirname(this.#filePath));
      return;
    } catch (error) {
      if (!hasCurrent || !new Set(["EEXIST", "EPERM"]).has(errorCode(error) ?? "")) throw error;
    }

    const displaced = `${this.#filePath}.previous.${process.pid}.${randomUUID()}`;
    await rename(this.#filePath, displaced);
    try {
      await rename(temporary, this.#filePath);
    } catch (error) {
      try {
        await rename(displaced, this.#filePath);
      } catch (restoreError) {
        throw new JsonStoreCorruptionError(
          "The Windows rename failed. Both the prior state and the new candidate remain recoverable in application data.",
          { cause: restoreError },
        );
      }
      throw error;
    }
    await rm(displaced, { force: true }).catch(() => undefined);
    await this.#syncDirectory(path.dirname(this.#filePath));
  }

  async #writeSyncedFile(filePath: string, content: string): Promise<void> {
    const handle = await open(filePath, "wx", 0o600);
    try {
      await handle.writeFile(content, { encoding: "utf8" });
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  async #syncFile(filePath: string): Promise<void> {
    const handle = await open(filePath, "r+");
    try {
      await handle.sync();
    } finally {
      await handle.close();
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
      if (!new Set(["EACCES", "EBADF", "EINVAL", "EISDIR", "ENOTSUP", "EPERM"]).has(errorCode(error) ?? "")) throw error;
    }
  }
}
