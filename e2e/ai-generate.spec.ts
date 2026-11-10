import { expect, test } from "@playwright/test";
import { PROJECT } from "./support";

test.describe("AI test design", () => {
  test("generate cases with the mock provider, edit, and save only the selected ones", async ({ page }) => {
    await page.goto(`${PROJECT}/ai`);
    await expect(page.getByRole("status").filter({ hasText: "Suggestions are not saved" })).toContainText(
      "offline mock",
    );

    await page.getByRole("button", { name: "Use example story" }).click();
    await page.getByLabel("Default platform").selectOption("Web");
    await page.getByRole("button", { name: "✦ Generate test cases" }).click();

    const suggestions = page.getByTestId("ai-suggestions");
    await expect(suggestions).toContainText("AI suggestion");
    const drafts = suggestions.getByTestId("ai-draft");
    await expect(drafts).toHaveCount(4);

    // Edit the first title, drop the last suggestion.
    const edited = `Valid discount code lowers the total ${Date.now().toString(36)}`;
    await drafts.nth(0).getByLabel("Title 1").fill(edited);
    await drafts.nth(3).getByRole("checkbox", { name: "Include" }).uncheck();
    await page.getByLabel("Save into suite").selectOption({ label: "Web storefront" });
    await page.getByRole("button", { name: "Save 3 selected as draft cases" }).click();

    await expect(page.getByRole("status").filter({ hasText: "Saved 3 draft case(s)" })).toBeVisible();

    await page.getByRole("link", { name: "Review them in Test cases" }).click();
    const row = page.getByTestId("cases-table").getByRole("row", { name: new RegExp(edited) });
    await expect(row).toContainText("AI draft");
    await expect(row).toContainText("draft");
    await row.getByRole("link").click();
    await expect(page.getByLabel("Step 1 action")).toHaveValue(/^Given /);
  });
});
