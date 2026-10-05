import { readFile } from "node:fs/promises";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { APP_NAME } from "./appName";

const PASSWORD = "correct horse battery staple";

function uniqueEmail(): string {
  return `user-${crypto.randomUUID()}@example.com`;
}

async function signUp(page: Page, email = uniqueEmail()): Promise<string> {
  await page.goto("/signup");
  await page.getByLabel("Name").fill("Ada");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page.getByRole("heading", { name: "Spreadsheets" })).toBeVisible();
  return email;
}

/** Signs up and opens a new spreadsheet in the editor. */
async function newSpreadsheet(page: Page): Promise<void> {
  await signUp(page);
  await page.getByRole("button", { name: "New spreadsheet" }).click();
  await expect(cell(page, "A1")).toBeVisible();
}

function cell(page: Page, address: string, table = "Table 1"): Locator {
  return page.locator(`[data-table="${table}"] [data-cell="${address}"]`);
}

/** Collapsed table borders can make the rendered size differ by a fraction of a pixel. */
async function expectCellSize(
  page: Page,
  address: string,
  dimension: "width" | "height",
  size: number,
): Promise<void> {
  await expect
    .poll(() =>
      cell(page, address).evaluate(
        (element, dimension) => Math.round(element.getBoundingClientRect()[dimension]),
        dimension,
      ),
    )
    .toBe(size);
}

/** Types into a cell the way a person does: click it, type, press Enter. */
async function enter(page: Page, address: string, text: string, table = "Table 1"): Promise<void> {
  await cell(page, address, table).click();
  await expect(cell(page, address, table)).toHaveAttribute("aria-selected", "true");
  const grid = page.getByRole("grid", { name: table, exact: true });
  await page.keyboard.type(text);
  const editing = page.getByLabel("Cell content");
  await expect(editing).toHaveText(text);
  await page.keyboard.press("Enter");
  await expect(grid).toBeFocused();
}

/**
 * Reloads the editor once the server has answered every change. Changes are
 * sent one at a time, and a reload drops the ones still waiting.
 */
async function reload(page: Page): Promise<void> {
  await expect(page.locator(".editor[data-saving]")).toHaveCount(0);
  await page.reload();
}

/**
 * Opens the menu of pages a block can move to. A menu closes when the page
 * scrolls, and the scroll that brings the button into view can end after the
 * click, so the click is made again until the menu stays open.
 */
async function openPageMenu(page: Page, block: string): Promise<void> {
  const button = page.getByRole("button", { name: `Move ${block} to another page` });
  await button.scrollIntoViewIfNeeded();
  await expect(async () => {
    await button.click();
    await expect(page.getByRole("menu")).toBeVisible({ timeout: 500 });
  }).toPass();
}

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
  page.once("dialog", (dialog) => void dialog.accept());
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
  page.once("dialog", (dialog) => {
    expect(dialog.message()).toContain("Resizing Table 1 to 3 columns and 3 rows deletes");
    void dialog.accept();
  });
  await resize.getByRole("button", { name: "Resize" }).click();
  await expect(resize).toHaveCount(0);
  await expect(table.locator("tbody tr")).toHaveCount(3);
  await expect(cell(page, "D1")).toHaveCount(0);
  // The formula that read a row that went says so.
  await expect(cell(page, "B1")).toHaveText("#REF!");
  await reload(page);
  await expect(table.locator("tbody tr")).toHaveCount(3);
  await expect(cell(page, "B1")).toHaveText("#REF!");
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

test("a page shows a chart and a text view of its tables, and they follow changes", async ({
  page,
}) => {
  await newSpreadsheet(page);
  await enter(page, "A1", "apples");
  await enter(page, "B1", "3");
  await enter(page, "A2", "pears");
  await enter(page, "B2", "5");

  await page.getByRole("button", { name: "Add chart" }).last().click();
  const chart = page.locator('[data-view="Chart 1"]');
  await expect(chart).toContainText("Enter the cells to chart");
  await chart.getByLabel("Chart data").click();
  await chart.getByLabel("Chart data").fill("'Table 1'!A1:B2");
  await chart.getByLabel("Chart data").press("Enter");
  await expect(chart.locator(".chart__bar")).toHaveCount(2);

  await chart.getByLabel("Chart type").selectOption("pie");
  await expect(chart.locator(".chart__slice")).toHaveCount(2);
  await expect(chart).toContainText("pears 63%");

  await page
    .locator('[data-insert-position="1"]')
    .getByRole("button", { name: "Add text" })
    .click();
  const text = page.locator('[data-view="Text 1"]');
  await expect(page.locator(".editor__block [data-table], .editor__block [data-view]")).toHaveCount(
    3,
  );
  await expect(page.locator(".editor__block").nth(1)).toContainText("Text 1");
  await expect(page.locator(".editor__block").nth(2)).toContainText("Chart 1");
  await expect(text.getByRole("heading", { name: "New text view" })).toBeVisible();
  await text.getByRole("button", { name: "Edit" }).click();
  await text
    .getByLabel("Text view source")
    .fill(
      [
        "## Fruit",
        "",
        "We have **{{ SUM('Table 1'!B1:B2) }}** pieces.",
        "",
        "{% for name, count in 'Table 1'!A1:B2 %}",
        "- {{ name }}: {{ count }}",
        "{% end %}",
      ].join("\n"),
    );
  // The view shows the result while the source is still being edited.
  await expect(text.locator(".text-view")).toContainText("We have 8 pieces.");
  await text.getByRole("button", { name: "Done" }).click();
  await expect(text.getByRole("listitem")).toHaveText(["apples: 3", "pears: 5"]);
  await expect(text.getByLabel("Text view source")).toBeHidden();

  // A double click on the text edits it too, and a click elsewhere saves it.
  await text.getByRole("heading", { name: "Fruit" }).dblclick();
  await expect(text.getByLabel("Text view source")).toBeFocused();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("\n## That is all");
  await cell(page, "C4").click();
  await expect(text.getByLabel("Text view source")).toBeHidden();
  await expect(text.getByRole("button", { name: "Edit" })).toBeVisible();
  await expect(text.getByRole("heading", { name: "That is all" })).toBeVisible();

  // Both follow a cell change.
  await enter(page, "B1", "15");
  await expect(text.locator(".text-view")).toContainText("We have 20 pieces.");
  await expect(chart).toContainText("apples 75%");

  // Both follow a table rename.
  await page.locator('[data-table="Table 1"] h2').getByText("Table 1").dblclick();
  await page.getByLabel("Table name").fill("Fruit");
  await page.getByLabel("Table name").press("Enter");
  await expect(chart.getByLabel("Chart data")).toHaveValue("Fruit!A1:B2");
  await expect(text.locator(".text-view")).toContainText("We have 20 pieces.");

  await reload(page);
  await expect(chart.locator(".chart__slice")).toHaveCount(2);
  await expect(chart.getByLabel("Chart type")).toHaveValue("pie");
  await expect(text.getByRole("listitem")).toHaveText(["apples: 15", "pears: 5"]);

  // The inserted text view moves down, then above the table, and stays there.
  const order = () =>
    page
      .locator(".editor__block > :first-child")
      .evaluateAll((cards) =>
        cards.map(
          (card) => card.getAttribute("data-table") ?? card.getAttribute("data-view") ?? "",
        ),
      );
  await expect.poll(order).toEqual(["Fruit", "Text 1", "Chart 1"]);
  await page.getByRole("button", { name: "Move Text 1 down" }).click();
  await expect.poll(order).toEqual(["Fruit", "Chart 1", "Text 1"]);
  await expect(page.getByRole("button", { name: "Move Text 1 down" })).toBeDisabled();
  await page.getByRole("button", { name: "Move Text 1 up" }).click();
  await expect.poll(order).toEqual(["Fruit", "Text 1", "Chart 1"]);
  await page.getByRole("button", { name: "Move Text 1 up" }).click();
  await expect(page.getByRole("button", { name: "Move Text 1 up" })).toBeDisabled();
  await expect.poll(order).toEqual(["Text 1", "Fruit", "Chart 1"]);
  await reload(page);
  await expect(text).toBeVisible();
  await expect.poll(order).toEqual(["Text 1", "Fruit", "Chart 1"]);

  page.once("dialog", (dialog) => void dialog.accept());
  await chart.getByRole("button", { name: "Delete chart" }).click();
  await expect(chart).toHaveCount(0);
  await expect(text).toBeVisible();
});

