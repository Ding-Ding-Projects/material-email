import { _electron as electron, expect, test, type ElectronApplication, type Locator, type Page } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// This file is the one place in the suite that launches a genuinely *packaged*
// Electron build (electron-builder's Linux "dir" target: a real unpacked app
// bundle with app.asar, not `electron .` pointed at the source tree the rest
// of tests/e2e uses). `app.isPackaged` only becomes true for output shaped
// this way, so it is the proof gate for every "packaged Electron session"
// claim in ROADMAP.md/HANDOFF.md. electron-builder's "dir" target needs no
// code signing, no installer format, and no Windows host — it is the cheapest
// honest way to get a real `app.isPackaged === true` process on this Linux
// sandbox, and it packages the exact same `dist/` output `npm run dist:win`
// would ship, just without the NSIS installer wrapper this repo's `package.json`
// `build.win` config still exclusively targets.
test.setTimeout(240_000);

const packagedExecutable = path.resolve("release/linux-unpacked/material-email");
const screenshotDir = path.resolve("test-results/packaged-build-tour");

const run = (command: string, args: string[]): Promise<void> =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", shell: false, cwd: path.resolve(".") });
    child.on("error", reject);
    child.on("exit", code => (code === 0 ? resolve() : reject(new Error(`${command} ${args.join(" ")} exited with ${code}`))));
  });

let application: ElectronApplication;
let page: Page;
let userData: string;
let shotIndex = 0;

const shot = async (name: string): Promise<void> => {
  shotIndex += 1;
  await page.screenshot({ path: path.join(screenshotDir, `${String(shotIndex).padStart(2, "0")}-${name}.png`), fullPage: false });
};

// Deliberately not MATERIAL_EMAIL_HEADLESS=1 here, unlike every other spec in
// this suite: this file's whole point is real visual evidence, and a
// never-shown BrowserWindow under Xvfb can stop producing new compositor
// frames after a state change (a modal opening, a tab switching), which hangs
// page.screenshot() indefinitely waiting on a frame that never arrives. The
// real Xvfb display this sandbox has lets the packaged window actually show
// and keep painting, which is both more honest for "real screenshots" and
// more reliable.
const launchPackaged = async (extraEnv: NodeJS.ProcessEnv = {}): Promise<ElectronApplication> => {
  const instance = await electron.launch({
    executablePath: packagedExecutable,
    env: { ...process.env, MATERIAL_EMAIL_USER_DATA_DIR: userData, ...extraEnv },
  });
  return instance;
};

const ensureDemo = async (): Promise<void> => {
  await page.locator('[data-testid="onboarding"], [data-testid="app-shell"]').first().waitFor({ state: "visible" });
  if (await page.getByTestId("onboarding").isVisible()) await page.getByTestId("demo-action").click();
  await expect(page.getByTestId("app-shell")).toBeVisible();
};

const openTab = async (id: string): Promise<Locator> => {
  await page.locator(`[role="tab"][data-tab-id="${id}"]`).click();
  const surface = page.locator(`#panel-${id}`);
  await expect(surface).toBeVisible();
  return surface;
};

