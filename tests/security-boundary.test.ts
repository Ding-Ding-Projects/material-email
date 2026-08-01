import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFile(path, "utf8");

describe("Electron security boundary", () => {
  it("keeps Node out of the sandboxed renderer and denies ambient permissions", async () => {
    const main = await read("src/main/index.ts");
    expect(main).toContain("contextIsolation: true");
    expect(main).toContain("nodeIntegration: false");
    expect(main).toContain("sandbox: true");
    expect(main).toContain("webSecurity: true");
    expect(main).toContain("setPermissionRequestHandler");
    expect(main).toContain("callback(false)");
    expect(main).toContain('will-navigate", event => event.preventDefault()');
    expect(main).toContain('will-redirect", event => event.preventDefault()');
    expect(main).toContain("isTrustedRendererFrameUrl(mainWindow.webContents.getURL(), activeTrustedRendererUrl)");
    expect(main).not.toMatch(/nodeIntegration:\s*true/);
  });

  it("routes every non-PIM IPC channel through strict runtime payload validation", async () => {
    const main = await read("src/main/index.ts");
    const channels = [
      "app:bootstrap",
      "dialog:attachments",
      "account:create-demo",
      "account:discover",
      "account:test",
      "account:add",
      "account:remove",
      "mail:sync",
      "mail:folders",
      "mail:messages",
      "mail:message",
      "mail:save-attachment",
      "mail:save-all-attachments",
      "quarantine:release",
      "quarantine:delete",
      "mail:flags",
      "mail:move",
      "mail:send",
      "mail:save-draft",
      "mail:drafts",
      "mail:draft",
      "mail:delete-draft",
      "mail:pending-operations",
      "mail:retry-pending-operation",
      "mail:discard-pending-operation",
      "mail:outbox",
      "mail:cancel-outbox",
      "mail:retry-outbox",
      "preferences:save",
      "notifications:read",
      "notifications:clear",
      "notifications:native",
      "history:restore",
      "history:list-local",
      "history:diff-local",
      "history:label-local",
      "history:restore-local",
      "data:export",
      "editor:detect",
      "editor:open",
      "external-link:confirm",
      "external-link:cancel",
      "window:minimize",
      "window:maximize",
      "window:close",
    ];
    for (const channel of channels) expect(main).toContain(`handleValidated("${channel}"`);
    expect(main).not.toMatch(/ipcMain\.handle\("(?:account|mail|preferences|notifications|history|data|editor|window):/u);
  });

  it("denies popup creation and reviews only links with warning signals", async () => {
    const main = await read("src/main/index.ts");
    const popupHandler = main.slice(main.indexOf("setWindowOpenHandler"), main.indexOf('will-navigate"'));
    expect(popupHandler).toContain('return { action: "deny" }');
    expect(popupHandler).toContain('assessment.risk === "ordinary"');
    expect(popupHandler).toContain("deliverExternalLinkReview(url)");
    expect(main).toContain('mainWindow.webContents.send("external-link:review", request)');
    expect(main).toContain("externalLinkReviews.takeForConfirmation(requestId)");
    expect(main).toContain("await shell.openExternal(url)");
  });

  it("authenticates every IPC sender against the current top-level trusted renderer", async () => {
    const main = await read("src/main/index.ts");
    expect(main.match(/ipcMain\.handle\(/gu)).toHaveLength(1);
    expect(main).toContain("event.sender === mainWindow.webContents");
    expect(main).toContain("senderFrame === event.sender.mainFrame");
    expect(main).toContain("senderFrame?.url");
    expect(main).toContain('handleTrusted("pim:contacts:list"');
    expect(main).toContain('handleTrusted("pim:transactions:list"');
    expect(main).toContain("isPackaged: app.isPackaged");
    expect(main).toContain("resolveRendererLoadTarget");
  });

  it("closes both account-test transports through finally-backed lifecycle helpers", async () => {
    const mailService = await read("src/main/mail-service.ts");
    const testAccount = mailService.slice(mailService.indexOf("async testAccount"), mailService.indexOf("async listFolders"));
    expect(testAccount).toContain("await this.#withImap");
    expect(testAccount).toContain("try {");
    expect(testAccount).toContain("finally {");
    expect(testAccount).toContain("transport.close()");
  });

  it("ships a restrictive local-only renderer policy without evaluated code", async () => {
    const [html, renderer] = await Promise.all([read("src/renderer/index.html"), read("src/renderer/main.ts")]);
    expect(html).toContain("default-src 'self'");
    expect(html).toContain("object-src 'none'");
    expect(html).toContain("form-action 'none'");
    expect(`${html}\n${renderer}`).not.toMatch(/https?:\/\/(?:fonts|unpkg|cdn|jsdelivr)/i);
    expect(`${html}\n${renderer}`).not.toMatch(/\beval\s*\(|new\s+Function\s*\(/);
  });

  it("isolates message HTML in a scriptless, opaque-origin frame", async () => {
    const renderer = await read("src/renderer/main.ts");
    expect(renderer).toContain('sandbox="allow-popups"');
    expect(renderer).not.toMatch(/sandbox="[^"]*allow-scripts/);
    expect(renderer).not.toMatch(/sandbox="[^"]*allow-same-origin/);
    expect(renderer).toContain("default-src 'none'");
    expect(renderer).toContain('referrerpolicy="no-referrer"');
    expect(renderer).toContain('anchor.rel = "noopener noreferrer"');
  });
});