test("a spreadsheet is exported to a file and imported again, and a table to and from CSV", async ({
  page,
}, testInfo) => {
  await newSpreadsheet(page);
  await enter(page, "A1", "apples");
  await enter(page, "B1", "3");
  await enter(page, "A2", "pears, ripe");
  await enter(page, "B2", "=B1*2");
  await page.getByRole("button", { name: "Add chart" }).last().click();
  const chart = page.locator('[data-view="Chart 1"]');
  await chart.getByLabel("Chart data").click();
  await chart.getByLabel("Chart data").fill("'Table 1'!A1:B2");
  await chart.getByLabel("Chart data").press("Enter");
  await expect(chart.locator(".chart__bar")).toHaveCount(2);

  // The CSV holds the values the table shows.
  const csvDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV" }).click();
  const csv = await csvDownload;
  expect(csv.suggestedFilename()).toBe("Table 1.csv");
  // Saved here because a download has no path when the browser runs on another machine.
  const csvPath = testInfo.outputPath(csv.suggestedFilename());
  await csv.saveAs(csvPath);
  expect(await readFile(csvPath, "utf8")).toBe('apples,3\r\n"pears, ripe",6');

  // The spreadsheet file holds what was typed, so formulas survive.
  const fileDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const file = await fileDownload;
  expect(file.suggestedFilename()).toBe("Untitled spreadsheet.json");
  const filePath = testInfo.outputPath(file.suggestedFilename());
  await file.saveAs(filePath);

  await page.getByRole("link", { name: "← Spreadsheets" }).click();
  await page.getByLabel("Import").setInputFiles(filePath);
  await expect(cell(page, "B2")).toHaveText("6");
  await expect(page.locator('[data-view="Chart 1"] .chart__bar')).toHaveCount(2);
  await enter(page, "B1", "5");
  await expect(cell(page, "B2")).toHaveText("10");
  await page.getByRole("link", { name: "← Spreadsheets" }).click();
  await expect(page.getByRole("link", { name: "Untitled spreadsheet" })).toHaveCount(2);

  // A CSV file goes into a table from its first cell, and the table grows to fit.
  await page.getByRole("button", { name: "New spreadsheet" }).click();
  await expect(cell(page, "A1")).toBeVisible();
  await page.getByLabel("Import CSV").setInputFiles(csvPath);
  await expect(cell(page, "A2")).toHaveText("pears, ripe");
  await expect(cell(page, "B2")).toHaveText("6");

  // A file that is not a spreadsheet is refused with a message.
  await page.getByRole("link", { name: "← Spreadsheets" }).click();
  await page.getByLabel("Import").setInputFiles(csvPath);
  await expect(page.getByRole("alert")).toContainText("not a spreadsheet exported from this app");
});