const setFunnyLevel = async (name: "funnyEnglish" | "funnyCantonese", value: 1 | 2 | 3 | 4 | 5): Promise<void> => {
  await page.locator(`input[data-pref="${name}"]`).evaluate((node, nextValue) => {
    const input = node as HTMLInputElement;
    input.value = String(nextValue);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
};

test.beforeAll(async ({}, testInfo) => {
  testInfo.setTimeout(240_000);
  userData = await mkdtemp(path.join(os.tmpdir(), "material-email-packaged-tour-"));
  await mkdir(screenshotDir, { recursive: true });
  // Build the renderer/main bundles, then package them with electron-builder's
  // Linux "dir" target. This is additive: package.json's `build.win` NSIS
  // config is untouched, and electron-builder needs no `build.linux` block at
  // all to honor an explicit `--linux dir` target on the command line.
  await run(process.execPath, [path.resolve("scripts/build.mjs")]);
  await run(path.resolve("node_modules/.bin/electron-builder"), ["--linux", "dir"]);
  application = await launchPackaged();
  page = await application.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await ensureDemo();
});

test.afterAll(async () => {
  await application?.close().catch(() => undefined);
  await rm(userData, { recursive: true, force: true });
});

test("runs a genuinely packaged Electron session, not the dev-mode source-tree launch every other spec uses", async () => {
  const isPackaged = await application.evaluate(({ app }) => app.isPackaged);
  expect(isPackaged).toBe(true);
  const appPath = await application.evaluate(({ app }) => app.getAppPath());
  expect(appPath.endsWith("app.asar")).toBe(true);
  const resourcesPath = await application.evaluate(() => process.resourcesPath);
  expect(appPath).toBe(path.join(resourcesPath, "app.asar"));
  await shot("packaged-onboarded-shell");

  // Packaged builds must ignore MATERIAL_EMAIL_DEV_URL entirely (renderer-trust.ts).
  // Prove it against the real packaged binary, not just the unit test: point it at
  // an address nothing is listening on and confirm the real bundled renderer still
  // loads instead of the window going blank waiting on a dev server.
  const devUrlUserData = await mkdtemp(path.join(os.tmpdir(), "material-email-packaged-devurl-"));
  const rogue = await electron.launch({
    executablePath: packagedExecutable,
    env: {
      ...process.env,
      MATERIAL_EMAIL_USER_DATA_DIR: devUrlUserData,
      MATERIAL_EMAIL_HEADLESS: "1",
      MATERIAL_EMAIL_DEV_URL: "http://127.0.0.1:1/definitely-nothing-here",
    },
  });
  try {
    const rogueIsPackaged = await rogue.evaluate(({ app }) => app.isPackaged);
    expect(rogueIsPackaged).toBe(true);
    const roguePage = await rogue.firstWindow();
    await roguePage.waitForLoadState("domcontentloaded");
    await expect(roguePage.locator('[data-testid="onboarding"], [data-testid="app-shell"]').first()).toBeVisible();
    expect(await roguePage.title()).toBe("Material Email");
  } finally {
    await rogue.close().catch(() => undefined);
    await rm(devUrlUserData, { recursive: true, force: true });
  }
});

test("exercises the major workspace surfaces in the real packaged session with real navigation", async () => {
  // Mail: search, the shared regex builder, and opening a real cached message.
  const mail = await openTab("mail");
  await expect(page.getByTestId("folder-list")).toBeVisible();
  await page.locator('[data-search-anchor="mail"] input[type="search"]').fill("checklist");
  await expect(page.getByTestId("message-list").locator(".message-row")).not.toHaveCount(0);
  await page.locator('[data-search-anchor="mail"] [data-action="clear-search"]').click();
  await page.getByTestId("message-list").locator(".message-row").first().locator(".message-row__main").click();
  await expect(page.getByTestId("reader-iframe")).toBeVisible();
  await shot("mail-reader");
  void mail;

  // Compose: open the non-modal composer over the mail surface.
  await page.locator('[data-action="compose"]').first().click();
  await expect(page.locator('[data-form="compose"]')).toBeVisible();
  await shot("compose-open");
  await page.locator('[data-action="request-close-compose"]').click();
  await expect(page.locator('[data-form="compose"]')).toHaveCount(0);

  // Drafts and Outbox.
  await openTab("drafts");
  await shot("drafts");
  await openTab("outbox");
  await shot("outbox");

  // Contacts: all three PIM sub-tabs, each with its own search field.
  const contacts = await openTab("contacts");
  await expect(contacts.getByRole("tab", { name: /^People/i })).toHaveAttribute("aria-selected", "true");
  await contacts.locator('[data-search-anchor="contacts"] input[type="search"]').fill("Alex");
  await contacts.locator('[data-search-anchor="contacts"] [data-action="clear-search"]').click();
  await shot("contacts-people");
  await contacts.getByRole("tab", { name: /^Mailing lists/i }).click();
  await expect(contacts.getByRole("tab", { name: /^Mailing lists/i })).toHaveAttribute("aria-selected", "true");
  await shot("contacts-mailing-lists");
  await contacts.getByRole("tab", { name: /^Transaction history/i }).click();
  await expect(contacts.getByRole("tab", { name: /^Transaction history/i })).toHaveAttribute("aria-selected", "true");
  await shot("contacts-history");

  // Calendar: open (and cancel) the new-event editor.
  const calendar = await openTab("calendar");
  await calendar.getByTestId("add-calendar-event").click();
  await expect(page.getByTestId("calendar-event-form")).toBeVisible();
  await shot("calendar-new-event");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("calendar-event-form")).toHaveCount(0);

  // Tasks.
  await openTab("tasks");
  await shot("tasks");

  // Settings: scroll through the major cards this task's roadmap items target.
  const settings = await openTab("settings");
  await expect(settings.locator('[data-setting-section="appearance"]')).toBeVisible();
  await settings.locator('[data-setting-section="accounts"]').scrollIntoViewIfNeeded();
  await settings.locator('[data-setting-section="identities"]').scrollIntoViewIfNeeded();
  await expect(page.getByTestId("identity-settings")).toBeVisible();
  await settings.locator('[data-setting-section="message-filters"]').scrollIntoViewIfNeeded();
  await expect(page.getByTestId("message-filter-settings")).toBeVisible();
  await shot("settings-message-filters");
  await settings.locator('[data-setting-section="pim-providers"]').scrollIntoViewIfNeeded();
  await expect(page.getByTestId("pim-provider-settings")).toBeVisible();
  await settings.locator('[data-setting-section="oauth-vault"]').scrollIntoViewIfNeeded();
  await expect(page.getByTestId("oauth-token-vault-settings")).toBeVisible();
  await settings.locator('[data-setting-section="tabs"]').scrollIntoViewIfNeeded();
  await shot("settings-tabs");

  // Appearance editor for the focused workspace tab (Ctrl+Shift+E).
  const settingsTab = page.locator('[role="tab"][data-tab-id="settings"]');
  await settingsTab.focus();
  await page.keyboard.press("Control+Shift+E");
  await expect(page.getByTestId("tab-appearance-editor")).toBeVisible();
  await shot("tab-appearance-editor");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("tab-appearance-editor")).toHaveCount(0);

  // Changelog and History, each with their own search and anchored date picker.
  const changelog = await openTab("changelog");
  await changelog.locator('[data-action="toggle-changelog-calendar"]').click();
  await expect(page.getByTestId("changelog-calendar")).toBeVisible();
  await shot("changelog-calendar");
  await page.keyboard.press("Escape");

  const history = await openTab("history");
  await history.locator('[data-action="toggle-history-calendar"]').click();
  await expect(page.getByTestId("history-calendar")).toBeVisible();
  await shot("history-calendar");
  await page.keyboard.press("Escape");

  // Notification Centre, with its own search field.
  const notifications = await openTab("notifications");
  await expect(notifications.locator('[data-search-anchor="notifications"]')).toBeVisible();
  await shot("notifications");

  // Tools: the standalone regex playground and the command palette.
  await openTab("tools");
  await expect(page.locator('[data-search-anchor="tools-regex"]')).toBeVisible();
  await shot("tools");
  await page.keyboard.press("Control+k");
  await expect(page.getByTestId("command-palette")).toBeVisible();
  await shot("command-palette");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("command-palette")).toHaveCount(0);
});

