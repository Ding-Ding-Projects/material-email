import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { HistoryRepository } from "../src/main/history-repository";

const execFileAsync = promisify(execFile);

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

  it("redacts queued-mail transport detail from renderer-facing revision diffs", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "material-email-history-error-redaction-"));
    const source = path.join(directory, "live-state.json");
    const repository = new HistoryRepository(path.join(directory, "history"));

    await writeFile(source, `${JSON.stringify({ outbox: [{ lastError: "waiting" }] }, null, 2)}\n`, "utf8");
    await repository.snapshot(source);
    await writeFile(source, `${JSON.stringify({ outbox: [{ lastError: String.raw`connect ECONNREFUSED C:\\Users\\private-user\\mail.eml https://smtp.example.test/send?token=private-token query=private-search ImapFlow` }] }, null, 2)}\n`, "utf8");
    await repository.snapshot(source);

    const latest = (await repository.list())[0]!;
    const diff = await repository.diff(latest.hash);
    const visible = diff.lines.map(line => line.text).join("\n");
    expect(visible).toContain("The server refused the connection");
    expect(visible).not.toMatch(/private-user|private-token|private-search|smtp\.example|ImapFlow/iu);
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

  it("previews exactly, preserves the current tree and labels, and prunes only eligible app snapshots", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "material-email-history-retention-"));
    const source = path.join(directory, "live-state.json");
    const repository = new HistoryRepository(path.join(directory, "history"));

    for (const value of [1, 2, 3, 4]) {
      await writeFile(source, `${JSON.stringify({ value })}\n`, "utf8");
      await repository.snapshot(source);
    }
    const before = await repository.list();
    const labeledSource = before[2]!;
    await repository.label(labeledSource.hash, "Keep quarter close · 留低季結");
    const future = new Date(Date.now() + 60 * 24 * 60 * 60 * 1_000);

    const preview = await repository.previewPrune(30, future);
    expect(preview).toMatchObject({
      totalRevisionCount: 4,
      protectedCurrentCount: 1,
      protectedLabeledCount: 1,
      protectedRecentCount: 0,
      blockedNonAppOwnedCount: 0,
      canPrune: true,
    });
    expect(preview.eligibleRevisions.map(revision => revision.hash)).toEqual([before[1]!.hash, before[3]!.hash]);
    expect((await repository.list()).map(revision => revision.hash)).toEqual(before.map(revision => revision.hash));

    const result = await repository.prune({
      retentionDays: preview.retentionDays,
      cutoffAt: preview.cutoffAt,
      expectedHeadHash: preview.headHash!,
      expectedEligibleHashes: preview.eligibleRevisions.map(revision => revision.hash),
    }, future);
    expect(result).toMatchObject({ prunedRevisionCount: 2, retainedRevisionCount: 2, semanticEventRecorded: false });

    const retained = await repository.list();
    expect(retained).toHaveLength(2);
    expect(JSON.parse(await repository.read(retained[0]!.hash))).toEqual({ value: 4 });
    expect(retained[1]).toMatchObject({ label: "Keep quarter close · 留低季結", isLabeled: true });
    expect(JSON.parse(await repository.read(retained[1]!.hash))).toEqual({ value: 2 });
    expect(JSON.parse(await readFile(source, "utf8"))).toEqual({ value: 4 });
    await expect(repository.read(before[1]!.hash)).rejects.toThrow();
    await expect(repository.read(before[3]!.hash)).rejects.toThrow();

    const evidence = await repository.inspectDeletionEvidence(new Date("2026-08-01T12:00:00.000Z"));
    expect(evidence).toMatchObject({
      generatedAt: "2026-08-01T12:00:00.000Z",
      policy: "active-history-pruning-only",
      activeRevisionCount: 2,
      activeLabeledRevisionCount: 1,
      mainReflogPresent: true,
      cryptographicErasureProvided: false,
      reflogExpiryPerformed: false,
      gitGarbageCollectionPerformed: false,
      backupCopiesAudited: false,
      storageMediaAudited: false,
    });
    expect(evidence.reflogOnlyRevisionCount).toBeGreaterThan(0);
    expect(evidence.gitVersion).toMatch(/^git version /u);
    expect(evidence.looseObjectCount).toBeGreaterThan(0);
    expect(evidence.looseObjectSizeKiB).toBeGreaterThanOrEqual(0);
  });

  it("refuses stale previews and any lineage containing a non-app-owned commit", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "material-email-history-retention-guard-"));
    const source = path.join(directory, "live-state.json");
    const historyPath = path.join(directory, "history");
    const repository = new HistoryRepository(historyPath);
    const future = new Date(Date.now() + 60 * 24 * 60 * 60 * 1_000);

    await writeFile(source, '{"value":1}\n', "utf8");
    await repository.snapshot(source);
    await writeFile(source, '{"value":2}\n', "utf8");
    await repository.snapshot(source);
    const stalePreview = await repository.previewPrune(30, future);
    await writeFile(source, '{"value":3}\n', "utf8");
    await repository.snapshot(source);
    await expect(repository.prune({
      retentionDays: stalePreview.retentionDays,
      cutoffAt: stalePreview.cutoffAt,
      expectedHeadHash: stalePreview.headHash!,
      expectedEligibleHashes: stalePreview.eligibleRevisions.map(revision => revision.hash),
    }, future)).rejects.toThrow("changed after the preview");
    expect(await repository.list()).toHaveLength(3);

    await writeFile(path.join(historyPath, "manual.txt"), "not managed by Material Email\n", "utf8");
    await execFileAsync("git", ["-C", historyPath, "add", "--", "manual.txt"]);
    await execFileAsync("git", ["-C", historyPath, "commit", "-m", "Manual checkpoint"]);
    const blocked = await repository.previewPrune(30, future);
    expect(blocked.blockedNonAppOwnedCount).toBe(1);
    expect(blocked.canPrune).toBe(false);
    await expect(repository.prune({
      retentionDays: blocked.retentionDays,
      cutoffAt: blocked.cutoffAt,
      expectedHeadHash: blocked.headHash!,
      expectedEligibleHashes: blocked.eligibleRevisions.map(revision => revision.hash),
    }, future)).rejects.toThrow("did not create");
  });

  it("bounds the configured retention age", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "material-email-history-retention-bounds-"));
    const repository = new HistoryRepository(path.join(directory, "history"));
    await expect(repository.previewPrune(29)).rejects.toThrow("30 to 3650 days");
    await expect(repository.previewPrune(3_651)).rejects.toThrow("30 to 3650 days");
  });
});
