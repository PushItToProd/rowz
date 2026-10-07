import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";

test("a document template creates a working to-do list", async ({ page }) => {
  await signUp(page);
  await page.getByRole("button", { name: "New from template" }).click();
  await expect(page.getByRole("group", { name: "Document templates" })).toBeVisible();
  await page.getByRole("button", { name: "Create To-do list from template" }).click();

  await expect(page.locator('[data-view="Task overview"]')).toContainText("3 open tasks");
  await expect(page.getByRole("heading", { name: "To-do list", exact: true })).toBeVisible();
});

test("the samples gallery copies a sample into the account and opens it", async ({ page }) => {
  await signUp(page);
  await page.getByRole("button", { name: "Browse samples and templates" }).last().click();

  const gallery = page.getByRole("dialog", { name: "Samples and templates" });
  await expect(gallery).toBeVisible();
  const sample = gallery
    .locator(".list__gallery-card")
    .filter({ has: page.getByRole("heading", { name: "Gran Turismo 7 grind comparison" }) });
  await expect(sample).toContainText("Samples");
  await sample.getByRole("button", { name: "Use Gran Turismo 7 grind comparison" }).click();

  await expect(
    page.getByRole("heading", { name: "Gran Turismo 7 grind comparison", exact: true }),
  ).toBeVisible();
  await expect(page.locator('[data-view="About"]')).toContainText(
    "This table shows the expected payout",
  );
});
