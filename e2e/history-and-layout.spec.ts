import { expect, test } from "@playwright/test";
import { newSpreadsheet, cell, expectCellSize, enter, reload } from "./helpers";

test("undo reverses a format, a row insertion, and a cell edit", async ({ page }) => {
  await newSpreadsheet(page);
  await enter(page, "A1", "remove me");
  await cell(page, "A1").click();
  await page.getByRole("button", { name: "Insert row above" }).click();
  await expect(cell(page, "A2")).toHaveText("remove me");
  await cell(page, "A2").click();
  await page.getByRole("toolbar", { name: "Format" }).getByRole("button", { name: "Bold" }).click();
  await expect(cell(page, "A2").locator(".cell-value")).toHaveCSS("font-weight", "700");

  await page.keyboard.press("ControlOrMeta+z");
  await page.keyboard.press("ControlOrMeta+z");
  await page.keyboard.press("ControlOrMeta+z");

  await expect(cell(page, "A1")).toHaveText("");
  await expect(cell(page, "A2")).toHaveCount(1);
  await expect(cell(page, "A1").locator(".cell-value")).not.toHaveCSS("font-weight", "700");
});

test("the row and column growth menus add a batch in one undo step", async ({ page }) => {
  await newSpreadsheet(page);
  const table = page.locator('[data-table="Table 1"]');
  const rowStrip = page.getByRole("button", { name: "Add row" });
  // The menu closes when the page scrolls, so let Playwright's scroll finish first.
  await rowStrip.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await rowStrip.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Add 5 rows" }).click();
  await expect(table.locator("tbody tr")).toHaveCount(25);

  await cell(page, "A1").click();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(table.locator("tbody tr")).toHaveCount(20);

  const columnStrip = page.getByRole("button", { name: "Add column" });
  await columnStrip.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await columnStrip.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Add 5 columns" }).click();
  await expect(table.locator("thead th")).toHaveCount(14);

  await cell(page, "A1").click();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(table.locator("thead th")).toHaveCount(9);
});

test("header border resizing persists and supports reset, undo, and redo", async ({ page }) => {
  await newSpreadsheet(page);
  async function drag(label: string, dx: number, dy: number) {
    const handle = page.getByLabel(label, { exact: true });
    const box = await handle.boundingBox();
    if (!box) throw new Error(`No bounds for ${label}`);
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx, y + dy);
    await page.mouse.up();
  }
  await drag("Resize column A", 80, 0);
  await expectCellSize(page, "A1", "width", 200);
  await drag("Resize row 1", 0, 40);
  await expectCellSize(page, "A1", "height", 70);
  await reload(page);
  await expectCellSize(page, "A1", "width", 200);
  await expectCellSize(page, "A1", "height", 70);
  await page.getByLabel("Resize column A", { exact: true }).dblclick();
  await expectCellSize(page, "A1", "width", 120);
  await cell(page, "A1").click();
  await page.keyboard.press("ControlOrMeta+z");
  await expectCellSize(page, "A1", "width", 200);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expectCellSize(page, "A1", "width", 120);
});

test("header menus resize selected rows and columns in pixels", async ({ page }) => {
  await newSpreadsheet(page);
  const columns = page.locator('[data-table="Table 1"] thead th');
  await columns.nth(1).click();
  await columns.nth(2).click({ modifiers: ["Shift"] });
  await columns.nth(2).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Resize column", exact: true }).click();
  let form = page.getByRole("form", { name: "Resize column", exact: true });
  await form.getByRole("spinbutton").fill("175");
  await form.getByRole("button", { name: "Apply", exact: true }).click();
  await expectCellSize(page, "A1", "width", 175);
  await expectCellSize(page, "B1", "width", 175);
  const rows = page.locator('[data-table="Table 1"] tbody th');
  await rows.nth(0).click();
  await rows.nth(1).click({ modifiers: ["Shift"] });
  await rows.nth(1).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Resize row", exact: true }).click();
  form = page.getByRole("form", { name: "Resize row", exact: true });
  await form.getByRole("spinbutton").fill("65");
  await form.getByRole("button", { name: "Apply", exact: true }).click();
  await expectCellSize(page, "A1", "height", 65);
  await expectCellSize(page, "A2", "height", 65);
  await reload(page);
  await expectCellSize(page, "A2", "width", 175);
  await expectCellSize(page, "A2", "height", 65);
});

