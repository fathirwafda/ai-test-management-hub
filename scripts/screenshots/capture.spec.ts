import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

const out = (name: string) => path.join(import.meta.dirname, "../../docs/screenshots", `${name}.png`);
const shot = (page: Page, name: string, fullPage = false) => page.screenshot({ path: out(name), fullPage });

test("capture README screenshots", async ({ page }) => {
  await page.goto("/p/1/dashboard");
  await page.getByLabel("Your name (for results)").fill("Dana K.");
  await expect.poll(() => page.evaluate(() => localStorage.getItem("hub.testerName"))).toBe("Dana K.");
  await expect(page.getByText("Pass-rate trend")).toBeVisible();
  await shot(page, "dashboard", true);

  await page.goto("/p/1/cases");
  await expect(page.getByTestId("cases-table")).toBeVisible();
  await shot(page, "test-cases");

  await page.goto("/p/1/runs");
  await expect(page.getByTestId("runs-table")).toBeVisible();
  await shot(page, "test-runs");

  // Run detail: failed web case with a screenshot, plus an AI triage suggestion.
  await page.goto("/p/1/runs/3");
  await page.getByRole("button", { name: "Expired discount code shows an inline error" }).click();
  const panel = page.getByTestId("item-panel");
  await panel.getByRole("button", { name: "✦ Suggest cause" }).click();
  await expect(panel.getByTestId("triage-suggestion")).toBeVisible();
  await page.getByRole("button", { name: "✦ Summarise run" }).click();
  await expect(page.getByTestId("run-summary")).toBeVisible();
  await shot(page, "run-detail", true);

  // API failure with JSON and log evidence previews.
  await page.goto("/p/1/runs/3");
  await page.getByRole("button", { name: "An expired discount code is rejected" }).click();
  await panel
    .getByTestId("evidence-item")
    .filter({ hasText: "discount-response.json" })
    .getByRole("button", { name: "Preview" })
    .click();
  await expect(panel.locator("pre.log").last()).toBeVisible();
  await panel.screenshot({ path: out("evidence-preview") });

  await page.goto("/p/1/import");
  await page
    .getByLabel("Report file")
    .setInputFiles(path.join(import.meta.dirname, "../../e2e/fixtures/api-regression.xml"));
  await page.getByLabel("Run name").fill("API regression #512");
  await page.getByLabel("Build").fill("ci-512");
  await page.getByRole("button", { name: "Import results" }).click();
  await expect(page.getByTestId("import-summary")).toBeVisible();
  await shot(page, "import-results");

  await page.goto("/p/1/ai");
  await page.getByRole("button", { name: "Use example story" }).click();
  await page.getByLabel("Default platform").selectOption("Web");
  await page.getByRole("button", { name: "✦ Generate test cases" }).click();
  await expect(page.getByTestId("ai-suggestions")).toBeVisible();
  await shot(page, "ai-test-design", true);
});