test("a table with named columns has typed columns, a formula column, and column references", async ({
  page,
}) => {
  await newSpreadsheet(page);
  const rows = [
    ["Item", "Price", "Qty", "Paid"],
    ["pen", "2", "10", "TRUE"],
    ["ink", "5", "3", "FALSE"],
  ];
  for (const [row, cells] of rows.entries()) {
    for (const [col, text] of cells.entries()) {
      await enter(page, `${"ABCD"[col] ?? ""}${String(row + 1)}`, text);
    }
  }
  const header = (name: string): Locator =>
    page.locator(`[data-table="Table 1"] thead th[data-column="${name}"]`);
  const choose = async (column: string, item: string): Promise<void> => {
    await header(column).click({ button: "right" });
    await page.getByRole("menuitem", { name: item }).click();
  };

  // The first row becomes the names, and the data moves up.
  await page.getByRole("button", { name: "Name columns" }).click();
  await page.getByRole("menuitem", { name: "Use the first row as the names" }).click();
  await expect(header("Price")).toBeVisible();
  await expect(cell(page, "A1")).toHaveText("pen");

  // A checkbox column shows checkboxes, and ticking one stores it.
  await choose("Paid", "Column holds: Checkbox");
  await expect(cell(page, "D1").getByRole("checkbox")).toBeChecked();
  await cell(page, "D2").getByRole("checkbox").check();

  // A formula column computes every row from the columns it names.
  await choose("Column 1", "Column holds: A formula…");
  await page.getByLabel("Column formula").fill("=[Price] * [Qty]");
  await page
    .locator(".column-formula-popover")
    .getByRole("button", { name: "Apply", exact: true })
    .click();
  await expect(cell(page, "E1")).toHaveText("20");
  await expect(cell(page, "E2")).toHaveText("15");

  // Renaming a column rewrites the formulas that name it.
  await header("Column 1").getByText("Column 1").dblclick();
  await page.getByLabel("Column name").fill("Total");
  await page.getByLabel("Column name").press("Enter");
  await header("Price").getByText("Price").dblclick();
  await page.getByLabel("Column name").fill("Unit price");
  await page.getByLabel("Column name").press("Enter");
  await cell(page, "E2").click();
  await expect(page.getByLabel("Formula")).toHaveValue("=[Unit price] * [Qty]");

  // Inline, bar, and popover editors share a column draft and its undo history.
  let formulaWrites = 0;
  page.on("request", (request) => {
    if (
      request.method() === "PATCH" &&
      request.url().includes("/columns/") &&
      (request.postDataJSON() as { formula?: unknown } | null)?.formula !== undefined
    )
      formulaWrites += 1;
  });
  await cell(page, "E2").dblclick();
  await expect(cell(page, "E2").locator(".formula-column-label")).toHaveText(
    "Editing formula for every row in Table 1[Total]",
  );
  await page.getByLabel("Cell content").fill("=[Unit price] * [Qty] + 10");
  await page.locator(".formula-bar").getByRole("textbox").click();
  await expect(page.locator(".formula-bar").getByRole("textbox")).toHaveText(
    "=[Unit price] * [Qty] + 10",
  );
  await page.getByRole("button", { name: "Edit column formula", exact: true }).click();
  const columnDraft = page.getByLabel("Column formula");
  await expect(columnDraft).toHaveText("=[Unit price] * [Qty] + 10");
  await columnDraft.press("Control+z");
  await expect(columnDraft).toHaveText("=[Unit price] * [Qty]");
  expect(formulaWrites).toBe(0);
  await page
    .locator(".column-formula-popover")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await expect(page.locator(".column-formula-popover")).toHaveCount(0);
  expect(formulaWrites).toBe(0);

  // Typing a formula into a formula column changes it for every row, and completes column names.
  await page.locator(".formula-bar").getByRole("textbox").click();
  await page.locator(".formula-bar").getByRole("textbox").fill("=[Unit price] * [Qty] + [");
  await expect(page.getByRole("option", { name: /Qty/ })).toBeVisible();
  await page.locator(".formula-bar").getByRole("textbox").click();
  await page.locator(".formula-bar").getByRole("textbox").fill("=[Unit price] * [Qty] + 1");
  await page.locator(".formula-bar").getByRole("textbox").press("Enter");
  await expect(cell(page, "E1")).toHaveText("21");
  await expect(cell(page, "E2")).toHaveText("16");

  // Another table reads a whole column by the table's name.
  await page.getByRole("button", { name: "Add table" }).last().click();
  await enter(page, "A1", "=SUM('Table 1'[Total])", "Table 2");
  await expect(cell(page, "A1", "Table 2")).toHaveText("37");

  // A new row is computed too, and everything survives a reload.
  await enter(page, "B3", "4");
  await enter(page, "C3", "2");
  await expect(cell(page, "E3")).toHaveText("9");
  await expect(cell(page, "A1", "Table 2")).toHaveText("46");
  await reload(page);
  await expect(header("Unit price")).toBeVisible();
  await expect(cell(page, "E3")).toHaveText("9");
  await expect(cell(page, "D2").getByRole("checkbox")).toBeChecked();
  await expect(cell(page, "A1", "Table 2")).toHaveText("46");
});

test("a data table is sorted and filtered in place, and edits and fills act on the rows shown", async ({
  page,
}) => {
  await newSpreadsheet(page);
  const rows = [
    ["Item", "Qty"],
    ["pear", "3"],
    ["apple", "1"],
    ["fig", "2"],
  ];
  for (const [row, cells] of rows.entries()) {
    for (const [col, text] of cells.entries()) {
      await enter(page, `${"AB"[col] ?? ""}${String(row + 1)}`, text);
    }
  }
  await page.getByRole("button", { name: "Name columns" }).click();
  await page.getByRole("menuitem", { name: "Use the first row as the names" }).click();

  // Sorting by Item shows apple, fig, pear, which are stored rows 2, 3, and 1.
  await page
    .locator('[data-table="Table 1"] thead th[data-column="Item"]')
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "Sort ascending" }).click();
  const shown = page.locator('[data-table="Table 1"] tbody tr td:first-of-type');
  await expect(shown.nth(0)).toHaveText("apple");
  await expect(shown.nth(1)).toHaveText("fig");
  await expect(shown.nth(2)).toHaveText("pear");
  await expect(shown.nth(0)).toHaveAttribute("data-cell", "A2");

  // Editing the first row shown changes that row, and Enter goes to the row shown next.
  await cell(page, "A2").click();
  await page.keyboard.type("zebra");
  await page.keyboard.press("Enter");
  await expect(shown.nth(0)).toHaveText("fig");
  await expect(shown.nth(2)).toHaveText("zebra");
  await expect(page.locator('[data-table="Table 1"] [aria-selected="true"]')).toHaveAttribute(
    "data-cell",
    "A3",
  );

  // A filter hides rows, and the table says how many.
  await page.getByLabel("Table filter").click();
  await page.getByLabel("Table filter").fill("=[Qty] > 1");
  await page.getByLabel("Table filter").press("Enter");
  await expect(page.getByText("1 row hidden")).toBeVisible();
  await expect(shown).toHaveCount(3);

  // Filling down the rows shown writes the stored rows beneath them.
  await enter(page, "B3", "9");
  await cell(page, "B3").click();
  await page.keyboard.press("Shift+ArrowDown");
  await page.keyboard.press("Control+d");
  await expect(cell(page, "B1")).toHaveText("9");

  await page.getByRole("button", { name: "Clear filter" }).click();
  await expect(page.getByText("row hidden")).toHaveCount(0);
  await reload(page);
  await expect(page.getByLabel("Sort column 1")).toBeVisible();
});

