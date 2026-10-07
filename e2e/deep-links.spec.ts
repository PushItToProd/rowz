import { expect, test } from "@playwright/test";
import { cell, newSpreadsheet } from "./helpers";

test("copies a cell link that opens the stored cell selected and in view", async ({ page }) => {
  await newSpreadsheet(page);
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);

  const target = cell(page, "A20");
  await target.scrollIntoViewIfNeeded();
  await target.click({ button: "right" });
  const cellMenu = page.getByRole("menu", { name: "Actions for A20" });
  await expect(cellMenu).toBeVisible();
  await cellMenu.getByRole("menuitem", { name: "Copy link to this cell" }).click();
  await expect(page.getByRole("status")).toContainText("Copied");
  const link = await page.evaluate(() => navigator.clipboard.readText());
  expect(link).toMatch(/\/s\/[^/]+\/p\/[^#]+#cell=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

  const linkedPage = await page.context().newPage();
  await linkedPage.goto(link);
  const linkedCell = cell(linkedPage, "A20");
  await expect(linkedCell).toHaveAttribute("aria-selected", "true");
  await expect(linkedCell).toBeInViewport();
});

test("a copied block link expands a collapsed block", async ({ page }) => {
  await newSpreadsheet(page);
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);

  await page.getByRole("button", { name: "Block actions for Table 1" }).click();
  await page.getByRole("menuitem", { name: "Collapse" }).click();
  await expect(page.getByRole("button", { name: "Expand Table 1" })).toHaveAttribute(
    "aria-expanded",
    "false",
  );

  await page.getByRole("button", { name: "Block actions for Table 1" }).click();
  await page.getByRole("menuitem", { name: "Copy link", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Copied");
  const link = await page.evaluate(() => navigator.clipboard.readText());

  const linkedPage = await page.context().newPage();
  await linkedPage.goto(link);
  await expect(linkedPage.getByRole("button", { name: "Collapse Table 1" })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
});
