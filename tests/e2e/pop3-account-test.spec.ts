import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer as createTlsServer, type Server as TlsServer, type TLSSocket } from "node:tls";

let application: ElectronApplication;
let page: Page;
let userData = "";
let server: TlsServer;
let silentServer: TlsServer;
let serverPort = 0;
let silentServerPort = 0;
let tcpConnections = 0;
let closedConnections = 0;
const commands: string[] = [];
const sockets = new Set<TLSSocket>();

const listen = async (fixture: TlsServer): Promise<number> => {
  await new Promise<void>((resolve, reject) => {
    fixture.once("error", reject);
    fixture.listen(0, "127.0.0.1", resolve);
  });
  const address = fixture.address();
  if (!address || typeof address === "string") throw new Error("POP3 Electron fixture did not expose a port.");
  return address.port;
};

const attachPop3 = (socket: TLSSocket): void => {
  socket.on("error", () => undefined);
  let buffer = "";
  socket.on("data", chunk => {
    buffer += chunk.toString("utf8");
    while (buffer.includes("\r\n")) {
      const boundary = buffer.indexOf("\r\n");
      const command = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      commands.push(command);
      if (command === "CAPA") socket.write("+OK capabilities\r\nUIDL\r\nUSER\r\nTOP\r\n.\r\n");
      else if (command === "USER fixture-user") socket.write("+OK user accepted\r\n");
      else if (command === "PASS fixture-secret") socket.write("+OK authenticated\r\n");
      else if (command === "STAT") socket.write("+OK 2 300\r\n");
      else if (command === "UIDL 1") socket.write("+OK 1 private-fixture-uid-1\r\n");
      else if (command === "LIST 1") socket.write("+OK 1 100\r\n");
      else if (command === "UIDL 2") socket.write("+OK 2 private-fixture-uid-2\r\n");
      else if (command === "LIST 2") socket.write("+OK 2 200\r\n");
      else if (command === "QUIT") socket.end("+OK goodbye\r\n");
      else socket.end("-ERR unsupported\r\n");
    }
  });
};

test.beforeAll(async () => {
  const certificatePath = path.resolve("tests/fixtures/tls/pop3-localhost-cert.pem");
  const [key, cert] = await Promise.all([
    readFile(path.resolve("tests/fixtures/tls/fixture-key.pem"), "utf8"),
    readFile(certificatePath, "utf8"),
  ]);
  server = createTlsServer({ key, cert }, socket => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    tcpConnections += 1;
    socket.once("close", () => { closedConnections += 1; });
    attachPop3(socket);
    socket.write("+OK private fixture greeting\r\n");
  });
  server.on("tlsClientError", () => undefined);
  serverPort = await listen(server);

  silentServer = createTlsServer({ key, cert }, socket => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    tcpConnections += 1;
    socket.on("error", () => undefined);
    socket.on("data", () => undefined);
    socket.once("close", () => { closedConnections += 1; });
    socket.write("+OK cancellation fixture ready\r\n");
  });
  silentServer.on("tlsClientError", () => undefined);
  silentServerPort = await listen(silentServer);

  userData = await mkdtemp(path.join(os.tmpdir(), "material-email-pop3-e2e-"));
  application = await electron.launch({
    args: [path.resolve(".")],
    env: {
      ...process.env,
      MATERIAL_EMAIL_USER_DATA_DIR: userData,
      MATERIAL_EMAIL_HEADLESS: "1",
      NODE_EXTRA_CA_CERTS: certificatePath,
    },
  });
  page = await application.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await page.getByTestId("onboarding").waitFor({ state: "visible" });
  await page.getByTestId("demo-action").click();
  await expect(page.getByTestId("app-shell")).toBeVisible();
});

test.afterAll(async () => {
  await application?.close();
  for (const socket of sockets) socket.destroy();
  await Promise.all([
    new Promise<void>(resolve => server.close(() => resolve())),
    new Promise<void>(resolve => silentServer.close(() => resolve())),
  ]);
  if (userData) await rm(userData, { recursive: true, force: true });
});