test("a dropdown column offers a list of choices, and a choice is picked", async ({ page }) => {
  await newSpreadsheet(page);
  await enter(page, "A1", "Race");
  await enter(page, "A2", "one");
  await page.getByRole("button", { name: "Name columns" }).click();
  await page.getByRole("menuitem", { name: "Use the first row as the names" }).click();

  await page
    .locator('[data-table="Table 1"] thead th[data-column="Race"]')
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "Column holds: A choice…" }).click();
  await page.getByLabel("Choices", { exact: true }).fill("Trial\nSprint");
  await page.getByRole("button", { name: "Save choices" }).click();

  // The value typed before is outside the list, and stays.
  const dropdown = cell(page, "A1").getByRole("combobox");
  await expect(dropdown).toHaveValue("one");
  await dropdown.selectOption("Sprint");
  await expect(dropdown).toHaveValue("Sprint");
  await reload(page);
  await expect(cell(page, "A1").getByRole("combobox")).toHaveValue("Sprint");
});

test("a conditional format fills the cells that meet a criterion and follows their values", async ({
  page,
}) => {
  await newSpreadsheet(page);
  await enter(page, "A1", "50");
  await enter(page, "A2", "150");
  await page.getByRole("button", { name: "Conditional formats" }).click();
  await cell(page, "A1").click();
  await cell(page, "A2").click({ modifiers: ["Shift"] });
  await page.getByLabel("Criterion").fill(">100");
  await page.getByLabel("Rule fill").selectOption("red");
  await page.getByRole("button", { name: "Add rule" }).click();

  // The fill is the color of the rule, and only the cell that meets it has it.
  await expect(cell(page, "A2")).toHaveCSS("background-color", "rgb(253, 226, 223)");
  await expect(cell(page, "A1")).not.toHaveCSS("background-color", "rgb(253, 226, 223)");

  // Changing the value moves the fill, and the rule survives a reload.
  await enter(page, "A1", "500");
  await expect(cell(page, "A1")).toHaveCSS("background-color", "rgb(253, 226, 223)");
  await enter(page, "A2", "20");
  await expect(cell(page, "A2")).not.toHaveCSS("background-color", "rgb(253, 226, 223)");
  await enter(page, "A2", "150");
  await reload(page);
  await expect(cell(page, "A2")).toHaveCSS("background-color", "rgb(253, 226, 223)");
});

test("the Gran Turismo sample imports its comparison and checkbox, and preserves its color scale on export", async ({
  page,
}, testInfo) => {
  await signUp(page);
  await page.getByLabel("Import").setInputFiles("samples/gt7-grind-comparison.json");
  const payout = (address: string): Locator => cell(page, address, "Payout (8*5 hours)");
  const showSpa = (): Locator =>
    cell(page, "A1", "Options").getByRole("checkbox", { name: "Show Spa" });

  // The comparison starts without Spa; its largest and smallest payouts have different scale colors.
  const expectSampleSettings = async (): Promise<void> => {
    await expect(payout("A1")).toHaveText("Race");
    await expect(payout("A2")).toHaveText("Le Mans");
    await expect(payout("B11")).toHaveText("90,750,000");
    await expect(payout("J4")).toHaveText("50,600,000");
    const best = await payout("B11").evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    );
    const worst = await payout("J4").evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    );
    expect(best).not.toBe(worst);
    await expect(showSpa()).not.toBeChecked();
  };
  await expectSampleSettings();

  // The comparison, checkbox, and scale travel in the file.
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const file = await download;
  const filePath = testInfo.outputPath(file.suggestedFilename());
  await file.saveAs(filePath);
  await page.getByRole("link", { name: "← Spreadsheets" }).click();
  await page.getByLabel("Import").setInputFiles(filePath);
  await expectSampleSettings();

  // Checking the option adds Spa's payouts to the comparison.
  await showSpa().check();
  await expect(payout("A4")).toHaveText("Spa");
  await expect(payout("P1")).toHaveText("60");
});

test("cells are formatted from the toolbar, and the formats follow their cells", async ({
  page,
}) => {
  await newSpreadsheet(page);
  await enter(page, "A1", "Total");
  await enter(page, "B1", "1234.5");
  await enter(page, "B2", "0.256");
  const bar = page.getByRole("toolbar", { name: "Format" });

  await cell(page, "A1").click();
  await bar.getByRole("button", { name: "Bold" }).click();
  await expect(bar.getByRole("button", { name: "Bold" })).toHaveAttribute("aria-pressed", "true");
  await expect(cell(page, "A1").locator(".cell-value")).toHaveCSS("font-weight", "700");

  await cell(page, "B1").click();
  await bar.getByLabel("Number format").selectOption("$#,##0.00");
  await expect(cell(page, "B1")).toHaveText("$1,234.50");
  await bar.getByLabel("Fill color").selectOption("yellow");
  await expect(cell(page, "B1")).toHaveCSS("background-color", "rgb(255, 243, 184)");
  // The value is unchanged: the bar above still shows what was typed.
  await expect(page.getByLabel("Formula")).toHaveValue("1234.5");

  await cell(page, "B2").click();
  await bar.getByLabel("Number format").selectOption("0%");
  await expect(cell(page, "B2")).toHaveText("26%");

  // A format moves with its cell when a row is inserted above it.
  await cell(page, "A1").click();
  await page.getByRole("button", { name: "Insert row above" }).click();
  await expect(cell(page, "B2")).toHaveText("$1,234.50");
  await expect(cell(page, "B1")).not.toHaveCSS("background-color", "rgb(255, 243, 184)");

  await reload(page);
  await expect(cell(page, "B2")).toHaveText("$1,234.50");
  await expect(cell(page, "B3")).toHaveText("26%");
  await expect(cell(page, "A2").locator(".cell-value")).toHaveCSS("font-weight", "700");

  await cell(page, "B2").click();
  await bar.getByRole("button", { name: "Clear format" }).click();
  await expect(cell(page, "B2")).toHaveText("1234.5");
});

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
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Untitled spreadsheet (copy)");
  expect(page.url()).not.toBe(original);
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
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Delete row" }).click();
  await expect(cell(page, "A1")).toHaveText("and me");

  await page.getByRole("button", { name: "History" }).click();
  const history = page.getByRole("dialog", { name: "History" });
  const version = history
    .getByRole("listitem")
    .filter({ hasText: "Before deleting row 1 of Table 1" });
  await expect(version).toBeVisible();

  page.once("dialog", (dialog) => void dialog.accept());
  await version.getByRole("button", { name: "Restore" }).click();
  await expect(page.getByRole("status")).toHaveText(/The version was restored/);
  await expect(cell(page, "A1")).toHaveText("keep me");
  await expect(cell(page, "A2")).toHaveText("and me");
  // Restoring kept what it replaced, so the restore can be undone too.
  await expect(history.getByRole("listitem").first()).toContainText(
    "Before restoring an earlier version",
  );

  await history.getByRole("listitem").first().getByRole("button", { name: "Open a copy" }).click();
  await expect(history).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Untitled spreadsheet (copy)");
  await expect(cell(page, "A1")).toHaveText("and me");
});

