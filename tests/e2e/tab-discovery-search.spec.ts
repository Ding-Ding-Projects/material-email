import { _electron as electron, expect, test, type ElectronApplication, type Locator, type Page } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SURFACE_TONE_COPY } from "../../src/renderer/lib/localization";

test.setTimeout(90_000);

let application: ElectronApplication;
let page: Page;
let userData: string;

const launch = async (): Promise<void> => {
  application = await electron.launch({
    args: [path.resolve(".")],
    env: { ...process.env, MATERIAL_EMAIL_USER_DATA_DIR: userData, MATERIAL_EMAIL_HEADLESS: "1" },
  });
  page = await application.firstWindow();
  await page.waitForLoadState("domcontentloaded");
};

const ensureDemo = async (): Promise<void> => {
  await page.locator('[data-testid="onboarding"], [data-testid="app-shell"]').first().waitFor({ state: "visible" });
  if (await page.getByTestId("onboarding").isVisible()) await page.getByTestId("demo-action").click();
  await expect(page.getByTestId("app-shell")).toBeVisible();
};

const setFunnyLevel = async (name: "funnyEnglish" | "funnyCantonese", value: 1 | 5): Promise<void> => {
  await page.locator(`input[data-pref="${name}"]`).evaluate((node, nextValue) => {
    const input = node as HTMLInputElement;
    input.value = String(nextValue);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
};

const openTabManager = async (): Promise<Locator> => {
  await page.locator('.tab-overflow-button[data-action="toggle-tab-manager"]').click();
  const manager = page.locator(".tab-manager");
  await expect(manager).toBeVisible();
  return manager;
};

const setFlag = async (builder: Locator, key: string, flag: string, checked: boolean): Promise<void> => {
  const control = builder.locator(`input[data-regex-flag="${key}"][value="${flag}"]`);
  if (checked) await control.check();
  else await control.uncheck();
};

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(os.tmpdir(), "material-email-tab-discovery-search-e2e-"));
  await launch();
});

test.afterAll(async () => {
  await application?.close();
  await rm(userData, { recursive: true, force: true });
});

