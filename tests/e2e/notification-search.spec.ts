import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SURFACE_TONE_COPY } from "../../src/renderer/lib/localization";
import { NOTIFICATION_SEARCH_STORAGE_KEY } from "../../src/renderer/lib/notification-search";
import { SETTINGS_SEARCH_STORAGE_KEY } from "../../src/renderer/lib/settings-search";

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

const openNotifications = async (): Promise<void> => {
  await page.locator('[role="tab"][data-tab-id="notifications"]').click();
  await expect(page.getByTestId("notifications-page")).toBeVisible();
};

const setFunnyLevel = async (name: "funnyEnglish" | "funnyCantonese", value: 1 | 5): Promise<void> => {
  await page.locator(`input[data-pref="${name}"]`).evaluate((node, nextValue) => {
    const input = node as HTMLInputElement;
    input.value = String(nextValue);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
};

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(os.tmpdir(), "material-email-notification-search-"));
  await launch();
});

test.afterAll(async () => {
  await application?.close();
  await rm(userData, { recursive: true, force: true });
});

test("persists an independent Notification Centre search and keeps invalid, no-match, and focus states semantic", async () => {
  await ensureDemo();
  await page.locator('[role="tab"][data-tab-id="settings"]').click();
  await expect(page.getByTestId("settings-page")).toBeVisible();
  await setFunnyLevel("funnyEnglish", 1);
  await setFunnyLevel("funnyCantonese", 5);
  await page.locator('select[data-pref="language"]').selectOption("bilingual");
  await openNotifications();

  const anchor = page.locator('[data-search-anchor="notifications"]');
  const input = anchor.locator('input[data-search-key="notifications"]');
  await input.fill("Demo workspace");
  await expect(page.getByTestId("notification-card")).toHaveCount(1);

  await anchor.locator('[data-action="toggle-regex-builder"]').click();
  let builder = page.getByTestId("regex-popover");
  await expect(builder.locator('textarea[data-regex-pattern="notifications"]')).toHaveValue("Demo workspace");
  await builder.locator('[data-action="set-regex-mode"][data-mode="regex"]').click();
  await builder.getByRole("checkbox", { name: /Ignore case/i }).uncheck();
  await builder.getByRole("checkbox", { name: /Multiline/i }).check();
  await builder.getByRole("checkbox", { name: /Unicode/i }).check();
  await builder.locator('textarea[data-regex-pattern="notifications"]').fill("^Definitely absent notification$");
  await builder.locator('textarea[data-regex-sample="notifications"]').fill("Transient notification sample");
  await builder.getByRole("button", { name: /Use in search/i }).click();

  const noMatch = page.getByTestId("notification-search-empty");
  await expect(noMatch).toHaveRole("status");
  await expect(noMatch).toHaveAccessibleName(/No notifications match/);
  await expect(noMatch.locator('p span[lang="en"]')).toHaveText(SURFACE_TONE_COPY.notificationNoMatch.english[0]!);
  await expect(noMatch.locator('p span[lang="zh-HK"]')).toHaveText(SURFACE_TONE_COPY.notificationNoMatch.cantonese[4]!);
  await expect(page.getByTestId("notification-search-status")).toHaveAttribute("data-search-state", "no-match");
  await expect(page.getByTestId("notification-search-status")).toContainText("Showing 0 of 1 notification");
  await noMatch.getByRole("button", { name: /^Edit notification search/i }).click();
  await expect(input).toBeFocused();

  await anchor.locator('[data-action="toggle-regex-builder"]').click();
  builder = page.getByTestId("regex-popover");
  await builder.locator('textarea[data-regex-pattern="notifications"]').fill("(");
  await page.keyboard.press("Escape");
  await expect(builder).toHaveCount(0);
  await expect(input).toBeFocused();
  await expect(input).toHaveAttribute("aria-invalid", "true");
  const invalid = page.getByTestId("notification-search-invalid");
  await expect(invalid).toHaveRole("alert");
  await expect(invalid).toHaveAccessibleName(/Invalid notification search/);
  await expect(page.getByTestId("notification-search-empty")).toHaveCount(0);
  await expect(page.getByTestId("notification-search-status")).toHaveAttribute("data-search-state", "invalid");

  await input.fill("^Demo workspace ready$");
  await expect(page.getByTestId("notification-card")).toHaveCount(1);
  await expect(page.getByRole("button", { name: /Open Settings: Demo workspace ready/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Mark read/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Dismiss notification: Demo workspace ready/i })).toBeVisible();

  const stored = await page.evaluate(({ notificationKey, settingsKey }) => ({
    notification: localStorage.getItem(notificationKey),
    settings: localStorage.getItem(settingsKey),
  }), {
    notificationKey: NOTIFICATION_SEARCH_STORAGE_KEY,
    settingsKey: SETTINGS_SEARCH_STORAGE_KEY,
  });
  expect(JSON.parse(stored.notification ?? "null")).toEqual({
    mode: "regex",
    pattern: "^Demo workspace ready$",
    flags: "mu",
  });
  expect(stored.settings).toBeNull();

  await application.close();
  await launch();
  await ensureDemo();
  await openNotifications();

  const restoredAnchor = page.locator('[data-search-anchor="notifications"]');
  const restoredInput = restoredAnchor.locator('input[data-search-key="notifications"]');
  await expect(restoredInput).toHaveValue("^Demo workspace ready$");
  await expect(page.getByTestId("notification-card")).toHaveCount(1);
  await expect(page.getByTestId("notification-search-status")).toHaveAttribute("data-search-state", "matches");
  await restoredAnchor.locator('[data-action="toggle-regex-builder"]').click();
  builder = page.getByTestId("regex-popover");
  await expect(builder.locator('[data-action="set-regex-mode"][data-mode="regex"]')).toHaveAttribute("aria-pressed", "true");
  await expect(builder.getByRole("checkbox", { name: /Ignore case/i })).not.toBeChecked();
  await expect(builder.getByRole("checkbox", { name: /Multiline/i })).toBeChecked();
  await expect(builder.getByRole("checkbox", { name: /Unicode/i })).toBeChecked();
  await expect(builder.locator('textarea[data-regex-sample="notifications"]')).toContainText("Demo workspace ready");
  await expect(builder.locator('textarea[data-regex-sample="notifications"]')).not.toHaveValue("Transient notification sample");
});