test("editing shows errors, the formula bar, and keyboard navigation", async ({ page }) => {
  await newSpreadsheet(page);
  await enter(page, "A1", "=1/0");
  await expect(cell(page, "A1")).toHaveText("#DIV/0!");

  // Enter moved the selection down, so typing continues in A2. Tab moves right.
  await page.keyboard.type("4");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("grid", { name: "Table 1" })).toBeFocused();
  await page.keyboard.type("=A2*A2");
  await page.keyboard.press("Enter");
  await expect(cell(page, "A2")).toHaveText("4");
  await expect(cell(page, "B2")).toHaveText("16");

  await cell(page, "B2").click();
  const formula = page.getByLabel("Formula");
  await expect(formula).toHaveValue("=A2*A2");
  await formula.click();
  await formula.fill("=A2+1");
  await formula.press("Enter");
  await expect(cell(page, "B2")).toHaveText("5");

  // Enter in the formula bar moves down and hands the keyboard back to the grid.
  await expect(cell(page, "B3")).toHaveAttribute("aria-selected", "true");
  await page.keyboard.type("typed in the grid");
  await page.keyboard.press("Enter");
  await expect(cell(page, "B3")).toHaveText("typed in the grid");
  await expect(page.getByRole("grid", { name: "Table 1" })).toBeFocused();

  // What is typed in the formula bar is saved when another cell is clicked.
  await cell(page, "B2").click();
  await formula.click();
  await formula.fill("=A2+2");
  await cell(page, "A1").click();
  await expect(cell(page, "B2")).toHaveText("6");
  await expect(cell(page, "A1")).toHaveText("#DIV/0!");
  await expect(formula).toHaveValue("=1/0");

  await cell(page, "B2").click();
  await page.keyboard.press("Delete");
  await expect(cell(page, "B2")).toHaveText("");
});

test("spreadsheets are private to the account that made them", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);

  const email = await signUp(page);
  await page.getByRole("button", { name: "New spreadsheet" }).click();
  await expect(cell(page, "A1")).toBeVisible();
  const privateUrl = page.url();

  await page.getByRole("link", { name: "← Spreadsheets" }).click();
  await expect(page.getByRole("link", { name: "Untitled spreadsheet" })).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);

  await signUp(page);
  await expect(page.getByText("No spreadsheets yet")).toBeVisible();
  await page.goto(privateUrl);
  await expect(page.getByRole("alert")).toHaveText("Spreadsheet not found");

  await page.goto("/");
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("link", { name: "Untitled spreadsheet" })).toBeVisible();
});

test("a spreadsheet is shared with another account, which can edit it until the share ends", async ({
  page,
  browser,
}) => {
  // The guest signs up first, in a browser of their own.
  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  const guestEmail = await signUp(guest);

  await newSpreadsheet(page);
  await enter(page, "A1", "from the owner");
  await page.getByRole("button", { name: "Share" }).click();
  const share = page.getByRole("dialog", { name: "Share" });
  await share.getByLabel("Email of the person to share with").fill("nobody@example.com");
  await share.getByRole("button", { name: "Share" }).click();
  await expect(share.getByRole("alert")).toContainText("No account uses nobody@example.com");

  await share.getByLabel("Email of the person to share with").fill(guestEmail);
  await share.getByRole("button", { name: "Share" }).click();
  await expect(share.locator(`[data-member="${guestEmail}"]`)).toBeVisible();

  // The guest sees it in their list, opens it, and edits it.
  await guest.reload();
  await expect(guest.getByText("Shared with you · can edit")).toBeVisible();
  await guest.getByRole("link", { name: "Untitled spreadsheet" }).click();
  await expect(cell(guest, "A1")).toHaveText("from the owner");
  await enter(guest, "B1", "from the guest");
  await expect(guest.getByRole("button", { name: "Delete table" })).toBeVisible();

  // The owner sees the guest's edit without reloading, and the guest the owner's.
  await expect(cell(page, "B1")).toHaveText("from the guest");
  await page.getByRole("button", { name: "Close sharing" }).click();
  await enter(page, "C1", "=LEN(B1)");
  await expect(cell(guest, "C1")).toHaveText("14");

  // The owner makes the guest a viewer, which the guest's page shows at once.
  await page.getByRole("button", { name: "Share" }).click();
  await share.getByLabel("What Ada can do").nth(0).selectOption("viewer");
  await expect(guest.getByText("View only")).toBeVisible();
  await expect(guest.getByRole("button", { name: "Delete table" })).toHaveCount(0);

  // Ending the share takes the spreadsheet away.
  page.once("dialog", (dialog) => void dialog.accept());
  await share.getByRole("button", { name: "Stop sharing with Ada" }).click();
  await expect(share.locator(`[data-member="${guestEmail}"]`)).toHaveCount(0);
  await expect(guest.getByRole("alert")).toContainText("not found");
  await guestContext.close();
});

