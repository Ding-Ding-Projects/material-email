import assert from "node:assert/strict";
import { createServer } from "node:http";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { assembleSiteArtifact, developmentReleaseMetadata } from "./verify-site-artifact.mjs";

const repositoryRoot = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const outputDirectory = path.join(repositoryRoot, "test-results", "site-runtime");
const stagingDirectory = await mkdtemp(path.join(tmpdir(), "material-email-site-runtime-"));
const artifactDirectory = path.join(stagingDirectory, "artifacts");
const developmentArtifact = path.join(artifactDirectory, "development");
const publishedArtifact = path.join(artifactDirectory, "published");
const exhaustedCatalogArtifact = path.join(artifactDirectory, "published-without-dish");
const preferenceKey = "material-email.docs.preferences.v1";
const firstVisitKey = "material-email.docs.first-visit.v1";
const publishedRelease = Object.freeze({
  schemaVersion: 1,
  published: true,
  version: "0.42.3",
  releaseDate: "2026-08-01",
  codeName: "Classic Har Gow · 蝦餃",
  photoFile: "hk-dish-0001-classic-har-gow.png",
  tag: "v0.42.3",
  releaseUrl: "https://github.com/Ding-Ding-Projects/material-email/releases/tag/v0.42.3",
});
const exhaustedCatalogRelease = Object.freeze({
  schemaVersion: 1,
  published: true,
  version: "0.43.1",
  releaseDate: "2026-08-01",
  codeName: null,
  photoFile: null,
  tag: "v0.43.1",
  releaseUrl: "https://github.com/Ding-Ding-Projects/material-email/releases/tag/v0.43.1",
});
const screenshotPaths = {
  development: path.join(outputDirectory, "development-home.png"),
  light: path.join(outputDirectory, "published-light-home.png"),
  dark: path.join(outputDirectory, "published-dark-documentation.png"),
  narrow: path.join(outputDirectory, "published-narrow-home.png"),
};
const stagedScreenshotPaths = Object.fromEntries(Object.entries(screenshotPaths).map(([name, file]) => [name, path.join(stagingDirectory, path.basename(file))]));

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".md", "text/markdown; charset=utf-8"],
  [".png", "image/png"],
]);

const createSiteServer = mounts => {
  const server = createServer(async (request, response) => {
    try {
      if (request.method !== "GET" && request.method !== "HEAD") {
        response.writeHead(405, { Allow: "GET, HEAD" }).end();
        return;
      }

      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
      const segments = decodeURIComponent(requestUrl.pathname).split("/").filter(Boolean);
      const mount = mounts.get(segments.shift());
      if (!mount) {
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
        return;
      }
      const mountRoot = path.resolve(mount);
      const relativePath = segments.length ? segments.join(path.sep) : "index.html";
      const resolved = path.resolve(mountRoot, relativePath);
      const mountPrefix = mountRoot.endsWith(path.sep) ? mountRoot : `${mountRoot}${path.sep}`;
      if (!resolved.startsWith(mountPrefix)) {
        response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" }).end("Forbidden");
        return;
      }

      const fileStats = await stat(resolved);
      if (!fileStats.isFile()) {
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
        return;
      }

      const body = await readFile(resolved);
      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Length": String(body.length),
        "Content-Type": contentTypes.get(path.extname(resolved).toLowerCase()) ?? "application/octet-stream",
        "X-Content-Type-Options": "nosniff",
      });
      response.end(request.method === "HEAD" ? undefined : body);
    } catch (error) {
      const statusCode = error && typeof error === "object" && "code" in error && error.code === "ENOENT" ? 404 : 500;
      response.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8" }).end(statusCode === 404 ? "Not found" : "Server error");
    }
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("The loopback server did not expose a TCP port."));
        return;
      }
      resolve({ server, origin: `http://127.0.0.1:${address.port}` });
    });
  });
};

const closeServer = async server => {
  server.closeIdleConnections?.();
  server.closeAllConnections?.();
  await new Promise(resolve => server.close(resolve));
};