test("extends adversarial/Unicode/zero-width/multiline/capture regex proof to the message-filter and tools-regex search surfaces", async () => {
  // Message filters is a nested Settings surface with its own independent
  // search + regex builder (MESSAGE_FILTER_SEARCH_KEY) that no prior spec has
  // exercised at all. It shares the exact same bounded shared/regex.ts
  // validator as every already-verified surface (cached mail, Settings,
  // Notification Centre, PIM, Tab Manager, command palette); prove that
  // sharing holds here too instead of assuming it.
  const settings = await openTab("settings");
  await settings.locator('[data-setting-section="message-filters"]').scrollIntoViewIfNeeded();

  // The search/regex surface only renders its no-match testid once at least one
  // real filter exists (an empty list renders a distinct "No filters yet" empty
  // state instead), so create one real filter first through the actual editor.
  await page.locator('[data-action="open-message-filter-editor"]').first().click();
  const editor = page.getByTestId("message-filter-editor");
  await expect(editor).toBeVisible();
  await editor.locator('input[name="name"]').fill("Newsletter cleanup");
  await editor.locator('[data-filter-condition="0"] input[name="conditionValue"]').fill("newsletter");
  await editor.getByRole("button", { name: /Save filter/i }).click();
  await expect(editor).toHaveCount(0);
  await expect(page.getByTestId("message-filter-list")).toContainText("Newsletter cleanup");

  const filterAnchor = page.locator('[data-search-anchor="message-filters"]');
  await filterAnchor.locator('[data-action="toggle-regex-builder"]').click();
  let builder = page.getByTestId("regex-popover");
  await builder.getByRole("button", { name: /^Regular expression/i }).click();

  // Adversarial: nested-quantifier / overlapping-repetition families are rejected
  // before ever reaching RegExp, and "Use in search" stays disabled.
  await builder.locator('textarea[data-regex-pattern="message-filters"]').fill("(a|aa)+$");
  await expect(builder.locator(".validation-row")).toContainText(/overlapping repetition/i);
  await expect(builder.getByRole("button", { name: /Use in search/i })).toBeDisabled();

  await builder.locator('textarea[data-regex-pattern="message-filters"]').fill("(.*)+");
  await expect(builder.locator(".validation-row")).toContainText(/nested quantifier|overlapping repetition/i);
  await expect(builder.getByRole("button", { name: /Use in search/i })).toBeDisabled();

  // Invalid JavaScript regex syntax is reported, not silently swallowed.
  await builder.locator('textarea[data-regex-pattern="message-filters"]').fill("(unterminated");
  await expect(builder.locator(".validation-row")).toHaveClass(/is-invalid/);
  await expect(builder.getByRole("button", { name: /Use in search/i })).toBeDisabled();

  // Unicode zero-width match under the `u` flag, advanced by code point (an
  // astral emoji), matching the same fix already proven for cached mail.
  await builder.locator('textarea[data-regex-pattern="message-filters"]').fill("(?=.)");
  await builder.getByRole("checkbox", { name: "Unicode" }).check();
  await builder.locator('textarea[data-regex-sample="message-filters"]').fill("🎉");
  await expect(builder.locator(".match-results .count-pill")).toHaveText("1");
  await expect(builder.locator(".match-results")).toContainText("(zero-width)");
  await expect(builder.locator(".match-results")).toContainText("@ 0");

  // Multiline anchors plus a capture group, both surfaced in the preview.
  await builder.getByRole("checkbox", { name: /Multiline/i }).check();
  await builder.locator('textarea[data-regex-pattern="message-filters"]').fill("^(Archive) old mail$");
  await builder.locator('textarea[data-regex-sample="message-filters"]').fill("keep\nArchive old mail\nkeep");
  await expect(builder.locator(".match-results .count-pill")).toHaveText("1");
  await expect(builder.locator(".match-results")).toContainText("$1: Archive");

  // Applying a real, matching plain-text query changes the visible filter list
  // and reports the exact matching/total count, not just the builder preview.
  await builder.getByRole("button", { name: /^Plain text/i }).click();
  await builder.locator('textarea[data-regex-pattern="message-filters"]').fill("zzz-does-not-exist-zzz");
  await builder.getByRole("button", { name: /Use in search/i }).click();
  await expect(page.getByTestId("message-filter-search-empty")).toBeVisible();
  await page.getByTestId("message-filter-search-empty").getByRole("button", { name: /Edit filter search/i }).click();
  await page.locator('[data-search-anchor="message-filters"] [data-action="clear-search"]').click();

  // Tools > standalone regex playground: same validator, same rejection, same
  // zero-width/capture semantics, entirely independent of any list to filter.
  await openTab("tools");
  const toolsAnchor = page.locator('[data-search-anchor="tools-regex"]');
  await toolsAnchor.locator('[data-action="toggle-regex-builder"]').click();
  builder = page.getByTestId("regex-popover");
  await builder.getByRole("button", { name: /^Regular expression/i }).click();
  await builder.locator('textarea[data-regex-pattern="tools-regex"]').fill("(x+x+)+y");
  await expect(builder.locator(".validation-row")).toContainText(/nested quantifier/i);
  await builder.locator('textarea[data-regex-pattern="tools-regex"]').fill("(\\p{Emoji_Presentation})");
  await builder.getByRole("checkbox", { name: "Unicode" }).check();
  await builder.locator('textarea[data-regex-sample="tools-regex"]').fill("Hello 🚀 world");
  await expect(builder.locator(".match-results .count-pill")).toHaveText("1");
  await expect(builder.locator(".match-results")).toContainText("$1: 🚀");
});

