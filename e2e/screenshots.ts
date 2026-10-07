// The text view step reaches into the page to size a textarea, which needs the DOM types.
/// <reference lib="dom" />
import { expect, test, type Locator, type Page } from "@playwright/test";

// Builds a small demo spreadsheet and saves the screenshots the README shows.
// Run with `pnpm screenshots`.

const OUTPUT = "docs/screenshots";

async function shoot(target: Page | Locator, name: string): Promise<void> {
  await target.screenshot({ path: `${OUTPUT}/${name}.png`, animations: "disabled" });
}

function cell(page: Page, address: string, table = "Table 1"): Locator {
  return page.locator(`[data-table="${table}"] [data-cell="${address}"]`);
}

async function enter(page: Page, address: string, text: string, table = "Table 1"): Promise<void> {
  await cell(page, address, table).click();
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
}

async function fill(page: Page, rows: string[][], table = "Table 1"): Promise<void> {
  for (const [row, cells] of rows.entries()) {
    for (const [col, text] of cells.entries()) {
      if (text !== "") await enter(page, `${"ABCDEFGH"[col] ?? ""}${String(row + 1)}`, text, table);
    }
  }
}

async function rename(
  page: Page,
  kind: "Table" | "Page",
  from: Locator,
  to: string,
): Promise<void> {
  await from.dblclick();
  await page.getByLabel(`${kind} name`).fill(to);
  await page.getByLabel(`${kind} name`).press("Enter");
}

/** Deletes the rows and columns past the given size, which a new table has more of than a demo needs. */
async function trim(page: Page, table: string, rows: number, columns: number): Promise<void> {
  const firstExtraRow = cell(page, `A${String(rows + 1)}`, table);
  while ((await firstExtraRow.count()) > 0) {
    const before = await page.locator(`[data-table="${table}"] tbody tr`).count();
    await firstExtraRow.click();
    await page.getByRole("button", { name: "Delete row" }).click();
    await expect(page.locator(`[data-table="${table}"] tbody tr`)).toHaveCount(before - 1);
  }
  const firstExtraColumn = cell(page, `${"ABCDEFGH"[columns] ?? ""}1`, table);
  while ((await firstExtraColumn.count()) > 0) {
    const before = await page.locator(`[data-table="${table}"] tbody tr:first-child td`).count();
    await firstExtraColumn.click();
    await page.getByRole("button", { name: "Delete column" }).click();
    await expect(page.locator(`[data-table="${table}"] tbody tr:first-child td`)).toHaveCount(
      before - 1,
    );
  }
}

