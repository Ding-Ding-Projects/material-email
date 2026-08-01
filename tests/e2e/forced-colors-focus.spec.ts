import { _electron as electron, expect, test, type ElectronApplication, type Locator, type Page } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test.setTimeout(90_000);

let application: ElectronApplication;
let page: Page;
let userData: string;

const focusStyle = (target: Locator) => target.evaluate(element => {
  const style = getComputedStyle(element);
  return {
    outlineStyle: style.outlineStyle,
    outlineWidth: style.outlineWidth,
    outlineOffset: style.outlineOffset,
    outlineColor: style.outlineColor,
    borderStyle: style.borderStyle,
    borderWidth: style.borderWidth,
    backgroundColor: style.backgroundColor,
    color: style.color,
    opacity: style.opacity,
    forcedColorAdjust: style.forcedColorAdjust,
  };
});

const expectFocusIndicator = async (indicator: Locator, offset: "0px" | "2px" | "-4px" = "2px"): Promise<void> => {
  const style = await focusStyle(indicator);
  expect(style.outlineStyle).toBe("solid");
  expect(style.outlineWidth).toBe("3px");
  expect(style.outlineOffset).toBe(offset);
  expect(style.outlineColor).not.toBe("rgba(0, 0, 0, 0)");
};

const expectKeyboardFocus = async (target: Locator, offset: "0px" | "2px" | "-4px" = "2px"): Promise<void> => {
  await expect(target).toBeFocused();
  await expectFocusIndicator(target, offset);
};

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(os.tmpdir(), "material-email-forced-colors-e2e-"));
  application = await electron.launch({
    args: [path.resolve(".")],
    env: { ...process.env, MATERIAL_EMAIL_USER_DATA_DIR: userData, MATERIAL_EMAIL_HEADLESS: "1" },
  });
  page = await application.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await page.getByTestId("onboarding").waitFor({ state: "visible" });
  await page.getByTestId("demo-action").click();
  await expect(page.getByTestId("app-shell")).toBeVisible();
  await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  expect(await page.evaluate(() => matchMedia("(forced-colors: active)").matches)).toBe(true);
});

test.afterAll(async () => {
  await application?.close();
  await rm(userData, { recursive: true, force: true });
});

test("keeps caption and notification-centre actions distinguishable under emulated forced colors", async () => {
  const controls = page.getByTestId("window-controls");
  const minimize = controls.locator('[data-action="window-minimize"]');
  const maximize = controls.locator('[data-action="window-maximize"]');
  const close = controls.locator('[data-action="window-close"]');

  await minimize.focus();
  await page.keyboard.press("Tab");
  await expectKeyboardFocus(maximize, "-4px");
  expect((await focusStyle(maximize)).borderWidth).toBe("1px");
  await page.keyboard.press("Tab");
  await expectKeyboardFocus(close, "-4px");

  await page.locator('[role="tab"][data-tab-id="notifications"]').click();
  let card = page.getByTestId("notification-card").filter({ hasText: "Demo workspace ready" });
  const open = card.getByRole("button", { name: "Open Settings: Demo workspace ready" });
  await open.focus();
  await page.keyboard.press("Tab");
  const read = card.getByRole("button", { name: "Mark read" });
  await expectKeyboardFocus(read);
  await read.press("Enter");

  card = page.getByTestId("notification-card").filter({ hasText: "Demo workspace ready" });
  await expect(card).toHaveClass(/is-read/);
  expect((await focusStyle(card)).opacity).toBe("1");
  const dismiss = card.getByRole("button", { name: "Dismiss notification: Demo workspace ready" });
  await dismiss.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expectKeyboardFocus(dismiss);
  await dismiss.press("Enter");

  card = page.getByTestId("notification-card").filter({ hasText: "Demo workspace ready" });
  await expect(card).toHaveClass(/is-dismissed/);
  expect((await focusStyle(card)).borderStyle).toBe("dashed");
  const restore = card.getByRole("button", { name: "Restore notification: Demo workspace ready" });
  await expect(restore).toHaveAttribute("aria-pressed", "true");
  const restoreStyle = await focusStyle(restore);
  expect(restoreStyle.borderWidth).toBe("2px");
  expect(restoreStyle.forcedColorAdjust).toBe("none");
});

test("keeps appearance-preset and both date-picker focus/state cues visible under emulation", async () => {
  const settingsTab = page.locator('[role="tab"][data-tab-id="settings"]');
  await settingsTab.click();
  await settingsTab.focus();
  await page.keyboard.press("Control+Shift+E");

  const editor = page.getByTestId("tab-appearance-editor");
  const presets = editor.locator("[data-appearance-preset]");
  await presets.focus();
  await page.keyboard.press("Tab");
  const apply = editor.locator('[data-action="apply-tab-appearance-preset"]');
  await expectKeyboardFocus(apply);
  expect((await focusStyle(apply)).borderWidth).toBe("1px");
  await page.keyboard.press("Shift+Tab");
  await expect(presets).toBeFocused();
  await expectFocusIndicator(presets.locator("xpath=.."), "0px");
  await page.keyboard.press("Escape");
  await expect(editor).toBeHidden();

  for (const target of [
    { tab: "history", pageId: "history-page", pickerId: "history-calendar" },
    { tab: "changelog", pageId: "changelog-page", pickerId: "changelog-calendar" },
  ] as const) {
    await page.locator(`[role="tab"][data-tab-id="${target.tab}"]`).click();
    const surface = page.getByTestId(target.pageId);
    await surface.getByRole("button", { name: /Choose dates/i }).click();
    const picker = surface.getByTestId(target.pickerId);
    const surfaceBackground = (await focusStyle(picker)).backgroundColor;

    await page.keyboard.press("ArrowRight");
    let day = picker.locator('[role="gridcell"][tabindex="0"]');
    await expectKeyboardFocus(day);
    await day.press("Enter");
    day = picker.locator('[role="gridcell"][tabindex="0"]');
    await expect(day).toHaveClass(/is-range-start/);
    await expectKeyboardFocus(day, "0px");
    const selectedStyle = await focusStyle(day);
    expect(selectedStyle.borderWidth).toBe("2px");
    expect(selectedStyle.forcedColorAdjust).toBe("none");
    expect(selectedStyle.backgroundColor).not.toBe(surfaceBackground);
    expect(selectedStyle.color).not.toBe(selectedStyle.backgroundColor);
    expect(selectedStyle.outlineColor).not.toBe(selectedStyle.backgroundColor);

    await page.keyboard.press("Escape");
    await expect(picker).toBeHidden();
  }
});
