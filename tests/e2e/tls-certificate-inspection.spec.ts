import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer as createTlsServer, type Server as TlsServer } from "node:tls";

let application: ElectronApplication;
let page: Page;
let userData: string;
let server: TlsServer;
let serverPort = 0;
let tcpConnections = 0;

test.beforeAll(async () => {
  const [key, cert] = await Promise.all([
    readFile(path.resolve("tests/fixtures/tls/fixture-key.pem"), "utf8"),
    readFile(path.resolve("tests/fixtures/tls/fixture-cert.pem"), "utf8"),
  ]);
  server = createTlsServer({ key, cert }, socket => {
    socket.on("error", () => undefined);
  });
  server.on("connection", () => { tcpConnections += 1; });
  server.on("tlsClientError", () => undefined);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("TLS fixture did not expose a port.");
  serverPort = address.port;

  userData = await mkdtemp(path.join(os.tmpdir(), "material-email-live-tls-e2e-"));
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
  await new Promise<void>(resolve => server.close(() => resolve()));
  await rm(userData, { recursive: true, force: true });
});

test("opens a credential-free TLS probe only after explicit action and shows redacted bilingual metadata", async () => {
  await page.getByRole("tab", { name: /^Settings/i }).click();
  await page.locator('select[data-pref="language"]').selectOption("bilingual");
  await page.getByRole("button", { name: /Add account/i }).click();
  const form = page.locator('[data-form="account-setup"]');
  await form.locator('[name="incomingHost"]').fill("127.0.0.1");
  await form.locator('[name="incomingPort"]').fill(String(serverPort));
  await form.locator('[name="incomingSecurity"]').selectOption("tls");

  await page.waitForTimeout(150);
  expect(tcpConnections).toBe(0);
  await form.getByTestId("inspect-incoming-certificate").click();

  const result = form.locator('[data-tls-inspection-result="incoming"]');
  await expect(result).toContainText(/live TLS inspection completed/i);
  await expect.poll(() => tcpConnections).toBe(1);
  await expect(result).toContainText(/Hostname mismatch/i);
  await expect(result).toContainText("主機名唔吻合");
  await expect(result).toContainText(/RSA 2048/i);
  await expect(result).toContainText(/Redacted output/i);
  await expect(result.locator('span[lang="zh-HK"]')).not.toHaveCount(0);
  await expect(result).not.toContainText(/fixture\.invalid|Material Email Test Fixture|BEGIN CERTIFICATE/iu);
  await expect(form.locator('[name="secret"]')).toHaveValue("");
  await expect(form.getByTestId("inspect-incoming-certificate")).not.toHaveAttribute("aria-busy", "true");
});
