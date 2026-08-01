import { access, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { assembleSiteArtifact, developmentReleaseMetadata } from "./verify-site-artifact.mjs";

const read = file => readFile(file, "utf8");
const [html, css, js, runtime, workflow, releaseFallback] = await Promise.all([read("site/index.html"), read("site/styles.css"), read("site/app.js"), read("scripts/verify-site-runtime.mjs"), read(".github/workflows/windows-release.yml"), read("site/release.json")]);
const surface = `${html}\n${css}\n${js}`;
const absoluteUrls = Array.from(surface.matchAll(/https?:\/\/[^"'\s)]+/g), match => match[0]);
const docReferences = Array.from(new Set(Array.from(js.matchAll(/"(\.\.\/docs\/[^"']+\.md)"/g), match => match[1])));
const dimSumFiles = Array.from(new Set(Array.from(js.matchAll(/["'](hk-dish-\d{4}-[a-z0-9-]+\.png)["']/g), match => match[1])));
const targetsExist = async (references, resolveReference) => (await Promise.all(references.map(async reference => {
  try {
    await access(resolveReference(reference));
    return true;
  } catch {
    return false;
  }
}))).every(Boolean);
const publishedFixture = {
  schemaVersion: 1,
  published: true,
  version: "0.42.3",
  releaseDate: "2026-08-01",
  codeName: "Classic Har Gow · 蝦餃",
  photoFile: "hk-dish-0001-classic-har-gow.png",
  tag: "v0.42.3",
  releaseUrl: "https://github.com/Ding-Ding-Projects/material-email/releases/tag/v0.42.3",
};
const temporaryRoot = await mkdtemp(path.join(tmpdir(), "material-email-pages-"));
let developmentArtifact;
let publishedArtifact;
try {
  developmentArtifact = await assembleSiteArtifact({ outputDirectory: path.join(temporaryRoot, "development"), releaseMetadata: developmentReleaseMetadata });
  publishedArtifact = await assembleSiteArtifact({ outputDirectory: path.join(temporaryRoot, "published"), releaseMetadata: publishedFixture });
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
const checks = [
  ["local content-security policy", html.includes("Content-Security-Policy") && html.includes("default-src 'self'") && html.includes("connect-src 'self'") && html.includes("object-src 'none'")],
  ["browser-style tab semantics", /role=["']tablist["']/.test(surface) && /role=["']tab["']/.test(surface)],
  ["live tabpanel relationships", js.includes('aria-labelledby="tab-') && js.includes("inactivePanelsHtml")],
  ["language modes", surface.includes("English") && surface.includes("廣東話") && surface.includes('value="bilingual"')],
  ["independent humor controls", /funny.*english/i.test(surface) && /funny.*cantonese/i.test(surface)],
  ["bounded regex builder", /regex/i.test(surface) && /2[,_]?048/.test(surface)],
  ["theme and density controls", /theme/i.test(surface) && /density/i.test(surface)],
  ["reduced motion", css.includes("prefers-reduced-motion")],
  ["visible focus", css.includes(":focus-visible")],
  ["no remote executable or visual assets", !/(?:src|href)=["']https?:|@import\s+url\(|fetch\(["']https?:/i.test(surface)],
  ["repository-subpath-safe local routing", !/(?:src|href)=["']\/(?!\/)/i.test(html) && js.includes('new URL("./release.json", import.meta.url)') && js.includes('new URL("./assets/dim-sum/"+file,import.meta.url)')],
  ["no analytics", !/google-analytics|googletagmanager|segment\.com|mixpanel|posthog/i.test(surface)],
  ["official LibreOffice/core is the only absolute source URL", absoluteUrls.length === 1 && absoluteUrls[0] === "https://github.com/LibreOffice/core/blob/"],
  ["all source documentation links map into the Pages bundle", docReferences.length >= 20 && js.includes('doc:doc.replace(/^\\.\\.\\/docs\\//,"./docs/")') && await targetsExist(docReferences, reference => path.resolve("site", reference))],
  ["ten unique tracked dim-sum paths resolve inside site", dimSumFiles.length === 10 && !js.includes("../src/renderer/assets") && await targetsExist(dimSumFiles, file => path.resolve("site/assets/dim-sum", file))],
  ["truthful development release fallback", JSON.stringify(JSON.parse(releaseFallback)) === JSON.stringify(developmentReleaseMetadata)],
  ["exact development Pages artifact", developmentArtifact.fileCount >= 45 && developmentArtifact.markdownCount >= 31 && !developmentArtifact.releaseMetadata.published],
  ["exact published Pages artifact", publishedArtifact.fileCount >= 45 && publishedArtifact.markdownCount >= 31 && publishedArtifact.releaseMetadata.published && publishedArtifact.releaseMetadata.version === publishedFixture.version],
  ["Pages job assembles rather than uploading raw site", workflow.includes("node scripts/verify-site-artifact.mjs") && workflow.includes("MATERIAL_EMAIL_SITE_PHOTO_FILE") && workflow.includes("path: ${{ runner.temp }}/material-email-pages") && !/path:\s*site\s*$/m.test(workflow)],
  ["standalone real-browser runtime harness", runtime.includes('createServer') && runtime.includes('from "@playwright/test"') && runtime.includes("published metadata, bundled release assets, and exact Pages routes") && runtime.includes("reduced-motion rendering path") && runtime.includes("deterministic local-only dim-sum surprise asset")],
  ["PIM lock evidence is current", js.includes("cross-instance/process lock") && js.includes("Four focused PIM test files with 25 tests") && !js.includes("Cross-process locking, migrations")],
];

const walk = async directory => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const resolved = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(resolved)));
    else if (entry.name.endsWith(".md")) files.push(resolved);
  }
  return files;
};

const articles = (await walk("docs")).filter(file => path.basename(file).toLowerCase() !== "readme.md");
checks.push(["categorized feature articles", articles.length >= 20]);
for (const article of articles) {
  const source = await read(article);
  checks.push([`${article} suggested articles`, /suggested articles/i.test(source)]);
}

let failed = false;
for (const [name, passed] of checks) {
  console.log(`${passed ? "PASS" : "FAIL"} ${name}`);
  if (!passed) failed = true;
}
if (failed) process.exitCode = 1;
else console.log(`PASS ${articles.length} detailed feature articles and the self-contained landing site`);
