import { expect, test } from "@playwright/test";
import { newSpreadsheet, cell, enter, reload, openPageMenu, expectCellSize } from "./helpers";

test("a cell input keeps its label visible at the default column width", async ({ page }) => {
  await newSpreadsheet(page);
  await enter(page, "A1", '=TEXTBOX(A2, "Name")');

  const control = cell(page, "A1");
  await expectCellSize(page, "A1", "width", 120);
  const label = control.locator(".cell-control--input > span");
  const input = control.getByRole("textbox", { name: "Name" });
  await expect(label).toHaveText("Name");
  await expect
    .poll(() => label.evaluate((element) => element.scrollWidth <= element.clientWidth))
    .toBe(true);
  await expect
    .poll(() => input.evaluate((element) => element.getBoundingClientRect().width))
    .toBeGreaterThan(0);
});

test("a button writes the sum of two cells into a third, and the result persists", async ({
  page,
}) => {
  await newSpreadsheet(page);
  await enter(page, "A1", "1");
  await enter(page, "A2", "2");
  await enter(page, "A4", '=BUTTON("Sum range", EXECUTE(SUM(A1,A2),A3))');
  await expect(cell(page, "A3")).toHaveText("");

  await page.getByRole("button", { name: "Sum range" }).click();
  await expect(cell(page, "A3")).toHaveText("3");
  await expect(page.getByRole("status")).toHaveText(/Updated A3/);

  // The button reads the cells as they are at each click.
  await enter(page, "A1", "10");
  await page.getByRole("button", { name: "Sum range" }).click();
  await expect(cell(page, "A3")).toHaveText("12");

  await reload(page);
  await expect(cell(page, "A1")).toHaveText("10");
  await expect(cell(page, "A3")).toHaveText("12");
  await expect(page.getByRole("button", { name: "Sum range" })).toBeVisible();
});

test("committing a formula closes parentheses left open at the end", async ({ page }) => {
  await newSpreadsheet(page);
  await enter(page, "D2", "1");
  await enter(page, "D3", "2");
  await enter(page, "D4", "3");
  await cell(page, "A1").click();
  await page.keyboard.type("=SUM(D2:D4)");
  const editing = page.getByLabel("Cell content");
  await expect(editing).toHaveText("=SUM(D2:D4)");
  await page.keyboard.press("Backspace");
  await expect(editing).toHaveText("=SUM(D2:D4");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("grid", { name: "Table 1", exact: true })).toBeFocused();
  await expect(cell(page, "A1")).toHaveText("6");
  await cell(page, "A1").click();
  await expect(page.getByLabel("Formula")).toHaveValue("=SUM(D2:D4)");
});

test("formula typing inserts matching parentheses and deletes an empty pair", async ({ page }) => {
  await newSpreadsheet(page);

  await cell(page, "A1").click();
  await page.keyboard.type("=IF(");
  const first = page.getByLabel("Cell content");
  await expect(first).toHaveText("=IF()");
  await page.keyboard.press("Backspace");
  await expect(first).toHaveText("=IF");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");

  await cell(page, "A2").click();
  await page.keyboard.type("=SUM(A1");
  await expect(page.getByLabel("Cell content")).toHaveText("=SUM(A1)");
});

test("a cell button asks before clearing cells", async ({ page }) => {
  await newSpreadsheet(page);
  await enter(page, "A1", "keep this");
  await enter(page, "B1", '=BUTTON("Clear", CLEAR(A1), "Clear A1?")');

  const clear = cell(page, "B1").getByRole("button", { name: "Clear", exact: true });
  await clear.click();
  const dialog = page.getByRole("dialog", { name: "Confirm action" });
  await expect(dialog).toContainText("Clear A1?");
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
  await expect(cell(page, "A1")).toHaveText("keep this");

  await clear.click();
  await dialog.getByRole("button", { name: "Run button" }).click();
  await expect(cell(page, "A1")).toHaveText("");
});

