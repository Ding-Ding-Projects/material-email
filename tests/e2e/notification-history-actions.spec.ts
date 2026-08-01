import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
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

const openNotifications = async () => {
  await page.locator('[role="tab"][data-tab-id="notifications"]').click();
  const centre = page.getByTestId("notifications-page");
  await expect(centre).toBeVisible();
  return centre;
};

const demoNotification = () => page.getByTestId("notification-card").filter({ hasText: "Demo workspace ready" });

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(os.tmpdir(), "material-email-notification-history-"));
  await launch();
  await page.getByTestId("onboarding").waitFor({ state: "visible" });
  await page.getByTestId("demo-action").click();
  await expect(page.getByTestId("app-shell")).toBeVisible();
});

test.afterAll(async () => {
  await application?.close();
  await rm(userData, { recursive: true, force: true });
});

test("persists accessible read/dismiss state and keeps localized safe actions reviewable", async () => {
  await openNotifications();
  let card = demoNotification();
  await expect(card).toHaveCount(1);
  await expect(card.locator(".kind-badge")).toHaveText("Account");
  await expect(card.locator(".severity-badge")).toHaveText("Success");
  await expect(card.getByRole("button", { name: "Open Settings: Demo workspace ready" })).toBeVisible();

  await card.getByRole("button", { name: "Mark read" }).click();
  card = demoNotification();
  await expect(card.getByRole("button", { name: "Mark unread" })).toHaveAttribute("aria-pressed", "true");
  await card.getByRole("button", { name: "Dismiss notification: Demo workspace ready" }).click();
  card = demoNotification();
  await expect(card).toHaveClass(/is-dismissed/);
  await expect(card.getByRole("button", { name: "Restore notification: Demo workspace ready" })).toHaveAttribute("aria-pressed", "true");

  await application.close();
  await launch();
  await expect(page.getByTestId("app-shell")).toBeVisible();
  await openNotifications();
  card = demoNotification();
  await expect(card.getByRole("button", { name: "Mark unread" })).toHaveAttribute("aria-pressed", "true");
  await expect(card.getByRole("button", { name: "Restore notification: Demo workspace ready" })).toHaveAttribute("aria-pressed", "true");

  await card.getByRole("button", { name: "Open Settings: Demo workspace ready" }).click();
  await expect(page.getByTestId("settings-page")).toBeVisible();
  await page.locator('select[data-pref="language"]').selectOption("yue");
  await openNotifications();
  card = demoNotification();
  await expect(card.locator(".kind-badge")).toHaveText("帳戶");
  await expect(card.locator(".severity-badge")).toHaveText("成功");
  await expect(card.getByRole("button", { name: "開啟設定: Demo workspace ready" })).toBeVisible();
  await expect(card.getByRole("button", { name: "恢復通知：Demo workspace ready" })).toBeVisible();

  await expect(page.getByTestId("toast-region")).toHaveAttribute("aria-live", "polite");
  await expect(page.getByTestId("toast-region").getByRole("dialog")).toHaveCount(0);
});