test("capture the README screenshots", async ({ page }) => {
  test.setTimeout(180_000);

  // A formula column asks for its formula.
  page.on("dialog", (dialog) => void dialog.accept("=[Price] * [Qty]"));

  await page.goto("/signup");
  await page.getByLabel("Name").fill("Ada");
  await page.getByLabel("Email").fill(`ada-${crypto.randomUUID()}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery staple");
  await page.getByRole("button", { name: "Sign up" }).click();
  await page.getByRole("button", { name: "New document" }).click();
  await expect(cell(page, "A1")).toBeVisible();

  const pages = page.getByRole("navigation", { name: "Pages" });
  await rename(page, "Page", pages.getByText("Page 1"), "Sales");

  // A data table: named, typed columns and a formula column.
  await fill(page, [
    ["Item", "Price", "Qty", "Paid"],
    ["Notebook", "4.5", "40", "TRUE"],
    ["Fountain pen", "28", "12", "TRUE"],
    ["Ink bottle", "9", "25", "FALSE"],
    ["Desk lamp", "35", "8", "TRUE"],
    ["Sticky notes", "2.25", "90", "FALSE"],
  ]);
  await trim(page, "Table 1", 7, 5);
  await rename(
    page,
    "Table",
    page.locator('[data-table="Table 1"] h2').getByText("Table 1"),
    "Orders",
  );
  const header = (name: string): Locator =>
    page.locator(`[data-table="Orders"] thead th[data-column="${name}"]`);
  const choose = async (column: string, item: string): Promise<void> => {
    await header(column).click({ button: "right" });
    await page.getByRole("menuitem", { name: item }).click();
  };
  await page.getByRole("button", { name: "Name columns" }).click();
  await page.getByRole("menuitem", { name: "Use the first row as the names" }).click();
  await choose("Paid", "Column holds: Checkbox");
  await choose("Column 1", "Column holds: A formula…");
  await header("Column 1").getByText("Column 1").dblclick();
  await page.getByLabel("Column name").fill("Total");
  await page.getByLabel("Column name").press("Enter");
  await expect(cell(page, "E1", "Orders")).toHaveText("180");

  const bar = page.getByRole("toolbar", { name: "Format" });
  for (const column of ["B", "E"]) {
    await cell(page, `${column}1`, "Orders").click();
    await cell(page, `${column}5`, "Orders").click({ modifiers: ["Shift"] });
    await bar.getByLabel("Number format").selectOption("$#,##0.00");
  }

  await page.getByRole("button", { name: "Add chart" }).last().click();
  const chart = page.locator('[data-view="Chart 1"]');
  await chart.getByLabel("Chart data").fill("HSTACK(Orders[Item], Orders[Total])");
  await chart.getByLabel("Chart data").press("Enter");
  await expect(chart.locator("[data-chart-value]")).toHaveCount(5);

  await page.getByRole("button", { name: "Add text" }).last().click();
  const text = page.locator('[data-view="Text 1"]');
  await text.getByRole("button", { name: "Edit" }).click();
  await text
    .getByLabel("Text view source")
    .fill(
      [
        "## Sales report",
        "",
        "{% let total = SUM(Orders[Total]) %}",
        "{% let unpaid = SUMIF(Orders[Paid], FALSE, Orders[Total]) %}",
        'We sold **{{ TEXT(total, "$#,##0.00") }}** in all, and **{{ TEXT(unpaid, "$#,##0.00") }}** is still unpaid.',
        "",
        "{% for item, price, qty, paid, amount in SORT(Orders!A1:E5, 5, FALSE) %}",
        "- {{ item }}: {{ qty }} sold{% if amount > 300 %} (a big one){% end %}",
        "{% end %}",
      ].join("\n"),
    );
  await expect(text.locator(".text-view")).toContainText("We sold $1,223.50 in all");
  // Show the source from its first line, in a box tall enough to hold it.
  await text.getByLabel("Text view source").evaluate((source: HTMLTextAreaElement) => {
    source.style.height = `${String(source.scrollHeight + 4)}px`;
    source.scrollTop = 0;
  });
  await shoot(text, "text-view");
  await text.getByRole("button", { name: "Done" }).click();

  await cell(page, "E2", "Orders").click();
  await page.mouse.move(0, 0);
  await page.screenshot({ path: `${OUTPUT}/editor.png`, fullPage: true, animations: "disabled" });

  // Completions while a formula is typed.
  await cell(page, "A6", "Orders").click();
  await page.keyboard.type("=SUMI");
  await expect(
    page.getByRole("listbox", { name: "Suggestions" }).getByRole("option").first(),
  ).toBeVisible();
  await page.screenshot({
    path: `${OUTPUT}/completion.png`,
    clip: { x: 0, y: 0, width: 1200, height: 560 },
    animations: "disabled",
  });
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");

  // A form on a page of its own: controls, and a button that runs actions.
  await page.getByRole("button", { name: "Add page" }).click();
  await expect(pages.locator('[aria-current="page"]')).toHaveText(/Page 1/);
  await rename(page, "Page", pages.locator('[aria-current="page"]'), "Order form");
  await page.getByRole("button", { name: "Add table" }).last().click();
  await fill(page, [["Item", "Tea pot"], ["Size"], ["Gift"]]);
  await enter(page, "C2", '=DROPDOWN("small, medium, large", B2)');
  await enter(page, "C3", '=CHECKBOX(B3, "wrap it")');
  await enter(
    page,
    "A5",
    "=BUTTON(\"Save order\", DO(APPEND_ROW('Table 2'!A:D, B1, B2, B3, TODAY()), CLEAR(B1:B3)))",
  );
  await trim(page, "Table 1", 5, 3);
  await trim(page, "Table 2", 4, 4);
  await rename(
    page,
    "Table",
    page.locator('[data-table="Table 1"] h2').getByText("Table 1"),
    "Form",
  );
  await rename(
    page,
    "Table",
    page.locator('[data-table="Table 2"] h2').getByText("Table 2"),
    "Log",
  );

  const save = async (item: string, size: string, gift: boolean): Promise<void> => {
    await enter(page, "B1", item, "Form");
    await cell(page, "C2", "Form").getByRole("combobox").selectOption(size);
    if (gift) await cell(page, "C3", "Form").getByRole("checkbox").check();
    await page.getByRole("button", { name: "Save order" }).click();
    await expect(cell(page, "B1", "Form")).toHaveText("");
  };
  await save("Tea pot", "large", true);
  await save("Mug", "small", false);
  await enter(page, "B1", "Tea towel", "Form");
  await cell(page, "C2", "Form").getByRole("combobox").selectOption("medium");
  await cell(page, "C3", "Form").getByRole("checkbox").check();
  // Select the button's cell from the keyboard, because a click would run the button.
  await cell(page, "A4", "Form").click();
  await page.keyboard.press("ArrowDown");
  await page.mouse.move(0, 0);
  await page.setViewportSize({ width: 1200, height: 800 });
  await shoot(page, "form");

  await page.goto("/help");
  await page.getByRole("link", { name: "Functions", exact: true }).click();
  await shoot(page, "help");
});
