import { expect, test, type Locator } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { signUp, newSpreadsheet, cell, enter, reload } from "./helpers";

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
  await expect(chart.locator("[data-chart-value]")).toHaveCount(2);
  // Rendering the saved source can precede closing the formula session.
  await expect(chart.locator('input[aria-label="Chart data"]')).toHaveValue("'Table 1'!A1:B2");
  await expect(page.locator(".editor[data-saving]")).toHaveCount(0);

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
  expect(file.suggestedFilename()).toBe("Untitled document.json");
  const filePath = testInfo.outputPath(file.suggestedFilename());
  await file.saveAs(filePath);

  await page.getByRole("link", { name: "← Documents" }).click();
  await expect(page.getByRole("heading", { name: "Documents", exact: true })).toBeVisible();
  await page.getByLabel("Import").setInputFiles(filePath);
  await expect(cell(page, "B2")).toHaveText("6");
  await expect(page.locator('[data-view="Chart 1"] [data-chart-value]')).toHaveCount(2);
  await enter(page, "B1", "5");
  await expect(cell(page, "B2")).toHaveText("10");
  await expect(page.locator(".editor[data-saving]")).toHaveCount(0);
  await page.getByRole("link", { name: "← Documents" }).click();
  await expect(page.getByRole("link", { name: "Untitled document" })).toHaveCount(2);

  // A CSV file goes into a table from its first cell, and the table grows to fit.
  await page.getByRole("button", { name: "New document" }).click();
  await expect(cell(page, "A1")).toBeVisible();
  await page.getByLabel("Import CSV").setInputFiles(csvPath);
  await expect(cell(page, "A2")).toHaveText("pears, ripe");
  await expect(cell(page, "B2")).toHaveText("6");
  // CSV values appear optimistically; verify the save before leaving the document.
  await reload(page);
  await expect(cell(page, "A1")).toHaveText("apples");
  await expect(cell(page, "B1")).toHaveText("3");
  await expect(cell(page, "A2")).toHaveText("pears, ripe");
  await expect(cell(page, "B2")).toHaveText("6");

  // A file that is not a spreadsheet is refused with a message.
  await page.getByRole("link", { name: "← Documents" }).click();
  await expect(page.getByRole("heading", { name: "Documents", exact: true })).toBeVisible();
  await page.getByLabel("Import").setInputFiles(csvPath);
  await expect(page.getByRole("alert")).toContainText("not a document exported from this app");
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
  const unpaid = cell(page, "D2");
  const unpaidSize = await unpaid.boundingBox();
  if (!unpaidSize) throw new Error("The unpaid cell is not visible");
  await unpaid.click({ position: { x: 4, y: unpaidSize.height / 2 } });
  await expect(unpaid).toHaveAttribute("aria-selected", "true");
  await expect(unpaid.getByRole("checkbox")).not.toBeChecked();
  const unpaidBox = unpaid.getByRole("checkbox");
  const boxSize = await unpaidBox.boundingBox();
  if (!boxSize) throw new Error("The checkbox is not visible");
  expect(boxSize.width).toBeGreaterThanOrEqual(16);
  expect(boxSize.height).toBeGreaterThanOrEqual(16);
  await unpaidBox.check();
  await expect(unpaid).toHaveAttribute("aria-selected", "true");
  await expect(unpaidBox).toBeChecked();

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

test("warns before changing a column type when stored values do not fit", async ({ page }) => {
  await newSpreadsheet(page);
  await enter(page, "A1", "Done");
  await enter(page, "A2", "TRUE");
  await enter(page, "A3", "not done");
  await enter(page, "A4", "FALSE");
  await page.getByRole("button", { name: "Name columns" }).click();
  await page.getByRole("menuitem", { name: "Use the first row as the names" }).click();

  const header = page.locator('[data-table="Table 1"] thead th[data-column="Done"]');
  await header.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Column holds: Checkbox" }).click();
  const dialog = page.getByRole("dialog", { name: "Change column type" });
  await expect(dialog).toContainText(
    "1 of 3 cells in 'Done' are not TRUE or FALSE and will show #VALUE! as Checkbox. Change the type anyway?",
  );
  await dialog.getByRole("button", { name: "Cancel" }).click();

  await header.click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "✓ Column holds: Anything" })).toBeVisible();
  await page.getByRole("menuitem", { name: "Column holds: Checkbox" }).click();
  await page
    .getByRole("dialog", { name: "Change column type" })
    .getByRole("button", { name: "Change type" })
    .click();

  await expect(cell(page, "A1").getByRole("checkbox")).toBeChecked();
  await expect(cell(page, "A2")).toContainText("#VALUE!");
  await expect(cell(page, "A3").getByRole("checkbox")).not.toBeChecked();
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
  const filter = page.getByLabel("Table filter");
  await filter.click();
  for (let tab = 0; tab < 10; tab += 1) await page.keyboard.press("Tab");
  await expect(filter).not.toBeFocused();
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

test("a whole-column selection stays whole when the table sort is removed", async ({ page }) => {
  await newSpreadsheet(page);
  for (const [row, values] of [
    ["Item", "Qty"],
    ["pear", "3"],
    ["apple", "1"],
    ["fig", "2"],
  ].entries()) {
    for (const [col, value] of values.entries())
      await enter(page, `${"AB"[col] ?? ""}${String(row + 1)}`, value);
  }
  await page.getByRole("button", { name: "Name columns" }).click();
  await page.getByRole("menuitem", { name: "Use the first row as the names" }).click();
  await page.getByRole("button", { name: "Add sort", exact: true }).click();
  await page.getByLabel("Sort column 1").selectOption({ label: "Qty" });
  await page.getByLabel("Sort direction 1").selectOption("descending");
  await expect(page.getByRole("button", { name: "Remove sort by Qty" })).toBeVisible();

  const qtyHeader = page.locator('[data-table="Table 1"] thead th[data-column="Qty"]');
  await qtyHeader.click();
  await page.getByRole("button", { name: "Conditional formats", exact: true }).click();
  const panel = page.locator(".conditional-panel");
  await expect(panel.locator("form p")).toHaveText("Applies to B1:B.");

  // Clear the sort from the column header menu while the conditional formats panel is open.
  await qtyHeader.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Clear sort", exact: true }).click();
  await expect(panel.locator("form p")).toHaveText("Applies to B1:B.");
  await panel.getByRole("button", { name: "Add rule" }).click();
  await expect(panel.locator(".conditional-panel__area")).toHaveText("B1:B");
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
  await page.getByRole("link", { name: "← Documents" }).click();
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
