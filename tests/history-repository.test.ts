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
    expect(first[0]).toMatchObject({ label: "Snapshot application state", subject: "Snapshot application state" });
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

  it("labels immutable commits and returns a bounded redacted diff against the prior revision", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "material-email-history-label-"));
    const source = path.join(directory, "live-state.json");
    const repository = new HistoryRepository(path.join(directory, "history"));

    await writeFile(source, `${JSON.stringify({ value: 1, encryptedSecret: "ciphertext-one" }, null, 2)}\n`, "utf8");
    await repository.snapshot(source);
    const first = (await repository.list())[0]!;
    const labeled = await repository.label(first.hash, "Before cleanup · 清理之前");
    expect(labeled.label).toBe("Before cleanup · 清理之前");
    expect((await repository.list())[0]?.label).toBe("Before cleanup · 清理之前");
    expect(JSON.parse(await repository.read(first.hash))).toEqual({ value: 1, encryptedSecret: "ciphertext-one" });

    await writeFile(source, `${JSON.stringify({ value: 2, encryptedSecret: "ciphertext-two" }, null, 2)}\n`, "utf8");
    await repository.snapshot(source);
    const latest = (await repository.list())[0]!;
    const diff = await repository.diff(latest.hash);

    expect(diff.parentHash).toBe(first.hash);
    expect(diff.revision.hash).toBe(latest.hash);
    expect(diff.lines.some(line => line.kind === "removed" && line.text.includes('"value": 1'))).toBe(true);
    expect(diff.lines.some(line => line.kind === "added" && line.text.includes('"value": 2'))).toBe(true);
    expect(diff.lines.some(line => line.text.includes("[encrypted value omitted]"))).toBe(true);
    expect(diff.lines.every(line => !line.text.includes("ciphertext-one") && !line.text.includes("ciphertext-two"))).toBe(true);
    expect(diff.truncated).toBe(false);
    await expect(repository.label(latest.hash, "\n")).rejects.toThrow("1 to 120");
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
