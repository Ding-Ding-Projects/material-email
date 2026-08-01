import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

let application: ElectronApplication;
let page: Page;
let userData = "";

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(os.tmpdir(), "material-email-pim-provider-e2e-"));
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
  if (userData) await rm(userData, { recursive: true, force: true });
});

test("validates provider profiles in an accessible bilingual no-network settings boundary", async () => {
  await page.getByRole("tab", { name: /^Settings/i }).click();
  await page.locator('select[data-pref="language"]').selectOption("bilingual");

  const section = page.getByTestId("pim-provider-settings");
  const form = section.locator('[data-form="pim-provider-foundation"]');
  const result = page.getByTestId("pim-provider-foundation-result");
  await expect(section).toBeVisible();
  await expect(section.locator('span[lang="zh-HK"]')).not.toHaveCount(0);
  await expect(section).toContainText(/zero live provider claims/i);
  await expect(section).toContainText("零即時供應商聲稱");
  await expect(section).toContainText(/accepts no user name, password, token, client ID, or scope/i);
  await expect(section.locator('input[type="password"]')).toHaveCount(0);
  await expect(result).toHaveAttribute("role", "status");
  await expect(result).toHaveAttribute("aria-live", "polite");

  await form.locator('[name="kind"]').selectOption("carddav");
  await form.locator('[name="authMode"]').selectOption("basic");
  await form.locator('[name="endpointUrl"]').fill("http://dav.example.test/address-books/");
  await form.getByTestId("run-pim-provider-foundation").click();
  await expect(result).toContainText(/Profile rejected locally/i);
  await expect(result).toContainText(/must use HTTPS/i);
  await expect(result.locator(".provider-foundation__facts div").filter({ hasText: /Endpoint contacted/i }).locator("dd")).toContainText(/^No/);
  await expect(result.locator(".provider-foundation__facts div").filter({ hasText: /Credential used/i }).locator("dd")).toContainText(/^No/);

  await form.locator('[name="endpointUrl"]').fill("https://DAV.Example.test:443/address-books/");
  await form.getByTestId("run-pim-provider-foundation").click();
  await expect(result).toContainText(/structurally ready/i);
  await expect(result).toContainText("https://dav.example.test/address-books/");
  await expect(result).toContainText(/Bounded local vCard envelope/i);
  await expect(result).toContainText(/Provider collection discovery/i);
  await expect(result).toContainText(/Unavailable; no provider proof/i);
  await expect(result.locator(".provider-foundation__facts div").filter({ hasText: /Live synchronization/i }).locator("dd")).toContainText(/^Not provided/);
  await expect(result.locator(".provider-foundation__facts div").filter({ hasText: /Recurrence/i }).locator("dd")).toContainText(/not expanded/i);

  await form.locator('[name="kind"]').selectOption("ics-file");
  await expect(form.locator('[name="authMode"]')).toBeDisabled();
  await expect(form).toContainText(/absolute Windows file URL ending in .ics/i);
  await expect(form).toContainText(/This panel does not import records/i);

  await page.setViewportSize({ width: 760, height: 560 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await expect(section).toBeVisible();
});
