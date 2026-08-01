import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
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

const openSettings = async (): Promise<void> => {
  await page.locator('[role="tab"][data-tab-id="settings"]').click();
  await expect(page.getByTestId("settings-page")).toBeVisible();
};

const setFunnyLevel = async (name: "funnyEnglish" | "funnyCantonese", value: 1 | 5): Promise<void> => {
  await page.locator(`input[data-pref="${name}"]`).evaluate((node, nextValue) => {
    const input = node as HTMLInputElement;
    input.value = String(nextValue);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
};

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(os.tmpdir(), "material-email-settings-search-e2e-"));
  await launch();
});

test.afterAll(async () => {
  await application?.close();
  await rm(userData, { recursive: true, force: true });
});

test("persists the Settings regex model and keeps no-match recovery semantic and focusable", async () => {
  await ensureDemo();
  await openSettings();
  await setFunnyLevel("funnyEnglish", 1);
  await setFunnyLevel("funnyCantonese", 5);
  await page.locator('select[data-pref="language"]').selectOption("bilingual");

  const anchor = page.locator('[data-search-anchor="settings"]');
  await anchor.locator('[data-action="toggle-regex-builder"]').click();
  let builder = page.getByTestId("regex-popover");
  await builder.locator('[data-action="set-regex-mode"][data-mode="regex"]').click();
  await builder.getByRole("checkbox", { name: /Ignore case/i }).uncheck();
  await builder.getByRole("checkbox", { name: /Multiline/i }).check();
  await builder.getByRole("checkbox", { name: /Unicode/i }).check();
  await builder.locator('textarea[data-regex-pattern="settings"]').fill("^Definitely absent setting$");
  await builder.locator('textarea[data-regex-sample="settings"]').fill("Transient sample that must not survive restart");
  await builder.getByRole("button", { name: /Use in search/i }).click();

  const noMatch = page.getByTestId("settings-search-empty");
  await expect(noMatch).toHaveRole("status");
  await expect(noMatch).toHaveAccessibleName(/No settings match/);
  await expect(noMatch.locator('p span[lang="en"]')).toHaveText(SURFACE_TONE_COPY.settingsNoMatch.english[0]!);
  await expect(noMatch.locator('p span[lang="zh-HK"]')).toHaveText(SURFACE_TONE_COPY.settingsNoMatch.cantonese[4]!);
  await noMatch.getByRole("button", { name: /^Edit settings search/i }).click();
  await expect(anchor.locator('input[data-search-key="settings"]')).toBeFocused();

  await application.close();
  await launch();
  await ensureDemo();
  await openSettings();

  const restoredAnchor = page.locator('[data-search-anchor="settings"]');
  await expect(restoredAnchor.locator('input[data-search-key="settings"]')).toHaveValue("^Definitely absent setting$");
  await expect(page.getByTestId("settings-search-empty")).toBeVisible();
  await restoredAnchor.locator('[data-action="toggle-regex-builder"]').click();
  builder = page.getByTestId("regex-popover");
  await expect(builder.locator('[data-action="set-regex-mode"][data-mode="regex"]')).toHaveAttribute("aria-pressed", "true");
  await expect(builder.getByRole("checkbox", { name: /Ignore case/i })).not.toBeChecked();
  await expect(builder.getByRole("checkbox", { name: /Multiline/i })).toBeChecked();
  await expect(builder.getByRole("checkbox", { name: /Unicode/i })).toBeChecked();
  await expect(builder.locator('textarea[data-regex-sample="settings"]')).toHaveValue(/Invoice #20261 arrived/);
  await expect(builder.locator('textarea[data-regex-sample="settings"]')).not.toHaveValue("Transient sample that must not survive restart");
});
