import { _electron as electron, expect, test } from "@playwright/test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("About presents the exact packaged release decoration without borrowing a dish", async () => {
  const metadata = JSON.parse(await readFile("dist/release-metadata.json", "utf8")) as {
    codeName: string;
    imageAsset: string;
  };
  const userData = await mkdtemp(path.join(os.tmpdir(), "material-email-release-decoration-"));
  const application = await electron.launch({
    args: [path.resolve(".")],
    env: { ...process.env, MATERIAL_EMAIL_HEADLESS: "1", MATERIAL_EMAIL_USER_DATA_DIR: userData },
  });
  try {
    const page = await application.firstWindow();
    await page.locator('[data-testid="onboarding"], [data-testid="app-shell"]').first().waitFor({ state: "visible" });
    if (await page.getByTestId("onboarding").isVisible()) await page.getByTestId("demo-action").click();
    await page.getByRole("tab", { name: /^Tools/i }).click();
    const about = page.locator(".about-card");
    await expect(about).toBeVisible();
    if (metadata.codeName && metadata.imageAsset) {
      await expect(about).toContainText(metadata.codeName);
      await expect(about.locator('.release-code-name img[alt="'+metadata.codeName+'"]')).toBeVisible();
    } else {
      await expect(about).toContainText("No code name assigned");
      await expect(about).toContainText("catalog was exhausted");
      await expect(about.locator(".release-code-name img")).toHaveCount(0);
    }
  } finally {
    await application.close();
    await rm(userData, { recursive: true, force: true });
  }
});
