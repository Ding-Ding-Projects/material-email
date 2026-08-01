import { test, expect, _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

let application: ElectronApplication;
let page: Page;
let userData: string;

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(os.tmpdir(), "material-email-command-search-e2e-"));
  application = await electron.launch({
    args: [path.resolve(".")],
    env: { ...process.env, MATERIAL_EMAIL_USER_DATA_DIR: userData, MATERIAL_EMAIL_HEADLESS: "1" },
  });
  page = await application.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  const onboarding = page.getByTestId("onboarding");
  await page.locator('[data-testid="onboarding"], [data-testid="app-shell"]').first().waitFor({ state: "visible" });
  if (await onboarding.isVisible()) await page.getByTestId("demo-action").click();
  await expect(page.getByTestId("app-shell")).toBeVisible();
});

test.afterAll(async () => {
  await application?.close();
  if (userData) await rm(userData, { recursive: true, force: true });
});

test("gives command search an independent anchored builder and blocks invalid execution", async () => {
  await page.keyboard.press("Control+K");
  const palette = page.getByTestId("command-palette");
  const anchor = palette.locator('[data-search-anchor="commands"]');
  const input = anchor.locator('input[data-search-key="commands"]');
  await expect(palette).toBeVisible();
  await expect(input).toBeFocused();

  await input.fill("open .*");
  await expect(palette.locator('[role="option"]')).toHaveCount(0);
  await input.fill("OPEN SETTINGS");
  await expect(palette.locator('[role="option"]')).toHaveCount(1);
  await expect(palette.locator('[role="option"]')).toContainText("Open Settings");

  await page.setViewportSize({ width: 760, height: 560 });
  await anchor.locator('[data-action="toggle-regex-builder"]').click();
  let builder = palette.locator('[data-testid="regex-popover"][data-search-owner="commands"]');
  await expect(builder).toBeVisible();
  await expect(builder.getByRole("button", { name: /^Plain text$/i })).toHaveClass(/is-selected/);
  const [anchorBox, builderBox] = await Promise.all([anchor.boundingBox(), builder.boundingBox()]);
  expect(anchorBox).not.toBeNull();
  expect(builderBox).not.toBeNull();
  expect(builderBox!.y).toBeGreaterThanOrEqual(anchorBox!.y + anchorBox!.height - 1);
  expect(builderBox!.x).toBeGreaterThanOrEqual(0);
  expect(builderBox!.x + builderBox!.width).toBeLessThanOrEqual(760);
  expect(builderBox!.y + builderBox!.height).toBeLessThanOrEqual(560);

  await builder.getByRole("button", { name: /^Regular expression$/i }).click();
  builder = palette.locator('[data-testid="regex-popover"][data-search-owner="commands"]');
  const pattern = builder.locator('textarea[data-regex-pattern="commands"]');
  await pattern.fill("(");
  await expect(input).toHaveAttribute("aria-invalid", "true");
  await expect(builder.getByRole("button", { name: /Use in search/i })).toBeDisabled();
  await expect(palette.locator('[role="option"]')).toHaveCount(0);

  await page.keyboard.press("Escape");
  await expect(builder).toBeHidden();
  await expect(palette).toBeVisible();
  await expect(input).toBeFocused();
  await anchor.locator('[data-action="toggle-regex-builder"]').click();
  builder = palette.locator('[data-testid="regex-popover"][data-search-owner="commands"]');

  await builder.locator('textarea[data-regex-pattern="commands"]').fill("^Open (Settings|History)");
  await expect(input).toHaveAttribute("aria-invalid", "false");
  await builder.getByRole("button", { name: /Use in search/i }).click();
  await expect(builder).toBeHidden();
  await expect(palette.locator('[role="option"]')).toHaveCount(2);

  await input.focus();
  await page.keyboard.press("Enter");
  await expect(palette).toBeHidden();
  await expect(page.getByTestId("settings-page")).toBeVisible();
});