test("restores every tab-discovery search and keeps empty-state and builder focus semantics", async () => {
  await ensureDemo();
  await page.locator('[role="tab"][data-tab-id="settings"]').click();
  await expect(page.getByTestId("settings-page")).toBeVisible();
  await setFunnyLevel("funnyEnglish", 1);
  await setFunnyLevel("funnyCantonese", 5);
  await page.locator('select[data-pref="language"]').selectOption("bilingual");

  let manager = await openTabManager();
  const current = manager.locator('[data-search-anchor="tabs-current"]');
  await current.locator('[data-action="toggle-regex-builder"]').click();
  let builder = current.getByTestId("regex-popover");
  await builder.locator('[data-action="set-regex-mode"][data-mode="regex"]').click();
  await setFlag(builder, "tabs-current", "i", false);
  await setFlag(builder, "tabs-current", "m", true);
  await setFlag(builder, "tabs-current", "u", true);
  await builder.locator('textarea[data-regex-pattern="tabs-current"]').fill("^Definitely absent open tab$");
  await builder.locator('textarea[data-regex-sample="tabs-current"]').fill("This sample must reset");
  await builder.locator('[data-action="close-regex-builder"]').click();
  await expect(current.locator('input[data-search-key="tabs-current"]')).toBeFocused();

  const group = manager.locator('[data-search-anchor="tabs-group"]');
  await group.locator('input[data-search-key="tabs-group"]').fill("Definitely absent group tab");

  const groups = manager.locator('[data-search-anchor="tab-groups"]');
  await groups.locator('[data-action="toggle-regex-builder"]').click();
  builder = groups.getByTestId("regex-popover");
  await builder.locator('[data-action="set-regex-mode"][data-mode="regex"]').click();
  await setFlag(builder, "tab-groups", "s", true);
  await builder.locator('textarea[data-regex-pattern="tab-groups"]').fill("^Definitely absent group name$");
  await builder.locator('[data-action="use-regex"]').click();

  const master = manager.locator('[data-search-anchor="tabs-master"]');
  await master.locator('[data-action="toggle-regex-builder"]').click();
  builder = master.getByTestId("regex-popover");
  await builder.locator('[data-action="set-regex-mode"][data-mode="regex"]').click();
  await builder.locator('textarea[data-regex-pattern="tabs-master"]').fill("[");
  await expect(master.locator(".field-error")).toBeVisible();
  await expect(manager.getByTestId("tab-search-empty-tabs-master")).toHaveCount(0);
  await builder.locator('textarea[data-regex-pattern="tabs-master"]').fill("^Definitely absent app tab$");
  await page.keyboard.press("Escape");
  await expect(manager).toBeVisible();
  await expect(master.locator('input[data-search-key="tabs-master"]')).toBeFocused();

  for (const [key, name] of [
    ["tabs-current", /No matching open tabs/i],
    ["tabs-group", /No matching tabs in this group/i],
    ["tab-groups", /No matching tab groups/i],
    ["tabs-master", /No matching app tabs/i],
  ] as const) {
    const empty = manager.getByTestId(`tab-search-empty-${key}`);
    await expect(empty).toHaveRole("status");
    await expect(empty).toHaveAccessibleName(name);
    await expect(empty.locator('p span[lang="en"]')).toHaveText(SURFACE_TONE_COPY.tabDiscoveryNoMatch.english[0]!);
    await expect(empty.locator('p span[lang="zh-HK"]')).toHaveText(SURFACE_TONE_COPY.tabDiscoveryNoMatch.cantonese[4]!);
  }
  await manager.getByTestId("tab-search-empty-tabs-group").getByRole("button", { name: /^Edit this tab search/i }).click();
  await expect(group.locator('input[data-search-key="tabs-group"]')).toBeFocused();

  await application.close();
  await launch();
  await ensureDemo();
  manager = await openTabManager();

  await expect(manager.locator('input[data-search-key="tabs-current"]')).toHaveValue("^Definitely absent open tab$");
  await expect(manager.locator('input[data-search-key="tabs-group"]')).toHaveValue("Definitely absent group tab");
  await expect(manager.locator('input[data-search-key="tab-groups"]')).toHaveValue("^Definitely absent group name$");
  await expect(manager.locator('input[data-search-key="tabs-master"]')).toHaveValue("^Definitely absent app tab$");

  const restoredCurrent = manager.locator('[data-search-anchor="tabs-current"]');
  await restoredCurrent.locator('[data-action="toggle-regex-builder"]').click();
  builder = restoredCurrent.getByTestId("regex-popover");
  await expect(builder.locator('[data-action="set-regex-mode"][data-mode="regex"]')).toHaveAttribute("aria-pressed", "true");
  await expect(builder.locator('input[data-regex-flag="tabs-current"][value="i"]')).not.toBeChecked();
  await expect(builder.locator('input[data-regex-flag="tabs-current"][value="m"]')).toBeChecked();
  await expect(builder.locator('input[data-regex-flag="tabs-current"][value="u"]')).toBeChecked();
  await expect(builder.locator('textarea[data-regex-sample="tabs-current"]')).not.toHaveValue("This sample must reset");
  await page.keyboard.press("Escape");
  await expect(restoredCurrent.locator('input[data-search-key="tabs-current"]')).toBeFocused();

  const restoredGroups = manager.locator('[data-search-anchor="tab-groups"]');
  await restoredGroups.locator('[data-action="toggle-regex-builder"]').click();
  builder = restoredGroups.getByTestId("regex-popover");
  await expect(builder.locator('[data-action="set-regex-mode"][data-mode="regex"]')).toHaveAttribute("aria-pressed", "true");
  await expect(builder.locator('input[data-regex-flag="tab-groups"][value="s"]')).toBeChecked();
  await builder.locator('[data-action="close-regex-builder"]').click();
  await expect(restoredGroups.locator('input[data-search-key="tab-groups"]')).toBeFocused();
});
