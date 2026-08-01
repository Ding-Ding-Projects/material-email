import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import os from "node:os";
import path from "node:path";

let application: ElectronApplication;
let page: Page;
let userData: string;

const listenLoopback = async (server: Server): Promise<number> => {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("The loopback regression server did not expose a TCP port.");
  return address.port;
};

const closeServer = async (server: Server): Promise<void> => {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
};

const launch = async (): Promise<void> => {
  application = await electron.launch({
    args: [path.resolve(".")],
    env: { ...process.env, MATERIAL_EMAIL_USER_DATA_DIR: userData, MATERIAL_EMAIL_HEADLESS: "1" },
  });
  page = await application.firstWindow();
  await page.waitForLoadState("domcontentloaded");
};

const ensureDemo = async (): Promise<void> => {
  const onboarding = page.getByTestId("onboarding");
  await page.locator('[data-testid="onboarding"], [data-testid="app-shell"]').first().waitFor({ state: "visible" });
  if (await onboarding.isVisible()) {
    await page.getByTestId("demo-action").click();
    await expect(onboarding).toBeHidden();
  }
  await expect(page.getByTestId("app-shell")).toBeVisible();
  if (!(await page.getByTestId("folder-list").isVisible())) {
    await page.locator('[role="tab"][data-tab-id="mail"]').click();
  }
  await expect(page.getByTestId("folder-list")).toBeVisible();
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

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(os.tmpdir(), "material-email-e2e-"));
  await launch();
});

test.afterAll(async () => {
  await application?.close();
});

test("onboards into a live three-pane demo and isolates message content", async () => {
  await expect(page.getByTestId("onboarding")).toBeVisible();
  await ensureDemo();
  await expect(page.getByTestId("folder-list").getByRole("button", { name: /Inbox/i })).toBeVisible();
  const messages = page.getByTestId("message-list").locator(".message-row");
  await expect(messages).toHaveCount(4);
  await messages.first().locator(".message-row__main").click();

  const frame = page.getByTestId("reader-iframe");
  await expect(frame).toBeVisible();
  await expect(frame.contentFrame().locator("body")).toContainText("final checklist");
  await expect(frame).toHaveAttribute("sandbox", "allow-popups");
  expect(await frame.contentFrame().locator("body").evaluate(() => typeof window.materialEmail)).toBe("undefined");
});

test("preserves the active reader document across message chrome updates", async () => {
  await ensureDemo();
  const messages = page.getByTestId("message-list").locator(".message-row");
  await messages.nth(1).locator(".message-row__main").click();

  const frame = page.getByTestId("reader-iframe");
  const body = frame.contentFrame().locator("body");
  await expect(body).toContainText("tab strip now keeps focus");
  const documentRevision = await frame.getAttribute("data-reader-document");
  expect(documentRevision).not.toBeNull();
  const scrollBeforeUpdate = await body.evaluate(element => {
    const marker = element.ownerDocument.createElement("div");
    marker.id = "reader-preservation-marker";
    marker.style.whiteSpace = "pre-line";
    marker.textContent = Array.from({ length: 180 }, (_, index) => `Reader continuity line ${index + 1}`).join("\n");
    element.append(marker);
    const view = element.ownerDocument.defaultView;
    view?.scrollTo(0, 240);
    return view?.scrollY ?? 0;
  });
  expect(scrollBeforeUpdate).toBe(240);

  await page.locator('[data-action="toggle-selected-star"]').click();
  await expect(page.getByTestId("toast-region")).toContainText(/Message updated/i);
  await expect(frame).toHaveAttribute("data-reader-document", documentRevision!);
  await expect(frame).toHaveAttribute("sandbox", "allow-popups");
  await expect(body.locator("#reader-preservation-marker")).toHaveCount(1);
  await expect.poll(() => body.evaluate(element => element.ownerDocument.defaultView?.scrollY ?? 0)).toBe(scrollBeforeUpdate);
  expect(await body.evaluate(() => typeof window.materialEmail)).toBe("undefined");

  await messages.nth(1).locator(".message-row__main").click();
  const refreshedFrame = page.getByTestId("reader-iframe");
  const refreshedBody = refreshedFrame.contentFrame().locator("body");
  await expect(refreshedBody).toContainText("tab strip now keeps focus");
  const refreshedRevision = await refreshedFrame.getAttribute("data-reader-document");
  expect(refreshedRevision).not.toBe(documentRevision);
  await expect(refreshedBody.locator("#reader-preservation-marker")).toHaveCount(0);

  await messages.nth(2).locator(".message-row__main").click();
  const replacementFrame = page.getByTestId("reader-iframe");
  const replacementBody = replacementFrame.contentFrame().locator("body");
  await expect(replacementBody).toContainText("Windows package completed");
  expect(await replacementFrame.getAttribute("data-reader-document")).not.toBe(refreshedRevision);
  await expect(replacementBody.locator("#reader-preservation-marker")).toHaveCount(0);
});

