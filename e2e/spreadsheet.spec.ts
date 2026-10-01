import { readFile } from "node:fs/promises";
import { expect, test, type Locator, type Page } from "@playwright/test";

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

/** Types into a cell the way a person does: click it, type, press Enter. */
async function enter(page: Page, address: string, text: string, table = "Table 1"): Promise<void> {
  await cell(page, address, table).click();
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
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

  await page.reload();
  await expect(cell(page, "A1")).toHaveText("10");
  await expect(cell(page, "A3")).toHaveText("12");
  await expect(page.getByRole("button", { name: "Sum range" })).toBeVisible();
});

test("formulas read other tables and other pages, and follow their changes", async ({ page }) => {
  await newSpreadsheet(page);

  await page.getByRole("button", { name: "Add table" }).click();
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

  await page.reload();
  await expect(cell(page, "A1")).toHaveText("8");
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
  await page.getByRole("button", { name: "Add table" }).click();
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

  await page.reload();
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

  await page.reload();
  await expect(cell(page, "C1")).toHaveText("4");
  await expect(cell(page, "A2")).toHaveText("3");

  // The same actions are on the menu a right-click opens.
  await cell(page, "A2").click({ button: "right" });
  const menu = page.getByRole("menu", { name: "Actions for A2" });
  await menu.getByRole("menuitem", { name: "Insert row below" }).click();
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

  await page.reload();
  await expect(cell(page, "D3")).toHaveText("fig");
  await expect(cell(page, "G1")).toHaveText("70");
});

test("a form with a checkbox and a dropdown saves rows to a log", async ({ page }) => {
  await newSpreadsheet(page);
  await page.getByRole("button", { name: "Add table" }).click();

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

  await page.getByRole("button", { name: "Save" }).click();
  await expect(cell(page, "A1", "Table 2")).toHaveText("pear");
  await expect(cell(page, "B1", "Table 2")).toHaveText("large");
  await expect(cell(page, "C1", "Table 2")).toHaveText("TRUE");
  // The form is reset, and its controls follow.
  await expect(cell(page, "B1")).toHaveText("");
  await expect(cell(page, "C3").getByRole("checkbox")).not.toBeChecked();
  await expect(cell(page, "C2").getByRole("combobox")).toHaveValue("-1");

  await enter(page, "B1", "fig");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(cell(page, "A2", "Table 2")).toHaveText("fig");

  await page.reload();
  await expect(cell(page, "A1", "Table 2")).toHaveText("pear");
  await expect(cell(page, "A2", "Table 2")).toHaveText("fig");
});

test("typing a formula offers completions and shows what a function expects", async ({ page }) => {
  await newSpreadsheet(page);
  await enter(page, "A1", "4");

  await cell(page, "B1").click();
  await page.keyboard.type("=sq");
  const suggestions = page.getByRole("listbox", { name: "Suggestions" });
  await expect(suggestions.getByRole("option")).toHaveText([/SQRT/]);

  await page.keyboard.press("Tab");
  await expect(page.getByRole("note")).toContainText("SQRT(number)");
  await page.keyboard.type("A1)");
  await page.keyboard.press("Enter");
  await expect(cell(page, "B1")).toHaveText("2");

  // The arrows pick from the list, and a click works too.
  await cell(page, "B2").click();
  await page.keyboard.type("=cou");
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

  await page.reload();
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

  await page.getByRole("button", { name: "Add chart" }).click();
  const chart = page.locator('[data-view="Chart 1"]');
  await expect(chart).toContainText("Enter the cells to chart");
  await chart.getByLabel("Chart data").fill("'Table 1'!A1:B2");
  await chart.getByLabel("Chart data").press("Enter");
  await expect(chart.locator(".chart__bar")).toHaveCount(2);

  await chart.getByLabel("Chart type").selectOption("pie");
  await expect(chart.locator(".chart__slice")).toHaveCount(2);
  await expect(chart).toContainText("pears 63%");

  await page.getByRole("button", { name: "Add text" }).click();
  const text = page.locator('[data-view="Text 1"]');
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

  await page.reload();
  await expect(chart.locator(".chart__slice")).toHaveCount(2);
  await expect(chart.getByLabel("Chart type")).toHaveValue("pie");
  await expect(text.getByRole("listitem")).toHaveText(["apples: 15", "pears: 5"]);

  page.once("dialog", (dialog) => void dialog.accept());
  await chart.getByRole("button", { name: "Delete chart" }).click();
  await expect(chart).toHaveCount(0);
  await expect(text).toBeVisible();
});

test("a spreadsheet is exported to a file and imported again, and a table to and from CSV", async ({
  page,
}) => {
  await newSpreadsheet(page);
  await enter(page, "A1", "apples");
  await enter(page, "B1", "3");
  await enter(page, "A2", "pears, ripe");
  await enter(page, "B2", "=B1*2");
  await page.getByRole("button", { name: "Add chart" }).click();
  const chart = page.locator('[data-view="Chart 1"]');
  await chart.getByLabel("Chart data").fill("'Table 1'!A1:B2");
  await chart.getByLabel("Chart data").press("Enter");
  await expect(chart.locator(".chart__bar")).toHaveCount(2);

  // The CSV holds the values the table shows.
  const csvDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV" }).click();
  const csv = await csvDownload;
  expect(csv.suggestedFilename()).toBe("Table 1.csv");
  const csvPath = await csv.path();
  expect(await readFile(csvPath, "utf8")).toBe('apples,3\r\n"pears, ripe",6');

  // The spreadsheet file holds what was typed, so formulas survive.
  const fileDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const file = await fileDownload;
  expect(file.suggestedFilename()).toBe("Untitled spreadsheet.json");
  const filePath = await file.path();

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

test("editing shows errors, the formula bar, and keyboard navigation", async ({ page }) => {
  await newSpreadsheet(page);
  await enter(page, "A1", "=1/0");
  await expect(cell(page, "A1")).toHaveText("#DIV/0!");

  // Enter moved the selection down, so typing continues in A2. Tab moves right.
  await page.keyboard.type("4");
  await page.keyboard.press("Tab");
  await page.keyboard.type("=A2*A2");
  await page.keyboard.press("Enter");
  await expect(cell(page, "A2")).toHaveText("4");
  await expect(cell(page, "B2")).toHaveText("16");

  await cell(page, "B2").click();
  const formula = page.getByLabel("Formula");
  await expect(formula).toHaveValue("=A2*A2");
  await formula.fill("=A2+1");
  await formula.press("Enter");
  await expect(cell(page, "B2")).toHaveText("5");

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

test("the help page documents formulas, with or without an account", async ({ page, context }) => {
  await page.goto("/help");
  await expect(page.getByRole("heading", { name: "Help", exact: true })).toBeVisible();
  await expect(page.locator('[data-function="SUM"]')).toContainText("gives 16");

  await page.getByRole("navigation", { name: "Contents" }).getByText("Errors").click();
  await expect(page).toHaveURL(/\/help#errors$/);
  await expect(page.locator('[data-error="#CYCLE!"]')).toBeInViewport();

  await newSpreadsheet(page);
  const opened = context.waitForEvent("page");
  await page.getByRole("link", { name: "Help" }).click();
  const help = await opened;
  await expect(help.getByRole("heading", { name: "Buttons and actions" })).toBeVisible();
  // The editor is still open in the first tab.
  await expect(cell(page, "A1")).toBeVisible();
});
