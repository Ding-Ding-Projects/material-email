import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AccountSummary, BootstrapState, MessageDetail, MessageSummary, Preferences } from "../../src/shared/contracts";
import { unsignedMessageCryptography } from "../../src/shared/message-cryptography";

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
      "mail:search-cached",
      "mail:message",
      "mail:flags",
      "mail:drafts",
      "mail:pending-operations",
      "mail:outbox",
      "preferences:save",
    ];
    for (const channel of channels) ipcMain.removeHandler(channel);
    let preferences: Preferences = { ...fixture.bootstrap.preferences, language: "bilingual", selectedAccountId: "alpha", selectedFolderPath: "Inbox" };
    let inboxReads = 0;
    (globalThis as typeof globalThis & { cachedMailRetryProbeCalls?: number }).cachedMailRetryProbeCalls = 0;
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
    ipcMain.handle("mail:search-cached", (_event, query: { mode: "plain" | "regex"; pattern: string; flags: string; limit: number }) => {
      if (query.pattern === "retry sentinel") {
        const probe = globalThis as typeof globalThis & { cachedMailRetryProbeCalls?: number };
        probe.cachedMailRetryProbeCalls = (probe.cachedMailRetryProbeCalls ?? 0) + 1;
        if (probe.cachedMailRetryProbeCalls === 1) throw new Error("SHOULD_NOT_LEAK private cached index detail");
      }
      const rows = [fixture.alphaReply, fixture.bravoMessage, fixture.alphaMessage];
      const bodyById: Record<string, string> = {
        [fixture.alphaReply.id]: "Cached body needle belongs only to the Alpha reply.",
        [fixture.alphaMessage.id]: "Alpha root body.",
        [fixture.bravoMessage.id]: "Bravo body.",
      };
      const expression = query.mode === "regex" ? new RegExp(query.pattern, query.flags) : null;
      const matches = (value: string): boolean => {
        if (expression) { expression.lastIndex = 0; return expression.test(value); }
        return value.toLocaleLowerCase("en-US").includes(query.pattern.toLocaleLowerCase("en-US"));
      };
      const matched = query.pattern === "retry sentinel" ? [fixture.bravoMessage] : rows.filter(message => matches([
        message.subject,
        message.preview,
        bodyById[message.id] ?? "",
        message.accountId === "alpha" ? "Alpha Account alpha@example.test" : "Bravo Account bravo@example.test",
        "Inbox",
      ].join("\n")));
      const hits = matched.slice(0, query.limit).map(message => ({
        message,
        snippet: bodyById[message.id] ?? message.preview,
        matchedFields: matches(bodyById[message.id] ?? "") ? ["body"] : ["account"],
        account: message.accountId === "alpha"
          ? { id: "alpha", displayName: "Alpha Account", email: "alpha@example.test" }
          : { id: "bravo", displayName: "Bravo Account", email: "bravo@example.test" },
        folder: { path: "Inbox", name: "Inbox", role: "inbox" },
        conversation: message.accountId === "alpha"
          ? { id: "conversation:alpha", subject: "Alpha unread inbox", messageCount: 2 }
          : { id: "message:bravo", subject: "Bravo starred inbox", messageCount: 1 },
      }));
      return {
        hits,
        totalMatched: matched.length,
        indexedDocumentCount: rows.length,
        documentLimit: 2_000,
        documentLimitReached: false,
        resultLimit: query.limit,
      };
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
        cryptography: fixture.cryptography,
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
  }, { bootstrap, alpha, bravo, alphaMessage, alphaReply, bravoMessage, cryptography: unsignedMessageCryptography() });

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
  await expect(page.getByTestId("cached-mail-search-count")).toContainText("1 cached-mail result");
  await expect(page.getByTestId("cached-mail-search-count")).toContainText("1 個快取郵件結果");
  await expect(page.getByTestId("cached-mail-search-truth")).toContainText(/Searched 3 cached summaries\/body snippets/i);
  await expect(list.locator(".message-row__account")).toContainText("Bravo Account · bravo@example.test · Inbox · single-message conversation");
  await mailSearch.locator("input").press("ArrowDown");
  await expect(list).toBeFocused();
  await mailSearch.locator("input").focus();

  await mailSearch.locator("input").fill("no cached result lives here");
  const empty = page.getByTestId("cached-mail-search-empty");
  await expect(empty).toContainText("No matching cached messages");
  await expect(list).toHaveAttribute("tabindex", "-1");
  await empty.getByRole("button", { name: /Edit search/i }).click();
  await expect(mailSearch.locator("input")).toBeFocused();

  await mailSearch.locator("input").fill("retry sentinel");
  const failed = page.getByTestId("cached-mail-search-error");
  await expect(failed).toContainText("The query and cached messages were unchanged");
  await expect(page.getByTestId("toast-region")).toContainText("Cached mail search could not finish");
  await expect(page.getByTestId("toast-region")).not.toContainText("SHOULD_NOT_LEAK");
  await failed.getByRole("button", { name: /Retry cached search/i }).click();
  await expect(mailSearch.locator("input")).toBeFocused();
  await expect(list.locator(".message-row")).toHaveCount(1);
  await expect(list).toContainText("Bravo starred inbox");
  expect(await application.evaluate(() => (globalThis as typeof globalThis & { cachedMailRetryProbeCalls?: number }).cachedMailRetryProbeCalls)).toBe(2);

  await mailSearch.locator('[data-action="toggle-regex-builder"]').click();
  const builder = page.getByTestId("regex-popover");
  await expect(builder).toHaveAttribute("data-search-owner", "mail");
  await builder.getByRole("button", { name: /^Regular expression/i }).click();
  await builder.locator('textarea[data-regex-pattern="mail"]').fill("cached\\s+body\\s+needle");
  await builder.getByRole("button", { name: /Use in search/i }).click();
  await expect(list.locator(".message-row")).toHaveCount(1);
  await expect(list).toContainText("Cached body needle belongs only to the Alpha reply.");
  await mailSearch.locator("input").fill("");

  await unified.getByRole("button", { name: /^Starred/i }).click();
  await expect(list.locator(".message-row")).toHaveCount(1);
  await expect(list).toContainText("Bravo starred inbox");
  await unified.getByRole("button", { name: /^Unread/i }).click();
  await expect(list.locator(".message-row")).toHaveCount(1);
  await expect(list).toContainText("Alpha unread inbox");
});

