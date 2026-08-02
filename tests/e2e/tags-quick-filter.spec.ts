import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { MessageTagCatalog } from "../../src/shared/contracts";

let application: ElectronApplication;
let page: Page;
let userData = "";

test.beforeEach(async () => {
  userData = await mkdtemp(path.join(os.tmpdir(), "material-email-tags-"));
  application = await electron.launch({
    args: [path.resolve(".")],
    env: { ...process.env, MATERIAL_EMAIL_USER_DATA_DIR: userData, MATERIAL_EMAIL_HEADLESS: "1" },
  });
  page = await application.firstWindow();
  await page.waitForLoadState("domcontentloaded");
});

test.afterEach(async () => {
  await application?.close();
  if (userData) await rm(userData, { recursive: true, force: true });
  userData = "";
});

/** Opens the bundled demonstration workspace through the real service, with no IPC stubbing. */
const openDemoWorkspace = async (): Promise<void> => {
  const onboarding = page.getByTestId("onboarding");
  await page.locator('[data-testid="onboarding"], [data-testid="app-shell"]').first().waitFor({ state: "visible" });
  if (await onboarding.isVisible()) {
    await page.getByTestId("demo-action").click();
    await expect(onboarding).toBeHidden();
  }
  await expect(page.getByTestId("app-shell")).toBeVisible();
  if (!(await page.getByTestId("folder-list").isVisible())) await page.locator('[role="tab"][data-tab-id="mail"]').click();
  await expect(page.getByTestId("message-list").locator(".message-row").first()).toBeVisible({ timeout: 15_000 });
};

test("tags a cached message, narrows the list by that tag, and marks the folder read", async () => {
  await openDemoWorkspace();

  const catalog = await page.evaluate(() => window.materialEmail.listMessageTags()) as MessageTagCatalog;
  expect(catalog.tags.map(tag => tag.id)).toEqual(["important", "work", "personal", "to-do", "later"]);

  const rows = page.getByTestId("message-list").locator(".message-row");
  const totalRows = await rows.count();
  expect(totalRows).toBeGreaterThan(1);

  await rows.first().locator("[data-action='select-message']").click();
  const readerTags = page.getByTestId("reader-tags");
  await expect(readerTags).toBeVisible();

  const workChip = readerTags.locator("[data-action='toggle-message-tag'][data-tag-id='work']");
  await expect(workChip).toHaveAttribute("aria-pressed", "false");
  await workChip.click();
  await expect(workChip).toHaveAttribute("aria-pressed", "true");

  // The tag reaches the list row, which reads its label from the main process, not from local state.
  await expect(rows.first().getByTestId("message-tag-chips")).toContainText(/Work/u);

  const quickFilter = page.getByTestId("quick-filter");
  await quickFilter.locator("[data-action='toggle-quick-filter']").click();
  await quickFilter.locator("[data-action='toggle-quick-filter-tag'][data-tag-id='work']").click();
  await expect(rows).toHaveCount(1);
  await expect(quickFilter).toContainText(/1 of \d+ cached messages match|封符合/u);

  await quickFilter.locator("[data-action='clear-quick-filter']").click();
  await expect(rows).toHaveCount(totalRows);

  await page.getByTestId("folder-actions").locator("[data-action='mark-folder-read']").click();
  await expect(page.getByTestId("message-list").locator(".message-row.is-unread")).toHaveCount(0, { timeout: 15_000 });
});

test("keeps an applied tag across a restart and reports an invalid quick filter without hiding messages", async () => {
  await openDemoWorkspace();
  const rows = page.getByTestId("message-list").locator(".message-row");
  const totalRows = await rows.count();

  await rows.first().locator("[data-action='select-message']").click();
  await page.getByTestId("reader-tags").locator("[data-action='toggle-message-tag'][data-tag-id='to-do']").click();
  await expect(rows.first().getByTestId("message-tag-chips")).toContainText(/To Do/u);

  await application.close();
  application = await electron.launch({
    args: [path.resolve(".")],
    env: { ...process.env, MATERIAL_EMAIL_USER_DATA_DIR: userData, MATERIAL_EMAIL_HEADLESS: "1" },
  });
  page = await application.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await openDemoWorkspace();

  const restoredRows = page.getByTestId("message-list").locator(".message-row");
  await expect(restoredRows.first().getByTestId("message-tag-chips")).toContainText(/To Do/u, { timeout: 15_000 });

  const quickFilter = page.getByTestId("quick-filter");
  await quickFilter.locator("[data-action='toggle-quick-filter']").click();
  await quickFilter.locator("[data-action='toggle-quick-filter-mode']").click();
  await quickFilter.locator("#quick-filter-text").fill("(a+)+$");
  // An unsafe expression is refused in place; the reader is told, and no row is hidden by guesswork.
  await expect(quickFilter.locator("#quick-filter-summary")).toHaveClass(/is-invalid/u);
  await expect(quickFilter.locator("#quick-filter-summary")).toContainText(/unresponsive|needs attention|要處理/u);

  await quickFilter.locator("#quick-filter-text").fill("");
  await expect(restoredRows).toHaveCount(totalRows);
});
