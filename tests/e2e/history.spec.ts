import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

let application: ElectronApplication;
let page: Page;
let userData: string;

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(os.tmpdir(), "material-email-history-e2e-"));
  application = await electron.launch({
    args: [path.resolve(".")],
    env: { ...process.env, MATERIAL_EMAIL_USER_DATA_DIR: userData, MATERIAL_EMAIL_HEADLESS: "1" },
  });
  page = await application.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await page.getByTestId("onboarding").waitFor({ state: "visible" });
  await page.getByTestId("demo-action").click();
  await expect(page.getByTestId("app-shell")).toBeVisible();
});

test.afterAll(async () => {
  await application?.close();
  await rm(userData, { recursive: true, force: true });
});

test("searches, diffs, labels, and reviews restore for a local Git revision", async () => {
  await page.getByRole("tab", { name: /^History$/i }).click();
  const versions = page.getByTestId("local-versions");
  await expect(versions).toBeVisible();
  const rows = versions.getByTestId("local-revision-row");
  await expect.poll(() => rows.count()).toBeGreaterThanOrEqual(2);

  const first = rows.first();
  await first.getByRole("button", { name: /View changes/i }).click();
  const detail = first.getByTestId("local-revision-detail");
  await expect(detail).toBeVisible();
  await expect(detail.locator(".revision-diff-line").first()).toBeVisible();

  const label = detail.getByRole("textbox", { name: /Revision label/i });
  await label.fill("Demo ready · 示範準備好");
  await detail.getByRole("button", { name: /Save label/i }).click();
  await expect(page.getByTestId("toast-region")).toContainText(/Revision label saved/i);
  await expect(first.locator("strong").first()).toHaveText("Demo ready · 示範準備好");

  const search = versions.locator('[data-search-anchor="history-versions"] input[type="search"]');
  await search.fill("示範準備好");
  await expect(versions.getByTestId("local-revision-row")).toHaveCount(1);
  await versions.getByRole("button", { name: /^Restore$/i }).click();
  const decision = page.getByRole("alertdialog");
  await expect(decision).toContainText("Demo ready · 示範準備好");
  await decision.getByRole("button", { name: /Cancel/i }).click();
  await expect(decision).toBeHidden();
});