test("formulas read other tables and other pages, and follow their changes", async ({ page }) => {
  await newSpreadsheet(page);

  await page.getByRole("button", { name: "Add table" }).last().click();
  await enter(page, "A1", "5", "Table 2");
  await enter(page, "A1", "='Table 2'!A1*2");
  await expect(cell(page, "A1")).toHaveText("10");

  await page.getByRole("button", { name: "Add page" }).click();
  const pages = page.getByRole("navigation", { name: "Pages" });
  await expect(pages.locator('[aria-current="page"]')).toHaveText(/Page 2/);
  await enter(page, "A1", "='Page 1'!'Table 2'!A1+1");
  await expect(cell(page, "A1")).toHaveText("6");

  await pages.getByText("Page 1").click();
  await enter(page, "A1", "7", "Table 2");
  await expect(cell(page, "A1")).toHaveText("14");

  await pages.getByText("Page 2").click();
  await expect(cell(page, "A1")).toHaveText("8");

  await reload(page);
  await expect(cell(page, "A1")).toHaveText("8");
});

test("a block moves to another page, formulas follow it, and pages are reordered", async ({
  page,
}) => {
  await newSpreadsheet(page);
  await page.getByRole("button", { name: "Add table" }).last().click();
  await enter(page, "A1", "5", "Table 2");
  await enter(page, "A1", "='Table 2'!A1*2");
  await page.getByRole("button", { name: "Add page" }).click();
  const pages = page.getByRole("navigation", { name: "Pages" });
  await expect(pages.locator('[aria-current="page"]')).toHaveText(/Page 2/);
  await pages.getByText("Page 1").click();
  await expect(cell(page, "A1")).toHaveText("10");

  // Table 2 goes to Page 2, and the formula that read it now names that page.
  await openPageMenu(page, "Table 2");
  await page.getByRole("menuitem", { name: "Move to Page 2" }).click();
  await expect(page.getByRole("status")).toHaveText(/Moved Table 2 to Page 2/);
  await expect(page.locator('[data-table="Table 2"]')).toHaveCount(0);
  await expect(cell(page, "A1")).toHaveText("10");
  await cell(page, "A1").click();
  await expect(page.getByLabel("Formula")).toHaveValue("='Page 2'!'Table 2'!A1*2");

  await pages.getByText("Page 2").click();
  await expect(cell(page, "A1", "Table 2")).toHaveText("5");
  // Page 1 has a table of the same name as the one Page 2 began with.
  await openPageMenu(page, "Table 1");
  await page.getByRole("menuitem", { name: "Move to Page 1" }).click();
  await expect(page.getByRole("alert")).toHaveText(/Page 1 already has a table named Table 1/);
  await expect(page.locator('[data-table="Table 1"]')).toBeVisible();

  // The open page moves among the tabs, and stays there.
  const names = () => pages.getByRole("link").allTextContents();
  expect(await names()).toEqual(["Page 1", "Page 2"]);
  await pages.getByRole("button", { name: "Move Page 2 left" }).click();
  await expect(pages.getByRole("button", { name: "Move Page 2 left" })).toBeDisabled();
  expect(await names()).toEqual(["Page 2", "Page 1"]);
  await reload(page);
  await expect(cell(page, "A1", "Table 2")).toHaveText("5");
  expect(await names()).toEqual(["Page 2", "Page 1"]);
  await pages.getByText("Page 1").click();
  await expect(cell(page, "A1")).toHaveText("10");
});

test("a button sends an email built from cells, and reports a bad address", async ({ page }) => {
  await newSpreadsheet(page);
  await enter(page, "A1", "ada@example.com");
  await enter(page, "A2", "Hello");
  await enter(page, "A3", "The total is 3");
  await enter(page, "B1", '=BUTTON("Click me!", SEND_EMAIL(A1,A2,A3))');

  await page.getByRole("button", { name: "Click me!" }).click();
  await expect(page.getByRole("status")).toHaveText(/Email sent/);

  await enter(page, "A1", "nobody");
  await page.getByRole("button", { name: "Click me!" }).click();
  await expect(page.getByRole("alert")).toHaveText(/"nobody" is not an email address/);
});