test("rejects privileged IPC from another WebContents and keeps same-file skip-link IPC trusted", async () => {
  await ensureDemo();
  await page.locator('a[href="#main-content"]').focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();
  const electronVersion = await application.evaluate(({ app }) => app.getVersion());
  await expect.poll(() => page.evaluate(() => window.materialEmail.bootstrap().then(result => result.version))).toBe(electronVersion);

  const result = await application.evaluate(
    async ({ BrowserWindow }, files) => {
      const otherWindow = new BrowserWindow({
        show: false,
        webPreferences: {
          preload: files.preload,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
      try {
        await otherWindow.loadFile(files.renderer);
        return await otherWindow.webContents.executeJavaScript(`window.materialEmail.bootstrap().then(
          () => ({ ok: true, message: "" }),
          error => ({ ok: false, message: String(error && error.message ? error.message : error) })
        )`);
      } finally {
        otherWindow.destroy();
      }
    },
    { preload: path.resolve("dist/main/preload.cjs"), renderer: path.resolve("dist/renderer/index.html") },
  );
  expect(result).toMatchObject({ ok: false });
  expect(result.message).toMatch(/untrusted renderer frame/i);

  await application.close();
  let sourceHits = 0;
  let targetHits = 0;
  const targetServer = createServer((_request, response) => {
    targetHits += 1;
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end("<!doctype html><h1>Untrusted redirect target</h1>");
  });
  const targetPort = await listenLoopback(targetServer);
  const sourceServer = createServer((_request, response) => {
    sourceHits += 1;
    response.writeHead(302, { location: `http://127.0.0.1:${targetPort}/untrusted` });
    response.end();
  });
  const sourcePort = await listenLoopback(sourceServer);
  const redirectUserData = await mkdtemp(path.join(os.tmpdir(), "material-email-redirect-e2e-"));
  let redirectApplication: ElectronApplication | undefined;
  try {
    redirectApplication = await electron.launch({
      args: [path.resolve("."), "mailto:recipient@example.test?subject=PrivateRedirectAudit&body=MustStayLocal"],
      env: {
        ...process.env,
        MATERIAL_EMAIL_DEV_URL: `http://127.0.0.1:${sourcePort}/`,
        MATERIAL_EMAIL_USER_DATA_DIR: redirectUserData,
        MATERIAL_EMAIL_HEADLESS: "1",
      },
    });
    await expect.poll(() => sourceHits).toBeGreaterThan(0);
    await new Promise(resolve => setTimeout(resolve, 750));
    expect(targetHits).toBe(0);
    expect(redirectApplication.windows().every(candidate => !candidate.url().includes(`127.0.0.1:${targetPort}`))).toBe(true);
  } finally {
    await redirectApplication?.close().catch(() => undefined);
    await Promise.all([closeServer(sourceServer), closeServer(targetServer)]);
    await rm(redirectUserData, { recursive: true, force: true });
    await launch();
  }
});

test("composes through the real renderer command path and reports demo delivery", async () => {
  await ensureDemo();
  await page.locator('[data-action="compose"]').click();
  const composer = page.getByTestId("compose-form");
  await expect(composer).toBeVisible();
  await composer.locator("#compose-to").fill("friend@example.test");
  await composer.locator("#compose-subject").fill("Electron demo delivery");
  await composer.locator("#compose-body").fill("This was submitted through the compose state machine.");
  await composer.getByTestId("compose-send").click();
  await expect(composer).toBeHidden();
  await expect(page.getByTestId("toast-region")).toContainText(/Message accepted by the server/i);
});

test("distinguishes a saved composer from later unsaved edits", async () => {
  test.slow();
  await ensureDemo();
  await page.locator('[data-action="compose"]').click();
  let composer = page.getByTestId("compose-form");
  await composer.locator("#compose-to").fill("saved-draft@example.test");
  await composer.locator("#compose-subject").fill("Saved composer baseline");
  await composer.locator("#compose-body").fill("This exact content is saved.");
  await composer.getByTestId("compose-save-draft").click();
  await expect(page.getByTestId("toast-region")).toContainText(/Saved composer baseline/i);
  await composer.getByRole("button", { name: /Close composer/i }).click();
  await expect(composer).toBeHidden();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);

  await page.locator('[data-action="compose"]').click();
  composer = page.getByTestId("compose-form");
  await composer.locator("#compose-to").fill("edited-after-save@example.test");
  await composer.locator("#compose-subject").fill("Edit after save");
  await composer.getByTestId("compose-save-draft").click();
  await composer.locator("#compose-body").fill("This changed after the saved baseline.");
  await expect(page.getByTestId("toast-region")).toContainText(/Draft saved; newer edits remain/i);
  await composer.getByRole("button", { name: /Close composer/i }).click();
  let decision = page.getByRole("alertdialog");
  await expect(decision).toContainText(/Discard this unsaved composer/i);
  await expect(decision.getByRole("button", { name: /Keep writing/i })).toBeFocused();
  await decision.getByRole("button", { name: /Keep writing/i }).click();
  await expect(composer.locator("#compose-body")).toHaveValue("This changed after the saved baseline.");

  await page.locator('[data-action="compose"]').first().click();
  decision = page.getByRole("alertdialog");
  await expect(decision).toContainText(/Discard this unsaved composer and start another/i);
  await decision.getByRole("button", { name: /Keep writing/i }).click();
  await expect(composer.locator("#compose-body")).toHaveValue("This changed after the saved baseline.");
  await page.locator('[data-action="compose"]').first().click();
  await page.getByRole("alertdialog").getByRole("button", { name: /Discard and continue/i }).click();
  composer = page.getByTestId("compose-form");
  await expect(composer.locator("#compose-subject")).toHaveValue("");
  await composer.getByRole("button", { name: /Close composer/i }).click();
  await expect(composer).toBeHidden();

  await application.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler("mail:send");
    ipcMain.handle("mail:send", async (_event, submitted: unknown) => {
      (globalThis as typeof globalThis & { materialEmailCapturedSend?: unknown }).materialEmailCapturedSend = structuredClone(submitted);
      await new Promise(resolve => setTimeout(resolve, 1_200));
      return { messageId: "<delayed-e2e@example.test>", accepted: ["slow@example.test"], rejected: [], queued: false };
    });
  });
  await page.locator('[data-action="compose"]').first().click();
  composer = page.getByTestId("compose-form");
  await composer.locator("#compose-to").fill("slow@example.test");
  await composer.locator("#compose-subject").fill("Slow send keeps later edits");
  await composer.locator("#compose-body").fill("Original submitted body");
  await composer.getByTestId("compose-send").click();
  await composer.locator("#compose-body").fill("Newer private edit entered during send");
  await expect(page.getByTestId("toast-region")).toContainText(/Submitted message accepted; newer edits remain/i);
  await expect(composer.locator("#compose-body")).toHaveValue("Newer private edit entered during send");
  expect(await application.evaluate(() =>
    (globalThis as typeof globalThis & { materialEmailCapturedSend?: { text?: string } }).materialEmailCapturedSend?.text,
  )).toBe("Original submitted body");
  await composer.getByRole("button", { name: /Close composer/i }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: /Discard message/i }).click();
  await expect(composer).toBeHidden();
});

