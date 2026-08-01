import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { HistoryRepository } from "../src/main/history-repository";

describe("HistoryRepository", () => {
  it("commits snapshots and reads immutable revisions without rewriting history", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "material-email-history-"));
    const source = path.join(directory, "live-state.json");
    const repository = new HistoryRepository(path.join(directory, "history"));

    await writeFile(source, '{"value":1}\n', "utf8");
    await repository.snapshot(source);
    const first = await repository.list();
    expect(first).toHaveLength(1);
    expect(JSON.parse(await repository.read(first[0]!.hash))).toEqual({ value: 1 });

    await writeFile(source, '{"value":2}\n', "utf8");
    await repository.snapshot(source);
    await repository.snapshot(source);

    const revisions = await repository.list();
    expect(revisions).toHaveLength(2);
    expect(JSON.parse(await repository.read(revisions[0]!.hash))).toEqual({ value: 2 });
    expect(JSON.parse(await repository.read(revisions[1]!.hash))).toEqual({ value: 1 });
    expect(JSON.parse(await readFile(source, "utf8"))).toEqual({ value: 2 });
  });

  it("rejects revision strings that could be interpreted as git options or paths", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "material-email-history-"));
    const repository = new HistoryRepository(path.join(directory, "history"));
    await expect(repository.read("--help:../../secret")).rejects.toThrow("identifier is invalid");
  });

  it("refuses invalid snapshots before they can enter append-only history", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "material-email-history-"));
    const source = path.join(directory, "live-state.json");
    const repository = new HistoryRepository(path.join(directory, "history"), value => {
      if (!value || typeof value !== "object" || (value as { schemaVersion?: unknown }).schemaVersion !== 1) {
        throw new Error("invalid snapshot");
      }
    });

    await writeFile(source, '{"schemaVersion":2}\n', "utf8");
    await expect(repository.snapshot(source)).rejects.toThrow("invalid snapshot");
    await writeFile(source, '{"schemaVersion":1}\n', "utf8");
    await repository.snapshot(source);
    expect(await repository.list()).toHaveLength(1);
  });
});
