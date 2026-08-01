import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

const assetDirectory = path.resolve("src/renderer/assets/dim-sum");
const catalog = JSON.parse(await readFile(path.join(assetDirectory, "release-catalog.json"), "utf8"));
const ids = new Set();
const files = new Set();
const hashes = new Set();

for (const item of catalog) {
  if (!item.id || !item.name?.en || !item.name?.zhHant || !item.file || !item.sha256 || !item.catalogCommit) {
    throw new Error(`Incomplete dim-sum catalog record: ${JSON.stringify(item)}`);
  }
  if (ids.has(item.id) || files.has(item.file) || hashes.has(item.sha256)) {
    throw new Error(`Duplicate dim-sum identity, filename, or image hash: ${item.id}`);
  }
  if (path.basename(item.file) !== item.file || !item.file.endsWith(".png")) {
    throw new Error(`Unsafe or unsupported dim-sum filename: ${item.file}`);
  }
  const bytes = await readFile(path.join(assetDirectory, item.file));
  const pngSignature = "89504e470d0a1a0a";
  if (bytes.subarray(0, 8).toString("hex") !== pngSignature || bytes.subarray(12, 16).toString("ascii") !== "IHDR") {
    throw new Error(`Image does not decode as a structurally valid PNG header: ${item.file}`);
  }
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (width < 1024 || height < 1024) throw new Error(`Image is below 1024×1024: ${item.file} (${width}×${height})`);
  const actualHash = createHash("sha256").update(bytes).digest("hex");
  if (actualHash !== item.sha256) throw new Error(`Image hash mismatch: ${item.file}`);
  ids.add(item.id);
  files.add(item.file);
  hashes.add(item.sha256);
  console.log(`PASS ${item.id} ${item.name.en} · ${item.name.zhHant} (${width}×${height})`);
}

console.log(`PASS ${catalog.length} verified unique bundled dim-sum images`);

