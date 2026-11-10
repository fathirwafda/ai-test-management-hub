import { expect, test } from "@playwright/test";
import { PNG, PROJECT, setTesterName, unique } from "./support";

test.describe("Test runs", () => {
  test("start a run, record pass and fail with evidence, and see progress update", async ({ page }) => {
    const name = unique("iOS smoke");
    await page.goto(`${PROJECT}/dashboard`);
    await setTesterName(page, "Robin E2E");

    await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Test runs" }).click();
    await page.getByRole("link", { name: "New run" }).click();
    await page.getByLabel("Run name").fill(name);
    await page.getByLabel("Build / version").fill("2.6.0-rc.1");
    await page.getByRole("checkbox", { name: "Mobile-iOS" }).check();
    await expect(page.getByTestId("run-preview").locator("li")).toHaveCount(3);
    await page.getByRole("button", { name: "Create run with 3 cases" }).click();

    await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
    await expect(page.getByTestId("run-progress")).toHaveText("0%");
    await expect(page.getByTestId("run-pass-rate")).toHaveText("–");

    // Pass the first case.
    await page.getByRole("button", { name: "Sign in with Face ID" }).click();
    const panel = page.getByTestId("item-panel");
    await expect(panel.getByLabel("Executed by")).toHaveValue("Robin E2E");
    await panel.getByRole("radio", { name: "Passed" }).check();
    await panel.getByLabel("Duration (seconds)").fill("42");
    await panel.getByRole("button", { name: "Save result" }).click();
    await expect(page.getByTestId("run-items").getByRole("row", { name: /Sign in with Face ID/ })).toContainText(
      "Passed",
    );

    // Fail the second case with a comment and two evidence files.
    await page.getByRole("button", { name: "Product cards render correctly in dark mode" }).click();
    await panel.getByRole("radio", { name: "Failed" }).check();
    await panel.getByLabel("Comment").fill("Price text is unreadable on dark cards");
    await panel.getByRole("button", { name: "Save result" }).click();
    await panel.getByLabel(/Attach screenshots/).setInputFiles([
      { name: "dark-mode-cards.png", mimeType: "image/png", buffer: PNG },
      { name: "device.log", mimeType: "text/plain", buffer: Buffer.from("iPhone 16, iOS 19.1\nDark mode: on\n") },
    ]);
    await panel.getByRole("button", { name: "Upload 2 files" }).click();

    const evidence = panel.getByTestId("evidence-item");
    await expect(evidence).toHaveCount(2);
    await expect(panel.getByRole("img", { name: "Evidence: dark-mode-cards.png" })).toBeVisible();
    await evidence.filter({ hasText: "device.log" }).getByRole("button", { name: "Preview" }).click();
    await expect(panel.locator("pre.log")).toContainText("Dark mode: on");

    await expect(page.getByTestId("run-progress")).toHaveText("67%");
    await expect(page.getByTestId("run-pass-rate")).toHaveText("50.0%");

    // Close the run: results become read-only.
    await page.getByRole("button", { name: "Close run" }).click();
    await expect(page.getByText("This run is closed.")).toBeVisible();
    await expect(panel.getByRole("radio", { name: "Passed" })).toBeDisabled();
  });

  test("AI triage suggests a cause and the tester accepts it", async ({ page }) => {
    await page.goto(`${PROJECT}/runs`);
    await page.getByRole("link", { name: "Release 2.5.0 candidate" }).click();
    await page.getByRole("button", { name: "Add to bag and pay with Google Pay" }).click();
    const panel = page.getByTestId("item-panel");
    await expect(panel).toContainText("SessionNotCreatedException");

    await panel.getByRole("button", { name: "✦ Suggest cause" }).click();
    const suggestion = panel.getByTestId("triage-suggestion");
    await expect(suggestion).toContainText("AI suggestion");
    await expect(suggestion).toContainText("Environment");
    await suggestion.getByRole("button", { name: "Accept and save to result" }).click();

    await expect(suggestion).toBeHidden();
    await expect(panel.locator(".saved-triage")).toContainText("AI-suggested, accepted");
    await expect(page.getByTestId("run-items").getByRole("row", { name: /Google Pay/ })).toContainText("Environment");
  });

  test("AI run summary is labelled and can be saved as notes", async ({ page }) => {
    await page.goto(`${PROJECT}/runs`);
    await page.getByRole("link", { name: "Release 2.5.0 candidate" }).click();
    await page.getByRole("button", { name: "✦ Summarise run" }).click();
    const summary = page.getByTestId("run-summary");
    await expect(summary).toContainText("AI suggestion");
    await expect(summary).toContainText("Not ready");
    await summary.getByRole("button", { name: "Save to run notes" }).click();
    await expect(page.locator("pre.notes")).toContainText("Release readiness (AI-suggested");
  });

  test("export the run report", async ({ page }) => {
    await page.goto(`${PROJECT}/runs`);
    await page.getByRole("link", { name: "Sprint 42 regression" }).click();
    const download = page.waitForEvent("download");
    await page.getByRole("link", { name: "CSV" }).click();
    expect((await download).suggestedFilename()).toMatch(/^test-run-\d+-sprint-42-regression\.csv$/);
  });
});
