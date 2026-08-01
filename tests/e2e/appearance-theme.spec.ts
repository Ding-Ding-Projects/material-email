import { _electron as electron, expect, test, type ElectronApplication, type Locator, type Page } from "@playwright/test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test.setTimeout(90_000);

let application: ElectronApplication;
let page: Page;
let userData: string;
let transferDirectory: string;

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

const restart = async (): Promise<void> => {
  await application.close();
  await launch();
  await expect(page.getByTestId("app-shell")).toBeVisible();
};

const openSettingsAppearance = async (): Promise<{ editor: Locator; tabContainer: Locator }> => {
  const settingsTab = page.locator('[role="tab"][data-tab-id="settings"]');
  await settingsTab.click();
  await settingsTab.focus();
  await page.keyboard.press("Control+Shift+E");
  const editor = page.getByTestId("tab-appearance-editor");
  await expect(editor).toBeVisible();
  return { editor, tabContainer: settingsTab.locator("..") };
};

const customProperty = (target: Locator, property: string): Promise<string> =>
  target.evaluate((element, name) => getComputedStyle(element).getPropertyValue(name).trim(), property);

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(os.tmpdir(), "material-email-appearance-theme-e2e-"));
  transferDirectory = await mkdtemp(path.join(os.tmpdir(), "material-email-theme-transfer-e2e-"));
  await launch();
});

test.afterAll(async () => {
  await application?.close();
  await rm(userData, { recursive: true, force: true });
  await rm(transferDirectory, { recursive: true, force: true });
});

test("persists named presets and reviews native-dialog theme transfer with bilingual independent tone", async () => {
  await ensureDemo();
  await page.locator('[role="tab"][data-tab-id="settings"]').click();
  const setRange = async (name: "funnyEnglish" | "funnyCantonese", value: number): Promise<void> => {
    await page.locator(`input[data-pref="${name}"]`).evaluate((node, next) => {
      const input = node as HTMLInputElement;
      input.value = String(next);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }, value);
  };
  await setRange("funnyEnglish", 1);
  await setRange("funnyCantonese", 5);
  await page.locator('select[data-pref="language"]').selectOption("bilingual");

  let { editor, tabContainer } = await openSettingsAppearance();
  const presets = editor.locator("[data-appearance-preset]");
  await expect(presets).toContainText("Quiet Slate");
  await expect(presets).toContainText("靜靜灰");
  await presets.selectOption("builtin:quiet-slate");
  await editor.locator('[data-action="apply-tab-appearance-preset"]').click();
  await expect.poll(() => customProperty(tabContainer, "--tab-custom-bg")).toBe("#E2E8F0");
  await expect.poll(() => customProperty(tabContainer, "--tab-custom-accent")).toBe("#475569");

  await editor.locator("[data-appearance-preset-name]").fill("Calm settings");
  await editor.locator('[data-action="save-tab-appearance-preset"]').click();
  await expect(editor.locator("[data-appearance-preset]")).toContainText("Calm settings");

  await page.keyboard.press("Escape");
  await restart();
  ({ editor, tabContainer } = await openSettingsAppearance());
  await expect(editor.locator("[data-appearance-preset]")).toContainText("Calm settings");
  await expect.poll(() => customProperty(tabContainer, "--tab-custom-bg")).toBe("#E2E8F0");

  const exportPath = path.join(transferDirectory, "calm-settings.json");
  await application.evaluate(async ({ dialog }, selectedPath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: selectedPath });
  }, exportPath);
  await editor.locator('[data-action="export-tab-appearance-theme"]').click();
  await expect(page.locator(".toast-region")).toContainText("Appearance theme exported");
  await expect(page.locator(".toast-region")).toContainText("外觀主題已匯出");
  await expect(page.locator(".toast-region")).toContainText("encore");
  const exported = await readFile(exportPath, "utf8");
  expect(exported).toContain('"format": "material-email-tab-appearance-theme"');
  expect(exported).toContain('"name": "Calm settings"');
  expect(exported).not.toMatch(/password|credential|message|account/iu);

  await editor.locator("[data-appearance-preset]").selectOption("builtin:high-contrast");
  await editor.locator('[data-action="apply-tab-appearance-preset"]').click();
  await expect.poll(() => customProperty(tabContainer, "--tab-custom-bg")).toBe("#000000");

  await application.evaluate(async ({ dialog }, selectedPath) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedPath] });
  }, exportPath);
  await editor.locator('[data-action="import-tab-appearance-theme"]').click();
  const confirmation = page.locator(".confirmation-dialog");
  await expect(confirmation).toContainText("calm-settings.json");
  await expect(confirmation).toContainText(/accounts.*credentials.*stay unchanged/iu);
  await confirmation.locator('[data-action="confirm-action"]').click();
  await expect.poll(() => customProperty(tabContainer, "--tab-custom-bg")).toBe("#E2E8F0");
  await expect(page.locator(".toast-region")).toContainText("Appearance theme imported");

  editor = page.getByTestId("tab-appearance-editor");
  await editor.locator("[data-appearance-preset]").selectOption({ label: "Calm settings" });
  await editor.locator('[data-action="request-clear-appearance-presets"]').click();
  const resetConfirmation = page.locator(".confirmation-dialog");
  await resetConfirmation.locator('[data-action="confirm-action"]').click();
  await expect(page.getByTestId("tab-appearance-editor").locator("[data-appearance-preset]")).not.toContainText("Calm settings");
  await expect.poll(() => customProperty(tabContainer, "--tab-custom-bg")).toBe("#E2E8F0");
});
