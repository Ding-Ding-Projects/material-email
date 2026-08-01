import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { JsonStore, JsonStoreCorruptionError } from "../src/main/storage";

describe("JsonStore", () => {
  it("creates defaults, persists updates, and returns defensive copies", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "material-email-store-"));
    const file = path.join(directory, "nested", "state.json");
    const store = new JsonStore(file, () => ({ count: 0, labels: [] as string[] }));

    const initial = await store.read();
    initial.labels.push("mutated copy");
    expect((await store.read()).labels).toEqual([]);

    await store.update(state => {
      state.count += 1;
      state.labels.push("persisted");
    });

    expect(await store.read()).toEqual({ count: 1, labels: ["persisted"] });
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ count: 1, labels: ["persisted"] });
  });

  it("serializes concurrent updates without losing writes", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "material-email-store-"));
    const store = new JsonStore(path.join(directory, "state.json"), () => ({ count: 0 }));

    await Promise.all(Array.from({ length: 25 }, () => store.update(state => void (state.count += 1))));

    expect((await store.read()).count).toBe(25);
  });

  it("refuses to replace corrupt state with defaults when no recovery copy exists", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "material-email-store-"));
    const file = path.join(directory, "state.json");
    const corrupt = '{"count":';
    await writeFile(file, corrupt, "utf8");

    const store = new JsonStore(file, () => ({ count: 99 }));
    await expect(store.read()).rejects.toBeInstanceOf(JsonStoreCorruptionError);
    expect(await readFile(file, "utf8")).toBe(corrupt);
  });

  it("recovers the newest valid backup and quarantines a corrupt primary", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "material-email-store-"));
    const file = path.join(directory, "state.json");
    const store = new JsonStore(file, () => ({ count: 0 }));
    await store.read();
    await store.update(state => void (state.count = 1));
    await store.update(state => void (state.count = 2));
    await writeFile(file, "not-json", "utf8");

    const recovered = new JsonStore(file, () => ({ count: 99 }));
    expect(await recovered.read()).toEqual({ count: 1 });
    expect(recovered.takeRecoveryNotice()).toEqual(
      expect.objectContaining({ recoveredFrom: `${file}.backup`, quarantinedOriginal: expect.stringContaining("state.json.corrupt.") }),
    );
    expect(recovered.takeRecoveryNotice()).toBeNull();
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ count: 1 });
    expect((await readdir(directory)).some(name => name.startsWith("state.json.corrupt."))).toBe(true);
  });

  it("promotes a valid interrupted-rename copy instead of inventing defaults", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "material-email-store-"));
    const file = path.join(directory, "state.json");
    await writeFile(`${file}.previous.interrupted`, '{"count":7}\n', "utf8");

    const store = new JsonStore(file, () => ({ count: 99 }));
    expect(await store.read()).toEqual({ count: 7 });
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ count: 7 });
  });

  it("refuses defaults when a missing primary has only corrupt recovery evidence", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "material-email-store-"));
    const file = path.join(directory, "state.json");
    const backup = `${file}.backup`;
    await writeFile(backup, "truncated", "utf8");

    const store = new JsonStore(file, () => ({ count: 99 }));
    await expect(store.read()).rejects.toThrow("Defaults were not written");
    await expect(readFile(file, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(backup, "utf8")).toBe("truncated");
  });

  it("validates a complete serialized candidate before changing the live state", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "material-email-store-"));
    const file = path.join(directory, "state.json");
    const validate = (value: unknown): { count: number } => {
      if (!value || typeof value !== "object" || typeof (value as { count?: unknown }).count !== "number") {
        throw new Error("invalid state");
      }
      return value as { count: number };
    };
    const store = new JsonStore(file, () => ({ count: 0 }), undefined, { validate });
    await store.read();

    await expect(
      store.update(state => {
        (state as unknown as { count: unknown }).count = "invalid";
      }),
    ).rejects.toBeInstanceOf(JsonStoreCorruptionError);
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ count: 0 });
  });
});