test("opens an anchored regex builder and keeps invalid patterns actionable", async () => {
  await ensureDemo();
  const mailSearch = page.locator('[data-search-anchor="mail"]');
  await mailSearch.locator('[data-action="toggle-regex-builder"]').click();
  const builder = page.getByTestId("regex-popover");
  await expect(builder).toBeVisible();
  await builder.getByRole("button", { name: /^Regular expression$/i }).click();
  const rawPattern = builder.locator('textarea[data-regex-pattern="mail"]');
  await rawPattern.fill("(");
  await expect(builder).toContainText(/invalid|correct|error/i);
  await page.keyboard.press("Escape");
  await expect(builder).toBeHidden();
});

test("persists Material settings and demo state across a real Electron restart", async () => {
  await ensureDemo();
  await page.getByRole("tab", { name: /Settings/i }).click();
  await expect(page.getByTestId("settings-page")).toBeVisible();
  await expect(page.getByTestId("choose-custom-editor")).toBeVisible();
  const theme = page.locator('[data-pref="theme"]');
  await theme.selectOption("dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await application.close();
  await launch();
  await expect(page.getByTestId("onboarding")).toHaveCount(0);
  await expect(page.getByTestId("app-shell")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByTestId("reader-iframe").contentFrame().locator("body")).toContainText("final checklist");
  await page.screenshot({ path: "test-results/material-email-live.png", fullPage: true });
});

test("filters and copies verified releases from the live Changelog page", async () => {
  await ensureDemo();
  await openWorkspaceTab(/^Changelog/i, "changelog-page");

  const changelog = page.getByTestId("changelog-page");
  const cards = changelog.locator(".changelog-card");
  const releases = [
    { version: "0.8.1", title: "Windows desktop foundation", codeName: "Classic Har Gow · 蝦餃" },
    { version: "0.10.1", title: "Drafts and reading continuity", codeName: "Scallop Har Gow · 帶子蝦餃" },
    { version: "0.11.1", title: "Queue recovery and privacy-safe notifications", codeName: "Bamboo Shoot Har Gow · 筍尖蝦餃" },
  ];

  await expect(cards).toHaveCount(releases.length);
  for (const [index, release] of releases.entries()) {
    const card = cards.nth(index);
    await expect(card).toContainText(`VERSION ${release.version}`);
    await expect(card.getByRole("heading", { name: release.title })).toBeVisible();
    await expect(card.getByRole("img", { name: release.codeName })).toBeVisible();
    await expect(card.locator("time")).toHaveAttribute("datetime", "2026-08-01");
  }

  const fromDate = changelog.locator('[data-changelog-date="from"]');
  const copyButton = changelog.getByRole("button", { name: /Copy filtered view/i });
  const exportButton = changelog.getByRole("button", { name: /Export filtered notes/i });
  await fromDate.fill("2026-08-02");
  await expect(cards).toHaveCount(0);
  await expect(changelog.getByText(/^0 matching released versions$/i)).toBeVisible();

  await fromDate.fill("2026-02-31");
  await expect(fromDate).toHaveValue("2026-02-31");
  await expect(fromDate).toHaveAttribute("aria-invalid", "true");
  await expect(changelog.getByRole("alert")).toContainText(/Enter a real calendar date/i);
  await expect(copyButton).toBeDisabled();
  await expect(exportButton).toBeDisabled();

  await fromDate.fill("");
  const search = changelog.locator('[data-search-anchor="changelog"] input[type="search"]');
  await search.fill("Queue recovery");
  await expect(cards).toHaveCount(1);
  await expect(cards).toContainText("VERSION 0.11.1");
  await expect(copyButton).toBeEnabled();

  await application.evaluate(({ clipboard }) => clipboard.writeText(""));
  await copyButton.click();
  await expect(page.getByTestId("toast-region")).toContainText(/Filtered changelog copied/i);
  const copied = await application.evaluate(({ clipboard }) => clipboard.readText());
  expect(copied).toContain("# Material Email changelog");
  expect(copied).toContain("Search: Queue recovery");
  expect(copied).toContain("## 0.11.1 — Queue recovery and privacy-safe notifications");
  expect(copied).not.toContain("## 0.8.1");
  expect(copied).not.toContain("## 0.10.1");
});

test("creates, edits, searches, deletes, restores, and persists contacts and mailing lists", async () => {
  test.slow();
  await ensureDemo();
  await openWorkspaceTab(/^Contacts/i, "contacts-page");

  const contactName = "Avery PIM E2E";
  const editedOrganization = "Material Local Lab";
  await page.getByTestId("add-contact").click();
  let editor = page.getByTestId("pim-editor");
  await expect(editor).toBeVisible();
  await editor.getByTestId("contact-name").fill(contactName);
  await editor.getByTestId("contact-email").fill("avery.pim@example.test");
  await editor.getByTestId("contact-phone").fill("+1 416 555 0160");
  await editor.getByTestId("save-contact").click();
  await expect(editor).toBeHidden();

  let contactCard = page.getByTestId("contact-card").filter({ hasText: contactName });
  await expect(contactCard).toHaveCount(1);
  await contactCard.getByRole("button", { name: /^Edit$/i }).click();
  editor = page.getByTestId("pim-editor");
  await editor.getByTestId("contact-organization").fill(editedOrganization);
  await editor.getByTestId("save-contact").click();
  contactCard = page.getByTestId("contact-card").filter({ hasText: contactName });
  await expect(contactCard).toContainText(editedOrganization);

  const contactSearch = page.locator('[data-search-anchor="contacts"] input');
  await contactSearch.fill("avery.pim@example.test");
  await expect(page.getByTestId("contact-card")).toHaveCount(1);
  await expect(page.getByTestId("contact-card")).toContainText(contactName);
  await contactSearch.fill("");

  await page.setViewportSize({ width: 900, height: 800 });
  const contactSearchAnchor = page.locator('[data-search-anchor="contacts"]');
  await contactSearchAnchor.locator('[data-action="toggle-regex-builder"]').click();
  let pimRegexBuilder = page.getByTestId("regex-popover");
  const [railBox, builderBox] = await Promise.all([
    page.locator(".spaces-rail").boundingBox(),
    pimRegexBuilder.boundingBox(),
  ]);
  expect(railBox).not.toBeNull();
  expect(builderBox).not.toBeNull();
  expect(builderBox!.x).toBeGreaterThanOrEqual(railBox!.x + railBox!.width);
  await pimRegexBuilder.getByRole("button", { name: /^Regular expression$/i }).click();
  await pimRegexBuilder.locator('textarea[data-regex-pattern="contacts"]').fill("^Avery\\s+PIM\\s+E2E");
  await pimRegexBuilder.getByRole("button", { name: /Use in search/i }).click();
  await expect(page.getByTestId("contact-card")).toHaveCount(1);
  await contactSearchAnchor.locator('[data-action="toggle-regex-builder"]').click();
  pimRegexBuilder = page.getByTestId("regex-popover");
  await pimRegexBuilder.getByRole("button", { name: /^Plain text$/i }).click();
  await pimRegexBuilder.locator('textarea[data-regex-pattern="contacts"]').fill("");
  await pimRegexBuilder.getByRole("button", { name: /Close regex builder/i }).click();
  await page.setViewportSize({ width: 1500, height: 940 });

  await page.getByRole("tab", { name: /Mailing lists/i }).click();
  await expect(page.getByTestId("mailing-lists-surface")).toBeVisible();
  const listName = "PIM Release Crew";
  const editedListName = "PIM Release Crew Edited";
  await page.getByTestId("add-mailing-list").click();
  editor = page.getByTestId("pim-editor");
  await editor.getByTestId("mailing-list-name").fill(listName);
  await editor.getByRole("checkbox", { name: new RegExp(contactName, "i") }).check();
  await editor.getByTestId("save-mailing-list").click();

  let listCard = page.getByTestId("mailing-list-card").filter({ hasText: listName });
  await expect(listCard).toHaveCount(1);
  await listCard.getByRole("button", { name: /View members/i }).click();
  await expect(page.getByTestId("mailing-list-members")).toContainText(contactName);
  await listCard.getByRole("button", { name: /^Edit$/i }).click();
  editor = page.getByTestId("pim-editor");
  await editor.getByTestId("mailing-list-name").fill(editedListName);
  await editor.getByTestId("save-mailing-list").click();
  listCard = page.getByTestId("mailing-list-card").filter({ hasText: editedListName });
  await expect(listCard).toHaveCount(1);

  const listSearch = page.locator('[data-search-anchor="mailing-lists"] input');
  await listSearch.fill("Edited");
  await expect(page.getByTestId("mailing-list-card")).toHaveCount(1);
  await listSearch.fill("");

  await listCard.getByRole("button", { name: new RegExp(`Delete ${editedListName}`, "i") }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: /Delete local record/i }).click();
  await expect(page.getByTestId("mailing-list-card").filter({ hasText: editedListName })).toHaveCount(0);
  let deleted = page.getByTestId("deleted-pim").filter({ hasText: editedListName });
  await deleted.getByTestId("restore-pim").click();
  await expect(page.getByTestId("mailing-list-card").filter({ hasText: editedListName })).toHaveCount(1);

  await page.getByRole("tab", { name: /^People/i }).click();
  contactCard = page.getByTestId("contact-card").filter({ hasText: contactName });
  await contactCard.getByRole("button", { name: new RegExp(`Delete ${contactName}`, "i") }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: /Delete local record/i }).click();
  await expect(page.getByTestId("contact-card").filter({ hasText: contactName })).toHaveCount(0);
  deleted = page.getByTestId("deleted-pim").filter({ hasText: contactName });
  await deleted.getByTestId("restore-pim").click();
  await expect(page.getByTestId("contact-card").filter({ hasText: contactName })).toHaveCount(1);

  await page.getByRole("tab", { name: /Transaction history/i }).click();
  await expect(page.getByTestId("pim-transaction-list")).toContainText(contactName);
  await expect(page.getByTestId("pim-transaction-list")).toContainText(editedListName);
  const deletedFilter = page.getByTestId("pim-history-surface").getByRole("checkbox", { name: /^deleted\b/i });
  await deletedFilter.locator("..").click();
  await expect(deletedFilter).toBeChecked();
  await expect(page.getByTestId("pim-transaction-list")).toContainText(/deleted/i);
  await page.getByRole("button", { name: /Clear filters/i }).click();

  await restart();
  await openWorkspaceTab(/^Contacts/i, "contacts-page");
  await expect(page.getByTestId("contact-card").filter({ hasText: contactName })).toContainText(editedOrganization);
  await page.getByRole("tab", { name: /Mailing lists/i }).click();
  listCard = page.getByTestId("mailing-list-card").filter({ hasText: editedListName });
  await expect(listCard).toHaveCount(1);
  await listCard.getByRole("button", { name: /View members/i }).click();
  await expect(page.getByTestId("mailing-list-members")).toContainText(contactName);
});

