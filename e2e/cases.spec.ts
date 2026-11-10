import { expect, test } from "@playwright/test";
import { PROJECT, unique } from "./support";

test.describe("Test cases", () => {
  test("create a case with steps and find it in the list", async ({ page }) => {
    const title = unique("Wishlist keeps items after sign-out");
    await page.goto(`${PROJECT}/cases`);
    await page.getByRole("link", { name: "New case" }).click();

    await page.getByLabel("Title").fill(title);
    await page.getByLabel("Suite").selectOption({ label: "Web storefront" });
    await page.getByLabel("Platform").selectOption("Web");
    await page.getByLabel("Type").selectOption("automated");
    await page.getByLabel("Priority").selectOption("high");
    await page.getByLabel("Status").selectOption("ready");
    await page.getByLabel("Tags").fill("wishlist, regression");
    await page.getByLabel("Automation reference").fill("e2e/wishlist.spec.ts#Wishlist > keeps items");
    await page.getByLabel("Step 1 action").fill("Add an item to the wishlist, sign out and sign in again");
    await page.getByLabel("Step 1 expected result").fill("The item is still in the wishlist");
    await page.getByRole("button", { name: "+ Add step" }).click();
    await page.getByLabel("Step 2 action").fill("Open the wishlist on another device");
    await page.getByRole("button", { name: "Create case" }).click();

    await expect(page.getByRole("heading", { level: 1 })).toContainText(title);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/TC-\d+/);

    await page.getByRole("link", { name: "← Back to cases" }).click();
    await page.getByRole("searchbox", { name: "Search cases" }).fill("Wishlist keeps");
    const row = page.getByTestId("cases-table").getByRole("row", { name: new RegExp(title) });
    await expect(row).toContainText("automated");
    await expect(row).toContainText("wishlist, regression");
  });

  test("filter cases by platform and type", async ({ page }) => {
    await page.goto(`${PROJECT}/cases`);
    await page.getByLabel("Platform").selectOption("Mobile-iOS");
    await page.getByLabel("Type").selectOption("manual");
    const rows = page.getByTestId("cases-table").locator("tbody tr");
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText("Mobile-iOS");
  });
});
