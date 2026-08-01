import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

let application: ElectronApplication;
let page: Page;
let userData: string;

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(os.tmpdir(), "material-email-history-e2e-"));
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

test("searches, diffs, labels, and reviews restore for a local Git revision", async () => {
  await page.getByRole("tab", { name: /^History$/i }).click();
  const versions = page.getByTestId("local-versions");
  await expect(versions).toBeVisible();
  const rows = versions.getByTestId("local-revision-row");
  await expect.poll(() => rows.count()).toBeGreaterThanOrEqual(2);

  const first = rows.first();
  await first.getByRole("button", { name: /View changes/i }).click();
  const detail = first.getByTestId("local-revision-detail");
  await expect(detail).toBeVisible();
  await expect(detail.locator(".revision-diff-line").first()).toBeVisible();

  const label = detail.getByRole("textbox", { name: /Revision label/i });
  await label.fill("Demo ready · 示範準備好");
  await detail.getByRole("button", { name: /Save label/i }).click();
  await expect(page.getByTestId("toast-region")).toContainText(/Revision label saved/i);
  await expect(first.locator("strong").first()).toHaveText("Demo ready · 示範準備好");

  const search = versions.locator('[data-search-anchor="history-versions"] input[type="search"]');
  await search.fill("示範準備好");
  await expect(versions.getByTestId("local-revision-row")).toHaveCount(1);
  await versions.getByRole("button", { name: /^Restore$/i }).click();
  const decision = page.getByRole("alertdialog");
  await expect(decision).toContainText("Demo ready · 示範準備好");
  await decision.getByRole("button", { name: /Cancel/i }).click();
  await expect(decision).toBeHidden();

  const retention = page.getByTestId("history-retention");
  await expect(retention).toBeVisible();
  const days = retention.getByRole("combobox", { name: /Keep unlabeled revisions for/i });
  await expect(days).toHaveValue("365");
  await days.selectOption("30");
  await expect.poll(() => page.evaluate(() => window.materialEmail.bootstrap().then(result => result.preferences.historyRetentionDays))).toBe(30);
  await retention.getByRole("button", { name: /Preview pruning/i }).click();
  const preview = page.getByTestId("history-retention-preview");
  await expect(preview).toBeVisible();
  await expect(preview).toContainText(/Dry-run result/i);
  await expect(preview).toContainText(/current.*labeled.*recent revisions protected/i);

  const deletionPolicy = page.getByTestId("history-deletion-policy");
  await deletionPolicy.getByRole("button", { name: /Inspect deletion limits/i }).click();
  const evidence = page.getByTestId("history-deletion-evidence");
  await expect(evidence).toBeVisible();
  await expect(evidence).toContainText(/Active-history pruning only/i);
  await expect(evidence).toContainText(/Cryptographic erasure is not provided/i);
  await expect(evidence).toContainText(/Not performed: cryptographic erasure, reflog expiry, Git garbage collection/i);
});

test("composes the anchored history calendar with action and regex filters", async () => {
  await page.getByRole("tab", { name: /^History$/i }).click();
  const history = page.getByTestId("history-page");
  const cards = history.locator(".history-list .history-card");
  await expect.poll(() => cards.count()).toBeGreaterThan(0);
  const initialCount = await cards.count();
  const firstCard = cards.first();
  const label = (await firstCard.getByRole("heading").innerText()).trim();
  const kind = (await firstCard.locator(".kind-badge").innerText()).trim().replaceAll(" ", "-");
  const createdAt = await firstCard.locator("time").getAttribute("datetime");
  expect(createdAt).toBeTruthy();
  const recordDate = await page.evaluate(value => {
    const date = new Date(value!);
    return `${String(date.getFullYear()).padStart(4, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }, createdAt);

  const fromDate = history.locator('[data-history-date="from"]');
  const throughDate = history.locator('[data-history-date="to"]');
  const exportButton = history.getByRole("button", { name: /Export view/i });
  await fromDate.fill("2026-02-31");
  await expect(fromDate).toHaveValue("2026-02-31");
  await expect(fromDate).toHaveAttribute("aria-invalid", "true");
  await expect(history.getByRole("alert")).toContainText(/Enter a real calendar date/i);
  await expect(exportButton).toBeDisabled();

  await fromDate.fill("2026-08");
  await expect(fromDate).toHaveValue("2026-08");
  await expect(history.getByRole("alert")).toContainText(/Finish entering the date/i);
  await fromDate.fill("");

  const calendarTrigger = history.getByRole("button", { name: /Choose dates/i });
  await calendarTrigger.click();
  const calendar = history.getByTestId("history-calendar");
  await expect(calendar).toBeVisible();
  await expect(calendar).toHaveAttribute("aria-modal", "false");
  const focusedDay = calendar.locator('[data-history-calendar-day][tabindex="0"]');
  const focusedIso = await focusedDay.getAttribute("data-history-calendar-day");
  expect(focusedIso).toBeTruthy();
  await expect(focusedDay).toBeFocused();
  const nextIso = new Date(`${focusedIso}T00:00:00Z`);
  nextIso.setUTCDate(nextIso.getUTCDate() + 1);
  await page.keyboard.press("ArrowRight");
  await expect(calendar.locator(`[data-history-calendar-day="${nextIso.toISOString().slice(0, 10)}"]`)).toBeFocused();

  const yearJump = calendar.getByRole("spinbutton", { name: /Calendar year/i });
  const originalYear = Number((await yearJump.inputValue()));
  await yearJump.fill(String(originalYear - 1));
  await yearJump.blur();
  await expect(calendar.locator(".changelog-calendar__month-label")).toContainText(String(originalYear - 1));
  await yearJump.fill(String(originalYear));
  await yearJump.blur();

  await calendar.getByRole("button", { name: /Last 7 days/i }).click();
  await expect(fromDate).toHaveValue(/^\d{4}-\d{2}-\d{2}$/u);
  await expect(throughDate).toHaveValue(/^\d{4}-\d{2}-\d{2}$/u);
  await calendar.getByRole("button", { name: /Clear dates/i }).click();
  await expect(fromDate).toHaveValue("");
  await expect(throughDate).toHaveValue("");
  await expect(cards).toHaveCount(initialCount);

  const [recordYear, recordMonth] = recordDate.split("-").map(Number) as [number, number];
  await calendar.getByRole("spinbutton", { name: /Calendar year/i }).fill(String(recordYear));
  await calendar.getByRole("spinbutton", { name: /Calendar year/i }).blur();
  await calendar.getByRole("combobox", { name: /Calendar month/i }).selectOption(String(recordMonth));
  const recordDay = calendar.locator(`[data-history-calendar-day="${recordDate}"]`);
  await recordDay.click();
  await expect(fromDate).toHaveValue(recordDate);
  await expect(throughDate).toHaveValue("");
  await recordDay.click();
  await expect(throughDate).toHaveValue(recordDate);
  await calendar.getByRole("button", { name: /^Done$/i }).click();
  await expect(calendar).toBeHidden();
  await expect(calendarTrigger).toBeFocused();

  await history.locator(`[data-history-action="${kind}"]`).check({ force: true });
  const search = history.locator('[data-search-anchor="history"] input[type="search"]');
  await search.fill(label.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"));
  const searchAnchor = history.locator('[data-search-anchor="history"]');
  await searchAnchor.getByRole("button", { name: /Open regular expression builder/i }).click();
  const builder = searchAnchor.getByTestId("regex-popover");
  await builder.getByRole("button", { name: /^Regular expression$/i }).click();
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText(label);
  await expect(exportButton).toBeEnabled();
});
