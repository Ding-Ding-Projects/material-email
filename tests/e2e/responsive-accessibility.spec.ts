import { _electron as electron, expect, test, type ElectronApplication, type Locator, type Page } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

let application: ElectronApplication;
let page: Page;
let userData: string;

const waitForAnchoredLayout = async (): Promise<void> => {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
};

const expectInsideViewport = async (surface: Locator, margin = 10): Promise<void> => {
  const box = await surface.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(margin);
  expect(box!.y).toBeGreaterThanOrEqual(margin);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width - margin);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height - margin);
};

const expectNoHorizontalOverflow = async (surface: Locator): Promise<void> => {
  const dimensions = await surface.evaluate(element => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
};

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(os.tmpdir(), "material-email-responsive-e2e-"));
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

test("keeps the expanded tab appearance editor usable across narrow effective viewports with reduced motion", async () => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 760, height: 560 });
  const settingsTab = page.locator('[role="tab"][data-tab-id="settings"]');
  await settingsTab.click();
  await settingsTab.focus();
  await page.keyboard.press("Control+Shift+E");

  const editor = page.getByTestId("tab-appearance-editor");
  const initialControl = editor.locator('input[type="color"][data-tab-style="background"]');
  await expect(editor).toBeVisible();
  await expect(initialControl).toBeFocused();
  await expectInsideViewport(editor);
  await expectNoHorizontalOverflow(editor);

  for (const viewport of [
    { width: 608, height: 448 },
    { width: 507, height: 373 },
    { width: 380, height: 280 },
  ]) {
    await page.setViewportSize(viewport);
    await waitForAnchoredLayout();
    await expectInsideViewport(editor);
    await expectNoHorizontalOverflow(editor);
    await expect(initialControl).toBeFocused();
  }

  const reducedMotion = await page.locator("[data-tooltip]").first().evaluate(element => {
    const motion = getComputedStyle(element, "::after");
    return {
      matches: matchMedia("(prefers-reduced-motion: reduce)").matches,
      transitionDelay: motion.transitionDelay,
      transitionDuration: motion.transitionDuration,
    };
  });
  expect(reducedMotion).toEqual({ matches: true, transitionDelay: "0s", transitionDuration: "0.001s" });

  const done = editor.getByRole("button", { name: /^Done$/i });
  await done.scrollIntoViewIfNeeded();
  await expectInsideViewport(done, 0);
  await page.keyboard.press("Escape");
  await expect(editor).toBeHidden();
  await expect(settingsTab).toBeFocused();
});

test("keeps History and Changelog date pickers collision-safe and restores focus", async () => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 760, height: 560 });

  for (const target of [
    { tab: /^History$/i, pageId: "history-page", pickerId: "history-calendar" },
    { tab: /^Changelog$/i, pageId: "changelog-page", pickerId: "changelog-calendar" },
  ]) {
    await page.getByRole("tab", { name: target.tab }).click();
    const surface = page.getByTestId(target.pageId);
    const trigger = surface.getByRole("button", { name: /Choose dates/i });
    await trigger.click();
    const picker = surface.getByTestId(target.pickerId);
    const focusedDay = picker.locator('[role="gridcell"][tabindex="0"]');
    await expect(picker).toBeVisible();
    await expect(picker).toHaveAttribute("aria-modal", "false");
    await expect(picker).toHaveCSS("position", "fixed");
    await expect(focusedDay).toBeFocused();
    await expectInsideViewport(picker);
    await expectNoHorizontalOverflow(picker);
    await expectNoHorizontalOverflow(picker.locator(".changelog-calendar__navigation"));

    for (const viewport of [
      { width: 608, height: 448 },
      { width: 380, height: 280 },
    ]) {
      await page.setViewportSize(viewport);
      await waitForAnchoredLayout();
      await expectInsideViewport(picker);
      await expectNoHorizontalOverflow(picker);
      await expectNoHorizontalOverflow(picker.locator(".changelog-calendar__navigation"));
      await expect(focusedDay).toBeFocused();
    }

    await page.keyboard.press("Escape");
    await expect(picker).toBeHidden();
    await expect(trigger).toBeFocused();
    await page.setViewportSize({ width: 760, height: 560 });
  }
});