test("the help page documents formulas, with or without an account", async ({ page, context }) => {
  await page.goto("/help");
  await expect(page.getByRole("heading", { name: "Help", exact: true })).toBeVisible();
  await expect(page.locator('[data-function="SUM"]')).toContainText("gives 16");

  await page.getByRole("navigation", { name: "Contents" }).getByText("Errors").click();
  await expect(page).toHaveURL(/\/help#errors$/);
  await expect(page.locator('[data-error="#CYCLE!"]')).toBeInViewport();

  // The contents stay on screen and mark the section being read.
  const contents = page.getByRole("navigation", { name: "Contents" });
  await expect(contents.locator('[aria-current="true"]')).toHaveText("Errors");
  await contents.getByText("Queries").click();
  await expect(contents.locator('[aria-current="true"]')).toHaveText("Queries");
  await expect(contents.getByText("Queries")).toBeInViewport();
  await page.getByRole("heading", { name: "Sharing" }).scrollIntoViewIfNeeded();
  await page.mouse.wheel(0, 300);
  await expect(contents.locator('[aria-current="true"]')).not.toHaveText("Queries");
  await expect(contents.locator('[aria-current="true"]')).toBeInViewport();

  await newSpreadsheet(page);
  const opened = context.waitForEvent("page");
  await page.getByRole("link", { name: "Help" }).click();
  const help = await opened;
  await expect(help.getByRole("heading", { name: "Buttons and actions" })).toBeVisible();
  // The editor is still open in the first tab.
  await expect(cell(page, "A1")).toBeVisible();
});

test("the browser tab names what is open, then the app", async ({ page }) => {
  await page.goto("/help");
  await expect(page).toHaveTitle(`Help | ${APP_NAME}`);

  await signUp(page);
  await expect(page).toHaveTitle(`Spreadsheets | ${APP_NAME}`);
  await expect(page.getByText(APP_NAME, { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "New spreadsheet" }).click();
  await expect(page).toHaveTitle(`Untitled spreadsheet | ${APP_NAME}`);

  await page.getByRole("heading", { level: 1 }).getByText("Untitled spreadsheet").dblclick();
  await page.getByLabel("Spreadsheet name").fill("My budget");
  await page.getByLabel("Spreadsheet name").press("Enter");
  await expect(page).toHaveTitle(`My budget | ${APP_NAME}`);
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("pages fit the screen, and a cell is edited by tapping it twice", async ({ page }) => {
    // Evaluated in the page, as text: this file is not compiled against the browser's types.
    const fitsScreen = (): Promise<boolean> =>
      page.evaluate<boolean>("document.documentElement.scrollWidth <= window.innerWidth");

    await signUp(page);
    expect(await fitsScreen()).toBe(true);
    await page.getByRole("button", { name: "New spreadsheet" }).tap();
    await expect(cell(page, "A1")).toBeVisible();
    expect(await fitsScreen()).toBe(true);

    await cell(page, "A1").tap();
    await expect(page.getByLabel("Cell content")).toHaveCount(0);
    await cell(page, "A1").tap();
    await page.getByLabel("Cell content").fill("=6*7");
    await page.keyboard.press("Enter");
    await expect(cell(page, "A1")).toHaveText("42");

    // The formula bar edits the selected cell too.
    await cell(page, "B1").tap();
    await page.getByLabel("Formula").click();
    await page.getByLabel("Formula").fill("=A1+1");
    await page.keyboard.press("Enter");
    await expect(cell(page, "B1")).toHaveText("43");

    await page.goto("/help");
    await expect(page.getByRole("heading", { name: "Help" })).toBeVisible();
    expect(await fitsScreen()).toBe(true);
  });
});

test("an open draft follows its row when another tab inserts above it", async ({
  page,
  context,
}) => {
  await newSpreadsheet(page);
  await enter(page, "A2", "before");
  await expect(page.locator(".editor[data-saving]")).toHaveCount(0);
  const other = await context.newPage();
  await other.goto(page.url());
  await expect(cell(other, "A2")).toHaveText("before");

  await cell(page, "A2").click();
  await page.keyboard.type("mine");
  await cell(other, "A1").click();
  await other.getByRole("button", { name: "Insert row above" }).click();
  await expect(cell(other, "A3")).toHaveText("before");
  await expect(cell(page, "A3").getByLabel("Cell content")).toHaveText("mine");
  await cell(page, "A3").getByLabel("Cell content").press("Enter");
  await expect(cell(other, "A3")).toHaveText("mine");
  await reload(page);
  await expect(cell(page, "A3")).toHaveText("mine");
  await other.close();
});

test("Tab traversal works across the grid and formula bar", async ({ page }) => {
  await newSpreadsheet(page);
  await cell(page, "C3").click();
  await page.keyboard.press("Tab");
  await page.keyboard.type("12");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("grid", { name: "Table 1" })).toBeFocused();
  const formula = page.getByLabel("Formula");
  await formula.click();
  await formula.fill("13");
  await formula.press("Tab");
  await expect(cell(page, "F3")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("grid", { name: "Table 1" })).toBeFocused();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await expect(cell(page, "C4")).toHaveAttribute("aria-selected", "true");
  await expect(cell(page, "D3")).toHaveText("12");
  await expect(cell(page, "E3")).toHaveText("13");
  await formula.click();
  await formula.fill("14");
  await formula.press("Shift+Tab");
  await expect(cell(page, "B4")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("grid", { name: "Table 1" })).toBeFocused();
});

test("saving a script does not scroll to the selected cell", async ({ page }) => {
  await newSpreadsheet(page);
  await cell(page, "A1").click();
  await page.getByRole("button", { name: "Add script", exact: true }).last().click();
  const script = page.locator('[data-view="Script 1"]');
  await script.getByRole("button", { name: "Edit", exact: true }).click();
  const source = script.getByLabel("Script source");
  await source.fill("Total = 42");
  await source.scrollIntoViewIfNeeded();
  await expect(cell(page, "A1")).not.toBeInViewport();
  await source.evaluate((element) => {
    element.blur();
  });
  await expect(script.locator(".script")).toContainText("42");
  await expect(cell(page, "A1")).not.toBeInViewport();
});

test("cell drafts keep history across pages and save literal text before navigation", async ({
  page,
}) => {
  await newSpreadsheet(page);
  await page.getByRole("button", { name: "Add page", exact: true }).click();
  const pages = page.getByRole("navigation", { name: "Pages" });
  await expect(pages.locator('[aria-current="page"]')).toContainText("Page 2");
  await pages.getByText("Page 1", { exact: true }).click();
  await expect(pages.locator('[aria-current="page"]')).toContainText("Page 1");
  let writes = 0;
  page.on("request", (request) => {
    if (request.method() === "PUT" && request.url().endsWith("/cells")) writes += 1;
  });
  await cell(page, "A1").click();
  await page.keyboard.type("1");
  await page.getByLabel("Formula").click();
  await page.getByLabel("Formula").fill("=");
  await pages.getByText("Page 2", { exact: true }).click();
  const dock = page.getByRole("region", { name: "Formula draft" });
  await expect(dock).toContainText("Page 1 · Table 1 · A1");
  await expect(dock.locator(".cm-content")).toHaveText("=");
  expect(writes).toBe(0);
  await dock.getByRole("button", { name: "Return to editor", exact: true }).click();
  await expect(page.getByLabel("Formula")).toBeFocused();
  await page.getByLabel("Formula").fill("=B2");
  await pages.getByText("Page 2", { exact: true }).click();
  await dock.locator(".cm-content").press("Control+z");
  await expect(dock.locator(".cm-content")).toHaveText("=");
  await dock.locator(".cm-content").press("Control+y");
  await expect(dock.locator(".cm-content")).toHaveText("=B2");
  expect(writes).toBe(0);
  await dock.locator(".cm-content").fill("1");
  await pages.getByText("Page 1", { exact: true }).click();
  await expect(dock).toHaveCount(0);
  await expect(cell(page, "A1")).toHaveText("1");
  expect(writes).toBe(1);
});

test("named formulas use shared editing while new names require an explicit submission", async ({
  page,
}) => {
  await newSpreadsheet(page);
  await page.locator("[data-open-names]").click();
  const panel = page.getByRole("region", { name: "Names in Table 1" });
  let created = 0;
  page.on("request", (request) => {
    if (request.method() === "PUT" && request.url().endsWith("/names")) created += 1;
  });
  await panel.getByLabel("New name", { exact: true }).fill("Fee");
  const newFormula = panel.getByLabel("Formula of the new name", { exact: true });
  await newFormula.fill("1 + 2");
  await newFormula.press("Tab");
  await expect(panel.getByRole("button", { name: "Add name", exact: true })).toBeFocused();
  expect(created).toBe(0);
  await cell(page, "A1").click();
  await expect(newFormula).toHaveText("1 + 2");
  expect(created).toBe(0);
  await newFormula.press("Enter");
  await expect(panel.locator(".names-panel__value")).toHaveText("3");
  expect(created).toBe(1);

  let fail = true;
  let saved = 0;
  await page.route("**/api/tables/*/names/*", async (route) => {
    if (route.request().method() !== "PATCH") {
      await route.continue();
      return;
    }
    saved += 1;
    if (fail)
      await route.fulfill({
        status: 422,
        contentType: "application/json",
        body: JSON.stringify({ error: { code: "test_failure", message: "Offline" } }),
      });
    else await route.continue();
  });
  const formula = panel.getByLabel("Formula of the name", { exact: true });
  await formula.click();
  await formula.click();
  await formula.fill("4 + 5");
  await formula.press("Tab");
  await expect(panel.getByRole("alert")).toHaveText("Offline");
  await expect(formula).toBeFocused();
  await expect(formula).toHaveText("4 + 5");
  await expect(panel.locator(".names-panel__value")).toHaveText("3");
  expect(saved).toBe(1);
  fail = false;
  await formula.press("Enter");
  await expect(panel.locator(".names-panel__value")).toHaveText("9");
  expect(saved).toBe(2);
});

test("chart drafts keep their original target while browsing pages and block actions on failed saves", async ({
  page,
}) => {
  await newSpreadsheet(page);
  await page.getByRole("button", { name: "Add page", exact: true }).click();
  const pages = page.getByRole("navigation", { name: "Pages" });
  await expect(pages.locator('[aria-current="page"]')).toContainText("Page 2");
  await pages.getByText("Page 1", { exact: true }).click();
  await expect(pages.locator('[aria-current="page"]')).toContainText("Page 1");
  await page.getByRole("button", { name: "Add chart", exact: true }).last().click();
  const chart = page.locator('[data-view="Chart 1"]');
  let writes = 0;
  let copies = 0;
  let fail = true;
  page.on("request", (request) => {
    if (request.url().endsWith("/copy")) copies += 1;
  });
  await page.route("**/api/views/*", async (route) => {
    if (route.request().method() !== "PATCH") {
      await route.continue();
      return;
    }
    writes += 1;
    if (fail)
      await route.fulfill({
        status: 422,
        contentType: "application/json",
        body: JSON.stringify({ error: { code: "test_failure", message: "Offline" } }),
      });
    else await route.continue();
  });
  await chart.getByLabel("Chart data").click();
  await chart.getByLabel("Chart data").fill("SUM(1, 2)");
  await expect(chart.locator(".formula-token--identifier").first()).toHaveText("SUM");
  expect(writes).toBe(0);
  await pages.getByText("Page 2", { exact: true }).click();
  expect(writes).toBe(0);
  const dock = page.locator(".formula-session-fallback");
  await expect(dock).toContainText("Page 1 · Chart 1 · Chart data");
  await expect(dock.locator(".cm-content")).toHaveText("SUM(1, 2)");
  expect(writes).toBe(0);
  await dock.getByRole("button", { name: "Return to editor" }).click();
  await expect(chart.getByLabel("Chart data")).toBeFocused();
  await expect(chart.getByLabel("Chart data")).toHaveText("SUM(1, 2)");
  expect(writes).toBe(0);
  const original = page.url();
  await page.getByRole("button", { name: "Save a copy", exact: true }).click();
  await expect(chart.getByRole("alert")).toHaveText("Offline");
  await expect(chart.getByLabel("Chart data")).toBeFocused();
  expect(page.url()).toBe(original);
  expect(copies).toBe(0);
  fail = false;
  await chart.getByLabel("Chart data").press("Enter");
  await expect(chart.locator(".cm-editor")).toHaveCount(0);
  await expect(chart.getByLabel("Chart data")).toHaveValue("SUM(1, 2)");
  expect(copies).toBe(0);
});

test("errors stay visible across pages and in the document list", async ({ page }) => {
  await newSpreadsheet(page);
  await enter(page, "A1", "=1/0");
  await expect(page.getByRole("button", { name: "1 error", exact: true })).toBeVisible();
  await expect(
    page.getByRole("img", { name: "Table 1 contains errors", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("img", { name: "Page 1 contains errors", exact: true }),
  ).toBeVisible();
  await cell(page, "A1").locator(".cell-value--error").hover();
  await expect(page.getByRole("tooltip")).toContainText("#DIV/0!");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await page.getByRole("button", { name: "Add page", exact: true }).click();
  await page.getByRole("button", { name: "1 error", exact: true }).click();
  const errors = page.getByRole("dialog", { name: "Document errors" });
  await expect(errors).toContainText("Page 1");
  await errors.getByRole("button", { name: /Table 1!A1/ }).click();
  await expect(errors).toBeVisible();
  await expect(cell(page, "A1")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("grid", { name: "Table 1" })).toBeFocused();
  await expect(page.locator(".editor[data-saving]")).toHaveCount(0);
  await page.getByRole("link", { name: "← Spreadsheets" }).click();
  await expect(
    page.getByRole("img", { name: "Untitled spreadsheet contains errors" }),
  ).toBeVisible();
  const link = page.getByRole("link", { name: /Untitled spreadsheet/ });
  const href = await link.getAttribute("href");
  const spreadsheetId = href?.split("/")[2];
  if (!spreadsheetId) throw new Error("The document link has no document ID");
  let releaseSnapshot!: () => void;
  const snapshotGate = new Promise<void>((resolve) => {
    releaseSnapshot = resolve;
  });
  await page.route(`**/api/spreadsheets/${spreadsheetId}`, async (route) => {
    await snapshotGate;
    await route.continue();
  });
  const request = page.waitForRequest(
    (request) => new URL(request.url()).pathname === `/api/spreadsheets/${spreadsheetId}`,
  );
  await link.click();
  await request;
  try {
    await expect(page.getByText("Loading…", { exact: true })).toBeVisible();
    await expect(page.getByRole("grid")).toHaveCount(0);
  } finally {
    releaseSnapshot();
  }
  await enter(page, "A1", "5");
  await expect(page.getByRole("button", { name: "1 error", exact: true })).toHaveCount(0);
  await expect(page.getByRole("img", { name: "Page 1 contains errors", exact: true })).toHaveCount(
    0,
  );
  await expect(page.locator(".editor[data-saving]")).toHaveCount(0);
  await page.getByRole("link", { name: "← Spreadsheets" }).click();
  await expect(page.getByRole("img", { name: "Untitled spreadsheet contains errors" })).toHaveCount(
    0,
  );
});

test("invalid button plans appear in document errors before clicking the button", async ({
  page,
}) => {
  await newSpreadsheet(page);
  await enter(page, "A1", '=BUTTON("Send", SEND_EMAIL("bad", "subject", "body"))');
  await expect(cell(page, "A1").getByRole("button", { name: "Send", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "1 error", exact: true }).click();
  const errors = page.getByRole("dialog", { name: "Document errors" });
  await expect(errors).toContainText('"bad" is not an email address');
  await errors.getByRole("button", { name: /Table 1!A1/ }).click();
  await expect(errors).toBeVisible();
  await enter(page, "A1", '=BUTTON("Send", SEND_EMAIL("valid@example.com", "subject", "body"))');
  await expect(errors).not.toContainText("not an email address");
  await expect(page.getByRole("button", { name: "1 error", exact: true })).toHaveCount(0);
});

test("script drafts complete parameters, keep history across pages, and retain failed saves", async ({
  page,
}) => {
  await newSpreadsheet(page);
  await page.getByRole("button", { name: "Add page", exact: true }).click();
  const pages = page.getByRole("navigation", { name: "Pages" });
  await expect(pages.locator('[aria-current="page"]')).toContainText("Page 2");
  await pages.getByText("Page 1", { exact: true }).click();
  await page.getByRole("button", { name: "Add script", exact: true }).last().click();
  const script = page.locator('[data-view="Script 1"]');
  await script.getByRole("button", { name: "Edit", exact: true }).click();
  const source = script.getByLabel("Script source");
  await source.fill("Double(amount) = am");
  await expect(page.getByRole("option", { name: /^amount/ })).toBeVisible();
  await source.press("Tab");
  await expect(source).toHaveText("Double(amount) = amount");
  await source.press("Escape");
  await expect(source).toBeVisible();
  await source.fill("Double(amount) = amount * 2");
  await source.press("Enter");
  await page.keyboard.type("Total = Double(2)");
  await source.press("Control+Enter");
  await expect(source).toHaveCount(0);
  await expect(script.locator(".script tr").last()).toContainText("4");
  await script.getByRole("button", { name: "Edit", exact: true }).click();
  await source.fill("Total = 77");
  await pages.getByText("Page 2", { exact: true }).click();
  const dock = page.getByRole("region", { name: "Formula draft" });
  await expect(dock).toContainText("Page 1 · Script 1 · Script source");
  await dock.locator(".cm-content").press("Control+z");
  await expect(dock.locator(".cm-line")).toHaveText([
    "Double(amount) = amount * 2",
    "Total = Double(2)",
  ]);
  await dock.locator(".cm-content").press("Control+y");
  await expect(dock.locator(".cm-content")).toHaveText("Total = 77");
  await dock.getByRole("button", { name: "Return to editor", exact: true }).click();
  await expect(source).toBeFocused();
  let writes = 0;
  await page.route("**/api/views/*", async (route) => {
    if (route.request().method() === "PATCH") {
      writes += 1;
      await route.fulfill({
        status: 422,
        contentType: "application/json",
        body: JSON.stringify({ error: { code: "test_failure", message: "Offline" } }),
      });
    } else await route.continue();
  });
  await script.getByRole("button", { name: "Done", exact: true }).click();
  await expect(script.getByRole("alert")).toHaveText("Offline");
  await expect(source).toBeFocused();
  await script.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(source).toHaveCount(0);
  expect(writes).toBe(1);
  await expect(script.locator(".script tr").last()).toContainText("4");
});

test("Markdown drafts complete only template expressions and Cancel restores the preview", async ({
  page,
}) => {
  await newSpreadsheet(page);
  await page.getByRole("button", { name: "Add text", exact: true }).last().click();
  const text = page.locator('[data-view="Text 1"]');
  await text.getByRole("button", { name: "Edit", exact: true }).click();
  const source = text.getByLabel("Text view source");
  await source.fill("Prose rou");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await source.fill("{% let Amount = 2 %}{{ Am");
  await expect(page.getByRole("option", { name: /^Amount/ })).toBeVisible();
  await source.press("Tab");
  await page.keyboard.type(" }}");
  await expect(text.locator(".text-view")).toHaveText("2");
  await source.press("Control+Enter");
  await expect(source).toHaveCount(0);
  await text.getByRole("button", { name: "Edit", exact: true }).click();
  await source.fill("Draft {{ 9 }}");
  await expect(text.locator(".text-view")).toHaveText("Draft 9");
  await source.press("Escape");
  await expect(source).toBeVisible();
  await text.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(text.locator(".text-view")).toHaveText("2");
});
