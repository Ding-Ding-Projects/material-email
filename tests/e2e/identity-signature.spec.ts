import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test.setTimeout(120_000);

let application: ElectronApplication;
let page: Page;
let userData = "";

const SIGNATURE_A = "Signature A\nDemo desk";
const SIGNATURE_B = "Signature B\nPress desk";
const PRESS_ADDRESS = "press@material-email.local";

/** Counts RFC 3676 separator lines, which is what a stacked signature would add a second of. */
const separatorLines = (body: string): number => body.match(/^-- $/gmu)?.length ?? 0;

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

// Every locator is resolved through a function because the restart replaces `page` mid-scenario.
const composeForm = () => page.getByTestId("compose-form");
const identitySettings = () => page.getByTestId("identity-settings");
const identityRow = (identityId: string) =>
  identitySettings().locator(`[data-testid="identity-row"][data-identity-id="${identityId}"]`);

const openMail = async (): Promise<void> => {
  await page.locator('[role="tab"][data-tab-id="mail"]').click();
  await expect(page.getByTestId("folder-list")).toBeVisible();
};

const openSettings = async (): Promise<void> => {
  await page.locator('[role="tab"][data-tab-id="settings"]').click();
  await expect(page.getByTestId("settings-page")).toBeVisible();
};

const openComposer = async (): Promise<void> => {
  await page.locator('[data-action="compose"]').first().click();
  await expect(composeForm()).toBeVisible();
};

/** `expectDiscardPrompt` is asserted rather than tolerated, so an unexpectedly clean draft is a failure. */
const closeComposer = async (expectDiscardPrompt: boolean): Promise<void> => {
  await composeForm().locator('[data-action="request-close-compose"]').click();
  if (expectDiscardPrompt) {
    const decision = page.getByRole("alertdialog");
    await expect(decision).toBeVisible();
    await decision.locator('[data-action="confirm-action"]').click();
  }
  await expect(composeForm()).toBeHidden();
};

const saveIdentityEditor = async (): Promise<void> => {
  const editor = identitySettings().getByTestId("identity-editor");
  await editor.locator('button[type="submit"]').click();
  await expect(editor).toBeHidden();
};

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(os.tmpdir(), "material-email-identity-e2e-"));
  await launch();
});

test.afterAll(async () => {
  await application?.close();
  if (userData) await rm(userData, { recursive: true, force: true });
  userData = "";
});