const launchBrowser = async () => {
  const candidates = [
    ["Playwright Chromium", {}],
    ["Microsoft Edge", { channel: "msedge" }],
    ["Google Chrome", { channel: "chrome" }],
  ];
  const failures = [];
  for (const [label, options] of candidates) {
    try {
      const browser = await chromium.launch({ headless: true, ...options });
      return { browser, label };
    } catch (error) {
      failures.push(`${label}: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
    }
  }
  throw new Error(`No supported Chromium runtime could launch headlessly. ${failures.join(" | ")}`);
};

const observePage = (page, expectedOrigin) => {
  const observation = { consoleErrors: [], externalRequests: [], failedRequests: [] };
  page.on("console", message => {
    if (message.type() === "error") observation.consoleErrors.push(message.text());
  });
  page.on("pageerror", error => observation.consoleErrors.push(error.message));
  page.on("request", request => {
    const requestUrl = new URL(request.url());
    if ((requestUrl.protocol === "http:" || requestUrl.protocol === "https:") && requestUrl.origin !== expectedOrigin) {
      observation.externalRequests.push(request.url());
    }
  });
  page.on("requestfailed", request => observation.failedRequests.push(`${request.url()} (${request.failure()?.errorText ?? "unknown"})`));
  return observation;
};

const waitForSite = async page => {
  await page.locator('#app[aria-busy="false"]').waitFor({ state: "attached" });
  await page.locator('[role="tabpanel"]:not([hidden])').waitFor({ state: "visible" });
};

const setRange = async (page, preference, value) => {
  await page.locator(`[data-pref="${preference}"]`).evaluate((element, nextValue) => {
    element.value = String(nextValue);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
  await page.waitForFunction(({ key, expected }) => {
    const stored = JSON.parse(localStorage.getItem("material-email.docs.preferences.v1") ?? "{}");
    return stored[key] === expected;
  }, { key: preference, expected: value });
};

const resetViewport = async page => {
  await page.evaluate(() => {
    document.activeElement?.blur();
    const previousBehavior = document.documentElement.style.scrollBehavior;
    document.documentElement.style.scrollBehavior = "auto";
    scrollTo(0, 0);
    document.documentElement.style.scrollBehavior = previousBehavior;
  });
  await page.waitForFunction(() => scrollY === 0);
};

const assertCleanObservation = observation => {
  assert.deepEqual(observation.externalRequests, [], `Unexpected non-loopback requests: ${observation.externalRequests.join(", ")}`);
  assert.deepEqual(observation.failedRequests, [], `Failed browser requests: ${observation.failedRequests.join(", ")}`);
  assert.deepEqual(observation.consoleErrors, [], `Browser console/page errors: ${observation.consoleErrors.join(" | ")}`);
};

const checks = [];
const check = async (name, callback) => {
  try {
    await callback();
    checks.push(name);
    console.log(`PASS ${name}`);
  } catch (error) {
    if (error instanceof Error) error.message = `${name}: ${error.message}`;
    throw error;
  }
};

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });
await assembleSiteArtifact({ outputDirectory: developmentArtifact, releaseMetadata: developmentReleaseMetadata });
await assembleSiteArtifact({ outputDirectory: publishedArtifact, releaseMetadata: publishedRelease });
await assembleSiteArtifact({ outputDirectory: exhaustedCatalogArtifact, releaseMetadata: exhaustedCatalogRelease });

const { server, origin } = await createSiteServer(new Map([["development", developmentArtifact], ["published", publishedArtifact], ["published-without-dish", exhaustedCatalogArtifact]]));
let browser;
let browserLabel = "";
let failure;

try {
  ({ browser, label: browserLabel } = await launchBrowser());
  const pageUrl = `${origin}/development/`;
  const publishedPageUrl = `${origin}/published/`;
  const exhaustedCatalogPageUrl = `${origin}/published-without-dish/`;
  const context = await browser.newContext({
    colorScheme: "light",
    locale: "en-CA",
    reducedMotion: "no-preference",
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  const observation = observePage(page, origin);

  await check("loopback server, CSP, and local executable assets", async () => {
    const navigation = await page.goto(pageUrl, { waitUntil: "networkidle" });
    assert.equal(navigation?.status(), 200);
    await waitForSite(page);
    const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute("content");
    assert.ok(csp);
    for (const directive of ["default-src 'self'", "script-src 'self'", "style-src 'self'", "img-src 'self' data:", "connect-src 'self'", "object-src 'none'", "frame-src 'none'"]) {
      assert.ok(csp.includes(directive), `Missing CSP directive: ${directive}`);
    }
    const resources = await page.evaluate(() => performance.getEntriesByType("resource").map(entry => entry.name));
    assert.ok(resources.some(resource => resource.endsWith("/development/app.js")), "app.js did not load from the assembled artifact.");
    assert.ok(resources.some(resource => resource.endsWith("/development/styles.css")), "styles.css did not load from the assembled artifact.");
    assert.ok(resources.some(resource => resource.endsWith("/development/release.json")), "release.json did not load from the assembled artifact.");
    assert.ok(resources.every(resource => new URL(resource).origin === origin), "A loaded resource was not loopback-local.");
    assert.equal(await page.evaluate(() => Array.from(document.styleSheets).some(sheet => sheet.href?.endsWith("/development/styles.css"))), true);
    assert.match((await page.locator(".top-app-bar .status-chip").textContent()) ?? "", /Unreleased/);
    assert.equal(await page.locator(".release-summary").count(), 0);
    assert.match((await page.locator("#panel-home").textContent()) ?? "", /No published release or downloadable installer yet/);
  });

  await check("tablist relationships and pinned visual keyboard order", async () => {
    const tabIds = await page.locator('[role="tab"]').evaluateAll(elements => elements.map(element => element.id));
    assert.deepEqual(tabIds, ["tab-home", "tab-docs", "tab-features", "tab-source", "tab-status", "tab-settings"]);
    const relationships = await page.evaluate(() => Array.from(document.querySelectorAll('[role="tab"]')).map(tab => {
      const controls = tab.getAttribute("aria-controls");
      const panel = controls ? document.getElementById(controls) : null;
      return { controls, hasPanel: Boolean(panel), selected: tab.getAttribute("aria-selected"), panelHidden: panel?.hidden };
    }));
    assert.ok(relationships.every(item => item.controls && item.hasPanel), "Every tab must reference a live panel.");
    assert.equal(relationships.filter(item => item.selected === "true").length, 1);
    assert.equal(relationships.filter(item => item.panelHidden === false).length, 1);
    await page.locator("#tab-home").focus();
    await page.keyboard.press("ArrowRight");
    await page.waitForFunction(() => document.activeElement?.id === "tab-docs");
    assert.equal(await page.locator("#tab-docs").getAttribute("aria-selected"), "true");
    assert.equal(await page.locator("#panel-docs").isVisible(), true);
    await page.keyboard.press("ArrowLeft");
    await page.waitForFunction(() => document.activeElement?.id === "tab-home");
  });

  await check("documentation article selection and local Markdown target", async () => {
    await page.locator("#tab-docs").click();
    await page.locator('.docs-results [data-article="calendar"]').click();
    assert.equal((await page.locator(".article h1").textContent())?.trim(), "Calendars and events");
    const articleHref = await page.locator(".article-header a").getAttribute("href");
    assert.ok(articleHref?.startsWith("./docs/"));
    const articleResponse = await fetch(new URL(articleHref, page.url()));
    assert.equal(articleResponse.status, 200);
    assert.match(articleResponse.headers.get("content-type") ?? "", /^text\/markdown/);
  });

  await check("plain search typing, matching, and honest no-result state", async () => {
    const search = page.locator("[data-search]");
    await search.fill("");
    await search.focus();
    await page.keyboard.type("Calendar");
    assert.equal(await page.locator("[data-search]").inputValue(), "Calendar", "Typing must preserve character order across rerenders.");
    assert.ok(await page.locator(".docs-results .doc-result").count() >= 1);
    assert.match((await page.locator(".docs-results").textContent()) ?? "", /Calendars and events/);
    await page.locator("[data-search]").fill("definitely-no-such-material-email-article");
    assert.equal(await page.locator(".docs-results .doc-result").count(), 0);
    assert.equal(await page.locator(".empty-state").isVisible(), true);
    assert.match((await page.locator(".empty-state").textContent()) ?? "", /No matching articles/);
    assert.equal(await page.locator(".article").count(), 0, "A stale article must not remain beside zero results.");
  });

  await check("bounded regex search, captures, invalid input, and focus return", async () => {
    await page.locator("[data-search]").fill("");
    await page.locator('[data-action="regex"]').click();
    await page.locator('[data-action="mode"][data-mode="regex"]').click();
    await page.locator("[data-pattern]").fill("^(Calendars|Tasks)");
    assert.equal(await page.locator(".docs-results .doc-result").count(), 2);
    assert.match((await page.locator(".regex-builder").textContent()) ?? "", /Valid JavaScript regular expression/);
    await page.locator("[data-sample]").fill("Calendars\nTasks");
    await page.locator('[data-flag][value="m"]').check();
    assert.match((await page.locator(".match-preview").textContent()) ?? "", /Calendars/);
    assert.match((await page.locator(".match-preview").textContent()) ?? "", /Tasks/);
    await page.locator("[data-pattern]").fill("(");
    assert.equal(await page.locator(".docs-results .doc-result").count(), 0);
    assert.equal(await page.locator(".empty-state").isVisible(), true);
    assert.match((await page.locator(".empty-state").textContent()) ?? "", /expression needs attention/i);
    assert.equal(await page.locator('[data-action="apply"]').isDisabled(), true);
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => document.activeElement?.matches("[data-search]") && !document.querySelector(".regex-builder"));
  });

  await check("English, Cantonese, bilingual, and independent humor levels", async () => {
    await page.locator("#tab-settings").click();
    await page.locator('[data-pref="language"]').selectOption("en");
    assert.equal(await page.locator("html").getAttribute("lang"), "en");
    await page.locator('[data-pref="language"]').selectOption("yue");
    assert.equal(await page.locator("html").getAttribute("lang"), "zh-HK");
    assert.match((await page.locator(".brand-copy strong").textContent()) ?? "", /Material Email 文件/);
    await page.locator('[data-pref="language"]').selectOption("bilingual");
    assert.equal(await page.locator("html").getAttribute("lang"), "en");
    assert.match((await page.locator(".brand-copy strong").textContent()) ?? "", /documentation · Material Email 文件/);
    await setRange(page, "funnyEnglish", 1);
    await setRange(page, "funnyCantonese", 5);
    await page.locator("#tab-home").click();
    assert.equal((await page.locator(".hero p:not(.eyebrow)").textContent())?.trim(), "An honest map of an early Windows email client. · 未剪綵，工具箱已經叮叮噹噹咁努力。");
    await page.locator("#tab-settings").click();
    await setRange(page, "funnyEnglish", 5);
    await page.locator("#tab-home").click();
    assert.equal((await page.locator(".hero p:not(.eyebrow)").textContent())?.trim(), "No ribbon cutting yet; the toolbox is still making cheerful clanking noises. · 未剪綵，工具箱已經叮叮噹噹咁努力。");
    const stored = await page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? "{}"), preferenceKey);
    assert.equal(stored.funnyEnglish, 5);
    assert.equal(stored.funnyCantonese, 5);
  });

  await check("theme and density persistence across reload", async () => {
    await page.locator("#tab-settings").click();
    await page.locator('[data-pref="theme"]').selectOption("dark");
    await page.locator('[data-pref="density"]').selectOption("compact");
    await page.reload({ waitUntil: "networkidle" });
    await waitForSite(page);
    assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
    assert.equal(await page.locator("html").getAttribute("data-density"), "compact");
    await page.locator("#tab-settings").click();
    assert.equal(await page.locator('[data-pref="theme"]').inputValue(), "dark");
    assert.equal(await page.locator('[data-pref="density"]').inputValue(), "compact");
  });

  await check("official LibreOffice/core source-map links only", async () => {
    await page.locator("#tab-source").click();
    const links = await page.locator(".source-table a").evaluateAll(elements => elements.map(element => element.href));
    assert.equal(links.length, 5);
    for (const link of links) {
      const parsed = new URL(link);
      assert.equal(parsed.protocol, "https:");
      assert.equal(parsed.hostname, "github.com");
      assert.match(parsed.pathname, /^\/LibreOffice\/core\/blob\/[0-9a-f]{40}\//);
    }
  });

  await check("truthful development fallback screenshot", async () => {
    await page.locator("#tab-settings").click();
    await page.locator('[data-pref="language"]').selectOption("en");
    await page.locator('[data-pref="theme"]').selectOption("light");
    await page.locator('[data-pref="density"]').selectOption("comfortable");
    await page.locator("#tab-home").click();
    await resetViewport(page);
    await page.screenshot({ path: stagedScreenshotPaths.development, fullPage: true });
  });

  await check("narrow bilingual layout and anchored regex builder", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator("#tab-settings").click();
    await page.locator('[data-pref="language"]').selectOption("bilingual");
    await page.locator('[data-pref="density"]').selectOption("compact");
    await page.locator("#tab-docs").click();
    await page.locator("[data-search]").fill("PIM");
    await page.locator('[data-action="regex"]').click();
    const builderBox = await page.locator(".regex-builder").boundingBox();
    const layout = await page.evaluate(() => ({
      anchor: document.querySelector(".search-anchor")?.getBoundingClientRect().toJSON(),
      bodyWidth: document.body.scrollWidth,
      documentWidth: document.documentElement.scrollWidth,
      docsLayout: document.querySelector(".docs-layout")?.getBoundingClientRect().toJSON(),
      docsLayoutColumns: getComputedStyle(document.querySelector(".docs-layout")).gridTemplateColumns,
      widest: Array.from(document.querySelectorAll("body *")).map(element => ({
        className: element.className,
        id: element.id,
        scrollWidth: element.scrollWidth,
        tag: element.tagName,
        width: element.getBoundingClientRect().width,
      })).filter(item => item.width > innerWidth || item.scrollWidth > innerWidth).sort((left, right) => Math.max(right.width, right.scrollWidth) - Math.max(left.width, left.scrollWidth)).slice(0, 12),
      page: document.querySelector(".page")?.getBoundingClientRect().toJSON(),
      scrollX,
      viewportWidth: innerWidth,
    }));
    assert.ok(builderBox);
    assert.ok(builderBox.x >= 0 && builderBox.x + builderBox.width <= 390.5, `Regex builder overflowed: ${JSON.stringify({ builderBox, layout })}`);
    assert.ok(layout.documentWidth <= layout.viewportWidth, `Document width ${layout.documentWidth} exceeded ${layout.viewportWidth}.`);
    assert.equal(await page.locator(".brand-copy").isVisible(), false, "The narrow app bar should use its fully named brand icon instead of truncating copy.");
    assert.equal(await page.locator(".tab-main").evaluateAll(elements => elements.every(element => element.scrollWidth <= element.clientWidth)), true, "A narrow tab label was ellipsized or clipped.");
    const builderOwnsLowerViewport = await page.locator(".regex-builder").evaluate(element => {
      const bounds = element.getBoundingClientRect();
      const x = Math.max(0, Math.min(innerWidth - 1, bounds.left + 12));
      const y = Math.max(0, Math.min(innerHeight - 12, bounds.bottom - 12));
      return Boolean(document.elementFromPoint(x, y)?.closest(".regex-builder"));
    });
    assert.equal(builderOwnsLowerViewport, true, "The narrow builder was clipped by its documentation sidebar.");
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => document.activeElement?.matches("[data-search]"));
    await page.locator('[data-action="regex"]').click();
  });

  assertCleanObservation(observation);
  await context.close();

  await check("published metadata, bundled release assets, and exact Pages routes", async () => {
    const publishedContext = await browser.newContext({ colorScheme: "light", locale: "en-CA", viewport: { width: 1440, height: 1000 } });
    const publishedPage = await publishedContext.newPage();
    const publishedObservation = observePage(publishedPage, origin);
    const navigation = await publishedPage.goto(publishedPageUrl, { waitUntil: "networkidle" });
    assert.equal(navigation?.status(), 200);
    await waitForSite(publishedPage);

    assert.equal(await publishedPage.locator(".top-app-bar .status-chip").getAttribute("data-status"), "released");
    assert.match((await publishedPage.locator(".top-app-bar .status-chip").textContent()) ?? "", /Released 0\.42\.3/);
    const releaseSummary = publishedPage.locator(".release-summary");
    assert.equal(await releaseSummary.isVisible(), true);
    assert.match((await releaseSummary.textContent()) ?? "", /Classic Har Gow · 蝦餃/);
    assert.match((await releaseSummary.textContent()) ?? "", /0\.42\.3/);
    assert.match((await releaseSummary.textContent()) ?? "", /2026-08-01 UTC/);
    const releaseImage = releaseSummary.locator("img");
    const releaseImageUrl = new URL(await releaseImage.getAttribute("src"));
    assert.equal(releaseImageUrl.origin, origin);
    assert.equal(releaseImageUrl.pathname, "/published/assets/dim-sum/hk-dish-0001-classic-har-gow.png");
    assert.equal(await releaseImage.getAttribute("alt"), publishedRelease.codeName);
    assert.equal(await releaseImage.evaluate(element => element.complete && element.naturalWidth > 0 && element.naturalHeight > 0), true);
    const releaseLink = publishedPage.locator('a[href="'+publishedRelease.releaseUrl+'"]');
    assert.ok(await releaseLink.count() >= 1);
    assert.doesNotMatch((await publishedPage.locator("#panel-home").textContent()) ?? "", /No release or installer yet/);

    const assetFiles = (await readdir(path.join(publishedArtifact, "assets", "dim-sum"))).filter(file => file.endsWith(".png"));
    assert.equal(assetFiles.length, 10);
    for (const assetFile of assetFiles) {
      const response = await fetch(`${origin}/published/assets/dim-sum/${assetFile}`);
      assert.equal(response.status, 200, `Published image route failed for ${assetFile}.`);
      assert.equal(response.headers.get("content-type"), "image/png");
    }

    await publishedPage.locator("#tab-features").click();
    const packagingRow = publishedPage.locator("tr", { has: publishedPage.locator('[data-article="packaging"]') });
    assert.match((await packagingRow.textContent()) ?? "", /Released/);
    await packagingRow.locator('[data-article="packaging"]').click();
    assert.match((await publishedPage.locator(".article").textContent()) ?? "", /Release 0\.42\.3 was published on 2026-08-01/);
    const articleHref = await publishedPage.locator(".article-header a").getAttribute("href");
    assert.ok(articleHref?.startsWith("./docs/"));
    const articleResponse = await fetch(new URL(articleHref, publishedPage.url()));
    assert.equal(articleResponse.status, 200);

    await publishedPage.locator("#tab-status").click();
    assert.match((await publishedPage.locator("#panel-status").textContent()) ?? "", /PUBLISHED RELEASE/);
    assert.match((await publishedPage.locator("#panel-status").textContent()) ?? "", /Release 0\.42\.3 metadata and assets verified/);

    await publishedPage.locator("#tab-home").click();
    await resetViewport(publishedPage);
    await publishedPage.screenshot({ path: stagedScreenshotPaths.light, fullPage: true });

    await publishedPage.locator("#tab-settings").click();
    await publishedPage.locator('[data-pref="language"]').selectOption("bilingual");
    await publishedPage.locator('[data-pref="theme"]').selectOption("dark");
    await publishedPage.locator("#tab-docs").click();
    await publishedPage.locator("[data-search]").fill("PIM persistence");
    await publishedPage.locator('.docs-results [data-article="pim-history"]').click();
    await resetViewport(publishedPage);
    const darkGeometry = await publishedPage.evaluate(() => ({ scrollY, skipTop: document.querySelector(".skip-link")?.getBoundingClientRect().top, topBarTop: document.querySelector(".top-app-bar")?.getBoundingClientRect().top }));
    assert.equal(darkGeometry.scrollY, 0);
    assert.equal(darkGeometry.topBarTop, 0);
    assert.ok(Number(darkGeometry.skipTop) < 0);
    await publishedPage.screenshot({ path: stagedScreenshotPaths.dark });

    await publishedPage.setViewportSize({ width: 390, height: 844 });
    await publishedPage.locator("#tab-settings").click();
    await publishedPage.locator('[data-pref="theme"]').selectOption("light");
    await publishedPage.locator('[data-pref="density"]').selectOption("compact");
    await publishedPage.locator("#tab-home").click();
    await resetViewport(publishedPage);
    const narrowLayout = await publishedPage.evaluate(() => ({ documentWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth }));
    assert.ok(narrowLayout.documentWidth <= narrowLayout.viewportWidth, `Published narrow page overflowed: ${JSON.stringify(narrowLayout)}`);
    assert.equal(await publishedPage.locator(".release-summary img").isVisible(), true);
    await publishedPage.screenshot({ path: stagedScreenshotPaths.narrow, fullPage: true });

    assertCleanObservation(publishedObservation);
    await publishedContext.close();
  });

  await check("published release remains truthful after catalog exhaustion", async () => {
    const exhaustedContext = await browser.newContext({ colorScheme: "light", locale: "en-CA", viewport: { width: 1024, height: 768 } });
    const exhaustedPage = await exhaustedContext.newPage();
    const exhaustedObservation = observePage(exhaustedPage, origin);
    const navigation = await exhaustedPage.goto(exhaustedCatalogPageUrl, { waitUntil: "networkidle" });
    assert.equal(navigation?.status(), 200);
    await waitForSite(exhaustedPage);
    const summary = exhaustedPage.locator(".release-summary");
    assert.equal(await summary.isVisible(), true);
    assert.match((await summary.textContent()) ?? "", /No code name assigned/);
    assert.match((await summary.textContent()) ?? "", /0\.43\.1/);
    assert.equal(await summary.locator("img").count(), 0, "An exhausted release must not reuse a catalog photo.");
    assert.match((await exhaustedPage.locator(".brand-copy small").textContent()) ?? "", /No code name assigned/);
    assert.match((await exhaustedPage.locator("#panel-home .notice").textContent()) ?? "", /all ten verified dish names were already used/i);
    assertCleanObservation(exhaustedObservation);
    await exhaustedContext.close();
  });

  await check("reduced-motion rendering path", async () => {
    const reducedContext = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 1024, height: 768 } });
    const reducedPage = await reducedContext.newPage();
    const reducedObservation = observePage(reducedPage, origin);
    await reducedPage.goto(pageUrl, { waitUntil: "networkidle" });
    await waitForSite(reducedPage);
    assert.equal(await reducedPage.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches), true);
    assert.equal(await reducedPage.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior), "auto");
    assertCleanObservation(reducedObservation);
    await reducedContext.close();
  });

  await check("deterministic local-only dim-sum surprise asset", async () => {
    const dimSumContext = await browser.newContext({ viewport: { width: 1024, height: 768 } });
    await dimSumContext.addInitScript(({ preferenceStorageKey, seenStorageKey }) => {
      localStorage.setItem(seenStorageKey, "seen");
      localStorage.setItem(preferenceStorageKey, JSON.stringify({
        accent: "#6750a4",
        density: "comfortable",
        dimSumEnabled: true,
        funnyCantonese: 3,
        funnyEnglish: 2,
        language: "en",
        theme: "light",
      }));
      Object.defineProperty(Crypto.prototype, "getRandomValues", {
        configurable: true,
        value(array) {
          array.fill(0);
          return array;
        },
      });
    }, { preferenceStorageKey: preferenceKey, seenStorageKey: firstVisitKey });
    const dimSumPage = await dimSumContext.newPage();
    const dimSumObservation = observePage(dimSumPage, origin);
    await dimSumPage.goto(pageUrl, { waitUntil: "networkidle" });
    await waitForSite(dimSumPage);
    const image = dimSumPage.locator(".toast img");
    await image.waitFor({ state: "visible" });
    const imageUrl = new URL(await image.getAttribute("src"));
    assert.equal(imageUrl.origin, origin);
    assert.match(imageUrl.pathname, /^\/development\/assets\/dim-sum\/hk-dish-0001-classic-har-gow\.png$/);
    assert.equal(await image.getAttribute("alt"), "Classic Har Gow · 蝦餃");
    assert.equal(await image.evaluate(element => element.complete && element.naturalWidth > 0 && element.naturalHeight > 0), true);
    assert.equal(await dimSumPage.evaluate(() => Boolean(document.activeElement?.closest(".toast"))), false, "The surprise stole focus.");
    assertCleanObservation(dimSumObservation);
    await dimSumContext.close();
  });
} catch (error) {
  failure = error;
} finally {
  const report = {
    browser: browser ? { headless: true, label: browserLabel, version: await browser.version() } : null,
    checks,
    screenshots: Object.fromEntries(Object.entries(screenshotPaths).map(([name, file]) => [name, path.relative(repositoryRoot, file).split(path.sep).join("/")])),
    status: failure ? "failed" : "passed",
  };
  if (failure) report.error = failure instanceof Error ? failure.message : String(failure);
  await browser?.close();
  await closeServer(server);
  let publicationError;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await mkdir(outputDirectory, { recursive: true });
      if (!failure) {
        for (const [name, finalPath] of Object.entries(screenshotPaths)) await copyFile(stagedScreenshotPaths[name], finalPath);
      }
      await writeFile(path.join(outputDirectory, "results.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
      if (!failure) await Promise.all(Object.values(screenshotPaths).map(file => stat(file)));
      publicationError = undefined;
      break;
    } catch (error) {
      publicationError = error;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  await rm(stagingDirectory, { recursive: true, force: true });
  if (publicationError) throw publicationError;
}

if (failure) throw failure;
console.log(`PASS ${checks.length} runtime checks in ${browserLabel}; screenshots: ${Object.values(screenshotPaths).join(", ")}`);
