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
    const FIXTURE_REDIRECT = "https://accounts.example.test/oauth/fixture-redirect";
    type AccountHint = { email: string | null; displayName: string | null } | null;
    let signIn: { provider: "google" | "microsoft"; phase: "ready"; failure: null; accountHint: AccountHint } | null = null;
    for (const channel of ["account:oauth-status", "account:oauth-start", "account:oauth-cancel", "account:oauth-submit-redirect", "account:oauth-signin-status"]) {
      ipcMain.removeHandler(channel);
    }
    ipcMain.handle("account:oauth-status", () => snapshot);
    ipcMain.handle("account:oauth-signin-status", () => signIn);
    ipcMain.handle("account:oauth-start", (_event, provider: "google" | "microsoft") => {
      signIn = null;
      snapshot = {
        phase: "awaiting-redirect-paste",
        provider,
        expiresAt: "2030-08-01T12:05:00.000Z",
        failure: null,
        providers,
      };
      return snapshot;
    });
    ipcMain.handle("account:oauth-submit-redirect", (_event, url: string) => {
      if (snapshot.phase !== "awaiting-redirect-paste") return snapshot;
      if (url.startsWith(FIXTURE_REDIRECT) && url.includes("code=")) {
        // The real service transitions to authorization-received the instant a matching redirect
        // lands; the sign-in exchange it triggers is a separate, slightly later state this stub
        // resolves immediately, matching what a fast local fixture exchange would look like.
        // A distinct fixture code simulates a token exchange whose response carried an ID token
        // with email/name claims, exercising the non-secret Add Account prefill hint end to end;
        // the original plain code keeps producing no hint, matching the earlier test unchanged.
        const code = new URL(url).searchParams.get("code");
        const accountHint: AccountHint = code === "fixture-authorization-code-with-hint"
          ? { email: "detected@example.test", displayName: "Detected User" }
          : null;
        signIn = { provider: snapshot.provider!, phase: "ready", failure: null, accountHint };
        snapshot = { phase: "authorization-received", provider: snapshot.provider, expiresAt: null, failure: null, providers };
      }
      // A non-matching paste leaves the phase unchanged, exactly like the real service, so the
      // panel stays open for another attempt rather than silently failing.
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
  await expect(panel).toContainText(/asks you to paste back the resulting address/i);
  await expect(passwordField).toBeHidden();
  await expect(password).not.toHaveAttribute("required", "");
  await expect(password).toHaveValue("");
  await expect(form.getByRole("button", { name: /Test settings/i })).toBeDisabled();
  await expect(form.getByRole("button", { name: /Connect account/i })).toBeDisabled();
  await expect(form).not.toContainText(/Password or OAuth access token/i);

  const provider = panel.getByRole("combobox", { name: /Browser provider/i });
  await expect(provider).toHaveValue("google");
  const start = panel.getByRole("button", { name: /Start browser sign-in/i });
  await expect(start).toBeEnabled();
  await start.click();

  const waiting = form.getByTestId("oauth-status");
  await expect(waiting).toHaveAttribute("role", "status");
  await expect(waiting).toHaveAttribute("aria-live", "polite");
  await expect(waiting).toHaveAttribute("aria-busy", "true");
  await expect(waiting).toContainText(/Paste the address after signing in/i);
  await expect(waiting).toContainText("登入完成之後貼返個網址");
  await expect(waiting).not.toContainText(/authorization-code-fixture|access-token-fixture|refresh-token-fixture/i);
  const pasteInput = form.getByTestId("oauth-redirect-input");
  await expect(pasteInput).toBeFocused();

  // A pasted address that does not match stays in the same phase, ready for another attempt,
  // rather than silently failing or advancing.
  await pasteInput.fill("https://not-the-registered-redirect.example.test/?code=wrong");
  await form.getByRole("button", { name: /^Continue/i }).click();
  await expect(form.getByRole("button", { name: /Test settings/i })).toBeDisabled();
  // The field clears after every submit attempt, matched or not, so a fresh paste always starts empty.
  await expect(pasteInput).toHaveValue("");
  await expect(waiting).toContainText(/Paste the address after signing in/i);

  // The exact registered redirect, with a code, completes the sign-in and enables the form.
  await pasteInput.fill("https://accounts.example.test/oauth/fixture-redirect?state=fixture&code=fixture-authorization-code");
  await form.getByRole("button", { name: /^Continue/i }).click();
  const ready = form.getByTestId("oauth-status");
  await expect(ready).toContainText(/Signed in/i);
  await expect(ready).toContainText("已登入");
  // No cancel action exists once signed in — there is nothing left to cancel — but a fresh sign-in
  // can still be started (a different provider, or the same one again).
  await expect(form.getByRole("button", { name: /^Cancel$/i })).toHaveCount(0);
  await expect(form.getByRole("button", { name: /Start browser sign-in/i })).toBeVisible();

  await page.setViewportSize({ width: 760, height: 560 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await expect(panel).toBeVisible();
  await page.setViewportSize({ width: 1500, height: 940 });
});

test("prefills empty email and display-name fields from a completed sign-in's non-secret account hint", async () => {
  const closeSetup = page.getByRole("button", { name: /Close account setup/i });
  if (await closeSetup.isVisible()) await closeSetup.click();
  await page.getByRole("tab", { name: /^Settings/i }).click();
  await page.getByRole("button", { name: /Add account/i }).click();

  const form = page.locator('[data-form="account-setup"]');
  const emailInput = form.locator('[name="email"]');
  const nameInput = form.locator('[name="displayName"]');
  await expect(emailInput).toHaveValue("");
  await expect(nameInput).toHaveValue("");

  await form.locator('[name="authMode"]').selectOption("oauth2");
  const panel = form.getByTestId("oauth-foundation");
  await expect(panel.getByRole("combobox", { name: /Browser provider/i })).toHaveValue("google");
  await panel.getByRole("button", { name: /Start browser sign-in/i }).click();

  const waiting = form.getByTestId("oauth-status");
  const pasteInput = form.getByTestId("oauth-redirect-input");
  await expect(waiting).toContainText(/Paste the address after signing in/i);
  await expect(pasteInput).toBeFocused();
  await pasteInput.fill("https://accounts.example.test/oauth/fixture-redirect?state=fixture&code=fixture-authorization-code-with-hint");
  await form.getByRole("button", { name: /^Continue/i }).click();

  await expect(form.getByTestId("oauth-status")).toContainText(/Signed in/i);
  await expect(emailInput).toHaveValue("detected@example.test");
  await expect(nameInput).toHaveValue("Detected User");
  // The hint is a prefill convenience only: both fields stay ordinary, editable inputs afterward.
  await emailInput.fill("overridden@example.test");
  await expect(emailInput).toHaveValue("overridden@example.test");
});

test("never overwrites an email or display name the user already typed, even after a late-arriving account hint", async () => {
  const closeSetup = page.getByRole("button", { name: /Close account setup/i });
  if (await closeSetup.isVisible()) await closeSetup.click();
  await page.getByRole("tab", { name: /^Settings/i }).click();
  await page.getByRole("button", { name: /Add account/i }).click();

  const form = page.locator('[data-form="account-setup"]');
  const emailInput = form.locator('[name="email"]');
  const nameInput = form.locator('[name="displayName"]');
  await emailInput.fill("typed-by-user@example.test");
  await nameInput.fill("Typed By User");

  await form.locator('[name="authMode"]').selectOption("oauth2");
  const panel = form.getByTestId("oauth-foundation");
  await panel.getByRole("button", { name: /Start browser sign-in/i }).click();

  const waiting = form.getByTestId("oauth-status");
  const pasteInput = form.getByTestId("oauth-redirect-input");
  await expect(waiting).toContainText(/Paste the address after signing in/i);
  await expect(pasteInput).toBeFocused();
  await pasteInput.fill("https://accounts.example.test/oauth/fixture-redirect?state=fixture&code=fixture-authorization-code-with-hint");
  await form.getByRole("button", { name: /^Continue/i }).click();

  await expect(form.getByTestId("oauth-status")).toContainText(/Signed in/i);
  await expect(emailInput).toHaveValue("typed-by-user@example.test");
  await expect(nameInput).toHaveValue("Typed By User");
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