test("seeds one identity, turns the composer From row into a picker, replaces the signature on a switch, and survives a restart", async () => {
  await ensureDemo();
  await openMail();

  // A freshly seeded account has exactly one identity, so the From row states an address instead of offering a choice.
  await openComposer();
  await expect(composeForm().getByTestId("compose-identity-static")).toHaveText("Material Email Demo <demo@material-email.local>");
  await expect(composeForm().getByTestId("compose-identity")).toHaveCount(0);
  await closeComposer(false);

  await openSettings();
  await expect(identitySettings()).toBeVisible();
  await expect(identitySettings().getByTestId("identity-row")).toHaveCount(1);
  const demoIdentityId = await identitySettings().getByTestId("identity-row").first().getAttribute("data-identity-id");
  expect(demoIdentityId).toBeTruthy();
  await expect(identityRow(demoIdentityId!).getByTestId("identity-default-badge")).toBeVisible();
  await expect(identityRow(demoIdentityId!)).toContainText(/No signature|冇簽名/u);
  // The account's only identity cannot be removed, which is what keeps "there is always a From address" true.
  await expect(identityRow(demoIdentityId!).locator('[data-action="request-delete-identity"]')).toBeDisabled();

  await identityRow(demoIdentityId!).locator('[data-action="open-identity-editor"]').click();
  await expect(identitySettings().getByTestId("identity-editor")).toBeVisible();
  await identitySettings().getByTestId("identity-signature").fill(SIGNATURE_A);
  await saveIdentityEditor();
  await expect(identityRow(demoIdentityId!)).toContainText(/Signature above quoted material|簽名放喺引文上面/u);

  await identitySettings().locator('[data-testid="identity-group"][data-account-id="demo"] .identity-group__header [data-action="open-identity-editor"]').click();
  const editor = identitySettings().getByTestId("identity-editor");
  await expect(editor).toBeVisible();
  await editor.locator('input[name="displayName"]').fill("Demo Press Desk");
  await editor.locator('input[name="email"]').fill(PRESS_ADDRESS);
  await editor.getByTestId("identity-signature").fill(SIGNATURE_B);
  await saveIdentityEditor();

  await expect(identitySettings().getByTestId("identity-row")).toHaveCount(2);
  const pressIdentityId = await identitySettings()
    .locator(`[data-testid="identity-row"]:not([data-identity-id="${demoIdentityId}"])`)
    .getAttribute("data-identity-id");
  expect(pressIdentityId).toBeTruthy();
  // Adding an identity leaves the default where it was, and an account never shows two defaults.
  await expect(identitySettings().getByTestId("identity-default-badge")).toHaveCount(1);
  await expect(identityRow(demoIdentityId!).getByTestId("identity-default-badge")).toBeVisible();
  await expect(identityRow(demoIdentityId!).locator('[data-action="request-delete-identity"]')).toBeEnabled();

  await openMail();
  await openComposer();
  await expect(composeForm().getByTestId("compose-identity-static")).toHaveCount(0);
  const picker = composeForm().getByTestId("compose-identity");
  await expect(picker).toBeVisible();
  await expect(picker.locator("option")).toHaveText([
    "Material Email Demo <demo@material-email.local>",
    `Demo Press Desk <${PRESS_ADDRESS}>`,
  ]);
  await expect(picker).toHaveValue(demoIdentityId!);

  const body = composeForm().locator("#compose-body");
  await body.fill("Hello from the demo desk.");

  await picker.selectOption(pressIdentityId!);
  await expect(picker).toHaveValue(pressIdentityId!);
  await expect(body).toHaveValue(`Hello from the demo desk.\n-- \n${SIGNATURE_B}`);

  await picker.selectOption(demoIdentityId!);
  await expect(body).toHaveValue(`Hello from the demo desk.\n-- \n${SIGNATURE_A}`);
  const afterSwitchBack = await body.inputValue();
  expect(separatorLines(afterSwitchBack)).toBe(1);
  expect(afterSwitchBack).not.toContain("Signature B");
  await closeComposer(true);

  await openSettings();
  await identityRow(pressIdentityId!).locator('[data-action="make-identity-default"]').click();
  await expect(identityRow(pressIdentityId!).getByTestId("identity-default-badge")).toBeVisible();
  await expect(identityRow(demoIdentityId!).getByTestId("identity-default-badge")).toHaveCount(0);
  await expect(identityRow(demoIdentityId!).locator('[data-action="make-identity-default"]')).toBeVisible();
  await expect(identitySettings().getByTestId("identity-default-badge")).toHaveCount(1);

  await application.close();
  await launch();
  await ensureDemo();
  await openSettings();

  await expect(identitySettings().getByTestId("identity-row")).toHaveCount(2);
  await expect(identityRow(pressIdentityId!).getByTestId("identity-default-badge")).toBeVisible();
  await expect(identityRow(demoIdentityId!).locator('[data-action="make-identity-default"]')).toBeVisible();
  await identityRow(pressIdentityId!).locator('[data-action="open-identity-editor"]').click();
  await expect(identitySettings().getByTestId("identity-signature")).toHaveValue(SIGNATURE_B);
  await identitySettings().locator('[data-action="close-identity-editor"]').click();
  await expect(identitySettings().getByTestId("identity-editor")).toHaveCount(0);
});

// An HTML parser drops the newline immediately after `<textarea>`, and that newline is the first
// character of a signature block, so the renderer emits a spare one for it to eat. Without that the
// block in the DOM no longer matches the text a switch strips, and the signature stacks.
test("replaces the signature when the identity changes before any body text is typed", async () => {
  await openMail();
  await openComposer();
  const picker = composeForm().getByTestId("compose-identity");
  const defaultIdentityId = await picker.inputValue();
  const otherIdentityId = await picker.locator(`option:not([value="${defaultIdentityId}"])`).getAttribute("value");
  expect(otherIdentityId).toBeTruthy();

  await picker.selectOption(otherIdentityId!);
  const switched = await composeForm().locator("#compose-body").inputValue();
  // Closed before asserting so the failing expectation cannot leave a composer that blocks shutdown.
  await closeComposer(true);

  expect(separatorLines(switched)).toBe(1);
  expect(switched).toContain("Signature A");
  expect(switched).not.toContain("Signature B");
});
