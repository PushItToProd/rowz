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
