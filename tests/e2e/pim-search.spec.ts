import { _electron as electron, expect, test, type ElectronApplication, type Locator, type Page } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PIM_SEARCH_STORAGE_KEY } from "../../src/renderer/lib/pim-search";

test.setTimeout(120_000);

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

const restart = async (): Promise<void> => {
  await application.close();
  await launch();
  await expect(page.getByTestId("onboarding")).toHaveCount(0);
  await expect(page.getByTestId("app-shell")).toBeVisible();
};

const openWorkspaceTab = async (name: RegExp, pageTestId: string): Promise<void> => {
  await page.getByRole("tab", { name }).click();
  await expect(page.getByTestId(pageTestId)).toBeVisible();
};

const setFunnyLevel = async (name: "funnyEnglish" | "funnyCantonese", value: 1 | 5): Promise<void> => {
  await page.locator(`input[data-pref="${name}"]`).evaluate((node, nextValue) => {
    const input = node as HTMLInputElement;
    input.value = String(nextValue);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
};

const openRegexBuilder = async (anchor: Locator): Promise<Locator> => {
  await anchor.locator('[data-action="toggle-regex-builder"]').click();
  const builder = page.getByTestId("regex-popover");
  await expect(builder).toBeVisible();
  return builder;
};

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(os.tmpdir(), "material-email-pim-search-e2e-"));
  await launch();
});

test.afterAll(async () => {
  await application?.close();
  await rm(userData, { recursive: true, force: true });
});

