import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

let application: ElectronApplication | undefined;
let page: Page;
let userData: string;

const launch = async (): Promise<void> => {
  application = await electron.launch({
    args: [path.resolve(".")],
    env: { ...process.env, MATERIAL_EMAIL_USER_DATA_DIR: userData, MATERIAL_EMAIL_HEADLESS: "1" },
  });
  page = await application.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await page.locator('[data-testid="onboarding"], [data-testid="app-shell"]').first().waitFor({ state: "visible" });
};

const ensureDemo = async (): Promise<void> => {
  const onboarding = page.getByTestId("onboarding");
  if (await onboarding.isVisible()) await page.getByTestId("demo-action").click();
  await expect(page.getByTestId("app-shell")).toBeVisible();
};

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(os.tmpdir(), "material-email-window-controls-e2e-"));
  await launch();
  await ensureDemo();
});

test.afterAll(async () => {
  await application?.close().catch(() => undefined);
  await rm(userData, { recursive: true, force: true });
});

test("names every caption action, keeps it keyboard reachable, and synchronizes maximize/restore", async () => {
  const controls = page.getByTestId("window-controls");
  await expect(controls).toHaveAttribute("role", "group");
  await expect(controls).toHaveAttribute("aria-label", /Window controls/i);

  const minimize = controls.locator('[data-action="window-minimize"]');
  const maximize = controls.locator('[data-action="window-maximize"]');
  const close = controls.locator('[data-action="window-close"]');
  await expect(minimize).toHaveAccessibleName(/Minimize window/i);
  await expect(maximize).toHaveAccessibleName(/Maximize window/i);
  await expect(close).toHaveAccessibleName(/Close window/i);

  await minimize.focus();
  await expect(minimize).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(maximize).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  expect(await close.evaluate(element => {
    const style = getComputedStyle(element);
    return { width: style.minWidth, outlineWidth: style.outlineWidth, outlineOffset: style.outlineOffset };
  })).toEqual({ width: "48px", outlineWidth: "3px", outlineOffset: "-4px" });

  await application!.evaluate(({ BrowserWindow }) => {
    const target = BrowserWindow.getAllWindows()[0];
    if (!target) throw new Error("The main window is missing.");
    const scope = globalThis as typeof globalThis & { windowControlMinimizeCalls?: number; originalWindowMinimize?: () => void };
    scope.windowControlMinimizeCalls = 0;
    scope.originalWindowMinimize = target.minimize.bind(target);
    target.minimize = () => { scope.windowControlMinimizeCalls = (scope.windowControlMinimizeCalls ?? 0) + 1; };
  });
  await minimize.click();
  await expect.poll(() => application!.evaluate(() =>
    (globalThis as typeof globalThis & { windowControlMinimizeCalls?: number }).windowControlMinimizeCalls ?? 0,
  )).toBe(1);
  await application!.evaluate(({ BrowserWindow }) => {
    const target = BrowserWindow.getAllWindows()[0];
    const scope = globalThis as typeof globalThis & { originalWindowMinimize?: () => void };
    if (target && scope.originalWindowMinimize) target.minimize = scope.originalWindowMinimize;
  });

  await maximize.click();
  await expect.poll(() => application!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isMaximized() ?? false)).toBe(true);
  await expect(maximize).toHaveAccessibleName(/Restore window/i);
  await expect(maximize).toHaveAttribute("aria-pressed", "true");
  await maximize.click();
  await expect.poll(() => application!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isMaximized() ?? true)).toBe(false);
  await expect(maximize).toHaveAccessibleName(/Maximize window/i);
});

test("restores validated normal bounds and maximized state across a full Electron restart", async () => {
  const expectedBounds = await application!.evaluate(({ BrowserWindow }) => {
    const target = BrowserWindow.getAllWindows()[0];
    if (!target) throw new Error("The main window is missing.");
    const current = target.getNormalBounds();
    target.setBounds({ x: current.x + 12, y: current.y + 8, width: 980, height: 700 });
    return target.getNormalBounds();
  });
  const stateFile = path.join(userData, "window-state.json");
  await expect.poll(async () => JSON.parse(await readFile(stateFile, "utf8"))).toMatchObject({ bounds: expectedBounds, maximized: false });

  await page.getByTestId("window-controls").locator('[data-action="window-maximize"]').click();
  await expect.poll(async () => JSON.parse(await readFile(stateFile, "utf8"))).toMatchObject({ bounds: expectedBounds, maximized: true });
  await application!.close();
  application = undefined;

  await launch();
  await ensureDemo();
  await expect.poll(() => application!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isMaximized() ?? false)).toBe(true);
  expect(await application!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getNormalBounds())).toEqual(expectedBounds);
  await page.getByTestId("window-controls").locator('[data-action="window-maximize"]').click();
  await expect.poll(() => application!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isMaximized() ?? true)).toBe(false);
});

test("uses bilingual humor copy and reviews unsaved work before the window closes", async () => {
  await page.evaluate(() => window.materialEmail.savePreferences({ language: "bilingual", funnyEnglish: 1, funnyCantonese: 5 }));
  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  await expect(page.getByTestId("app-shell")).toBeVisible();

  const close = page.getByTestId("window-controls").locator('[data-action="window-close"]');
  await expect(close).toHaveAccessibleName("Close window");
  await expect(close).toHaveAttribute("data-tooltip", /Close window · 關閉視窗——未完成更改要先見迷你寫字板督察/);

  await page.locator('[data-action="compose"]').first().click();
  const composer = page.getByTestId("compose-form");
  await composer.locator("#compose-subject").fill("Unsaved native close evidence");
  await composer.locator("#compose-body").fill("This content must remain until the reviewed close decision.");
  await close.click();

  const decision = page.getByRole("alertdialog");
  await expect(decision).toBeVisible();
  await expect(decision).toContainText("Close Material Email with unsaved work?");
  await expect(decision).toContainText("迷你未完成更改委員會收工");
  const keepOpen = decision.getByRole("button", { name: "Keep Material Email open" });
  await expect(keepOpen).toBeFocused();
  await keepOpen.click();
  await expect(close).toBeFocused();
  await expect(composer.locator("#compose-body")).toHaveValue("This content must remain until the reviewed close decision.");

  await application!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
  await expect(page.getByRole("alertdialog")).toBeVisible();
  const closed = application!.waitForEvent("close");
  await page.getByRole("alertdialog").getByRole("button", { name: "Discard unsaved work and close" }).click();
  await closed;
  application = undefined;
});