test("renaming a table or page rewrites the formulas that name it", async ({ page }) => {
  await newSpreadsheet(page);
  await page.getByRole("button", { name: "Add table" }).last().click();
  await enter(page, "A1", "5", "Table 2");
  await enter(page, "A1", "='Table 2'!A1+1");
  await enter(page, "A2", "='Page 1'!'Table 2'!A1*2");
  await expect(cell(page, "A1")).toHaveText("6");

  await page.locator('[data-table="Table 2"]').getByText("Table 2").dblclick();
  await page.getByLabel("Table name").fill("Sales");
  await page.getByLabel("Table name").press("Enter");
  await expect(page.locator('[data-table="Sales"]')).toBeVisible();
  await expect(cell(page, "A1")).toHaveText("6");
  await cell(page, "A1").click();
  await expect(page.getByLabel("Formula")).toHaveValue("=Sales!A1+1");

  await page.locator('[data-table="Sales"]').getByText("Sales").dblclick();
  await page.getByLabel("Table name").fill("Table 1");
  await page.getByLabel("Table name").press("Enter");
  await expect(page.getByRole("alert")).toHaveText(/A table named Table 1 already exists/);

  const pages = page.getByRole("navigation", { name: "Pages" });
  await pages.getByText("Page 1").dblclick();
  await page.getByLabel("Page name").fill("Summary");
  await page.getByLabel("Page name").press("Enter");
  await expect(pages.locator('[aria-current="page"]')).toHaveText(/Summary/);
  await expect(cell(page, "A2")).toHaveText("10");
  await cell(page, "A2").click();
  await expect(page.getByLabel("Formula")).toHaveValue("=Summary!Sales!A1*2");

  await reload(page);
  await expect(cell(page, "A1")).toHaveText("6");
  await expect(cell(page, "A2")).toHaveText("10");
  await expect(pages.locator('[aria-current="page"]')).toHaveText(/Summary/);
});