test("restores six independent PIM searches with semantic states, localized counts, and focus recovery", async () => {
  await ensureDemo();
  await openWorkspaceTab(/^Settings/i, "settings-page");
  await setFunnyLevel("funnyEnglish", 1);
  await setFunnyLevel("funnyCantonese", 5);
  await page.locator('select[data-pref="language"]').selectOption("bilingual");

  const contactName = "Avery Search Ledger";
  const listName = "Search Persistence Crew";
  const eventTitle = "PIM Search Planning";
  const eventLocation = "Room PIM 42";
  const taskTitle = "Verify PIM search restart";

  await openWorkspaceTab(/^Contacts/i, "contacts-page");
  await page.getByTestId("add-contact").click();
  let editor = page.getByTestId("pim-editor");
  await editor.getByTestId("contact-name").fill(contactName);
  await editor.getByTestId("contact-email").fill("avery.search@example.test");
  await editor.getByTestId("save-contact").click();
  await expect(page.getByTestId("contact-card")).toHaveCount(1);

  await page.getByRole("tab", { name: /Mailing lists/i }).click();
  await page.getByTestId("add-mailing-list").click();
  editor = page.getByTestId("pim-editor");
  await editor.getByTestId("mailing-list-name").fill(listName);
  await editor.getByRole("checkbox", { name: new RegExp(contactName, "i") }).check();
  await editor.getByTestId("save-mailing-list").click();
  await expect(page.getByTestId("mailing-list-card").filter({ hasText: listName })).toHaveCount(1);

  await openWorkspaceTab(/^Calendar/i, "calendar-page");
  await page.getByTestId("add-calendar-event").click();
  editor = page.getByTestId("pim-editor");
  await editor.getByTestId("event-title").fill(eventTitle);
  await editor.getByTestId("event-start").fill("2033-06-15T09:30");
  await editor.getByTestId("event-end").fill("2033-06-15T10:30");
  await editor.getByTestId("event-location").fill(eventLocation);
  await editor.getByTestId("save-calendar-event").click();
  await expect(page.getByTestId("calendar-event-card")).toHaveCount(1);

  await openWorkspaceTab(/^Tasks/i, "tasks-page");
  await page.getByTestId("add-task").click();
  editor = page.getByTestId("pim-editor");
  await editor.getByTestId("task-title").fill(taskTitle);
  await editor.getByTestId("task-due").fill("2033-06-20");
  await editor.getByTestId("save-task").click();
  await expect(page.getByTestId("task-card")).toHaveCount(1);

  await openWorkspaceTab(/^Contacts/i, "contacts-page");
  await page.getByRole("tab", { name: /^People/i }).click();
  const contactAnchor = page.locator('[data-search-anchor="contacts"]');
  let builder = await openRegexBuilder(contactAnchor);
  await builder.getByRole("button", { name: /^Regular expression/i }).click();
  await builder.getByRole("checkbox", { name: /Ignore case/i }).uncheck();
  await builder.getByRole("checkbox", { name: /Multiline/i }).check();
  await builder.getByRole("checkbox", { name: /Unicode/i }).check();
  await builder.locator('textarea[data-regex-pattern="contacts"]').fill("^Avery Search Ledger$");
  await builder.locator('textarea[data-regex-sample="contacts"]').fill("Transient contact sample");
  await page.keyboard.press("Escape");
  await expect(builder).toHaveCount(0);
  await expect(contactAnchor.locator('input[data-search-key="contacts"]')).toBeFocused();
  await expect(page.locator('[data-pim-search-status="contacts"]')).toHaveAttribute("data-search-state", "matches");
  await expect(page.locator('[data-pim-search-status="contacts"]')).toContainText("Showing 1 of 1 contact.");
  await expect(page.locator('[data-pim-search-status="contacts"]')).toContainText("顯示 1 個聯絡人入面嘅 1 個。");

  await page.getByRole("tab", { name: /Mailing lists/i }).click();
  const listInput = page.locator('input[data-search-key="mailing-lists"]');
  await listInput.fill("Definitely absent mailing list");
  let noMatch = page.locator('[data-testid="pim-search-empty"][data-pim-search-key="mailing-lists"]');
  await expect(noMatch).toHaveRole("status");
  await expect(noMatch).toHaveAccessibleName(/No mailing lists match/i);
  await expect(page.locator('[data-pim-search-status="mailing-lists"]')).toHaveAttribute("data-search-state", "no-match");
  await noMatch.getByRole("button", { name: /^Edit mailing-list search/i }).click();
  await expect(listInput).toBeFocused();

  await openWorkspaceTab(/^Calendar/i, "calendar-page");
  await page.locator('input[data-search-key="calendar-events"]').fill(eventLocation);
  await expect(page.locator('[data-pim-search-status="calendar-events"]')).toHaveAttribute("data-search-state", "matches");
  await expect(page.getByTestId("calendar-event-card")).toContainText(eventTitle);

  await openWorkspaceTab(/^Tasks/i, "tasks-page");
  const taskAnchor = page.locator('[data-search-anchor="tasks"]');
  builder = await openRegexBuilder(taskAnchor);
  await builder.getByRole("button", { name: /^Regular expression/i }).click();
  await builder.locator('textarea[data-regex-pattern="tasks"]').fill("(");
  await page.keyboard.press("Escape");
  await expect(taskAnchor.locator('input[data-search-key="tasks"]')).toBeFocused();
  await expect(page.locator('[data-pim-search-status="tasks"]')).toHaveAttribute("data-search-state", "invalid");
  const invalid = page.locator('[data-testid="pim-search-invalid"][data-pim-search-key="tasks"]');
  await expect(invalid).toHaveRole("alert");
  await expect(invalid).toHaveAccessibleName(/Invalid task search/i);
  await expect(page.locator('[data-testid="pim-search-empty"][data-pim-search-key="tasks"]')).toHaveCount(0);

  await openWorkspaceTab(/^Contacts/i, "contacts-page");
  await page.getByRole("tab", { name: /Transaction history/i }).click();
  await page.locator('input[data-search-key="pim-history"]').fill("created");
  await expect(page.locator('[data-pim-search-status="pim-history"]')).toHaveAttribute("data-search-state", "matches");
  await expect(page.getByTestId("pim-transaction")).not.toHaveCount(0);

  await page.getByRole("tab", { name: /Mailing lists/i }).click();
  await listInput.fill("");
  await page.getByTestId("mailing-list-card").filter({ hasText: listName }).getByRole("button", { name: /^Edit/i }).click();
  editor = page.getByTestId("pim-editor");
  const memberAnchor = editor.locator('[data-search-anchor="mailing-list-members-editor"]');
  builder = await openRegexBuilder(memberAnchor);
  await builder.getByRole("button", { name: /^Regular expression/i }).click();
  await builder.getByRole("checkbox", { name: /Ignore case/i }).uncheck();
  await builder.getByRole("checkbox", { name: /Multiline/i }).check();
  await builder.getByRole("checkbox", { name: /Unicode/i }).check();
  await builder.locator('textarea[data-regex-pattern="mailing-list-members-editor"]').fill("^Definitely absent member$");
  await builder.locator('textarea[data-regex-sample="mailing-list-members-editor"]').fill("Transient member sample");
  await builder.getByRole("button", { name: /Use in search/i }).click();
  noMatch = editor.locator('[data-testid="pim-search-empty"][data-pim-search-key="mailing-list-members-editor"]');
  await expect(noMatch).toHaveRole("status");
  await noMatch.getByRole("button", { name: /^Edit member search/i }).click();
  await expect(memberAnchor.locator('input[data-search-key="mailing-list-members-editor"]')).toBeFocused();
  builder = await openRegexBuilder(memberAnchor);
  await page.keyboard.press("Escape");
  await expect(builder).toHaveCount(0);
  await expect(editor).toBeVisible();
  await expect(memberAnchor.locator('input[data-search-key="mailing-list-members-editor"]')).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(editor).toBeHidden();

  const stored = await page.evaluate(storageKey => localStorage.getItem(storageKey), PIM_SEARCH_STORAGE_KEY);
  expect(JSON.parse(stored ?? "null")).toEqual({
    contacts: { mode: "regex", pattern: "^Avery Search Ledger$", flags: "mu" },
    "mailing-lists": { mode: "plain", pattern: "", flags: "i" },
    "calendar-events": { mode: "plain", pattern: eventLocation, flags: "i" },
    tasks: { mode: "regex", pattern: "(", flags: "i" },
    "pim-history": { mode: "plain", pattern: "created", flags: "i" },
    "mailing-list-members-editor": { mode: "regex", pattern: "^Definitely absent member$", flags: "mu" },
  });

  await restart();

  await openWorkspaceTab(/^Contacts/i, "contacts-page");
  await expect(page.locator('input[data-search-key="contacts"]')).toHaveValue("^Avery Search Ledger$");
  await expect(page.locator('[data-pim-search-status="contacts"]')).toHaveAttribute("data-search-state", "matches");
  builder = await openRegexBuilder(page.locator('[data-search-anchor="contacts"]'));
  await expect(builder.getByRole("checkbox", { name: /Ignore case/i })).not.toBeChecked();
  await expect(builder.getByRole("checkbox", { name: /Multiline/i })).toBeChecked();
  await expect(builder.getByRole("checkbox", { name: /Unicode/i })).toBeChecked();
  await expect(builder.locator('textarea[data-regex-sample="contacts"]')).not.toHaveValue("Transient contact sample");
  await builder.getByRole("button", { name: /Close regex builder/i }).click();

  await page.getByRole("tab", { name: /Mailing lists/i }).click();
  await expect(page.locator('input[data-search-key="mailing-lists"]')).toHaveValue("");

  await openWorkspaceTab(/^Calendar/i, "calendar-page");
  await expect(page.locator('input[data-search-key="calendar-events"]')).toHaveValue(eventLocation);
  await expect(page.locator('[data-pim-search-status="calendar-events"]')).toHaveAttribute("data-search-state", "matches");

  await openWorkspaceTab(/^Tasks/i, "tasks-page");
  await expect(page.locator('input[data-search-key="tasks"]')).toHaveValue("(");
  await expect(page.locator('[data-pim-search-status="tasks"]')).toHaveAttribute("data-search-state", "invalid");
  await expect(page.locator('[data-testid="pim-search-invalid"][data-pim-search-key="tasks"]')).toHaveRole("alert");

  await openWorkspaceTab(/^Contacts/i, "contacts-page");
  await page.getByRole("tab", { name: /Transaction history/i }).click();
  await expect(page.locator('input[data-search-key="pim-history"]')).toHaveValue("created");
  await expect(page.locator('[data-pim-search-status="pim-history"]')).toHaveAttribute("data-search-state", "matches");

  await page.getByRole("tab", { name: /Mailing lists/i }).click();
  await page.getByTestId("mailing-list-card").filter({ hasText: listName }).getByRole("button", { name: /^Edit/i }).click();
  editor = page.getByTestId("pim-editor");
  const restoredMemberAnchor = editor.locator('[data-search-anchor="mailing-list-members-editor"]');
  await expect(restoredMemberAnchor.locator('input[data-search-key="mailing-list-members-editor"]')).toHaveValue("^Definitely absent member$");
  await expect(editor.locator('[data-pim-search-status="mailing-list-members-editor"]')).toHaveAttribute("data-search-state", "no-match");
  builder = await openRegexBuilder(restoredMemberAnchor);
  await expect(builder.getByRole("checkbox", { name: /Ignore case/i })).not.toBeChecked();
  await expect(builder.getByRole("checkbox", { name: /Multiline/i })).toBeChecked();
  await expect(builder.getByRole("checkbox", { name: /Unicode/i })).toBeChecked();
  await expect(builder.locator('textarea[data-regex-sample="mailing-list-members-editor"]')).not.toHaveValue("Transient member sample");
});
