import path from "node:path";
import { expect, test } from "@playwright/test";
import { PROJECT, unique } from "./support";

test.describe("Results import and dashboard", () => {
  test("import a JUnit report and see the run on the dashboard", async ({ page }) => {
    const runName = unique("API regression");
    await page.goto(`${PROJECT}/dashboard`);
    const runsStat = page.getByTestId("dashboard-stats").getByRole("link", { name: /Test runs/ });
    const before = Number((await runsStat.locator(".stat-value").textContent()) ?? 0);
    await expect(page.getByTestId("dashboard-stats")).toContainText("Needs review");

    await page.getByRole("link", { name: "Import results" }).click();
    await page.getByLabel("Report file").setInputFiles(path.join(import.meta.dirname, "fixtures/api-regression.xml"));
    await page.getByLabel("Platform for new cases").selectOption("API");
    await page.getByLabel("Run name").fill(runName);
    await page.getByLabel("Build").fill("ci-512");
    await page.getByRole("button", { name: "Import results" }).click();

    const summary = page.getByTestId("import-summary");
    await expect(summary.getByTestId("import-total")).toHaveText("4");
    await expect(summary.getByTestId("import-mapped")).toHaveText("3");
    await expect(summary.getByTestId("import-created")).toHaveText("1");
    await expect(summary).toContainText("limitsQuantityPerOrder");
    await expect(summary).toContainText("needs review");

    await summary.getByRole("link", { name: "Open run" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(runName);
    await expect(page.getByTestId("run-pass-rate")).toHaveText("75.0%");
    await page.getByRole("button", { name: "An expired discount code is rejected" }).click();
    await expect(page.getByTestId("item-panel")).toContainText("Expected status code <422> but was <200>.");

    await page.getByRole("link", { name: "Dashboard" }).click();
    await expect(runsStat.locator(".stat-value")).toHaveText(String(before + 1));
    await expect(page.getByTestId("dashboard-stats").getByRole("link", { name: /Latest pass rate/ })).toContainText(
      runName,
    );
    await expect(page.getByTestId("dashboard-stats").getByRole("link", { name: /Needs review/ })).toContainText("1");
  });

  test("reject a file that is not a test report", async ({ page }) => {
    await page.goto(`${PROJECT}/import`);
    await page
      .getByLabel("Report file")
      .setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
    await page.getByRole("button", { name: "Import results" }).click();
    await expect(page.getByRole("alert")).toContainText("Unrecognised file");
  });
});
