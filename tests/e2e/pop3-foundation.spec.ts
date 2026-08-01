import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

let application: ElectronApplication;
let page: Page;
let userData = "";

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(os.tmpdir(), "material-email-pop3-e2e-"));
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

test("runs a bilingual accessible local POP3 state machine while live account actions stay blocked", async () => {
  await page.getByRole("tab", { name: /^Settings/i }).click();
  await page.locator('select[data-pref="language"]').selectOption("bilingual");
  await page.getByRole("button", { name: /Add account/i }).click();

  const form = page.locator('[data-form="account-setup"]');
  await form.locator('[name="incomingProtocol"]').selectOption("pop3");
  const panel = form.getByTestId("pop3-foundation");
  const result = form.getByTestId("pop3-foundation-result");

  await expect(panel).toBeVisible();
  await expect(panel.locator('span[lang="zh-HK"]')).not.toHaveCount(0);
  await expect(panel).toContainText(/live POP3 remains off/i);
  await expect(panel).toContainText("即時 POP3 仍然關閉");
  await expect(panel).toContainText(/DELE, server deletion.*full synchronization are not implemented/i);
  await expect(form.locator('[name="incomingPort"]')).toHaveValue("995");
  await expect(form.locator('[name="authMode"]')).toBeDisabled();
  await expect(form.locator('[name="secret"]')).toBeDisabled();
  await expect(form.getByTestId("inspect-incoming-certificate")).toBeDisabled();
  await expect(form.getByRole("button", { name: /Test settings/i })).toBeDisabled();
  await expect(form.getByRole("button", { name: /Connect account/i })).toBeDisabled();

  await panel.getByTestId("run-pop3-foundation").click();
  await expect(result).toHaveAttribute("role", "status");
  await expect(result).toHaveAttribute("aria-live", "polite");
  await expect(result).toHaveAttribute("aria-busy", "false");
  await expect(result).toContainText(/Local POP3 demo completed/i);
  await expect(result).toContainText("本機 POP3 示範完成");
  await expect(result).toContainText(/UIDL/);
  await expect(result).toContainText(/STLS, PIPELINING, DELE/);
  await expect(result.locator(".pop3-foundation__facts div").filter({ hasText: /Server contacted/i }).locator("dd")).toContainText(/^No/);
  await expect(result.locator(".pop3-foundation__facts div").filter({ hasText: /Credential used/i }).locator("dd")).toContainText(/^No/);
  await expect(result.locator(".pop3-foundation__facts div").filter({ hasText: /^DELE/ }).locator("dd")).toContainText(/^Not attempted/);
  await expect(result.locator(".pop3-foundation__facts div").filter({ hasText: /Full synchronization/i }).locator("dd")).toContainText(/^Not provided/);
  await expect(result).toContainText(/idle —start→ connecting/);
  await expect(result.locator(".pop3-foundation__messages li")).toHaveCount(3);

  await page.setViewportSize({ width: 760, height: 560 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await expect(panel).toBeVisible();
});