test("runs and cancels a redacted bilingual live POP3 test while account creation and sync stay blocked", async () => {
  await page.getByRole("tab", { name: /^Settings/i }).click();
  await page.locator('select[data-pref="language"]').selectOption("bilingual");
  await page.getByRole("button", { name: /Add account/i }).click();

  const form = page.locator('[data-form="account-setup"]');
  await form.locator('[name="incomingProtocol"]').selectOption("pop3");
  const panel = form.getByTestId("pop3-account-test");
  const liveResult = form.getByTestId("pop3-live-test-result");
  const testButton = form.getByTestId("test-account-settings");
  const cancelButton = form.getByTestId("cancel-pop3-test");

  await expect(panel).toBeVisible();
  await expect(panel.locator('span[lang="zh-HK"]')).not.toHaveCount(0);
  await expect(panel).toContainText(/POP3 live account test/i);
  await expect(panel).toContainText("POP3 即時帳戶測試");
  await expect(panel).toContainText(/DELE is never sent/i);
  await expect(form.locator('[name="incomingPort"]')).toHaveValue("995");
  await expect(form.locator('[name="authMode"]')).toBeDisabled();
  await expect(form.locator('[name="secret"]')).toBeEnabled();
  await expect(form.getByTestId("inspect-incoming-certificate")).toBeDisabled();
  await expect(testButton).toBeEnabled();
  await expect(form.getByRole("button", { name: /Connect account/i })).toBeDisabled();

  await form.locator('[name="email"]').fill("pop3@example.test");
  await form.locator('[name="displayName"]').fill("POP3 Test");
  await form.locator('[name="incomingHost"]').fill("127.0.0.1");
  await form.locator('[name="incomingPort"]').fill(String(serverPort));
  await form.locator('[name="incomingSecurity"]').selectOption("tls");
  await form.locator('[name="incomingUsername"]').fill("fixture-user");
  await form.locator('[name="outgoingHost"]').fill("smtp.example.test");
  await form.locator('[name="outgoingUsername"]').fill("pop3@example.test");
  await form.locator('[name="secret"]').fill("fixture-secret");
  await form.locator('[name="pop3MessageLimit"]').fill("2");

  expect(tcpConnections).toBe(0);
  await testButton.click();
  await expect(liveResult).toContainText(/Live POP3 account test completed/i);
  await expect(liveResult).toContainText("即時 POP3 帳戶測試完成");
  await expect(liveResult).toContainText(/Implicit TLS/);
  await expect(liveResult).toContainText(/CAPA, UIDL, USER, TOP/);
  await expect(liveResult).toContainText(/2 messages/i);
  await expect(liveResult).toContainText(/2 message numbers verified/i);
  await expect(liveResult).toContainText(/Never sent/i);
  await expect(liveResult).toContainText(/Not performed/i);
  await expect(liveResult).not.toContainText(/fixture-user|fixture-secret|private-fixture-uid|private fixture greeting/iu);
  await expect.poll(() => tcpConnections).toBe(1);
  await expect.poll(() => closedConnections).toBe(1);
  expect(commands).toEqual(["CAPA", "USER fixture-user", "PASS fixture-secret", "STAT", "UIDL 1", "LIST 1", "UIDL 2", "LIST 2", "QUIT"]);
  expect(commands.some(command => /^(?:DELE|RETR|TOP)(?: |$)/u.test(command))).toBe(false);

  const persisted = await readFile(path.join(userData, "material-email-state-v1.json"), "utf8");
  expect(persisted).not.toContain("fixture-secret");
  expect(persisted).not.toContain("fixture-user");
  expect(persisted).not.toContain("private-fixture-uid");

  await form.locator('[name="incomingPort"]').fill(String(silentServerPort));
  await testButton.click();
  await expect(cancelButton).toBeVisible();
  await cancelButton.click();
  await expect(liveResult).toContainText(/POP3 account test was cancelled/i);
  await expect(cancelButton).toBeHidden();
  await expect(testButton).toBeFocused();
  await expect.poll(() => tcpConnections).toBe(2);
  await expect.poll(() => closedConnections).toBe(2);

  await page.setViewportSize({ width: 760, height: 560 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await expect(panel).toBeVisible();
});
