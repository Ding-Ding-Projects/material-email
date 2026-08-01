import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { access, mkdir, mkdtemp, readFile, readdir, rename, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { AtomicJsonStore, PimPersistenceError } from "../../src/main/pim";

const stateSchema = z.object({ count: z.number().int().nonnegative(), labels: z.array(z.string()) }).strict();
const defaults = () => ({ count: 0, labels: [] as string[] });

async function waitForOutput(child: ChildProcessWithoutNullStreams, expected: string): Promise<void> {
  child.stdout.setEncoding("utf8");
  await new Promise<void>((resolve, reject) => {
    let output = "";
    const onData = (chunk: string) => {
      output += chunk;
      if (!output.includes(expected)) return;
      child.stdout.off("data", onData);
      child.off("error", onError);
      child.off("exit", onExit);
      resolve();
    };
    const onError = (error: Error) => {
      child.stdout.off("data", onData);
      child.off("exit", onExit);
      reject(error);
    };
    const onExit = (code: number | null) => {
      child.stdout.off("data", onData);
      child.off("error", onError);
      reject(new Error(`Child exited with ${String(code)} before emitting ${expected}.`));
    };
    child.stdout.on("data", onData);
    child.once("error", onError);
    child.once("exit", onExit);
  });
}

async function expectSuccessfulExit(child: ChildProcessWithoutNullStreams): Promise<void> {
  child.stderr.setEncoding("utf8");
  let stderr = "";
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  const [code] = (await once(child, "exit")) as [number | null, NodeJS.Signals | null];
  expect(stderr).toBe("");
  expect(code).toBe(0);
}

describe("AtomicJsonStore", () => {
  it("serializes concurrent mutations and suppresses no-op disk generations", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "material-email-atomic-"));
    const store = new AtomicJsonStore(path.join(directory, "state.json"), stateSchema, defaults);
    expect(await store.read()).toEqual({ count: 0, labels: [] });
    await Promise.all(
      Array.from({ length: 25 }, (_, index) =>
        store.mutate(state => {
          state.count += 1;
          state.labels.push(String(index));
          return { changed: true, result: undefined };
        }),
      ),
    );
    expect((await store.read()).count).toBe(25);
    const generation = await store.generation();
    await store.mutate(state => ({ changed: false, result: state.count }));
    expect(await store.generation()).toBe(generation);
  });

  it("preserves sequential mutations from independently warmed store instances", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "material-email-atomic-sequential-"));
    const file = path.join(directory, "state.json");
    const first = new AtomicJsonStore(file, stateSchema, defaults);
    const second = new AtomicJsonStore(file, stateSchema, defaults);
    await Promise.all([first.read(), second.read()]);

    await first.mutate(state => {
      state.count += 1;
      state.labels.push("first");
      return { changed: true, result: undefined };
    });
    await second.mutate(state => {
      state.count += 1;
      state.labels.push("second");
      return { changed: true, result: undefined };
    });

    expect(await first.read()).toEqual({ count: 2, labels: ["first", "second"] });
    expect(await second.generation()).toBe(2);
    expect(JSON.parse(await readFile(file, "utf8"))).toMatchObject({
      generation: 2,
      payload: { count: 2, labels: ["first", "second"] },
    });
  });

  it("serializes concurrent mutations from independent store instances", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "material-email-atomic-concurrent-"));
    const file = path.join(directory, "state.json");
    const first = new AtomicJsonStore(file, stateSchema, defaults);
    const second = new AtomicJsonStore(file, stateSchema, defaults);
    await Promise.all([first.read(), second.read()]);

    let releaseFirst!: () => void;
    const firstMayFinish = new Promise<void>(resolve => {
      releaseFirst = resolve;
    });
    let announceFirst!: () => void;
    const firstEntered = new Promise<void>(resolve => {
      announceFirst = resolve;
    });
    const firstMutation = first.mutate(async state => {
      announceFirst();
      await firstMayFinish;
      state.count += 1;
      state.labels.push("first");
      return { changed: true, result: undefined };
    });
    await firstEntered;
    const secondMutation = second.mutate(state => {
      state.count += 1;
      state.labels.push("second");
      return { changed: true, result: undefined };
    });
    await new Promise(resolve => setTimeout(resolve, 30));
    releaseFirst();
    await Promise.all([firstMutation, secondMutation]);

    const persisted = JSON.parse(await readFile(file, "utf8"));
    expect(persisted).toMatchObject({ generation: 2, payload: { count: 2, labels: ["first", "second"] } });
  });

  it("serializes mutations made by separate Node processes", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "material-email-atomic-processes-"));
    const file = path.join(directory, "state.json");
    const moduleUrl = pathToFileURL(path.resolve("src/main/pim/atomic-json-store.ts")).href;
    const childSource = `
      import { AtomicJsonStore } from ${JSON.stringify(moduleUrl)};
      import { z } from "zod";
      const [file, label, pause] = process.argv.slice(1);
      const schema = z.object({ count: z.number().int().nonnegative(), labels: z.array(z.string()) }).strict();
      const store = new AtomicJsonStore(file, schema, () => ({ count: 0, labels: [] }));
      await store.mutate(async state => {
        process.stdout.write("entered:" + label + "\\n");
        await new Promise(resolve => setTimeout(resolve, Number(pause)));
        state.count += 1;
        state.labels.push(label);
        return { changed: true, result: undefined };
      });
    `;
    const spawnWriter = (label: string, pauseMs: number) =>
      spawn(process.execPath, ["--input-type=module", "--eval", childSource, file, label, String(pauseMs)], {
        cwd: process.cwd(),
      });

    const first = spawnWriter("first", 150);
    await waitForOutput(first, "entered:first");
    const second = spawnWriter("second", 0);
    await Promise.all([expectSuccessfulExit(first), expectSuccessfulExit(second)]);

    const persisted = JSON.parse(await readFile(file, "utf8"));
    expect(persisted).toMatchObject({ generation: 2, payload: { count: 2, labels: ["first", "second"] } });
  });

  it("recovers the highest valid generation left in the next or backup slot", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "material-email-atomic-recovery-"));
    const file = path.join(directory, "state.json");
    const first = new AtomicJsonStore(file, stateSchema, defaults);
    await first.read();
    await first.mutate(state => {
      state.count = 1;
      return { changed: true, result: undefined };
    });
    await writeFile(
      first.paths.next,
      `${JSON.stringify({ formatVersion: 1, generation: 2, payload: { count: 2, labels: ["recovered"] } }, null, 2)}\n`,
      "utf8",
    );

    const recovered = new AtomicJsonStore(file, stateSchema, () => ({ count: 99, labels: [] }));
    expect(await recovered.read()).toEqual({ count: 2, labels: ["recovered"] });
    expect(await recovered.generation()).toBe(2);
    await expect(access(recovered.paths.next)).rejects.toThrow();
    expect(JSON.parse(await readFile(file, "utf8"))).toMatchObject({ generation: 2, payload: { count: 2 } });
  });

  it("recovers the current-to-backup crash window without losing the newer next generation", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "material-email-atomic-backup-window-"));
    const file = path.join(directory, "state.json");
    const first = new AtomicJsonStore(file, stateSchema, defaults);
    await first.read();
    await first.mutate(state => {
      state.count = 1;
      state.labels.push("backup");
      return { changed: true, result: undefined };
    });
    await rename(file, first.paths.backup);
    await writeFile(
      first.paths.next,
      `${JSON.stringify({ formatVersion: 1, generation: 2, payload: { count: 2, labels: ["next"] } }, null, 2)}\n`,
      "utf8",
    );

    const recovered = new AtomicJsonStore(file, stateSchema, defaults);
    expect(await recovered.read()).toEqual({ count: 2, labels: ["next"] });
    await expect(access(recovered.paths.next)).rejects.toThrow();
    await expect(access(recovered.paths.backup)).rejects.toThrow();
    expect(JSON.parse(await readFile(file, "utf8"))).toMatchObject({ generation: 2 });
  });

  it("keeps a valid current generation when a higher-looking next slot is corrupt", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "material-email-atomic-invalid-next-"));
    const file = path.join(directory, "state.json");
    const first = new AtomicJsonStore(file, stateSchema, defaults);
    await first.read();
    await first.mutate(state => {
      state.count = 1;
      state.labels.push("current");
      return { changed: true, result: undefined };
    });
    await writeFile(
      first.paths.next,
      `${JSON.stringify({ formatVersion: 1, generation: 99, payload: { count: -1, labels: ["invalid"] } })}\n`,
      "utf8",
    );

    const recovered = new AtomicJsonStore(file, stateSchema, defaults);
    expect(await recovered.read()).toEqual({ count: 1, labels: ["current"] });
    expect(await recovered.generation()).toBe(1);
    await expect(access(recovered.paths.next)).rejects.toThrow();
  });

  it("recovers a stale dead-owner lock and removes the active lock after use", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "material-email-atomic-stale-lock-"));
    const file = path.join(directory, "state.json");
    const lockPath = `${file}.lock`;
    const token = "00000000-0000-4000-8000-000000000001";
    await mkdir(lockPath);
    const ownerPath = path.join(lockPath, "owner.json");
    await writeFile(
      ownerPath,
      `${JSON.stringify({ formatVersion: 1, token, pid: 2_147_483_647, createdAt: Date.now() - 60_000 })}\n`,
      "utf8",
    );
    const staleTime = new Date(Date.now() - 60_000);
    await utimes(ownerPath, staleTime, staleTime);

    const store = new AtomicJsonStore(file, stateSchema, defaults);
    expect(await store.read()).toEqual({ count: 0, labels: [] });
    await expect(access(lockPath)).rejects.toThrow();
    expect((await readdir(directory)).some(entry => entry.startsWith("state.json.lock.stale-"))).toBe(true);
  });

  it("does not steal an old lock whose owner process is still alive", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "material-email-atomic-live-lock-"));
    const file = path.join(directory, "state.json");
    const lockPath = `${file}.lock`;
    await mkdir(lockPath);
    const ownerPath = path.join(lockPath, "owner.json");
    await writeFile(
      ownerPath,
      `${JSON.stringify({
        formatVersion: 1,
        token: "00000000-0000-4000-8000-000000000002",
        pid: process.pid,
        createdAt: Date.now() - 60_000,
      })}\n`,
      "utf8",
    );
    const staleTime = new Date(Date.now() - 60_000);
    await utimes(ownerPath, staleTime, staleTime);

    const store = new AtomicJsonStore(file, stateSchema, defaults);
    let settled = false;
    const read = store.read().finally(() => {
      settled = true;
    });
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(settled).toBe(false);
    await rm(lockPath, { recursive: true });
    expect(await read).toEqual({ count: 0, labels: [] });
    await expect(access(lockPath)).rejects.toThrow();
  });

  it("rejects an out-of-band generation change instead of overwriting it", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "material-email-atomic-conflict-"));
    const file = path.join(directory, "state.json");
    const store = new AtomicJsonStore(file, stateSchema, defaults);
    await store.read();

    await expect(
      store.mutate(async state => {
        state.count = 9;
        state.labels.push("discarded");
        await writeFile(
          file,
          `${JSON.stringify({ formatVersion: 1, generation: 1, payload: { count: 1, labels: ["external"] } }, null, 2)}\n`,
          "utf8",
        );
        return { changed: true, result: undefined };
      }),
    ).rejects.toThrow(/changed while a mutation was in progress/u);
    expect(JSON.parse(await readFile(file, "utf8"))).toMatchObject({
      generation: 1,
      payload: { count: 1, labels: ["external"] },
    });

    await store.mutate(state => {
      state.count += 1;
      state.labels.push("recovered queue");
      return { changed: true, result: undefined };
    });
    expect(await store.read()).toEqual({ count: 2, labels: ["external", "recovered queue"] });
  });

  it("releases its lock and keeps the same-instance queue usable after a rejected mutator", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "material-email-atomic-rejected-"));
    const file = path.join(directory, "state.json");
    const lockPath = `${file}.lock`;
    const store = new AtomicJsonStore(file, stateSchema, defaults);
    await store.read();

    await expect(
      store.mutate(() => {
        throw new Error("expected mutator rejection");
      }),
    ).rejects.toThrow("expected mutator rejection");
    await expect(access(lockPath)).rejects.toThrow();

    await store.mutate(state => {
      state.count += 1;
      return { changed: true, result: undefined };
    });
    expect(await store.read()).toEqual({ count: 1, labels: [] });
    const entries = await readdir(directory);
    expect(entries.filter(entry => entry.includes(".lock.pending-") || entry.includes(".lock.released-"))).toEqual([]);
  });

  it("recovers the queue and lock after a filesystem commit rejection", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "material-email-atomic-commit-rejected-"));
    const file = path.join(directory, "state.json");
    const lockPath = `${file}.lock`;
    const store = new AtomicJsonStore(file, stateSchema, defaults);
    await store.read();
    await mkdir(store.paths.next);

    await expect(
      store.mutate(state => {
        state.count = 99;
        return { changed: true, result: undefined };
      }),
    ).rejects.toThrow();
    await expect(access(lockPath)).rejects.toThrow();
    expect(JSON.parse(await readFile(file, "utf8"))).toMatchObject({ generation: 0, payload: { count: 0 } });

    await rm(store.paths.next, { recursive: true });
    await store.mutate(state => {
      state.count += 1;
      return { changed: true, result: undefined };
    });
    expect(await store.read()).toEqual({ count: 1, labels: [] });
    expect(await store.generation()).toBe(1);
  });

  it("refuses corrupt persisted data when no validated recovery copy exists", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "material-email-atomic-corrupt-"));
    const file = path.join(directory, "state.json");
    await writeFile(file, '{"formatVersion":1,"generation":3,"payload":{"count":-1}}\n', "utf8");
    const store = new AtomicJsonStore(file, stateSchema, defaults);
    await expect(store.read()).rejects.toBeInstanceOf(PimPersistenceError);
    expect(await readFile(file, "utf8")).toContain('"count":-1');
  });
});