test("guards dirty PIM editors and restores keyboard focus for contact, membership, and delete decisions", async () => {
  test.slow();
  await ensureDemo();
  await openWorkspaceTab(/^Contacts/i, "contacts-page");
  await page.getByRole("tab", { name: /^People/i }).click();
  const helperName = "Dirty State Focus Contact";
  await page.getByTestId("add-contact").click();
  let editor = page.getByTestId("pim-editor");
  await editor.getByTestId("contact-name").fill(helperName);
  await editor.getByTestId("contact-email").fill("dirty-focus@example.test");
  await editor.getByTestId("save-contact").click();

  let card = page.getByTestId("contact-card").filter({ hasText: helperName });
  const editButton = card.getByRole("button", { name: /^Edit$/i });
  await editButton.click();
  editor = page.getByTestId("pim-editor");
  const notes = editor.getByTestId("contact-notes");
  expect(await page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true });
    return window.dispatchEvent(event);
  })).toBe(true);
  await notes.fill("Unsaved keyboard value must survive Keep editing.");
  await expect(editor.getByTestId("pim-dirty-state")).toContainText(/Unsaved changes/i);
  await editButton.click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(notes).toHaveValue("Unsaved keyboard value must survive Keep editing.");
  await expect(editor.getByTestId("pim-dirty-state")).toContainText(/Unsaved changes/i);
  expect(await page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true });
    return window.dispatchEvent(event);
  })).toBe(false);
  await notes.focus();
  await page.keyboard.press("Escape");
  let decision = page.getByRole("alertdialog");
  const keepEditing = decision.getByRole("button", { name: /Keep editing/i });
  const discardChanges = decision.getByRole("button", { name: /Discard changes/i });
  await expect(keepEditing).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(discardChanges).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(keepEditing).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(decision).toBeHidden();
  await expect(notes).toHaveValue("Unsaved keyboard value must survive Keep editing.");
  await expect(notes).toBeFocused();
  await page.keyboard.press("Escape");
  decision = page.getByRole("alertdialog");
  await decision.getByRole("button", { name: /Discard changes/i }).click();
  await expect(editor).toBeHidden();
  await expect(editButton).toBeFocused();

  await editButton.click();
  editor = page.getByTestId("pim-editor");
  await page.keyboard.press("Escape");
  await expect(editor).toBeHidden();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(editButton).toBeFocused();

  const revisionBefore = await card.locator(".revision-chip").textContent();
  await editButton.click();
  editor = page.getByTestId("pim-editor");
  await editor.getByTestId("save-contact").click();
  await expect(page.getByTestId("toast-region")).toContainText(/No contact changes to save/i);
  card = page.getByTestId("contact-card").filter({ hasText: helperName });
  await expect(card.locator(".revision-chip")).toHaveText(revisionBefore ?? "");

  await page.getByRole("tab", { name: /Mailing lists/i }).click();
  const addList = page.getByTestId("add-mailing-list");
  await addList.click();
  editor = page.getByTestId("pim-editor");
  const member = editor.getByRole("checkbox", { name: new RegExp(helperName, "i") });
  await member.check();
  await expect(editor.getByTestId("pim-dirty-state")).toContainText(/Unsaved changes/i);
  await page.keyboard.press("Escape");
  decision = page.getByRole("alertdialog");
  await decision.getByRole("button", { name: /Keep editing/i }).click();
  await expect(member).toBeChecked();
  await expect(member).toBeFocused();
  await page.keyboard.press("Escape");
  await page.getByRole("alertdialog").getByRole("button", { name: /Discard changes/i }).click();
  await expect(editor).toBeHidden();
  await expect(addList).toBeFocused();

  await page.getByRole("tab", { name: /^People/i }).click();
  card = page.getByTestId("contact-card").filter({ hasText: helperName });
  const deleteButton = card.getByRole("button", { name: new RegExp(`Delete ${helperName}`, "i") });
  await deleteButton.click();
  decision = page.getByRole("alertdialog");
  const cancelDelete = decision.getByRole("button", { name: /^Cancel$/i });
  const confirmDelete = decision.getByRole("button", { name: /Delete local record/i });
  await expect(cancelDelete).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(confirmDelete).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(cancelDelete).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(deleteButton).toBeFocused();
  await deleteButton.click();
  await page.getByRole("alertdialog").getByRole("button", { name: /Delete local record/i }).click();
  await expect(card).toHaveCount(0);
  await expect(page.getByTestId("add-contact")).toBeFocused();
});