test("rows and columns can be inserted and deleted, and formulas follow", async ({ page }) => {
  await newSpreadsheet(page);
  await enter(page, "A1", "1");
  await enter(page, "A2", "2");
  await enter(page, "A3", "3");
  await enter(page, "B1", "=SUM(A1:A3)");
  await enter(page, "C1", "=A2*10");
  await expect(cell(page, "B1")).toHaveText("6");

  // Delete row 2: the sum shrinks, and the formula that named A2 loses its target.
  await cell(page, "A2").click();
  await page.getByRole("toolbar", { name: "Format" }).getByRole("button", { name: "Bold" }).click();
  await page.getByRole("button", { name: "Delete row" }).click();
  await expect(cell(page, "A2")).toHaveText("3");
  await expect(cell(page, "B1")).toHaveText("4");
  await expect(cell(page, "C1")).toHaveText("#REF!");

  const deletionNotice = page
    .locator('.notice--floating[role="status"]')
    .filter({ hasText: "Deleted row 2" });
  await deletionNotice.getByRole("button", { name: "Undo" }).click();
  await expect(cell(page, "A2")).toHaveText("2");
  await expect(cell(page, "B1")).toHaveText("6");
  await expect(cell(page, "C1")).toHaveText("20");
  await expect(cell(page, "A2").locator(".cell-value")).toHaveCSS("font-weight", "700");

  // Return to the deleted state so the rest of the test can exercise shifted formulas.
  await cell(page, "A2").click();
  await page.getByRole("button", { name: "Delete row" }).click();
  await expect(cell(page, "A2")).toHaveText("3");
  await expect(cell(page, "B1")).toHaveText("4");
  await expect(cell(page, "C1")).toHaveText("#REF!");

  // Insert a column left of B: the formulas move right and still read column A.
  await cell(page, "B1").click();
  await page.getByRole("button", { name: "Insert column left" }).click();
  await expect(cell(page, "B1")).toHaveText("");
  await expect(cell(page, "C1")).toHaveText("4");
  await cell(page, "C1").click();
  await expect(page.getByLabel("Formula")).toHaveValue("=SUM(A1:A2)");

  await reload(page);
  await expect(cell(page, "C1")).toHaveText("4");
  await expect(cell(page, "A2")).toHaveText("3");

  // The same actions are on the menu a right-click opens.
  await cell(page, "A2").click({ button: "right" });
  const menu = page.getByRole("menu", { name: "Actions for A2" });
  const rowsBeforeInsert = await page.locator('[data-table="Table 1"] tbody tr').count();
  await menu.getByRole("menuitem", { name: "Insert row below" }).click();
  await expect(page.locator('[data-table="Table 1"] tbody tr')).toHaveCount(rowsBeforeInsert + 1);
  await expect(menu).toHaveCount(0);
  await expect(cell(page, "A3")).toHaveText("");
  await enter(page, "A3", "10");
  await expect(cell(page, "C1")).toHaveText("4");

  // A right-click on a row header selects the row and opens the menu for it.
  await page.locator('[data-table="Table 1"] tbody th').nth(2).click({ button: "right" });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await page.keyboard.press("Delete");
  await expect(cell(page, "A3")).toHaveText("");

  // Dragging over row headers selects the rows, and the menu then acts on all of them.
  await enter(page, "A3", "10");
  await enter(page, "A4", "=SUM(A1:A3)");
  const rowHeaders = page.locator('[data-table="Table 1"] tbody th');
  await rowHeaders.nth(1).hover();
  await page.mouse.down();
  await rowHeaders.nth(2).hover();
  await page.mouse.up();
  await rowHeaders.nth(2).click({ button: "right" });
  const rowMenu = page.getByRole("menu", { name: "Actions for A2:I3" });
  await expect(rowMenu.getByRole("menuitem", { name: /column/ })).toHaveCount(0);
  await rowMenu.getByRole("menuitem", { name: "Insert 2 rows above" }).click();
  await expect(cell(page, "A4")).toHaveText("3");
  await expect(cell(page, "A6")).toHaveText("14");
  // The selected rows follow their IDs to rows 4–5. Select the newly inserted rows explicitly.
  await expect(page.locator('[data-table="Table 1"] tbody th.grid__header--selected')).toHaveText([
    "4",
    "5",
  ]);
  await rowHeaders.nth(1).hover();
  await page.mouse.down();
  await rowHeaders.nth(2).hover();
  await page.mouse.up();
  await rowHeaders.nth(2).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Delete rows 2-3" }).click();
  await expect(cell(page, "A2")).toHaveText("3");
  await expect(cell(page, "A4")).toHaveText("14");

  // The strips along the bottom and right edges add a row and a column.
  const table = page.locator('[data-table="Table 1"]');
  await expect(table.locator("tbody tr")).toHaveCount(20);
  await table.getByRole("button", { name: "Add row" }).click();
  await expect(table.locator("tbody tr")).toHaveCount(21);
  await table.getByRole("button", { name: "Add column" }).click();
  await expect(cell(page, "J1")).toBeVisible();

  // Resize sets both at once. A smaller size asks before it discards content.
  await enter(page, "B1", "=A4*2");
  await expect(cell(page, "B1")).toHaveText("28");
  await table.getByRole("button", { name: "Resize" }).click();
  const resize = page.getByRole("dialog", { name: "Resize Table 1" });
  await expect(resize.getByLabel("Columns")).toHaveValue("10");
  await expect(resize.getByLabel("Rows")).toHaveValue("21");
  await resize.getByLabel("Columns").fill("3");
  await resize.getByLabel("Rows").fill("3");
  const resizeConfirm = page.getByRole("alertdialog", { name: "Resize table" });
  await resize.getByRole("button", { name: "Resize" }).click();
  await expect(resizeConfirm).toContainText("Resizing Table 1 to 3 columns and 3 rows deletes");
  await resizeConfirm.getByRole("button", { name: "Resize" }).click();
  await expect(resize).toHaveCount(0);
  await expect(table.locator("tbody tr")).toHaveCount(3);
  await expect(cell(page, "D1")).toHaveCount(0);
  // The formula that read a row that went says so.
  await expect(cell(page, "B1")).toHaveText("#REF!");
  await reload(page);
  await expect(table.locator("tbody tr")).toHaveCount(3);
  await expect(cell(page, "B1")).toHaveText("#REF!");
});

test("deleting a column can be undone immediately with its formula and format", async ({
  page,
}) => {
  await newSpreadsheet(page);
  await enter(page, "A1", "1");
  await enter(page, "B1", "2");
  await enter(page, "C1", "=SUM(A1:B1)");
  await cell(page, "B1").click();
  await page.getByRole("toolbar", { name: "Format" }).getByRole("button", { name: "Bold" }).click();
  await cell(page, "B1").click();
  await page.getByRole("button", { name: "Delete column" }).click();
  await expect(cell(page, "B1")).toHaveText("1");

  const deletionNotice = page
    .locator('.notice--floating[role="status"]')
    .filter({ hasText: "Deleted column B" });
  await deletionNotice.getByRole("button", { name: "Undo" }).click();
  await expect(cell(page, "B1")).toHaveText("2");
  await expect(cell(page, "C1")).toHaveText("3");
  await expect(cell(page, "B1").locator(".cell-value")).toHaveCSS("font-weight", "700");
});

