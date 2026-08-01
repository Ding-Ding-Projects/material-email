import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AccountSummary, BootstrapState, MessageDetail, MessageSummary, Preferences } from "../../src/shared/contracts";

let application: ElectronApplication;
let page: Page;
let userData = "";

const account = (id: string, name: string): AccountSummary => ({
  id,
  displayName: `${name} Account`,
  email: `${id}@example.test`,
  incoming: { host: "demo.local", port: 993, security: "tls", username: id },
  outgoing: { host: "demo.local", port: 465, security: "tls", username: id },
  authMode: "password",
  kind: "demo",
  createdAt: "2026-08-01T00:00:00.000Z",
});

const summary = (
  accountId: string,
  uid: number,
  subject: string,
  unread: boolean,
  starred: boolean,
  reference: Partial<Pick<MessageSummary, "messageId" | "inReplyTo" | "references">> = {},
): MessageSummary => ({
  id: `${accountId}:Inbox:${uid}`,
  accountId,
  folderPath: "Inbox",
  uid,
  ...reference,
  from: [{ name: `${accountId} sender`, address: `${accountId}-sender@example.test` }],
  to: [{ name: `${accountId} user`, address: `${accountId}@example.test` }],
  cc: [],
  subject,
  date: `2026-08-01T1${uid}:00:00.000Z`,
  preview: `${subject} cached preview`,
  unread,
  starred,
  hasAttachments: false,
  size: 100,
});

test.beforeEach(async () => {
  userData = await mkdtemp(path.join(os.tmpdir(), "material-email-unified-folders-"));
  application = await electron.launch({
    args: [path.resolve(".")],
    env: { ...process.env, MATERIAL_EMAIL_USER_DATA_DIR: userData, MATERIAL_EMAIL_HEADLESS: "1" },
  });
  page = await application.firstWindow();
  await page.waitForLoadState("domcontentloaded");
});

test.afterEach(async () => {
  await application?.close();
  if (userData) await rm(userData, { recursive: true, force: true });
  userData = "";
});

test("shows cached cross-account folders with attribution, shared regex search, and stable selection", async () => {
  const bootstrap = await page.evaluate(() => window.materialEmail.bootstrap()) as BootstrapState;
  const alpha = account("alpha", "Alpha");
  const bravo = account("bravo", "Bravo");
  const alphaMessage = summary("alpha", 1, "Alpha unread inbox", true, false, { messageId: "<alpha-root@example.test>" });
  const bravoMessage = summary("bravo", 2, "Bravo starred inbox", false, true);
  const alphaReply = summary("alpha", 3, "Re: Alpha unread inbox", false, false, {
    messageId: "<alpha-reply@example.test>",
    inReplyTo: "<ALPHA-ROOT@example.test>",
  });

  await application.evaluate(({ BrowserWindow, ipcMain }, fixture) => {
    const channels = [
      "app:bootstrap",
      "mail:folders",
      "mail:messages",
      "mail:unified-messages",
      "mail:message",
      "mail:flags",
      "mail:drafts",
      "mail:pending-operations",
      "mail:outbox",
      "preferences:save",
    ];
    for (const channel of channels) ipcMain.removeHandler(channel);
    let preferences = { ...fixture.bootstrap.preferences, selectedAccountId: "alpha", selectedFolderPath: "Inbox" };
    let inboxReads = 0;
    ipcMain.handle("app:bootstrap", () => ({ ...fixture.bootstrap, accounts: [fixture.alpha, fixture.bravo], preferences, isFirstRun: false }));
    ipcMain.handle("mail:folders", (_event, accountId: string) => [{ accountId, path: "Inbox", name: "Inbox", role: "inbox", unread: 1, total: 1 }]);
    ipcMain.handle("mail:messages", (_event, accountId: string) => accountId === "alpha" ? [fixture.alphaReply, fixture.alphaMessage] : [fixture.bravoMessage]);
    ipcMain.handle("mail:unified-messages", (_event, folder: "inbox" | "starred" | "unread") => {
      if (folder === "starred") return [fixture.bravoMessage];
      if (folder === "unread") return [fixture.alphaMessage];
      inboxReads += 1;
      return inboxReads % 2
        ? [fixture.alphaMessage, fixture.bravoMessage, fixture.alphaReply]
        : [fixture.bravoMessage, fixture.alphaReply, fixture.alphaMessage];
    });
    ipcMain.handle("mail:message", (_event, accountId: string, _folderPath: string, uid: number) => {
      const message = accountId === "bravo" ? fixture.bravoMessage : uid === fixture.alphaReply.uid ? fixture.alphaReply : fixture.alphaMessage;
      return {
        ...message,
        text: `${message.subject} body`,
        html: `<p>${message.subject} body</p>`,
        remoteContentHtml: `<p>${message.subject} body</p>`,
        remoteContentSources: [],
        remoteContentAllowed: false,
        attachments: [],
        replyTo: message.from,
      } satisfies MessageDetail;
    });
    ipcMain.handle("mail:flags", () => undefined);
    ipcMain.handle("mail:drafts", () => []);
    ipcMain.handle("mail:pending-operations", () => []);
    ipcMain.handle("mail:outbox", () => []);
    ipcMain.handle("preferences:save", (_event, patch: Partial<Preferences>) => {
      preferences = { ...preferences, ...patch };
      return preferences;
    });
    BrowserWindow.getAllWindows()[0]?.webContents.reload();
  }, { bootstrap, alpha, bravo, alphaMessage, alphaReply, bravoMessage });

  const unified = page.getByTestId("unified-folder-list");
  await unified.getByRole("button", { name: /Unified Inbox/i }).click();
  await expect(page.getByTestId("unified-folder-truth")).toContainText(/cached on this computer/i);
  const list = page.getByTestId("message-list");
  await expect(list).toContainText("Alpha unread inbox");
  await expect(list).toContainText("Re: Alpha unread inbox");
  await expect(list).toContainText("Bravo starred inbox");
  const conversation = list.getByTestId("conversation-group");
  await expect(conversation).toHaveCount(1);
  await expect(conversation.locator(".conversation-group__header")).toContainText("Alpha unread inbox");
  await expect(conversation.locator(".conversation-group__header")).toContainText("2 messages");
  await expect(conversation.locator(".message-row__account")).toHaveCount(2);

  await list.locator('[data-message-id="bravo:Inbox:2"] [data-action="select-message"]').click();
  await expect(list.locator('.message-row[data-message-id="bravo:Inbox:2"]')).toHaveAttribute("aria-selected", "true");
  await unified.getByRole("button", { name: /Unified Inbox/i }).click();
  await expect(list.locator('.message-row[data-message-id="bravo:Inbox:2"]')).toHaveAttribute("aria-selected", "true");

  const mailSearch = page.locator('[data-search-anchor="mail"]');
  await mailSearch.locator("input").fill("bravo@example.test");
  await expect(list.locator(".message-row")).toHaveCount(1);
  await mailSearch.locator('[data-action="toggle-regex-builder"]').click();
  await expect(page.getByTestId("regex-popover")).toHaveAttribute("data-search-owner", "mail");
  await page.keyboard.press("Escape");
  await mailSearch.locator("input").fill("");

  await unified.getByRole("button", { name: /^Starred/i }).click();
  await expect(list.locator(".message-row")).toHaveCount(1);
  await expect(list).toContainText("Bravo starred inbox");
  await unified.getByRole("button", { name: /^Unread/i }).click();
  await expect(list.locator(".message-row")).toHaveCount(1);
  await expect(list).toContainText("Alpha unread inbox");
});
