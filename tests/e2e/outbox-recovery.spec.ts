import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AUTOMATIC_MAIL_QUEUE_ATTEMPT_LIMIT } from "../../src/shared/contracts";

test.setTimeout(90_000);

let application: ElectronApplication;
let page: Page;
let userData = "";

const firstQueueId = "outbox:restart-proof-one";
const secondQueueId = "outbox:restart-proof-two";

const launch = async (): Promise<void> => {
  application = await electron.launch({
    args: [path.resolve(".")],
    env: { ...process.env, MATERIAL_EMAIL_USER_DATA_DIR: userData, MATERIAL_EMAIL_HEADLESS: "1" },
  });
  page = await application.firstWindow();
  await page.waitForLoadState("domcontentloaded");
};

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(os.tmpdir(), "material-email-outbox-recovery-"));
  await launch();
  await page.getByTestId("onboarding").waitFor({ state: "visible" });
  await page.getByTestId("demo-action").click();
  await expect(page.getByTestId("app-shell")).toBeVisible();
  await application.close();

  const statePath = path.join(userData, "material-email-state-v1.json");
  const state = JSON.parse(await readFile(statePath, "utf8")) as {
    preferences: Record<string, unknown>;
    outbox: unknown[];
    history: unknown[];
  };
  state.preferences.language = "bilingual";
  state.preferences.funnyEnglish = 1;
  state.preferences.funnyCantonese = 5;
  state.outbox = [
    {
      id: firstQueueId,
      draft: { id: "restart-draft-one", accountId: "demo", to: ["one@example.test"], cc: [], bcc: [], subject: "Restart proof one", text: "First local queued fixture.", attachments: [] },
      createdAt: "2026-08-01T12:00:00.000Z",
      attempts: AUTOMATIC_MAIL_QUEUE_ATTEMPT_LIMIT,
      lastError: "Offline fixture retained after restart",
    },
    {
      id: secondQueueId,
      draft: { id: "restart-draft-two", accountId: "demo", to: ["two@example.test"], cc: [], bcc: [], subject: "Restart proof two", text: "Second local queued fixture.", attachments: [] },
      createdAt: "2026-08-01T12:01:00.000Z",
      attempts: 1,
      lastError: "Second offline fixture retained after restart",
    },
  ];
  state.history.unshift(
    { id: "history-restart-one", kind: "created", entityType: "draft", entityId: firstQueueId, label: "Queued “Restart proof one”", createdAt: "2026-08-01T12:00:00.000Z", snapshot: { accountId: "demo" } },
    { id: "history-restart-two", kind: "created", entityType: "draft", entityId: secondQueueId, label: "Queued “Restart proof two”", createdAt: "2026-08-01T12:01:00.000Z", snapshot: { accountId: "demo" } },
  );
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
  await launch();
});

test.afterAll(async () => {
  await application?.close();
  if (userData) await rm(userData, { recursive: true, force: true });
});

test("keeps retry state after restart and exposes accessible bilingual recovery actions", async () => {
  await page.getByRole("tab", { name: /^Outbox/i }).click();
  const first = page.getByTestId("outbox-card").filter({ hasText: "Restart proof one" });
  await expect(first).toContainText(`${AUTOMATIC_MAIL_QUEUE_ATTEMPT_LIMIT} failed attempts`);
  await expect(first).toContainText("自動重試已暫停");
  await expect(page.getByTestId("queue-recovery-tone")).toContainText("Each action affects only this queued item");
  await expect(page.getByTestId("queue-recovery-tone")).toContainText("迷你信封");

  await expect(first.getByRole("button", { name: "Retry once: Restart proof one" })).toBeVisible();
  await expect(first.getByRole("button", { name: "Undo queued send: Restart proof one" })).toBeVisible();
  await expect(first.getByRole("button", { name: "Open delivery history: Restart proof one" })).toBeVisible();

  await first.getByRole("button", { name: "Open delivery history: Restart proof one" }).click();
  await expect(page.getByTestId("history-page")).toBeVisible();
  await expect(page.locator('input[data-search-key="history"]')).toHaveValue(firstQueueId);
  await expect(page.locator(".history-list .history-card")).toHaveCount(1);
  await expect(page.locator(".history-list .history-card")).toContainText("Restart proof one");

  await page.getByRole("tab", { name: /^Outbox/i }).click();
  const recovered = page.getByTestId("outbox-card").filter({ hasText: "Restart proof one" });
  await recovered.getByRole("button", { name: "Undo queued send: Restart proof one" }).click();
  await expect(recovered).toHaveCount(0);
  await page.getByRole("tab", { name: /^Drafts/i }).click();
  await expect(page.getByTestId("draft-card").filter({ hasText: "Restart proof one" })).toHaveCount(1);

  await application.close();
  await launch();
  await page.getByRole("tab", { name: /^Outbox/i }).click();
  const remaining = page.getByTestId("outbox-card").filter({ hasText: "Restart proof two" });
  await expect(remaining).toContainText("1 failed attempts");
  await expect(remaining).toContainText("Second offline fixture retained after restart");
});
