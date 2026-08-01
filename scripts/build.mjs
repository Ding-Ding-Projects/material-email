import { build } from "esbuild";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

const run = (command, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", shell: false });
    child.on("exit", code => (code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`))));
  });

await rm("dist", { recursive: true, force: true });
await mkdir("dist/main", { recursive: true });
await build({
  entryPoints: ["src/main/index.ts"],
  outfile: "dist/main/index.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  sourcemap: true,
  external: ["electron", "imapflow", "mailparser", "nodemailer", "sanitize-html", "zod"],
});
await build({
  entryPoints: ["src/preload/index.ts"],
  outfile: "dist/main/preload.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  sourcemap: true,
  external: ["electron"],
});
await run(process.execPath, [path.resolve("node_modules/vite/bin/vite.js"), "build"]);
await cp("src/renderer/assets", "dist/renderer/assets", { recursive: true });

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const version = process.env.MATERIAL_EMAIL_RELEASE_VERSION?.trim() || packageJson.version;
if (version !== packageJson.version) {
  throw new Error(`Release metadata version ${version} does not match package version ${packageJson.version}.`);
}
const releaseDate = process.env.MATERIAL_EMAIL_RELEASE_DATE?.trim() || "";
if (releaseDate) {
  const parsedReleaseDate = new Date(`${releaseDate}T00:00:00.000Z`);
  if (Number.isNaN(parsedReleaseDate.valueOf()) || parsedReleaseDate.toISOString().slice(0, 10) !== releaseDate) {
    throw new Error(`MATERIAL_EMAIL_RELEASE_DATE must be a real UTC calendar date in YYYY-MM-DD form, received ${releaseDate}.`);
  }
}
const releaseMetadata = {
  version,
  releaseDate,
  codeName: process.env.MATERIAL_EMAIL_CODE_NAME || "Classic Har Gow · 蝦餃",
  dishId: process.env.MATERIAL_EMAIL_DISH_ID || "hk-dish-0001",
  imageAsset: process.env.MATERIAL_EMAIL_DISH_ASSET || "hk-dish-0001-classic-har-gow.png",
  catalogCommit: process.env.MATERIAL_EMAIL_CATALOG_COMMIT || "dfb95a20e647d921242358988ada9c5436c78b3d",
};
await writeFile("dist/release-metadata.json", `${JSON.stringify(releaseMetadata, null, 2)}\n`, "utf8");