test("keeps Message Filters counts and Quick Filter facet labels factually identical across English, Cantonese, and bilingual extremes", async () => {
  // Neither surface has ever had bilingual/humor real-Electron proof before
  // this task. Both are plain tx()-bilingual (not one of the eight
  // surfaceTone humor-styled surfaces already covered elsewhere), so what
  // matters here is that the *language* switch changes voice without moving
  // the underlying facts — not an additional humor-level claim neither
  // surface's copy actually varies by.
  const settings = await openTab("settings");
  await settings.locator('[data-setting-section="message-filters"]').scrollIntoViewIfNeeded();
  const status = page.getByTestId("message-filter-search-status");
  await expect(status).toBeVisible();
  const englishStatus = (await status.textContent())?.trim() ?? "";
  const filterCountMatch = /^(\d+) filters?;/.exec(englishStatus);
  expect(filterCountMatch).not.toBeNull();
  const filterCount = filterCountMatch![1];

  await setFunnyLevel("funnyEnglish", 1);
  await setFunnyLevel("funnyCantonese", 5);
  await page.locator('select[data-pref="language"]').selectOption("yue");
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-HK");
  await settings.locator('[data-setting-section="message-filters"]').scrollIntoViewIfNeeded();
  const cantoneseStatus = (await status.textContent())?.trim() ?? "";
  expect(cantoneseStatus).not.toBe(englishStatus);
  expect(cantoneseStatus).toContain(filterCount);
  expect(cantoneseStatus).toMatch(/條規則/);

  await setFunnyLevel("funnyEnglish", 5);
  await setFunnyLevel("funnyCantonese", 1);
  await page.locator('select[data-pref="language"]').selectOption("bilingual");
  await settings.locator('[data-setting-section="message-filters"]').scrollIntoViewIfNeeded();
  const bilingualStatus = (await status.textContent())?.trim() ?? "";
  expect(bilingualStatus).toContain(filterCount);
  expect(bilingualStatus).toMatch(/條規則/);
  expect(bilingualStatus).toMatch(/filters?;/);

  // Quick Filter (mail): facet chip labels and the summary line switch voice
  // the same way, and the invalid-pattern rejection reads correctly in
  // Cantonese too, not just the English string already proven in
  // tags-quick-filter.spec.ts.
  await openTab("mail");
  const quickFilter = page.getByTestId("quick-filter");
  await quickFilter.locator("[data-action='toggle-quick-filter']").click();
  await expect(quickFilter.getByText("未讀")).toBeVisible();
  await quickFilter.locator("[data-action='toggle-quick-filter-mode']").click();
  await quickFilter.locator("#quick-filter-text").fill("(a+)+$");
  await expect(quickFilter.locator("#quick-filter-summary")).toHaveClass(/is-invalid/u);
  await expect(quickFilter.locator("#quick-filter-summary")).toContainText(/要處理/u);
  await quickFilter.locator("#quick-filter-text").fill("");
  await quickFilter.locator("[data-action='clear-quick-filter']").click();

  // Leave language/humor back at their defaults for whatever runs next.
  await openTab("settings");
  await page.locator('select[data-pref="language"]').selectOption("en");
  await setFunnyLevel("funnyEnglish", 2);
  await setFunnyLevel("funnyCantonese", 3);
});
