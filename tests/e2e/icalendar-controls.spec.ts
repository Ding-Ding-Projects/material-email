import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

let application: ElectronApplication;
let page: Page;
let userData = "";

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(os.tmpdir(), "material-email-ics-controls-e2e-"));
  application = await electron.launch({ args: [path.resolve(".")], env: { ...process.env, MATERIAL_EMAIL_USER_DATA_DIR: userData, MATERIAL_EMAIL_HEADLESS: "1" } });
  page = await application.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await page.getByTestId("onboarding").waitFor({ state: "visible" });
  await page.getByTestId("demo-action").click();
  await expect(page.getByTestId("app-shell")).toBeVisible();
});

test.afterAll(async () => {
  await application?.close();
  if (userData) await rm(userData, { recursive: true, force: true });
});

test("exposes bilingual selected/all iCalendar controls with persistent local selection", async () => {
  await page.getByRole("tab", { name: /^Settings/i }).click();
  await page.locator('select[data-pref="language"]').selectOption("bilingual");
  await page.getByRole("tab", { name: /^Calendar/i }).click();
  await expect(page.getByTestId("calendar-ics-boundary")).toContainText("原子");
  await page.locator("select[data-ics-duplicate-policy]").selectOption("update");
  await page.getByTestId("add-calendar-event").click();
  await page.getByTestId("event-title").fill("Imported-exported event");
  await page.getByTestId("save-calendar-event").click();
  const eventCard = page.getByTestId("calendar-event-card").filter({ hasText: "Imported-exported event" });
  await expect(eventCard).toBeVisible();
  await expect(page.getByTestId("export-selected-events-ics")).toBeDisabled();
  await eventCard.locator('input[data-ics-select="calendar-event"]').check();
  await expect(page.getByTestId("export-selected-events-ics")).toBeEnabled();
  await expect(page.getByTestId("export-all-events-ics")).toBeEnabled();

  await page.getByRole("tab", { name: /^Tasks/i }).click();
  await expect(page.locator("select[data-ics-duplicate-policy]")).toHaveValue("update");
  await page.getByTestId("add-task").click();
  await page.getByTestId("task-title").fill("Selected task export");
  await page.getByTestId("save-task").click();
  const taskCard = page.getByTestId("task-card").filter({ hasText: "Selected task export" });
  await taskCard.locator('input[data-ics-select="task"]').check();
  await expect(page.getByTestId("export-selected-tasks-ics")).toBeEnabled();
  await expect(page.getByTestId("export-all-tasks-ics")).toBeEnabled();
  await page.setViewportSize({ width: 760, height: 560 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});