test("Save a copy opens an independent document with working formulas", async ({ page }) => {
  await newSpreadsheet(page);
  const original = page.url();
  await enter(page, "A1", "21");
  await enter(page, "B1", "=A1*2");
  await expect(page.locator(".editor[data-saving]")).toHaveCount(0);
  await page.getByRole("button", { name: "Save a copy", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Untitled document (copy)");
  expect(page.url()).not.toBe(original);
  const copy = page.url();
  await expect(page.locator('.notice--floating[role="status"]')).toContainText(
    "Copy saved. You are now editing “Untitled document (copy)”.",
  );
  await page.getByRole("link", { name: "Back to original", exact: true }).click();
  await expect(page).toHaveURL(original);
  await expect(cell(page, "A1")).toHaveText("21");
  await expect(cell(page, "B1")).toHaveText("42");
  await page.goto(copy);
  await expect(cell(page, "B1")).toHaveText("42");
  await enter(page, "A1", "5");
  await expect(cell(page, "B1")).toHaveText("10");
  await expect(page.locator(".editor[data-saving]")).toHaveCount(0);
  await page.goto(original);
  await expect(cell(page, "A1")).toHaveText("21");
  await expect(cell(page, "B1")).toHaveText("42");
});

test("the header says when a change is on its way to the server", async ({ page }) => {
  await newSpreadsheet(page);
  const status = page.locator(".editor__saved");
  await expect(status).toHaveText("Saved");

  // Hold the save, so that the time it takes does not pass unseen.
  let release = (): void => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/tables/*/cells", async (route) => {
    await held;
    await route.continue();
  });
  await cell(page, "A1").click();
  await page.keyboard.type("kept");
  await page.keyboard.press("Enter");
  await expect(status).toHaveText("Saving…");
  release();
  await expect(status).toHaveText("Saved");

  await reload(page);
  await expect(cell(page, "A1")).toHaveText("kept");
});

test("a deleted row is brought back from the history, and a version opens as a copy", async ({
  page,
}) => {
  await newSpreadsheet(page);
  await enter(page, "A1", "keep me");
  await enter(page, "A2", "and me");
  await cell(page, "A1").click();
  await page.getByRole("button", { name: "Delete row" }).click();
  await expect(cell(page, "A1")).toHaveText("and me");

  await page.getByRole("button", { name: "History" }).click();
  const history = page.getByRole("dialog", { name: "History" });
  const version = history
    .getByRole("listitem")
    .filter({ hasText: "Before deleting row 1 of Table 1" });
  await expect(version).toBeVisible();

  const restoreDialog = page.getByRole("alertdialog", { name: "Restore version" });
  await version.getByRole("button", { name: "Restore" }).click();
  await restoreDialog.getByRole("button", { name: "Restore" }).click();
  await expect(page.getByRole("status")).toHaveText(/The version was restored/);
  await expect(cell(page, "A1")).toHaveText("keep me");
  await expect(cell(page, "A2")).toHaveText("and me");
  // Restoring kept what it replaced, so the restore can be undone too.
  await expect(history.getByRole("listitem").first()).toContainText(
    "Before restoring an earlier version",
  );

  await history.getByRole("listitem").first().getByRole("button", { name: "Open a copy" }).click();
  await expect(history).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Untitled document (copy)");
  await expect(cell(page, "A1")).toHaveText("and me");
});

test("deleting a page can be undone immediately with its formulas and formats", async ({
  page,
}) => {
  await newSpreadsheet(page);
  await enter(page, "A1", "5");
  const pages = page.getByRole("navigation", { name: "Pages" });
  await page.getByRole("button", { name: "Add page" }).click();
  await expect(pages.locator('[aria-current="page"]')).toHaveText(/Page 2/);
  await enter(page, "A1", "='Page 1'!'Table 1'!A1*2");
  await expect(cell(page, "A1")).toHaveText("10");
  await cell(page, "A1").click();
  await page.getByRole("toolbar", { name: "Format" }).getByRole("button", { name: "Bold" }).click();
  await expect(cell(page, "A1").locator(".cell-value")).toHaveCSS("font-weight", "700");

  await pages.getByRole("button", { name: "Delete Page 2" }).click();
  await expect(pages.locator('[aria-current="page"]')).toHaveText(/Page 1/);
  const deletionNotice = page
    .locator('.notice--floating[role="status"]')
    .filter({ hasText: "Deleted page Page 2" });
  await deletionNotice.getByRole("button", { name: "Undo" }).click();

  await expect(pages.getByText("Page 2")).toBeVisible();
  await pages.getByText("Page 2").click();
  await expect(cell(page, "A1")).toHaveText("10");
  await expect(cell(page, "A1").locator(".cell-value")).toHaveCSS("font-weight", "700");
});
