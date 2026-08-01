import { createHash } from "node:crypto";
import { access, copyFile, cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const repositoryRoot = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const siteSourceDirectory = path.join(repositoryRoot, "site");
const docsSourceDirectory = path.join(repositoryRoot, "docs");
const catalogPath = path.join(repositoryRoot, "src", "renderer", "assets", "dim-sum", "release-catalog.json");
const rendererAssetDirectory = path.dirname(catalogPath);
const siteAssetDirectory = path.join(siteSourceDirectory, "assets", "dim-sum");
const supportDocuments = ["HANDOFF.md", "ROADMAP.md"];
const versionPattern = /^\d+\.\d+\.\d+$/;
const photoPattern = /^hk-dish-\d{4}-[a-z0-9-]+\.png$/;

export const developmentReleaseMetadata = Object.freeze({
  schemaVersion: 1,
  published: false,
  version: "0.1.0",
  releaseDate: null,
  codeName: null,
  photoFile: null,
  tag: null,
  releaseUrl: null,
});

const sha256 = async file => createHash("sha256").update(await readFile(file)).digest("hex");

const isRealUtcDate = value => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
};

const readCatalog = async () => {
  const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
  if (!Array.isArray(catalog) || catalog.length !== 10) throw new Error("The release catalog must contain exactly ten verified dishes.");
  const files = new Set();
  for (const entry of catalog) {
    if (!entry || typeof entry !== "object" || !photoPattern.test(entry.file ?? "") || !/^[0-9a-f]{64}$/.test(entry.sha256 ?? "")) {
      throw new Error("The release catalog contains an invalid file or SHA-256 value.");
    }
    if (files.has(entry.file)) throw new Error(`Duplicate release catalog file: ${entry.file}`);
    if (!entry.name || typeof entry.name.en !== "string" || typeof entry.name.zhHant !== "string") {
      throw new Error(`Release catalog names are incomplete for ${entry.file}.`);
    }
    files.add(entry.file);
  }
  return catalog;
};

export const validateReleaseMetadata = async metadata => {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) throw new Error("release.json must contain an object.");
  const expectedKeys = ["schemaVersion", "published", "version", "releaseDate", "codeName", "photoFile", "tag", "releaseUrl"];
  const actualKeys = Object.keys(metadata).sort();
  if (actualKeys.join("\n") !== expectedKeys.slice().sort().join("\n")) throw new Error("release.json has missing or unknown fields.");
  if (metadata.schemaVersion !== 1 || typeof metadata.published !== "boolean" || !versionPattern.test(metadata.version ?? "")) {
    throw new Error("release.json has an invalid schema, publication flag, or version.");
  }

  if (!metadata.published) {
    for (const key of ["releaseDate", "codeName", "photoFile", "tag", "releaseUrl"]) {
      if (metadata[key] !== null) throw new Error(`Development release metadata must keep ${key} null.`);
    }
    return { ...metadata };
  }

  if (!isRealUtcDate(metadata.releaseDate ?? "")) throw new Error("Published release metadata needs a real UTC YYYY-MM-DD date.");
  if (metadata.tag !== `v${metadata.version}`) throw new Error("Published release tag must match the version.");

  let releaseUrl;
  try {
    releaseUrl = new URL(metadata.releaseUrl);
  } catch {
    throw new Error("Published release metadata has an invalid release URL.");
  }
  const expectedPath = `/Ding-Ding-Projects/material-email/releases/tag/${metadata.tag}`;
  if (releaseUrl.protocol !== "https:" || releaseUrl.hostname !== "github.com" || releaseUrl.pathname !== expectedPath || releaseUrl.search || releaseUrl.hash) {
    throw new Error("Published release URL must target the matching Material Email GitHub release.");
  }

  const hasCodeName = metadata.codeName !== null;
  const hasPhoto = metadata.photoFile !== null;
  if (hasCodeName !== hasPhoto) throw new Error("Published release code name and photo must both be present or both be null.");
  if (hasCodeName && hasPhoto) {
    if (typeof metadata.codeName !== "string" || !metadata.codeName.trim() || metadata.codeName.length > 160) {
      throw new Error("Published release metadata has an invalid code name.");
    }
    if (!photoPattern.test(metadata.photoFile)) throw new Error("Published release metadata has an invalid photo filename.");
    const catalog = await readCatalog();
    const dish = catalog.find(entry => entry.file === metadata.photoFile);
    if (!dish) throw new Error("Published release photo is not in the verified catalog.");
    const expectedCodeName = `${dish.name.en} · ${dish.name.zhHant}`;
    if (metadata.codeName !== expectedCodeName) throw new Error("Published code name does not match its verified catalog photo.");
  }
  return { ...metadata };
};

