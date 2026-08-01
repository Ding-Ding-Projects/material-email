import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

let application: ElectronApplication;
let page: Page;
let userData: string;

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(os.tmpdir(), "material-email-certificate-e2e-"));
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

test("shows bilingual accessible certificate diagnostics and blocks local preflight errors", async () => {
  await page.getByRole("tab", { name: /^Settings/i }).click();
  await page.locator('select[data-pref="language"]').selectOption("bilingual");
  await expect(page.getByTestId("settings-page").locator('span[lang="zh-HK"]')).not.toHaveCount(0);
  await page.getByRole("button", { name: /Add account/i }).click();

  const form = page.locator('[data-form="account-setup"]');
  const preflight = page.getByTestId("connection-preflight");
  const incomingHost = form.locator('[name="incomingHost"]');
  await incomingHost.fill("192.0.2.12");
  const ipWarning = preflight.locator('[data-connection-diagnostic="certificate-ip-literal"]');
  await expect(ipWarning).toContainText(/certificate may not cover this IP address/i);
  await expect(ipWarning).toContainText("證書未必涵蓋呢個 IP 地址");
  await expect(ipWarning).toContainText(/has not inspected a certificate/i);

  await incomingHost.fill("imap.example.test");
  await form.locator('[name="incomingPort"]').fill("143");
  const portConflict = preflight.locator('[data-connection-diagnostic="implicit-tls-on-starttls-port"]');
  await expect(portConflict).toContainText(/Choose STARTTLS, or use TLS on port 993/i);
  await expect(portConflict).toContainText("請選擇 STARTTLS");

  await form.locator('[name="incomingPort"]').fill("993");
  await incomingHost.fill("*.example.test");
  await form.locator('[name="email"]').fill("certificate@example.test");
  await form.locator('[name="displayName"]').fill("Certificate Check");
  await form.locator('[name="incomingUsername"]').fill("certificate@example.test");
  await form.locator('[name="outgoingHost"]').fill("smtp.example.test");
  await form.locator('[name="outgoingUsername"]').fill("certificate@example.test");
  await form.locator('[name="secret"]').fill("fixture-only-secret");
  await form.getByRole("button", { name: /Test settings/i }).click();

  await expect(preflight).toHaveAttribute("role", "alert");
  await expect(preflight).toHaveAttribute("aria-live", "assertive");
  await expect(incomingHost).toHaveAttribute("aria-invalid", "true");
  await expect(incomingHost).toBeFocused();
  await expect(preflight.locator('[data-connection-diagnostic="hostname-wildcard"]')).toContainText(/No server has been contacted/i);
  const errorToast = page.getByTestId("toast-region").locator(".toast--error").last();
  await expect(errorToast).toContainText(/connection test was not started/i);
  await expect(errorToast.locator('span[lang="zh-HK"]')).not.toHaveCount(0);
});
