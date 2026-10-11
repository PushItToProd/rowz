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
  await page.locator('[data-add-block-type="row"]').last().click();
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
  await page.locator('[data-add-block-type="row"]').last().click();
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

/** Drags a block or a row of blocks by its header and releases it at a point in the window. */
async function dragHeader(page: Page, header: string, to: { x: number; y: number }) {
  const from = await box(page, header);
  await page.mouse.move(from.x + from.width - 60, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y - 20, { steps: 5 });
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await expect(page.locator(".editor__drop")).toBeVisible();
  await page.mouse.up();
  await expect(page.locator(".editor__drop")).toHaveCount(0);
  await expect(page.locator(".editor[data-saving]")).toHaveCount(0);
}

test("dragging a header moves a block into a row, within it, and out, and moves a row", async ({
  page,
}) => {
  // Tall enough to show the whole page, so that no header is under the bars that stay in view.
  await page.setViewportSize({ width: 1280, height: 2000 });
  await newSpreadsheet(page);
  await page.locator('[data-add-block-type="row"]').last().click();
  const row = page.getByRole("region", { name: "Row 1" });
  await row.getByRole("button", { name: "Add chart", exact: true }).click();
  await expect(row.locator('[data-view="Chart 1"]')).toBeVisible();
  await page.evaluate(() => {
    window.scrollTo(0, 0);
  });
  const TABLE = '.table-card[data-table="Table 1"]';
  const CHART = '[data-view="Chart 1"]';

  // Into the row, to the right of the chart.
  let chart = await box(page, CHART);
  await dragHeader(page, `${TABLE} .table-card__header`, {
    x: chart.x + chart.width - 20,
    y: chart.y + 30,
  });
  await expect(row.locator(TABLE)).toBeVisible();
  expect((await box(page, TABLE)).x).toBeGreaterThan((await box(page, CHART)).x);

  // Within the row, to the left of the chart.
  chart = await box(page, CHART);
  await dragHeader(page, `${TABLE} .table-card__header`, { x: chart.x + 20, y: chart.y + 30 });
  expect((await box(page, TABLE)).x).toBeLessThan((await box(page, CHART)).x);

  // Out of the row, to the page above it.
  const header = await box(page, ".block-row__header");
  await dragHeader(page, `${TABLE} .table-card__header`, { x: header.x + 200, y: header.y - 30 });
  await expect(row.locator(TABLE)).toHaveCount(0);
  expect((await box(page, TABLE)).y).toBeLessThan((await box(page, ".block-row")).y);

  // The row itself, above the table.
  const table = await box(page, TABLE);
  await dragHeader(page, ".block-row__header", { x: table.x + 200, y: table.y + 5 });
  expect((await box(page, ".block-row")).y).toBeLessThan((await box(page, TABLE)).y);

  // One undo step takes back the last drag.
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.locator(".editor[data-saving]")).toHaveCount(0);
  expect((await box(page, TABLE)).y).toBeLessThan((await box(page, ".block-row")).y);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(page.locator(".editor[data-saving]")).toHaveCount(0);

  await reload(page);
  expect((await box(page, ".block-row")).y).toBeLessThan((await box(page, TABLE)).y);
  await expect(row.locator(CHART)).toBeVisible();
});