const walk = async directory => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const resolved = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(resolved));
    else if (entry.isFile()) files.push(resolved);
  }
  return files;
};

const exists = async target => {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
};

const stripLinkTarget = rawTarget => {
  let target = rawTarget.trim();
  if (target.startsWith("<") && target.endsWith(">")) target = target.slice(1, -1);
  target = target.split("#", 1)[0].split("?", 1)[0];
  return decodeURIComponent(target);
};

const verifyMarkdownLinks = async (artifactDirectory, markdownFiles) => {
  for (const markdownFile of markdownFiles) {
    const source = await readFile(markdownFile, "utf8");
    for (const match of source.matchAll(/\]\(([^)]+)\)/g)) {
      const rawTarget = match[1].trim();
      if (!rawTarget || rawTarget.startsWith("#") || /^(?:https?:|mailto:)/i.test(rawTarget)) continue;
      const target = stripLinkTarget(rawTarget);
      if (!target) continue;
      const resolved = path.resolve(path.dirname(markdownFile), target);
      const relative = path.relative(artifactDirectory, resolved);
      if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`Markdown link escapes the Pages artifact: ${markdownFile} -> ${rawTarget}`);
      if (!await exists(resolved)) throw new Error(`Broken Markdown link in Pages artifact: ${markdownFile} -> ${rawTarget}`);
    }
  }
};

const verifyCatalogCopies = async artifactDirectory => {
  const catalog = await readCatalog();
  for (const entry of catalog) {
    const rendererFile = path.join(rendererAssetDirectory, entry.file);
    const trackedSiteFile = path.join(siteAssetDirectory, entry.file);
    const artifactFile = path.join(artifactDirectory, "assets", "dim-sum", entry.file);
    const hashes = await Promise.all([rendererFile, trackedSiteFile, artifactFile].map(sha256));
    if (hashes.some(hash => hash !== entry.sha256)) throw new Error(`Catalog asset is missing or not byte-identical: ${entry.file}`);
  }
  return catalog;
};

