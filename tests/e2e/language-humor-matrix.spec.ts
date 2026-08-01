import { _electron as electron, expect, test, type ElectronApplication, type Locator, type Page } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SURFACE_TONE_COPY } from "../../src/renderer/lib/localization";

test.setTimeout(90_000);

let application: ElectronApplication;
let page: Page;
let userData: string;

type LanguageMode = "en" | "yue" | "bilingual";
type FunnyLevel = 1 | 2 | 3 | 4 | 5;

const openTab = async (id: string, testId: string): Promise<Locator> => {
  await page.locator(`[role="tab"][data-tab-id="${id}"]`).click();
  const surface = page.getByTestId(testId);
  await expect(surface).toBeVisible();
  return surface;
};

const setRange = async (name: "funnyEnglish" | "funnyCantonese", value: FunnyLevel): Promise<void> => {
  await page.locator(`input[data-pref="${name}"]`).evaluate((node, nextValue) => {
    const input = node as HTMLInputElement;
    input.value = String(nextValue);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
};

const setLanguageHumor = async (language: LanguageMode, funnyEnglish: FunnyLevel, funnyCantonese: FunnyLevel): Promise<void> => {
  await openTab("settings", "settings-page");
  await setRange("funnyEnglish", funnyEnglish);
  await setRange("funnyCantonese", funnyCantonese);
  await page.locator('select[data-pref="language"]').selectOption(language);
  await expect(page.locator('select[data-pref="language"]')).toHaveValue(language);
};

const expectTone = async (target: Locator, language: LanguageMode, english: string, cantonese: string): Promise<void> => {
  if (language === "bilingual") {
    await expect(target.locator('span[lang="en"]')).toHaveText(english);
    await expect(target.locator('span[lang="zh-HK"]')).toHaveText(cantonese);
    return;
  }
  await expect(target).toHaveText(language === "yue" ? cantonese : english);
};

const expectTargetSurfaces = async (
  language: LanguageMode,
  englishIndex: number,
  cantoneseIndex: number,
): Promise<void> => {
  const settingsTab = page.locator('[role="tab"][data-tab-id="settings"]');
  await settingsTab.focus();
  await page.keyboard.press("Control+Shift+E");
  const appearanceTone = page.getByTestId("appearance-tone");
  await expectTone(
    appearanceTone,
    language,
    SURFACE_TONE_COPY.appearance.english[englishIndex]!,
    SURFACE_TONE_COPY.appearance.cantonese[cantoneseIndex]!,
  );
  await page.keyboard.press("Escape");

  const history = await openTab("history", "history-page");
  await history.locator('[data-action="toggle-history-calendar"]').click();
  await expectTone(
    history.getByTestId("history-calendar-tone"),
    language,
    SURFACE_TONE_COPY.historyDatePicker.english[englishIndex]!,
    SURFACE_TONE_COPY.historyDatePicker.cantonese[cantoneseIndex]!,
  );
  await page.keyboard.press("Escape");

  const changelog = await openTab("changelog", "changelog-page");
  await changelog.locator('[data-action="toggle-changelog-calendar"]').click();
  await expectTone(
    changelog.getByTestId("changelog-calendar-tone"),
    language,
    SURFACE_TONE_COPY.changelogDatePicker.english[englishIndex]!,
    SURFACE_TONE_COPY.changelogDatePicker.cantonese[cantoneseIndex]!,
  );
  await page.keyboard.press("Escape");

  const notifications = await openTab("notifications", "notifications-page");
  await expectTone(
    notifications.getByTestId("notifications-tone"),
    language,
    SURFACE_TONE_COPY.notifications.english[englishIndex]!,
    SURFACE_TONE_COPY.notifications.cantonese[cantoneseIndex]!,
  );
};

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(os.tmpdir(), "material-email-language-humor-e2e-"));
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

test("applies all language modes and independent humor levels to the new UX surfaces", async () => {
  await setLanguageHumor("en", 1, 5);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expectTargetSurfaces("en", 0, 4);

  await setLanguageHumor("yue", 1, 5);
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-HK");
  await expectTargetSurfaces("yue", 0, 4);

  await setLanguageHumor("bilingual", 1, 5);
  await expectTargetSurfaces("bilingual", 0, 4);
  await openTab("settings", "settings-page");
  await page.locator('[data-action="reset-appearance"]').click();
  const bilingualToast = page.getByTestId("toast-region").locator(".toast").last();
  await expect(bilingualToast.locator('.toast__copy p span[lang="en"]')).toContainText("Theme, density, accent, font, scale, and weight returned to their defaults.");
  await expect(bilingualToast.locator('.toast__copy p span[lang="zh-HK"]')).toContainText("迷你謝幕禮");

  await setLanguageHumor("bilingual", 5, 1);
  await expectTargetSurfaces("bilingual", 4, 0);
});
