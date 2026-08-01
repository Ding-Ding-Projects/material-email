import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

let application: ElectronApplication;
let page: Page;
let userData = "";

const releaseId = "11111111-1111-4111-8111-111111111111";
const deleteId = "22222222-2222-4222-8222-222222222222";
const releaseBytes = Buffer.from("reviewed dangerous payload");
const deleteBytes = Buffer.from("reviewed macro payload");

const launch = async (): Promise<void> => {
  application = await electron.launch({
    args: [path.resolve(".")],
    env: { ...process.env, MATERIAL_EMAIL_USER_DATA_DIR: userData, MATERIAL_EMAIL_HEADLESS: "1" },
  });
  page = await application.firstWindow();
  await page.waitForLoadState("domcontentloaded");
};

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(os.tmpdir(), "material-email-quarantine-e2e-"));
  await launch();
  await page.getByTestId("onboarding").waitFor({ state: "visible" });
  await page.getByTestId("demo-action").click();
  await expect(page.getByTestId("app-shell")).toBeVisible();
  await application.close();

  const statePath = path.join(userData, "material-email-state-v1.json");
  const state = JSON.parse(await readFile(statePath, "utf8")) as Record<string, unknown>;
  state.quarantinedAttachments = [
    {
      id: releaseId,
      filename: "invoice.pdf.exe",
      contentType: "application/pdf",
      size: releaseBytes.length,
      sha256: "1e45e0ec1e417bb7ede89d8abac169983db380199c83c3344671527aff8f0716",
      risk: { level: "dangerous", reasons: ["windows-executable", "double-extension", "mime-extension-mismatch"] },
      quarantinedAt: "2026-08-01T04:00:00.000Z",
      source: { accountId: "demo", folderPath: "Inbox", uid: 104, uidValidity: "demo-1", attachmentIndex: 0 },
    },
    {
      id: deleteId,
      filename: "forecast.xlsm",
      contentType: "application/vnd.ms-excel.sheet.macroenabled.12",
      size: deleteBytes.length,
      sha256: "1178bfffac745ccc7c2a6852d32d163b0dc1b9ea78c6335d6fd9bc1248ae8b0e",
      risk: { level: "caution", reasons: ["macro-enabled-document"] },
      quarantinedAt: "2026-08-01T04:01:00.000Z",
      source: { accountId: "demo", folderPath: "Inbox", uid: 104, uidValidity: "demo-1", attachmentIndex: 1 },
    },
  ];
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
  const quarantinePath = path.join(userData, "attachment-quarantine-v1");
  await mkdir(quarantinePath, { recursive: true });
  await writeFile(path.join(quarantinePath, `${releaseId}.quarantine`), releaseBytes);
  await writeFile(path.join(quarantinePath, `${deleteId}.quarantine`), deleteBytes);
  await launch();
});

test.afterAll(async () => {
  await application?.close();
  if (userData) await rm(userData, { recursive: true, force: true });
});

test("requires explicit accessible release and delete decisions for persisted quarantine entries", async () => {
  await page.getByRole("tab", { name: /^Tools/i }).click();
  const centre = page.getByTestId("quarantine-center");
  await expect(centre).toBeVisible();
  await expect(centre).toContainText(/not antivirus scanning/i);
  await expect(page.getByTestId("quarantine-card")).toHaveCount(2);

  const releaseTarget = path.join(userData, "released", "invoice.pdf.exe");
  await mkdir(path.dirname(releaseTarget), { recursive: true });
  await application.evaluate(({ dialog }, target) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: target });
  }, releaseTarget);

  const releaseCard = page.getByTestId("quarantine-card").filter({ hasText: "invoice.pdf.exe" });
  await releaseCard.getByRole("button", { name: /Release/i }).click();
  let decision = page.getByRole("alertdialog");
  await expect(decision).toContainText(/not an antivirus approval/i);
  await expect(decision.getByRole("button", { name: /Keep quarantined/i })).toBeFocused();
  await decision.getByRole("button", { name: /Release to a chosen location/i }).click();
  await expect(releaseCard).toHaveCount(0);
  await expect(readFile(releaseTarget, "utf8")).resolves.toBe(releaseBytes.toString("utf8"));
  await expect(access(path.join(userData, "attachment-quarantine-v1", `${releaseId}.quarantine`))).rejects.toMatchObject({ code: "ENOENT" });

  const deleteCard = page.getByTestId("quarantine-card").filter({ hasText: "forecast.xlsm" });
  await deleteCard.getByRole("button", { name: /^Delete$/i }).click();
  decision = page.getByRole("alertdialog");
  await expect(decision).toContainText(/cannot be restored/i);
  await decision.getByRole("button", { name: /Delete quarantined file/i }).click();
  await expect(page.getByTestId("quarantine-card")).toHaveCount(0);
  await expect(centre).toContainText(/quarantine is empty/i);
  await expect(access(path.join(userData, "attachment-quarantine-v1", `${deleteId}.quarantine`))).rejects.toMatchObject({ code: "ENOENT" });

  const persisted = JSON.parse(await readFile(path.join(userData, "material-email-state-v1.json"), "utf8")) as { quarantinedAttachments: unknown[] };
  expect(persisted.quarantinedAttachments).toEqual([]);
});