export const verifySiteArtifact = async artifactDirectory => {
  const resolvedArtifact = path.resolve(artifactDirectory);
  for (const required of ["index.html", "styles.css", "app.js", "release.json", "docs/README.md", "HANDOFF.md", "ROADMAP.md"]) {
    if (!await exists(path.join(resolvedArtifact, required))) throw new Error(`Pages artifact is missing ${required}.`);
  }

  const releaseMetadata = await validateReleaseMetadata(JSON.parse(await readFile(path.join(resolvedArtifact, "release.json"), "utf8")));
  const catalog = await verifyCatalogCopies(resolvedArtifact);
  if (releaseMetadata.published && releaseMetadata.photoFile && !catalog.some(entry => entry.file === releaseMetadata.photoFile)) {
    throw new Error("The selected release photo is absent from the Pages artifact.");
  }

  const artifactFiles = await walk(resolvedArtifact);
  const markdownFiles = artifactFiles.filter(file => file.toLowerCase().endsWith(".md"));
  await verifyMarkdownLinks(resolvedArtifact, markdownFiles);

  const html = await readFile(path.join(resolvedArtifact, "index.html"), "utf8");
  for (const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
    const rawTarget = match[1];
    if (!rawTarget || rawTarget.startsWith("#") || /^(?:data:|https?:|mailto:)/i.test(rawTarget)) continue;
    const resolved = path.resolve(resolvedArtifact, stripLinkTarget(rawTarget));
    if (!await exists(resolved)) throw new Error(`Broken index.html asset link in Pages artifact: ${rawTarget}`);
  }

  const app = await readFile(path.join(resolvedArtifact, "app.js"), "utf8");
  const docReferences = Array.from(new Set(Array.from(app.matchAll(/["'](\.\.\/docs\/[^"']+\.md)["']/g), match => match[1].replace(/^\.\.\/docs\//, "./docs/"))));
  if (docReferences.length < 20) throw new Error("The site application does not expose the complete bundled documentation set.");
  if (!app.includes('doc:doc.replace(/^\\.\\.\\/docs\\//,"./docs/")')) throw new Error("The application does not route source-tree article paths into the Pages docs bundle.");
  for (const reference of docReferences) {
    if (!await exists(path.resolve(resolvedArtifact, reference))) throw new Error(`Broken application documentation link: ${reference}`);
  }
  const imageReferences = Array.from(new Set(Array.from(app.matchAll(/["'](hk-dish-\d{4}-[a-z0-9-]+\.png)["']/g), match => `./assets/dim-sum/${match[1]}`)));
  if (imageReferences.length !== 10) throw new Error("The site application must reference all ten local dim-sum images.");
  if (app.includes("../src/renderer/assets")) throw new Error("The Pages application still points outside its artifact for dim-sum images.");
  for (const reference of imageReferences) {
    if (!await exists(path.resolve(resolvedArtifact, reference))) throw new Error(`Broken application image link: ${reference}`);
  }

  return { fileCount: artifactFiles.length, markdownCount: markdownFiles.length, releaseMetadata };
};

export const assembleSiteArtifact = async ({ outputDirectory, releaseMetadata } = {}) => {
  if (!outputDirectory) throw new Error("A Pages artifact output directory is required.");
  const output = path.resolve(outputDirectory);
  const relativeToRepository = path.relative(repositoryRoot, output);
  const outsideRepository = relativeToRepository.startsWith("..") || path.isAbsolute(relativeToRepository);
  const outputIsRepositoryAncestor = repositoryRoot === output || repositoryRoot.startsWith(`${output}${path.sep}`);
  const protectedSource = [siteSourceDirectory, docsSourceDirectory, rendererAssetDirectory].some(source => source === output || source.startsWith(`${output}${path.sep}`) || output.startsWith(`${source}${path.sep}`));
  if (outputIsRepositoryAncestor || protectedSource || (!outsideRepository && relativeToRepository.split(path.sep)[0] !== "test-results")) {
    throw new Error("Refusing to replace an unsafe Pages artifact path.");
  }

  const metadata = await validateReleaseMetadata(releaseMetadata ?? JSON.parse(await readFile(path.join(siteSourceDirectory, "release.json"), "utf8")));
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  await cp(siteSourceDirectory, output, { recursive: true });
  await cp(docsSourceDirectory, path.join(output, "docs"), { recursive: true });
  for (const document of supportDocuments) await copyFile(path.join(repositoryRoot, document), path.join(output, document));

  const docsIndex = path.join(output, "docs", "README.md");
  const originalIndex = await readFile(docsIndex, "utf8");
  const deployedIndex = originalIndex.replace("](../site/index.html)", "](../index.html)");
  if (deployedIndex === originalIndex) throw new Error("The docs index no longer contains the expected source-tree site link.");
  await writeFile(docsIndex, deployedIndex, "utf8");
  await writeFile(path.join(output, "release.json"), `${JSON.stringify(metadata, null, 2)}\n`, "utf8");

  return verifySiteArtifact(output);
};

const cli = async () => {
  const args = process.argv.slice(2);
  const outputIndex = args.indexOf("--output");
  if (outputIndex < 0 || !args[outputIndex + 1]) throw new Error("Usage: node scripts/verify-site-artifact.mjs --output <directory> [--published]");
  const published = args.includes("--published") || process.env.MATERIAL_EMAIL_SITE_PUBLISHED === "true";
  const releaseMetadata = published ? {
    schemaVersion: 1,
    published: true,
    version: process.env.MATERIAL_EMAIL_SITE_VERSION,
    releaseDate: process.env.MATERIAL_EMAIL_SITE_RELEASE_DATE,
    codeName: process.env.MATERIAL_EMAIL_SITE_CODE_NAME?.trim() || null,
    photoFile: process.env.MATERIAL_EMAIL_SITE_PHOTO_FILE?.trim() || null,
    tag: process.env.MATERIAL_EMAIL_SITE_TAG,
    releaseUrl: process.env.MATERIAL_EMAIL_SITE_RELEASE_URL,
  } : undefined;
  const outputDirectory = path.resolve(args[outputIndex + 1]);
  const result = await assembleSiteArtifact({ outputDirectory, releaseMetadata });
  console.log(`PASS exact Pages artifact (${result.fileCount} files, ${result.markdownCount} Markdown documents, ${result.releaseMetadata.published ? `published ${result.releaseMetadata.version}` : `development ${result.releaseMetadata.version}`}) at ${outputDirectory}`);
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await cli();
