import { expect, test } from "@playwright/test";
import { cell, newSpreadsheet } from "./helpers";

test("page and block context menus leave table cell actions to the grid", async ({ page }) => {
  await newSpreadsheet(page);
  await page.getByRole("button", { name: "Add page" }).click();

  const pages = page.getByRole("navigation", { name: "Pages" });
  await pages.getByRole("link", { name: "Page 1", exact: true }).click({ button: "right" });
  await page
    .getByRole("menu", { name: "Actions for Page 1" })
    .getByRole("menuitem", {
      name: "Move right",
    })
    .click();
  await expect(pages.getByRole("link")).toHaveText(["Page 2", "Page 1"]);

  const table = page.locator('.table-card[data-table="Table 1"]');
  await table.click({ button: "right", position: { x: 4, y: 4 } });
  await expect(page.getByRole("menu", { name: "Actions for Table 1" })).toBeVisible();

  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Block actions for Table 1" }).click();
  await expect(page.getByRole("menu", { name: "Actions for Table 1" })).toBeVisible();

  await page.keyboard.press("Escape");
  await cell(page, "A1").click({ button: "right" });
  await expect(page.getByRole("menu", { name: "Actions for A1" })).toBeVisible();
  await expect(page.getByRole("menu", { name: "Actions for Table 1" })).toHaveCount(0);
});