test("creates, edits, searches, deletes, restores, and persists calendar events and tasks", async () => {
  test.slow();
  await ensureDemo();
  const eventTitle = "PIM E2E Planning";
  const eventLocation = "Local Room 43";
  await openWorkspaceTab(/^Calendar/i, "calendar-page");
  await page.getByTestId("add-calendar-event").click();
  let editor = page.getByTestId("pim-editor");
  await editor.getByTestId("event-title").fill(eventTitle);
  await editor.getByTestId("event-start").fill("2032-06-15T09:30");
  await editor.getByTestId("event-end").fill("2032-06-15T10:45");
  await editor.getByTestId("event-location").fill("Local Room 12");
  await editor.getByTestId("save-calendar-event").click();

  let eventCard = page.getByTestId("calendar-event-card").filter({ hasText: eventTitle });
  await expect(eventCard).toHaveCount(1);
  await eventCard.getByRole("button", { name: /^Edit$/i }).click();
  editor = page.getByTestId("pim-editor");
  await editor.getByTestId("event-location").fill(eventLocation);
  await editor.getByTestId("event-status").selectOption("tentative");
  await editor.getByTestId("save-calendar-event").click();
  eventCard = page.getByTestId("calendar-event-card").filter({ hasText: eventTitle });
  await expect(eventCard).toContainText(eventLocation);
  await expect(eventCard).toContainText(/Tentative/i);

  const eventSearch = page.locator('[data-search-anchor="calendar-events"] input');
  await eventSearch.fill(eventLocation);
  await expect(page.getByTestId("calendar-event-card")).toHaveCount(1);
  await eventSearch.fill("");
  await eventCard.getByRole("button", { name: new RegExp(`Delete ${eventTitle}`, "i") }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: /Delete local record/i }).click();
  let deleted = page.getByTestId("deleted-pim").filter({ hasText: eventTitle });
  await deleted.getByTestId("restore-pim").click();
  await expect(page.getByTestId("calendar-event-card").filter({ hasText: eventTitle })).toHaveCount(1);

  const taskTitle = "Ship PIM E2E evidence";
  await openWorkspaceTab(/^Tasks/i, "tasks-page");
  await page.getByTestId("add-task").click();
  editor = page.getByTestId("pim-editor");
  await editor.getByTestId("task-title").fill(taskTitle);
  await editor.getByTestId("task-due").fill("2032-06-20");
  await editor.getByTestId("task-priority").fill("5");
  await editor.getByTestId("task-status").selectOption("in-progress");
  await editor.getByTestId("task-completion").fill("40");
  await editor.getByTestId("save-task").click();

  let taskCard = page.getByTestId("task-card").filter({ hasText: taskTitle });
  await expect(taskCard).toContainText("40%");
  await expect(taskCard).toContainText("P5");
  await taskCard.getByRole("button", { name: /^Edit$/i }).click();
  editor = page.getByTestId("pim-editor");
  await editor.getByTestId("task-description").fill("Edited through the structured local task form.");
  await editor.getByTestId("save-task").click();
  taskCard = page.getByTestId("task-card").filter({ hasText: taskTitle });
  await expect(taskCard).toContainText("Edited through the structured local task form.");

  const taskSearch = page.locator('[data-search-anchor="tasks"] input');
  await taskSearch.fill("structured local task");
  await expect(page.getByTestId("task-card")).toHaveCount(1);
  await taskSearch.fill("");
  await taskCard.getByRole("button", { name: /^Complete$/i }).click();
  taskCard = page.getByTestId("task-card").filter({ hasText: taskTitle });
  await expect(taskCard).toContainText(/Completed/i);
  await taskCard.getByRole("button", { name: new RegExp(`Delete ${taskTitle}`, "i") }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: /Delete local record/i }).click();
  deleted = page.getByTestId("deleted-pim").filter({ hasText: taskTitle });
  await deleted.getByTestId("restore-pim").click();
  await expect(page.getByTestId("task-card").filter({ hasText: taskTitle })).toContainText(/Completed/i);

  await restart();
  await openWorkspaceTab(/^Calendar/i, "calendar-page");
  await expect(page.getByTestId("calendar-event-card").filter({ hasText: eventTitle })).toContainText(eventLocation);
  await openWorkspaceTab(/^Tasks/i, "tasks-page");
  await expect(page.getByTestId("task-card").filter({ hasText: taskTitle })).toContainText("Edited through the structured local task form.");
  await expect(page.getByTestId("task-card").filter({ hasText: taskTitle })).toContainText(/Completed/i);
});