test("a formula with several results fills the cells around it", async ({ page }) => {
  await newSpreadsheet(page);
  await enter(page, "A1", "pear");
  await enter(page, "A2", "apple");
  await enter(page, "A3", "fig");
  await enter(page, "B1", "5");
  await enter(page, "B2", "12");
  await enter(page, "B3", "8");

  await enter(page, "D1", "=SORT(FILTER(A1:B3, B1:B3 > 6), 2, FALSE)");
  await expect(cell(page, "D1")).toHaveText("apple");
  await expect(cell(page, "E1")).toHaveText("12");
  await expect(cell(page, "D2")).toHaveText("fig");
  await expect(cell(page, "E2")).toHaveText("8");
  await expect(cell(page, "E2")).toHaveClass(/grid__cell--filled/);

  await enter(page, "G1", "=SUM(E:E)");
  await expect(cell(page, "G1")).toHaveText("20");

  // The result follows its inputs.
  await enter(page, "B1", "50");
  await expect(cell(page, "D1")).toHaveText("pear");
  await expect(cell(page, "D3")).toHaveText("fig");
  await expect(cell(page, "G1")).toHaveText("70");

  // Typing into a filled cell blocks the result until the cell is cleared.
  await enter(page, "D2", "in the way");
  await expect(cell(page, "D1")).toHaveText("#SPILL!");
  await cell(page, "D2").click();
  await page.keyboard.press("Delete");
  await expect(cell(page, "D1")).toHaveText("pear");

  await reload(page);
  await expect(cell(page, "D3")).toHaveText("fig");
  await expect(cell(page, "G1")).toHaveText("70");
});

test("a form with a checkbox and a dropdown saves rows to a log", async ({ page }) => {
  await newSpreadsheet(page);
  await page.getByRole("button", { name: "Add table" }).last().click();

  // Table 1 is the form. Table 2 is the log.
  await enter(page, "A1", "Item");
  await enter(page, "B1", "pear");
  await enter(page, "A2", "Size");
  await enter(page, "C2", '=DROPDOWN("small, large", B2)');
  await enter(page, "A3", "Gift");
  await enter(page, "C3", '=CHECKBOX(B3, "wrap it")');
  await enter(
    page,
    "A5",
    "=BUTTON(\"Save\", DO(APPEND_ROW('Table 2'!A:C, B1, B2, B3), CLEAR(B1:B3)))",
  );

  await cell(page, "C2").getByRole("combobox").selectOption("large");
  await expect(cell(page, "B2")).toHaveText("large");
  await cell(page, "C3").getByRole("checkbox").check();
  await expect(cell(page, "B3")).toHaveText("TRUE");

  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(cell(page, "A1", "Table 2")).toHaveText("pear");
  await expect(cell(page, "B1", "Table 2")).toHaveText("large");
  await expect(cell(page, "C1", "Table 2")).toHaveText("TRUE");
  // The form is reset, and its controls follow.
  await expect(cell(page, "B1")).toHaveText("");
  await expect(cell(page, "C3").getByRole("checkbox")).not.toBeChecked();
  await expect(cell(page, "C2").getByRole("combobox")).toHaveValue("-1");

  await enter(page, "B1", "fig");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(cell(page, "A2", "Table 2")).toHaveText("fig");

  await reload(page);
  await expect(cell(page, "A1", "Table 2")).toHaveText("pear");
  await expect(cell(page, "A2", "Table 2")).toHaveText("fig");
});

