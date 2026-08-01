import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const read = (path: string): Promise<string> => readFile(path, "utf8");

describe("catalog-exhausted release contract", () => {
  it("keeps build decoration all-or-none and does not reuse the development dish for a dated release", async () => {
    const build = await read("scripts/build.mjs");
    expect(build).toContain("Release decoration metadata must provide code name, dish ID, image asset, and catalog commit together.");
    expect(build).toMatch(/releaseDate\s*\?\s*\{\s*codeName:\s*""\s*,\s*dishId:\s*""\s*,\s*imageAsset:\s*""\s*,\s*catalogCommit:\s*""/);
  });

  it("verifies exactly one installer asset when no catalog photo is assigned", async () => {
    const workflow = await read(".github/workflows/windows-release.yml");
    expect(workflow).toContain("$expectedAssetCount = if ($photoFile) { 2 } else { 1 }");
    expect(workflow).toContain("if ($photoFile) {");
    expect(workflow).toContain("every verified catalog dish was already used");
    expect(workflow).not.toContain("Release must contain exactly two assets.");
    expect(workflow).not.toContain("Join-Path $downloadDir ''");
  });

  it("publishes Pages metadata and presentation without a fake dish", async () => {
    const [artifact, site] = await Promise.all([
      read("scripts/verify-site-artifact.mjs"),
      read("site/app.js"),
    ]);
    expect(artifact).toContain("code name and photo must both be present or both be null");
    expect(site).toContain("No code name assigned");
    expect(site).toContain("const summary=decorated?");
    expect(site).toContain("release-summary--plain");
  });
});