test("marks bilingual visible copy with language semantics across mail, settings, PIM, and errors", async () => {
  await ensureDemo();
  await openWorkspaceTab(/^Settings/i, "settings-page");
  await page.locator('select[data-pref="language"]').selectOption("bilingual");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByTestId("settings-page").locator('span[lang="en"]')).not.toHaveCount(0);
  await expect(page.getByTestId("settings-page").locator('span[lang="zh-HK"]')).not.toHaveCount(0);
  await expect(page.locator('[data-action="open-notifications"]')).toHaveAttribute("aria-label", "Open notifications");

  await page.locator('[role="tab"][data-tab-id="mail"]').click();
  await expect(page.getByTestId("tab-strip").locator('span[lang="zh-HK"]')).not.toHaveCount(0);
  await openWorkspaceTab(/^Contacts/i, "contacts-page");
  await expect(page.getByTestId("contacts-page").locator('span[lang="zh-HK"]')).not.toHaveCount(0);

  await openWorkspaceTab(/^Calendar/i, "calendar-page");
  await page.getByTestId("add-calendar-event").click();
  const editor = page.getByTestId("pim-editor");
  await editor.getByTestId("event-title").fill("Bilingual error semantics");
  await editor.getByTestId("event-start").fill("2033-01-02T10:00");
  await editor.getByTestId("event-end").fill("2033-01-02T09:00");
  await editor.getByTestId("save-calendar-event").click();
  const errorToast = page.getByTestId("toast-region").locator(".toast--error").last();
  await expect(errorToast).toContainText(/Event time is invalid/i);
  await expect(errorToast.locator('span[lang="zh-HK"]')).not.toHaveCount(0);

  await page.setViewportSize({ width: 760, height: 560 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await expect(editor.getByTestId("save-calendar-event")).toBeVisible();
  await page.setViewportSize({ width: 1500, height: 940 });

  await page.keyboard.press("Escape");
  await page.getByRole("alertdialog").getByRole("button", { name: /Discard changes/i }).click();
  await openWorkspaceTab(/^Settings/i, "settings-page");
  await page.locator('select[data-pref="language"]').selectOption("en");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
});

test("shows a retryable PIM error instead of an endless loading state", async () => {
  await application.close();
  userData = await mkdtemp(path.join(os.tmpdir(), "material-email-pim-error-e2e-"));
  const brokenStatePath = path.join(userData, "pim", "material-email-pim-v1.json");
  await mkdir(brokenStatePath, { recursive: true });
  await launch();
  await ensureDemo();
  await page.getByRole("tab", { name: /^Contacts/i }).click();
  const errorState = page.getByTestId("pim-load-error");
  await expect(errorState).toBeVisible();
  await expect(errorState).toContainText(/Local records unavailable/i);
  await expect(errorState).not.toHaveAttribute("aria-busy", "true");
  await rm(brokenStatePath, { recursive: true, force: true });
  await errorState.getByRole("button", { name: /Retry local records/i }).click();
  await expect(page.getByTestId("contacts-page")).toBeVisible();
  await expect(page.getByTestId("pim-load-error")).toHaveCount(0);
});