test("rejects adversarial mail regex and keeps Unicode zero-width and multiline states bounded", async () => {
  await page.getByRole("button", { name: /Use the local demo/i }).click();
  const unified = page.getByTestId("unified-folder-list");
  await unified.getByRole("button", { name: /^Unified Inbox/i }).click();

  const mailSearch = page.locator('[data-search-anchor="mail"]');
  await mailSearch.locator('[data-action="toggle-regex-builder"]').click();
  let builder = page.getByTestId("regex-popover");
  await expect(builder.getByRole("button", { name: /^Plain text/i })).toHaveAttribute("aria-pressed", "true");
  await builder.getByRole("button", { name: /^Regular expression/i }).click();
  await builder.locator('textarea[data-regex-pattern="mail"]').fill("(a|aa)+$");
  await expect(builder.locator(".validation-row")).toContainText(/overlapping repetition/i);
  await expect(builder.getByRole("button", { name: /Use in search/i })).toBeDisabled();
  await expect(page.getByTestId("cached-mail-search-invalid")).toBeVisible();
  await expect(page.getByTestId("cached-mail-search-truth")).toContainText(/not sent to the cache index/i);
  await expect(page.getByTestId("message-list")).toHaveAttribute("tabindex", "-1");

  await builder.locator('textarea[data-regex-pattern="mail"]').fill("(?=.)");
  await builder.getByRole("checkbox", { name: "Unicode" }).check();
  await builder.locator('textarea[data-regex-sample="mail"]').fill("😀");
  await expect(builder.locator(".match-results .count-pill")).toHaveText("1");
  await expect(builder.locator(".match-results")).toContainText("(zero-width)");
  await expect(builder.locator(".match-results")).toContainText("@ 0");

  await builder.getByRole("checkbox", { name: /Multiline/i }).check();
  await builder.locator('textarea[data-regex-pattern="mail"]').fill("^Windows package completed$");
  await builder.locator('textarea[data-regex-sample="mail"]').fill("header\nWindows package completed\nfooter");
  await expect(builder.locator(".match-results .count-pill")).toHaveText("1");
  await builder.getByRole("button", { name: /Use in search/i }).click();
  await expect(page.getByTestId("message-list").locator(".message-row")).toHaveCount(1);
  await expect(page.getByTestId("message-list")).toContainText("Windows package completed");

  await mailSearch.locator('[data-action="toggle-regex-builder"]').click();
  builder = page.getByTestId("regex-popover");
  await builder.locator('textarea[data-regex-pattern="mail"]').fill("(?=不存在)");
  await builder.getByRole("button", { name: /Use in search/i }).click();
  await expect(page.getByTestId("cached-mail-search-empty")).toBeVisible();
  await expect(page.getByTestId("message-list")).toHaveAttribute("tabindex", "-1");
});

test("persists only the cached-mail regex mode across a real Electron restart", async () => {
  await page.getByRole("button", { name: /Use the local demo/i }).click();
  const mailSearch = page.locator('[data-search-anchor="mail"]');
  await expect(mailSearch.locator("input")).toBeVisible();
  await mailSearch.locator('[data-action="toggle-regex-builder"]').click();
  let builder = page.getByTestId("regex-popover");
  await builder.getByRole("button", { name: /^Regular expression/i }).click();
  await builder.locator('textarea[data-regex-pattern="mail"]').fill("restart-private-query");
  await expect(builder.getByRole("button", { name: /^Regular expression/i })).toHaveAttribute("aria-pressed", "true");

  await application.close();
  application = await electron.launch({
    args: [path.resolve(".")],
    env: { ...process.env, MATERIAL_EMAIL_USER_DATA_DIR: userData, MATERIAL_EMAIL_HEADLESS: "1" },
  });
  page = await application.firstWindow();
  await page.waitForLoadState("domcontentloaded");

  const restartedSearch = page.locator('[data-search-anchor="mail"]');
  await expect(restartedSearch.locator("input")).toHaveValue("");
  await restartedSearch.locator('[data-action="toggle-regex-builder"]').click();
  builder = page.getByTestId("regex-popover");
  await expect(builder.getByRole("button", { name: /^Regular expression/i })).toHaveAttribute("aria-pressed", "true");
  await expect(builder.locator('textarea[data-regex-pattern="mail"]')).toHaveValue("");
});
