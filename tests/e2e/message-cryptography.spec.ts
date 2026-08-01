import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { MessageDetail, MessageSummary } from "../../src/shared/contracts";

let application: ElectronApplication;
let page: Page;
let userData = "";

const ensureDemo = async (): Promise<void> => {
  await page.locator('[data-testid="onboarding"], [data-testid="app-shell"]').first().waitFor({ state: "visible" });
  if (await page.getByTestId("onboarding").isVisible()) await page.getByTestId("demo-action").click();
  await expect(page.getByTestId("app-shell")).toBeVisible();
  await expect(page.getByTestId("message-list").locator(".message-row")).toHaveCount(4);
};

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(os.tmpdir(), "material-email-message-crypto-"));
  application = await electron.launch({
    args: [path.resolve(".")],
    env: { ...process.env, MATERIAL_EMAIL_USER_DATA_DIR: userData, MATERIAL_EMAIL_HEADLESS: "1" },
  });
  page = await application.firstWindow();
  await page.waitForLoadState("domcontentloaded");
});

test.afterAll(async () => {
  await application?.close();
  if (userData) await rm(userData, { recursive: true, force: true });
});

test("shows honest bilingual unsigned, unverified, and unsupported trust states without crypto controls or plaintext secrets", async () => {
  await ensureDemo();
  const rows = page.getByTestId("message-list").locator(".message-row");
  await rows.first().locator(".message-row__main").click();
  const unsignedReader = page.getByTestId("reader-crypto-trust");
  await expect(unsignedReader).toHaveAttribute("data-state", "unsigned");
  await expect(unsignedReader.getByTestId("reader-crypto-state")).toHaveText("Unsigned");
  await expect(unsignedReader).toContainText(/does not prove sender identity or message integrity/i);

  await page.locator('[data-action="compose"]').click();
  let composeTrust = page.getByTestId("compose-crypto-trust");
  await expect(composeTrust).toHaveAttribute("data-state", "unsigned");
  await expect(composeTrust).toContainText(/without an OpenPGP or S\/MIME signature/i);
  await expect(composeTrust).toContainText(/Keys, passphrases, and plaintext cryptographic secrets are neither accepted nor persisted/i);
  await expect(page.getByTestId("compose-form").getByRole("button", { name: /sign|encrypt|import key|certificate/i })).toHaveCount(0);
  await page.getByRole("button", { name: "Close composer" }).click();

  const summaries = await page.evaluate(() => window.materialEmail.listMessages("demo", "Inbox")) as MessageSummary[];
  await application.evaluate(({ ipcMain }, fixture) => {
    ipcMain.removeHandler("mail:message");
    ipcMain.handle("mail:message", (_event, _accountId: string, _folderPath: string, uid: number) => {
      const message = fixture.find(item => item.uid === uid) ?? fixture[0]!;
      const cryptography = uid === fixture[1]?.uid
        ? {
            protocol: "openpgp" as const,
            container: "signed" as const,
            state: "unverified" as const,
            reason: "openpgp-signed-container" as const,
            signatureVerification: "not-performed" as const,
            contentDecryption: "not-performed" as const,
          }
        : {
            protocol: "smime" as const,
            container: "encrypted" as const,
            state: "unsupported" as const,
            reason: "smime-encrypted-container" as const,
            signatureVerification: "not-performed" as const,
            contentDecryption: "not-performed" as const,
          };
      return {
        ...message,
        text: `${message.subject} local trust-state fixture`,
        html: `<p>${message.subject} local trust-state fixture</p>`,
        remoteContentHtml: `<p>${message.subject} local trust-state fixture</p>`,
        remoteContentSources: [],
        remoteContentAllowed: false,
        attachments: [],
        replyTo: message.from,
        cryptography,
      } satisfies MessageDetail;
    });
  }, summaries);

  await rows.nth(1).locator(".message-row__main").click();
  await expect(page.getByTestId("reader-crypto-trust")).toHaveAttribute("data-state", "unverified");
  await expect(page.getByTestId("reader-crypto-trust")).toContainText(/OpenPGP signature not verified/i);
  await expect(page.getByTestId("reader-crypto-trust")).toContainText(/Signature verification not performed/i);

  await rows.nth(2).locator(".message-row__main").click();
  await expect(page.getByTestId("reader-crypto-trust")).toHaveAttribute("data-state", "unsupported");
  await expect(page.getByTestId("reader-crypto-trust")).toContainText(/S\/MIME encrypted content unsupported/i);
  await expect(page.getByTestId("reader-crypto-trust")).toContainText(/cannot decrypt or authenticate/i);

  await page.setViewportSize({ width: 760, height: 560 });
  await page.getByRole("tab", { name: /^Settings/i }).click();
  await page.locator('select[data-pref="language"]').selectOption("bilingual");
  await page.getByRole("tab", { name: /^Mail/i }).click();
  await expect(page.getByTestId("reader-crypto-trust")).toContainText("S/MIME encrypted content unsupported");
  await expect(page.getByTestId("reader-crypto-trust")).toContainText("S/MIME 加密內容未支援");
  await page.locator('[data-action="compose"]').click();
  composeTrust = page.getByTestId("compose-crypto-trust");
  await expect(composeTrust).toContainText("Sending unsigned");
  await expect(composeTrust).toContainText("將會未簽署寄出");
  await expect(composeTrust).toBeVisible();
  expect(await composeTrust.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);

  const persisted = await readFile(path.join(userData, "material-email-state-v1.json"), "utf8");
  expect(persisted).not.toMatch(/privateKey|private_key|passphrase|cryptographicSecret/iu);
});
