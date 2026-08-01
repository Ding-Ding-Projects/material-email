import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

let application: ElectronApplication;
let page: Page;
let userData = "";

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(os.tmpdir(), "material-email-oauth-e2e-"));
  application = await electron.launch({
    args: [path.resolve(".")],
    env: { ...process.env, MATERIAL_EMAIL_USER_DATA_DIR: userData, MATERIAL_EMAIL_HEADLESS: "1" },
  });
  page = await application.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await page.getByTestId("onboarding").waitFor({ state: "visible" });
  await page.getByTestId("demo-action").click();
  await expect(page.getByTestId("app-shell")).toBeVisible();

  await application.evaluate(({ BrowserWindow, ipcMain }) => {
    const providers: Array<{ id: "google" | "microsoft"; name: string; configured: boolean }> = [
      { id: "google", name: "Google", configured: true },
      { id: "microsoft", name: "Microsoft", configured: false },
    ];
    let snapshot: {
      phase: string;
      provider: "google" | "microsoft" | null;
      expiresAt: string | null;
      failure: string | null;
      providers: Array<{ id: "google" | "microsoft"; name: string; configured: boolean }>;
    } = {
      phase: "idle",
      provider: null,
      expiresAt: null,
      failure: null,
      providers,
    };
    for (const channel of ["account:oauth-status", "account:oauth-start", "account:oauth-cancel"]) ipcMain.removeHandler(channel);
    ipcMain.handle("account:oauth-status", () => snapshot);
    ipcMain.handle("account:oauth-start", (_event, provider: "google" | "microsoft") => {
      snapshot = {
        phase: "waiting-for-callback",
        provider,
        expiresAt: "2030-08-01T12:05:00.000Z",
        failure: null,
        providers,
      };
      return snapshot;
    });
    ipcMain.handle("account:oauth-cancel", () => {
      snapshot = {
        phase: "cancelled",
        provider: snapshot.provider,
        expiresAt: null,
        failure: null,
        providers,
      };
      return snapshot;
    });
    BrowserWindow.getAllWindows()[0]?.webContents.reload();
  });

  await page.waitForLoadState("domcontentloaded");
  await expect(page.getByTestId("app-shell")).toBeVisible();
});

test.afterAll(async () => {
  await application?.close();
  if (userData) await rm(userData, { recursive: true, force: true });
});

test("shows a bilingual accessible OAuth foundation and cancellation without accepting or persisting a token", async () => {
  await page.getByRole("tab", { name: /^Settings/i }).click();
  await page.locator('select[data-pref="language"]').selectOption("bilingual");
  await page.getByRole("button", { name: /Add account/i }).click();

  const form = page.locator('[data-form="account-setup"]');
  await form.locator('[name="authMode"]').selectOption("oauth2");
  const panel = form.getByTestId("oauth-foundation");
  const passwordField = form.locator("[data-password-credential]");
  const password = form.locator('[name="secret"]');

  await expect(panel).toBeVisible();
  await expect(panel.locator('span[lang="zh-HK"]')).not.toHaveCount(0);
  await expect(panel).toContainText(/No provider client registration ships in this build/i);
  await expect(panel).toContainText("呢個版本冇附帶供應商 client registration");
  await expect(panel).toContainText(/never asks you to paste an OAuth token/i);
  await expect(passwordField).toBeHidden();
  await expect(password).not.toHaveAttribute("required", "");
  await expect(password).toHaveValue("");
  await expect(form.getByRole("button", { name: /Test settings/i })).toBeDisabled();
  await expect(form.getByRole("button", { name: /Connect account/i })).toBeDisabled();
  await expect(form).not.toContainText(/Password or OAuth access token/i);

  const provider = panel.getByRole("combobox", { name: /Browser provider/i });
  await expect(provider).toHaveValue("google");
  const start = panel.getByRole("button", { name: /Start browser authorization/i });
  await expect(start).toBeEnabled();
  await start.click();

  const waiting = form.getByTestId("oauth-status");
  await expect(waiting).toHaveAttribute("role", "status");
  await expect(waiting).toHaveAttribute("aria-live", "polite");
  await expect(waiting).toHaveAttribute("aria-busy", "true");
  await expect(waiting).toContainText(/Waiting for the exact loopback callback/i);
  await expect(waiting).toContainText("等緊完全吻合嘅 loopback 回呼");
  await expect(waiting).toContainText(/127\.0\.0\.1/);
  await expect(waiting).not.toContainText(/authorization-code-fixture|access-token-fixture|refresh-token-fixture/i);
  const cancel = form.getByRole("button", { name: /Cancel authorization/i });
  await expect(cancel).toBeFocused();

  await cancel.click();
  const cancelled = form.getByTestId("oauth-status");
  await expect(cancelled).toHaveAttribute("aria-busy", "false");
  await expect(cancelled).toContainText(/Browser authorization cancelled/i);
  await expect(cancelled).toContainText("瀏覽器授權已取消");
  await expect(cancelled).toContainText(/No code or token was saved/i);
  await expect(form.getByRole("button", { name: /Start browser authorization/i })).toBeFocused();

  await page.setViewportSize({ width: 760, height: 560 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await expect(panel).toBeVisible();
  await page.setViewportSize({ width: 1500, height: 940 });
});

test("shows the production Windows vault boundary without renderer token material or enabled provider actions", async () => {
  const closeSetup = page.getByRole("button", { name: /Close account setup/i });
  if (await closeSetup.isVisible()) await closeSetup.click();
  await page.getByRole("tab", { name: /^Settings/i }).click();
  await page.locator('select[data-pref="language"]').selectOption("bilingual");
  const vault = page.getByTestId("oauth-token-vault-settings");

  await expect(vault).toBeVisible();
  await expect(vault.locator('span[lang="zh-HK"]')).not.toHaveCount(0);
  await expect(vault).toContainText(/Windows OAuth token vault/i);
  await expect(vault).toContainText(/registers no OAuth provider/i);
  await expect(vault).toContainText("呢個版本冇註冊 OAuth 供應商");
  await expect(vault.getByRole("status")).toHaveAttribute("aria-live", "polite");
  await expect(vault.getByTestId("oauth-vault-provider-google").getByRole("button", { name: /Clear local/i })).toBeDisabled();
  await expect(vault.getByTestId("oauth-vault-provider-google").getByRole("button", { name: /Revoke and clear/i })).toBeDisabled();
  await expect(vault).not.toContainText(/fixture-access|fixture-refresh|authorization-code-fixture/i);
  await expect(vault.locator('input[type="password"], textarea[name*="token" i], input[name*="token" i]')).toHaveCount(0);

  const bridgeKeys = await page.evaluate(() => Object.keys(window.materialEmail));
  expect(bridgeKeys).toEqual(expect.arrayContaining(["getOAuthTokenVaultStatus", "clearOAuthTokenVault", "revokeOAuthTokenVault"]));
  expect(bridgeKeys.some(key => /accessToken|refreshToken|authorizationCode|codeVerifier/i.test(key))).toBe(false);

  await page.setViewportSize({ width: 760, height: 560 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await expect(vault).toBeVisible();
  await page.setViewportSize({ width: 1500, height: 940 });
});