test("typing a formula offers completions and shows what a function expects", async ({ page }) => {
  await newSpreadsheet(page);
  await enter(page, "A1", "4");

  await cell(page, "B1").click();
  await page.keyboard.type("=sq");
  const suggestions = page.getByRole("listbox");
  await expect(suggestions.getByRole("option")).toHaveText([/SQRT/]);

  await page.keyboard.press("Tab");
  await expect(page.locator(".formula-editor__signature")).toContainText("SQRT(number)");
  await page.keyboard.type("A1)");
  await page.keyboard.press("Enter");
  await expect(cell(page, "B1")).toHaveText("2");

  // The arrows pick from the list, and a click works too.
  await cell(page, "B2").click();
  await page.keyboard.type("=cou");
  await expect(suggestions).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await page.keyboard.type("A1:B1)");
  await page.keyboard.press("Enter");
  await expect(cell(page, "B2")).toHaveText("2");
  await cell(page, "B2").click();
  await expect(page.getByLabel("Formula")).toHaveValue("=COUNTA(A1:B1)");

  await cell(page, "B3").click();
  await page.keyboard.type("=ab");
  await suggestions.getByRole("option", { name: /ABS/ }).click();
  await page.keyboard.type("-7)");
  await page.keyboard.press("Enter");
  await expect(cell(page, "B3")).toHaveText("7");
});

test("a formula is filled down by dragging, and cells are copied and pasted", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await newSpreadsheet(page);
  await enter(page, "A1", "1");
  await enter(page, "A2", "2");
  await enter(page, "A3", "3");
  await enter(page, "B1", "=A1*10");

  // Drag the fill handle of B1 down to B3.
  await cell(page, "B1").click();
  await cell(page, "B1").locator(".grid__fill-handle").hover();
  await page.mouse.down();
  await cell(page, "B2").hover();
  await cell(page, "B3").hover();
  await page.mouse.up();
  await expect(cell(page, "B2")).toHaveText("20");
  await expect(cell(page, "B3")).toHaveText("30");
  await cell(page, "B3").click();
  await expect(page.getByLabel("Formula")).toHaveValue("=A3*10");

  // Select A1:B3 by dragging, copy it, and paste it at D1.
  await cell(page, "A1").hover();
  await page.mouse.down();
  await cell(page, "B3").hover();
  await page.mouse.up();
  await page.keyboard.press("ControlOrMeta+C");
  await cell(page, "D1").click();
  await page.keyboard.press("ControlOrMeta+V");
  await expect(cell(page, "D3")).toHaveText("3");
  await expect(cell(page, "E3")).toHaveText("30");
  await cell(page, "E3").click();
  await expect(page.getByLabel("Formula")).toHaveValue("=D3*10");

  // Shift+Down extends the selection, Ctrl+D fills it, and Delete clears it.
  await enter(page, "G1", "=A1+1");
  await cell(page, "G1").click();
  await page.keyboard.press("Shift+ArrowDown");
  await page.keyboard.press("Shift+ArrowDown");
  await page.keyboard.press("ControlOrMeta+D");
  await expect(cell(page, "G3")).toHaveText("4");
  await page.keyboard.press("Delete");
  await expect(cell(page, "G1")).toHaveText("");
  await expect(cell(page, "G3")).toHaveText("");

  await reload(page);
  await expect(cell(page, "B3")).toHaveText("30");
  await expect(cell(page, "E3")).toHaveText("30");
});

test("dates are typed, computed with, and stamped by a button", async ({ page }) => {
  await newSpreadsheet(page);
  await enter(page, "A1", "2026-09-30");
  await enter(page, "A2", "=A1 + 7");
  await enter(page, "A3", '=DAYS(A2, A1) & " days"');
  await enter(page, "A4", "=EOMONTH(A1, 1)");
  await expect(cell(page, "A2")).toHaveText("2026-10-07");
  await expect(cell(page, "A3")).toHaveText("7 days");
  await expect(cell(page, "A4")).toHaveText("2026-10-31");

  // The server stamps the row with the time on this browser's clock.
  await enter(page, "C1", '=BUTTON("Stamp", EXECUTE(TODAY(), D1))');
  await page.getByRole("button", { name: "Stamp" }).click();
  const today = await page.evaluate(() => {
    const now = new Date();
    const pad = (value: number): string => String(value).padStart(2, "0");
    return `${String(now.getFullYear())}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  });
  await expect(cell(page, "D1")).toHaveText(today);
  await enter(page, "E1", "=ISDATE(D1)");
  await expect(cell(page, "E1")).toHaveText("TRUE");
});
