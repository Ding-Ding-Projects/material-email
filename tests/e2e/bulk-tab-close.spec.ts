import { _electron as electron, expect, test, type ElectronApplication, type Locator, type Page } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

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

const openTabManager = async (): Promise<Locator> => {
  await page.locator('.tab-overflow-button[data-action="toggle-tab-manager"]').click();
  const manager = page.locator(".tab-manager");
  await expect(manager).toBeVisible();
  return manager;
};

const setFlag = async (builder: Locator, flag: string, checked: boolean): Promise<void> => {
  const control = builder.locator(`input[data-regex-flag="bulk-tabs"][value="${flag}"]`);
  if (checked) await control.check();
  else await control.uncheck();
};

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(os.tmpdir(), "material-email-bulk-tab-close-e2e-"));
  await launch();
});

test.afterAll(async () => {
  await application?.close();
  await rm(userData, { recursive: true, force: true });
});

test("persists a safe bulk-close review and returns focus around confirmation", async () => {
  await ensureDemo();
  await page.locator('[role="tab"][data-tab-id="settings"]').click();
  await expect(page.getByTestId("settings-page")).toBeVisible();
  await page.locator('select[data-pref="language"]').selectOption("bilingual");

  let manager = await openTabManager();
  let bulk = manager.getByTestId("bulk-tab-close");
  let input = bulk.locator('input[data-search-key="bulk-tabs"]');
  let preview = bulk.getByTestId("bulk-close-preview");
  let review = bulk.locator('[data-action="request-bulk-close"]');

  await input.fill("   ");
  await expect(preview).toHaveAttribute("data-bulk-status", "empty");
  await expect(preview).toHaveAttribute("role", "status");
  await expect(preview).toHaveAccessibleName(/Bulk-close preview unavailable/i);
  await expect(preview).toContainText("Whitespace alone never enables bulk close.");
  await expect(preview).toContainText("淨係空格永遠唔會啟用批量關閉");
  await expect(review).toBeDisabled();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);

  await bulk.locator('[data-action="toggle-regex-builder"]').click();
  let builder = bulk.getByTestId("regex-popover");
  await builder.locator('[data-action="set-regex-mode"][data-mode="regex"]').click();
  await setFlag(builder, "i", false);
  await setFlag(builder, "m", true);
  await setFlag(builder, "u", true);
  await builder.locator('textarea[data-regex-pattern="bulk-tabs"]').fill("[");
  await expect(preview).toHaveAttribute("data-bulk-status", "invalid");
  await expect(preview).toHaveAttribute("role", "status");
  await expect(preview).toHaveAccessibleName(/Bulk-close preview blocked/i);
  await expect(review).toBeDisabled();

  await builder.locator('textarea[data-regex-pattern="bulk-tabs"]').fill("Mail|Settings");
  await builder.locator('textarea[data-regex-sample="bulk-tabs"]').fill("This sample must reset at restart");
  await builder.locator('[data-action="close-regex-builder"]').click();
  await expect(input).toBeFocused();
  await expect(preview).toHaveAttribute("data-bulk-status", "ready");
  await expect(preview).toHaveAccessibleName(/1 tab would close/i);
  await expect(preview).toContainText("pinned tabs excluded (1 matching protected)");

  const pinned = bulk.locator('input[data-bulk-option="pinned"]');
  const inverse = bulk.locator('input[data-bulk-option="inverse"]');
  await pinned.check();
  await expect(preview).toHaveAccessibleName(/2 tabs would close/i);
  await expect(preview).toContainText("pinned tabs included by saved explicit choice (1 in preview)");
  await inverse.check();
  await expect(preview).toContainText("close visible labels that do not match");

  await application.close();
  await launch();
  await ensureDemo();
  manager = await openTabManager();
  bulk = manager.getByTestId("bulk-tab-close");
  input = bulk.locator('input[data-search-key="bulk-tabs"]');
  preview = bulk.getByTestId("bulk-close-preview");
  review = bulk.locator('[data-action="request-bulk-close"]');

  await expect(input).toHaveValue("Mail|Settings");
  await expect(bulk.locator('input[data-bulk-option="inverse"]')).toBeChecked();
  await expect(bulk.locator('input[data-bulk-option="pinned"]')).toBeChecked();
  await expect(preview).toContainText("close visible labels that do not match");
  await bulk.locator('[data-action="toggle-regex-builder"]').click();
  builder = bulk.getByTestId("regex-popover");
  await expect(builder.locator('[data-action="set-regex-mode"][data-mode="regex"]')).toHaveAttribute("aria-pressed", "true");
  await expect(builder.locator('input[data-regex-flag="bulk-tabs"][value="i"]')).not.toBeChecked();
  await expect(builder.locator('input[data-regex-flag="bulk-tabs"][value="m"]')).toBeChecked();
  await expect(builder.locator('input[data-regex-flag="bulk-tabs"][value="u"]')).toBeChecked();
  await expect(builder.locator('textarea[data-regex-sample="bulk-tabs"]')).not.toHaveValue("This sample must reset at restart");
  await page.keyboard.press("Escape");
  await expect(input).toBeFocused();

  await bulk.locator('input[data-bulk-option="inverse"]').uncheck();
  await bulk.locator('input[data-bulk-option="pinned"]').uncheck();
  await input.fill("Settings");
  await expect(preview).toHaveAccessibleName(/1 tab would close/i);
  await review.click();
  let confirmation = page.getByRole("alertdialog");
  await expect(confirmation).toContainText("Regular-expression review");
  await expect(confirmation).toContainText("Pinned tabs are excluded from this exact set.");
  await confirmation.getByRole("button", { name: /^Cancel/i }).click();
  await expect(input).toBeFocused();

  await review.click();
  confirmation = page.getByRole("alertdialog");
  await confirmation.getByRole("button", { name: /^Close reviewed tabs/i }).click();
  await expect(input).toBeFocused();
  await expect(preview).toHaveAccessibleName(/0 tabs would close/i);
  await expect(page.locator('[role="tab"][data-tab-id="settings"]')).toHaveCount(0);
  await expect(manager.locator('[data-action="reopen-tab"][data-tab-id="settings"]')).toBeVisible();
});
