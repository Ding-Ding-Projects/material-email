import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AccountSummary, BootstrapState, Contact, MessageDetail, MessageSummary, Preferences } from "../../src/shared/contracts";

let application: ElectronApplication;
let page: Page;
let userData = "";

const launch = async (): Promise<void> => {
  userData = await mkdtemp(path.join(os.tmpdir(), "material-email-renderer-concurrency-"));
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

const openContacts = async (): Promise<void> => {
  await page.getByRole("tab", { name: /^Contacts/i }).click();
  await expect(page.getByTestId("contacts-page")).toBeVisible();
};

const createContact = async (displayName: string, email: string): Promise<void> => {
  await page.getByTestId("add-contact").click();
  const editor = page.getByTestId("pim-editor");
  await editor.getByTestId("contact-name").fill(displayName);
  await editor.getByTestId("contact-email").fill(email);
  await editor.getByTestId("save-contact").click();
  await expect(page.getByTestId("contact-card").filter({ hasText: displayName })).toHaveCount(1);
};

test.beforeEach(async () => launch());

test.afterEach(async () => {
  await application?.close();
  if (userData) await rm(userData, { recursive: true, force: true });
  userData = "";
});

test("late folder results cannot cross the selected account or persist a losing folder", async () => {
  const bootstrap = await page.evaluate(() => window.materialEmail.bootstrap()) as BootstrapState;
  const account = (id: string, label: string): AccountSummary => ({
    id,
    displayName: `${label} Account`,
    email: `${id.toLowerCase()}@example.test`,
    incoming: { host: "demo.local", port: 993, security: "tls", username: id },
    outgoing: { host: "demo.local", port: 465, security: "tls", username: id },
    authMode: "password",
    kind: "demo",
    createdAt: "2026-07-31T00:00:00.000Z",
  });
  const summary = (accountId: string, folderPath: string, uid: number, subject: string): MessageSummary => ({
    id: `${accountId}:${folderPath}:${uid}`,
    accountId,
    folderPath,
    uid,
    from: [{ name: `${accountId} Sender`, address: `${accountId.toLowerCase()}-sender@example.test` }],
    to: [{ name: `${accountId} User`, address: `${accountId.toLowerCase()}@example.test` }],
    cc: [],
    subject,
    date: "2026-07-31T12:00:00.000Z",
    preview: `${subject} preview`,
    unread: true,
    starred: false,
    hasAttachments: false,
    size: 100,
  });
  const alpha = account("A", "Alpha");
  const bravo = account("B", "Bravo");
  const alphaInbox = summary("A", "Inbox", 1, "Alpha normal inbox");
  const alphaSlow = summary("A", "Slow", 2, "ALPHA PRIVATE SLOW MESSAGE");
  const bravoInbox = summary("B", "Inbox", 3, "Bravo normal inbox");

  await application.evaluate(({ BrowserWindow, ipcMain }, fixture) => {
    const auditGlobal = globalThis as typeof globalThis & { rendererConcurrencyPreferencePatches?: Array<Partial<Preferences>> };
    const sleep = (milliseconds: number): Promise<void> => new Promise(resolve => setTimeout(resolve, milliseconds));
    for (const channel of ["app:bootstrap", "mail:folders", "mail:messages", "mail:message", "preferences:save"]) {
      ipcMain.removeHandler(channel);
    }
    let preferences = { ...fixture.bootstrap.preferences, selectedAccountId: "A", selectedFolderPath: "Inbox" };
    auditGlobal.rendererConcurrencyPreferencePatches = [];
    ipcMain.handle("app:bootstrap", () => ({
      ...fixture.bootstrap,
      accounts: [fixture.alpha, fixture.bravo],
      preferences,
      isFirstRun: false,
    }));
    ipcMain.handle("mail:folders", async (_event, accountId: string) => {
      await sleep(30);
      return accountId === "A"
        ? [
            { accountId: "A", path: "Inbox", name: "Inbox", role: "inbox", unread: 1, total: 1 },
            { accountId: "A", path: "Slow", name: "Slow private folder", role: "other", unread: 1, total: 1 },
          ]
        : [{ accountId: "B", path: "Inbox", name: "Inbox", role: "inbox", unread: 1, total: 1 }];
    });
    ipcMain.handle("mail:messages", async (_event, accountId: string, folderPath: string) => {
      if (accountId === "A" && folderPath === "Slow") await sleep(1_300);
      else await sleep(40);
      if (accountId === "A" && folderPath === "Slow") return [fixture.alphaSlow];
      return accountId === "A" ? [fixture.alphaInbox] : [fixture.bravoInbox];
    });
    ipcMain.handle("mail:message", async (_event, accountId: string, folderPath: string) => {
      await sleep(30);
      const item = accountId === "A" && folderPath === "Slow"
        ? fixture.alphaSlow
        : accountId === "A"
          ? fixture.alphaInbox
          : fixture.bravoInbox;
      return {
        ...item,
        text: `${item.subject} full private body`,
        html: `<p>${item.subject} full private body</p>`,
        attachments: [],
        replyTo: item.from,
      } satisfies MessageDetail;
    });
    ipcMain.handle("preferences:save", (_event, patch: Partial<Preferences>) => {
      auditGlobal.rendererConcurrencyPreferencePatches?.push(structuredClone(patch));
      preferences = { ...preferences, ...patch };
      return preferences;
    });
    BrowserWindow.getAllWindows()[0]?.webContents.reload();
  }, { bootstrap, alpha, bravo, alphaInbox, alphaSlow, bravoInbox });

  await page.locator("#account-switcher").waitFor({ state: "visible" });
  await expect(page.getByTestId("message-list").locator(".message-row__subject", { hasText: "Alpha normal inbox" })).toBeVisible();
  await page.getByTestId("folder-list").getByRole("button", { name: /Slow private folder/i }).click();
  await page.locator("#account-switcher").selectOption("B");
  await expect(page.getByTestId("message-list").locator(".message-row__subject", { hasText: "Bravo normal inbox" })).toBeVisible();
  await page.waitForTimeout(1_600);

  await expect(page.locator("#account-switcher")).toHaveValue("B");
  await expect(page.getByTestId("message-list")).toContainText("Bravo normal inbox");
  await expect(page.getByTestId("message-list")).not.toContainText("ALPHA PRIVATE SLOW MESSAGE");
  const patches = await application.evaluate(() => {
    const auditGlobal = globalThis as typeof globalThis & { rendererConcurrencyPreferencePatches?: Array<Partial<Preferences>> };
    return auditGlobal.rendererConcurrencyPreferencePatches ?? [];
  });
  expect(patches).not.toContainEqual(expect.objectContaining({ selectedAccountId: "B", selectedFolderPath: "Slow" }));
  expect(patches.at(-1)).toMatchObject({ selectedAccountId: "B", selectedFolderPath: "Inbox" });
});

test("completion of one PIM save never closes the replacement editor", async () => {
  await ensureDemo();
  await openContacts();
  await createContact("Alpha Save Owner", "alpha-save@example.test");
  await createContact("Bravo Replacement", "bravo-replacement@example.test");
  const contacts = await page.evaluate(() => window.materialEmail.listContacts());
  const alpha = contacts.find(contact => contact.displayName === "Alpha Save Owner");
  const bravo = contacts.find(contact => contact.displayName === "Bravo Replacement");
  expect(alpha).toBeTruthy();
  expect(bravo).toBeTruthy();

  await application.evaluate(({ ipcMain }, fixture) => {
    const auditGlobal = globalThis as typeof globalThis & { rendererConcurrencyContacts?: Contact[] };
    const sleep = (milliseconds: number): Promise<void> => new Promise(resolve => setTimeout(resolve, milliseconds));
    auditGlobal.rendererConcurrencyContacts = fixture.contacts;
    ipcMain.removeHandler("pim:contacts:update");
    ipcMain.removeHandler("pim:contacts:list");
    ipcMain.handle("pim:contacts:update", async (_event, uid: string, patch: Partial<Contact>) => {
      await sleep(900);
      const current = auditGlobal.rendererConcurrencyContacts?.find(contact => contact.uid === uid);
      if (!current) throw new Error("Fixture contact disappeared");
      const saved = { ...current, ...patch, uid, revision: current.revision + 1, updatedAt: new Date().toISOString() } as Contact;
      auditGlobal.rendererConcurrencyContacts = (auditGlobal.rendererConcurrencyContacts ?? []).map(contact => contact.uid === uid ? saved : contact);
      return saved;
    });
    ipcMain.handle("pim:contacts:list", () => auditGlobal.rendererConcurrencyContacts ?? []);
  }, { contacts });

  const alphaCard = page.getByTestId("contact-card").filter({ hasText: "Alpha Save Owner" });
  await alphaCard.getByRole("button", { name: /^Edit$/i }).click();
  let editor = page.getByTestId("pim-editor");
  await editor.getByTestId("contact-notes").fill("Saved by the first editor");
  await editor.getByTestId("save-contact").click();
  await expect(editor).toHaveAttribute("aria-busy", "true");

  await page.evaluate((uid: string) => {
    const card = document.querySelector<HTMLElement>(`[data-testid="contact-card"][data-pim-uid="${CSS.escape(uid)}"]`);
    card?.querySelector<HTMLButtonElement>('[data-action="edit-pim"]')?.click();
  }, bravo!.uid);
  const confirmation = page.getByRole("alertdialog");
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole("button", { name: /Discard and open/i }).click();

  editor = page.getByTestId("pim-editor");
  await expect(editor.getByTestId("contact-name")).toHaveValue("Bravo Replacement");
  await expect(editor).toHaveAttribute("aria-busy", "false", { timeout: 5_000 });
  await expect(editor).toBeVisible();
  await expect(editor.getByTestId("contact-name")).toHaveValue("Bravo Replacement");
});

test("a saved PIM mutation with a failed refresh keeps a retryable editor", async () => {
  await ensureDemo();
  await openContacts();
  await createContact("Refresh Failure Contact", "refresh-failure@example.test");
  const contacts = await page.evaluate(() => window.materialEmail.listContacts());
  const source = contacts.find(contact => contact.displayName === "Refresh Failure Contact");
  expect(source).toBeTruthy();
  if (!source) throw new Error("Refresh-failure fixture contact was not created.");

  await application.evaluate(({ ipcMain }, fixture) => {
    const auditGlobal = globalThis as typeof globalThis & {
      rendererConcurrencySavedContact?: Contact;
      rendererConcurrencyFailRefresh?: boolean;
    };
    auditGlobal.rendererConcurrencySavedContact = fixture.source;
    auditGlobal.rendererConcurrencyFailRefresh = false;
    ipcMain.removeHandler("pim:contacts:update");
    ipcMain.removeHandler("pim:contacts:list");
    ipcMain.handle("pim:contacts:update", async (_event, uid: string, patch: Partial<Contact>) => {
      const current = auditGlobal.rendererConcurrencySavedContact;
      if (!current) throw new Error("Fixture contact disappeared");
      const saved = { ...current, ...patch, uid, revision: current.revision + 1, updatedAt: new Date().toISOString() } as Contact;
      auditGlobal.rendererConcurrencySavedContact = saved;
      auditGlobal.rendererConcurrencyFailRefresh = true;
      return saved;
    });
    ipcMain.handle("pim:contacts:list", () => {
      if (auditGlobal.rendererConcurrencyFailRefresh) {
        auditGlobal.rendererConcurrencyFailRefresh = false;
        throw new Error("Fixture post-save refresh unavailable");
      }
      return auditGlobal.rendererConcurrencySavedContact ? [auditGlobal.rendererConcurrencySavedContact] : [];
    });
  }, { source });

  const card = page.getByTestId("contact-card").filter({ hasText: "Refresh Failure Contact" });
  await card.getByRole("button", { name: /^Edit$/i }).click();
  let editor = page.getByTestId("pim-editor");
  await editor.getByTestId("contact-notes").fill("This mutation reached storage before refresh failed");
  await editor.getByTestId("save-contact").click();

  await expect(page.getByTestId("toast-region")).toContainText(/Record saved; local views need a retry/i);
  await expect(page.getByTestId("pim-load-error")).toBeVisible();
  editor = page.getByTestId("pim-editor");
  await expect(editor).toBeVisible();
  await expect(editor).toHaveAttribute("aria-busy", "false");
  await expect(editor.getByTestId("contact-notes")).toHaveValue("This mutation reached storage before refresh failed");

  await page.getByTestId("pim-load-error").getByRole("button", { name: /Retry local records/i }).click();
  await expect(page.getByTestId("contacts-page")).toBeVisible();
  await expect(page.getByTestId("pim-load-error")).toHaveCount(0);
  await expect(page.getByTestId("pim-editor").getByTestId("contact-notes")).toHaveValue("This mutation reached storage before refresh failed");
});

test("compose Send and Save are mutually exclusive in both directions", async () => {
  await ensureDemo();
  await application.evaluate(({ ipcMain }) => {
    const auditGlobal = globalThis as typeof globalThis & { rendererConcurrencyComposeCalls?: { sends: number; saves: number } };
    const sleep = (milliseconds: number): Promise<void> => new Promise(resolve => setTimeout(resolve, milliseconds));
    auditGlobal.rendererConcurrencyComposeCalls = { sends: 0, saves: 0 };
    ipcMain.removeHandler("mail:save-draft");
    ipcMain.removeHandler("mail:send");
    ipcMain.handle("mail:save-draft", async (_event, draft) => {
      auditGlobal.rendererConcurrencyComposeCalls!.saves += 1;
      await sleep(650);
      return { ...draft, id: draft.id ?? "renderer-concurrency-draft" };
    });
    ipcMain.handle("mail:send", async (_event, draft) => {
      auditGlobal.rendererConcurrencyComposeCalls!.sends += 1;
      await sleep(650);
      return { messageId: "<renderer-concurrency@example.test>", accepted: draft.to, rejected: [], queued: false };
    });
  });

  await page.locator('[data-action="compose"]').first().click();
  let composer = page.getByTestId("compose-form");
  await composer.locator("#compose-to").fill("recipient@example.test");
  await composer.locator("#compose-subject").fill("Compose mutual exclusion");
  await composer.locator("#compose-body").fill("Save owns the first operation.");
  await composer.getByTestId("compose-save-draft").click();
  await expect(composer.getByTestId("compose-send")).toBeDisabled();
  await expect(composer.getByTestId("compose-save-draft")).toBeDisabled();
  await composer.evaluate(form => {
    const send = form.querySelector<HTMLButtonElement>('[data-compose-submit="send"]');
    form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true, submitter: send }));
  });
  await expect(page.getByTestId("toast-region")).toContainText(/Draft saved locally/i);

  let counts = await application.evaluate(() => {
    const auditGlobal = globalThis as typeof globalThis & { rendererConcurrencyComposeCalls?: { sends: number; saves: number } };
    return auditGlobal.rendererConcurrencyComposeCalls;
  });
  expect(counts).toEqual({ sends: 0, saves: 1 });

  composer = page.getByTestId("compose-form");
  await composer.locator("#compose-body").fill("Send owns the second operation.");
  await composer.getByTestId("compose-send").click();
  await expect(composer.getByTestId("compose-send")).toBeDisabled();
  await expect(composer.getByTestId("compose-save-draft")).toBeDisabled();
  await composer.evaluate(form => {
    const save = form.querySelector<HTMLButtonElement>('[data-compose-submit="draft"]');
    form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true, submitter: save }));
  });
  await expect(composer).toBeHidden();

  counts = await application.evaluate(() => {
    const auditGlobal = globalThis as typeof globalThis & { rendererConcurrencyComposeCalls?: { sends: number; saves: number } };
    return auditGlobal.rendererConcurrencyComposeCalls;
  });
  expect(counts).toEqual({ sends: 1, saves: 1 });
});
