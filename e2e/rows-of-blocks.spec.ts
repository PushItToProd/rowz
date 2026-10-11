import { expect, test, type Page } from "@playwright/test";
import { chooseBlockAction, enter, newSpreadsheet, reload } from "./helpers";

/** The left edge and width of a block's card. */
async function box(page: Page, selector: string) {
  const found = await page.locator(selector).boundingBox();
  if (!found) throw new Error(`${selector} is not on the page`);
  return found;
}

test("a row of blocks shows its blocks side by side, and ungrouping stacks them again", async ({
  page,
}) => {
  await newSpreadsheet(page);
  await enter(page, "A1", "kept");
  await page.getByRole("button", { name: "Add row of blocks" }).last().click();
  const row = page.getByRole("region", { name: "Row 1" });
  await expect(row.getByText("This row is empty.")).toBeVisible();

  // One block is added from the row's own controls, and one is moved in from the page.
  await row.getByRole("button", { name: "Add chart", exact: true }).click();
  await expect(row.locator('[data-view="Chart 1"]')).toBeVisible();
  await chooseBlockAction(page, "Table 1", "Move into Row 1");
  await expect(row.locator('.table-card[data-table="Table 1"]')).toBeVisible();
  await expect(page.locator(".editor[data-saving]")).toHaveCount(0);

  const chart = await box(page, '[data-view="Chart 1"]');
  const table = await box(page, '.table-card[data-table="Table 1"]');
  expect(table.x).toBeGreaterThan(chart.x + chart.width - 1);
  expect(Math.abs(table.y - chart.y)).toBeLessThan(2);

  await chooseBlockAction(page, "Table 1", "Move left");
  await expect(page.locator(".editor[data-saving]")).toHaveCount(0);
  await reload(page);
  const moved = await box(page, '.table-card[data-table="Table 1"]');
  expect(moved.x).toBeLessThan((await box(page, '[data-view="Chart 1"]')).x);
  await expect(page.getByRole("grid", { name: "Table 1" }).getByText("kept")).toBeVisible();

  await chooseBlockAction(page, "Row 1", "Ungroup");
  await expect(page.getByRole("region", { name: "Row 1" })).toHaveCount(0);
  const below = await box(page, '[data-view="Chart 1"]');
  const above = await box(page, '.table-card[data-table="Table 1"]');
  expect(below.y).toBeGreaterThan(above.y + above.height - 1);
});

test("deleting a row of blocks names what goes with it, and undo brings it back", async ({
  page,
}) => {
  await newSpreadsheet(page);
  await page.getByRole("button", { name: "Add row of blocks" }).last().click();
  const row = page.getByRole("region", { name: "Row 1" });
  await row.getByRole("button", { name: "Add text", exact: true }).click();
  await expect(row.locator('[data-view="Text 1"]')).toBeVisible();

  await chooseBlockAction(page, "Row 1", "Delete row and its blocks");
  const dialog = page.getByRole("alertdialog").or(page.getByRole("dialog"));
  await expect(dialog).toContainText("Delete Row 1 and the block in it (Text 1)?");
  await dialog.getByRole("button", { name: "Delete row", exact: true }).click();
  await expect(page.getByRole("region", { name: "Row 1" })).toHaveCount(0);
  await expect(page.locator('[data-view="Text 1"]')).toHaveCount(0);

  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Row 1" }).locator('[data-view="Text 1"]'),
  ).toBeVisible();
});
