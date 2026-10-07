import { expect, test } from "@playwright/test";
import { newSpreadsheet, cell, dragReference, enter } from "./helpers";

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
  await page.getByRole("button", { name: "History", exact: true }).click();
  const history = page.getByRole("dialog", { name: "History" });
  await expect(history).toBeVisible();
  await page.getByRole("button", { name: "1 error", exact: true }).click();
  const errors = page.getByRole("dialog", { name: "Document errors" });
  await expect(history).toHaveCount(0);
  await expect(errors).toContainText("Page 1");
  await errors.getByRole("button", { name: /'Table 1'!A1/ }).click();
  await expect(errors).toBeVisible();
  await expect(cell(page, "A1")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("grid", { name: "Table 1" })).toBeFocused();
  await expect(page.locator(".editor[data-saving]")).toHaveCount(0);
  await page.getByRole("link", { name: "← Documents" }).click();
  await expect(page.getByRole("img", { name: "Untitled document contains errors" })).toBeVisible();
  const link = page.getByRole("link", { name: /Untitled document/ });
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
  await page.getByRole("link", { name: "← Documents" }).click();
  await expect(page.getByRole("img", { name: "Untitled document contains errors" })).toHaveCount(0);
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
  await errors.getByRole("button", { name: /'Table 1'!A1/ }).click();
  await expect(errors).toBeVisible();
  await expect(cell(page, "A1")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("grid", { name: "Table 1" })).toBeFocused();
  await enter(page, "A1", '=BUTTON("Send", SEND_EMAIL("valid@example.com", "subject", "body"))');
  await expect(errors).not.toContainText("not an email address");
  await expect(page.getByRole("button", { name: "1 error", exact: true })).toHaveCount(0);
});

test("a function error links to its script definition and places the editor caret there", async ({
  page,
}) => {
  await newSpreadsheet(page);
  const rows = [
    ["Race", "Payout (40 hrs)", "Duration"],
    ["Spa", "100", "40 hrs"],
    ["Monaco", "200", "20 hrs"],
  ];
  for (const [row, values] of rows.entries()) {
    for (const [col, value] of values.entries()) {
      await enter(page, `${"ABC"[col] ?? ""}${String(row + 1)}`, value);
    }
  }
  await page.getByRole("button", { name: "Name columns", exact: true }).click();
  await page.getByRole("menuitem", { name: "Use the first row as the names" }).click();
  await page.locator('[data-table="Table 1"]').getByText("Table 1").dblclick();
  await page.getByLabel("Table name").fill("Runs");
  await page.getByLabel("Table name").press("Enter");

  await page.getByRole("button", { name: "Add script", exact: true }).last().click();
  const script = page.locator('[data-view="Script 1"]');
  await script.getByRole("button", { name: "Edit", exact: true }).click();
  const source = script.getByLabel("Script source");
  await source.fill(
    `PayoutByDuration(with_spa) = QUERY(Runs, "select Race, sum('Payout (40 hrs)') " & IF(with_spa, "", "where Race <> 'Spa' ") & "group by Race pivot Duration")`,
  );
  await source.press("Control+Enter");
  await expect(source).toHaveCount(0);
  await page.getByRole("button", { name: "Add table", exact: true }).last().click();
  // Renaming the original Table 1 to Runs freed this name for the new table.
  const callerTable = "Table 1";
  await expect(cell(page, "A1", callerTable)).toBeVisible();
  await enter(page, "A1", "=PayoutByDuration(FALSE)", callerTable);
  const result = cell(page, "A1", callerTable);
  await expect(result).toHaveText("#VALUE!");
  await result.locator(".cell-value--error").hover();
  await expect(page.getByRole("dialog")).toContainText("The data has no column Spa");
  await expect(page.getByRole("dialog")).toContainText(
    "Raised in PayoutByDuration (Script 1, line 1)",
  );

  await page.getByRole("button", { name: "1 error", exact: true }).click();
  const errors = page.getByRole("dialog", { name: "Document errors" });
  await errors.getByRole("button", { name: /Raised in PayoutByDuration/ }).click();
  await expect(source).toBeFocused();
  const caret = await source.evaluate((element) => {
    const selection = document.getSelection();
    return {
      active: document.activeElement === element,
      offset: selection?.anchorOffset,
      text: selection?.anchorNode?.textContent,
    };
  });
  expect(caret.active).toBe(true);
  expect(caret.offset).toBe(0);
  expect(caret.text).toContain("PayoutByDuration");
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
  await source.fill("# Heading\n**bold** and `{{ A1 + 2 }}`");
  await expect(text.locator(".formula-prose--heading").last()).toContainText("Heading");
  await expect(text.locator(".formula-prose--strong").filter({ hasText: "bold" })).toBeVisible();
  await expect(text.locator(".formula-prose--code").filter({ hasText: "A1" })).toHaveCount(0);
  await expect(text.locator(".formula-token--identifier").filter({ hasText: "A1" })).toBeVisible();
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

test("direct formula references and visible grid outlines share colors without changing selection", async ({
  page,
}) => {
  await newSpreadsheet(page);
  await cell(page, "C3").click();
  await page.keyboard.type("=A1 + $A$1 + B2");
  const source = page.getByLabel("Cell content");
  await expect(source).toHaveText("=A1 + $A$1 + B2");
  const references = source.locator(".formula-reference");
  await expect(references).toHaveCount(3);
  const firstColor = await references.nth(0).getAttribute("data-reference-color");
  const secondColor = await references.nth(2).getAttribute("data-reference-color");
  if (!firstColor || !secondColor) throw new Error("Reference colors are missing");
  expect(firstColor).not.toBe(secondColor);
  await expect(references.nth(1)).toHaveAttribute("data-reference-color", firstColor);
  await expect(cell(page, "A1")).toHaveAttribute("data-reference-color", firstColor);
  await expect(cell(page, "B2")).toHaveAttribute("data-reference-color", secondColor);
  const renderedColor = await references
    .nth(0)
    .evaluate((element) => getComputedStyle(element.lastElementChild ?? element).color);
  expect(
    await cell(page, "A1").evaluate((element) => getComputedStyle(element).boxShadow),
  ).toContain(renderedColor);
  await expect(cell(page, "C3")).toHaveAttribute("aria-selected", "true");
  await source.press("Escape");
  await expect(page.locator("td[data-reference-color]")).toHaveCount(0);
});

test("automatic reference picks keep the target, replace further picks, and suppress cell buttons", async ({
  page,
}) => {
  await newSpreadsheet(page);
  await enter(page, "A1", '=BUTTON("Write", EXECUTE(9,A2))');
  await enter(page, "B1", "=CHECKBOX(A2)");
  let writes = 0;
  page.on("request", (request) => {
    if (request.method() === "PUT" && request.url().endsWith("/cells")) writes++;
  });
  await cell(page, "D4").click();
  await page.keyboard.type("=");
  const source = page.getByLabel("Cell content");
  await cell(page, "A1").getByRole("button", { name: "Write", exact: true }).click();
  await expect(source).toHaveText("=A1");
  await expect(cell(page, "A2")).toHaveText("");
  await cell(page, "B1").getByRole("checkbox").click();
  await expect(source).toHaveText("=B1");
  await expect(cell(page, "B1").getByRole("checkbox")).not.toBeChecked();
  await cell(page, "B2").click();
  await expect(source).toHaveText("=B2");
  await expect(cell(page, "D4")).toHaveAttribute("aria-selected", "true");
  await expect(source).toBeFocused();
  expect(writes).toBe(0);
  await source.press("ArrowLeft");
  await expect(source).toHaveText("=B2");
  await cell(page, "C3").click();
  await expect(cell(page, "C3")).toHaveAttribute("aria-selected", "true");
  expect(writes).toBe(1);
});

test("explicit picking replaces selections and complete references, and a drag has one undo step", async ({
  page,
}) => {
  await newSpreadsheet(page);
  await cell(page, "E5").click();
  await page.keyboard.type("=10+B2");
  const source = page.getByLabel("Cell content");
  await source.press("Home");
  await source.press("ArrowRight");
  await source.press("Shift+ArrowRight");
  await source.press("Shift+ArrowRight");
  await page.getByRole("button", { name: "Pick reference", exact: true }).click();
  await cell(page, "A1").click();
  await expect(source).toHaveText("=A1+B2");
  await source.fill("=$A1");
  await source.press("Home");
  await source.press("ArrowRight");
  await source.press("Shift+End");
  await dragReference(page, cell(page, "B2"), cell(page, "D4"));
  await expect(source).toHaveText("=B2:D4");
  await source.press("Control+z");
  await expect(source).toHaveText("=$A1");
  await source.press("Control+y");
  await expect(source).toHaveText("=B2:D4");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(source).toHaveText("=$A1");
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(source).toHaveText("=B2:D4");
  await source.fill("=SUM(");
  await dragReference(page, cell(page, "B2"), cell(page, "E5"));
  await expect(source).toHaveText("=SUM(B2:E5");
  await source.press("Control+z");
  await expect(source).toHaveText("=SUM(");
  await source.fill("=A1+1");
  await source.press("Home");
  await source.press("ArrowRight");
  await source.press("ArrowRight");
  await page.getByRole("button", { name: "Pick reference", exact: true }).click();
  await cell(page, "C3").click();
  await expect(source).toHaveText("=C3+1");
  await source.fill("=B3+");
  const start = await cell(page, "A1").boundingBox(),
    end = await cell(page, "B2").boundingBox();
  if (!start || !end) throw new Error("The reference drag endpoints are not visible");
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2);
  await expect(source).toHaveText("=B3+A1:B2");
  await source.press("Escape");
  await page.mouse.up();
  await expect(source).toHaveText("=B3+");
  await expect(source).toBeFocused();
  await source.press("ArrowLeft");
  await expect(cell(page, "E5")).toHaveAttribute("aria-selected", "true");
  await cell(page, "C3").click();
  await expect(cell(page, "C3")).toHaveAttribute("aria-selected", "true");
});

test("cross-page picking preserves the original cell and draft history without intermediate writes", async ({
  page,
}) => {
  await newSpreadsheet(page);
  await page.getByRole("button", { name: "Add page", exact: true }).click();
  const pages = page.getByRole("navigation", { name: "Pages" });
  await expect(pages.locator('[aria-current="page"]')).toContainText("Page 2");
  await enter(page, "B2", "7");
  await pages.getByText("Page 1", { exact: true }).click();
  let writes = 0;
  page.on("request", (request) => {
    if (request.method() === "PUT" && request.url().endsWith("/cells")) writes++;
  });
  await cell(page, "C3").click();
  await page.keyboard.type("=");
  await cell(page, "A1").click();
  await pages.getByText("Page 2", { exact: true }).click();
  const dock = page.getByRole("region", { name: "Formula draft" });
  await expect(dock).toContainText("Page 1 · Table 1 · C3");
  await cell(page, "B2").click();
  await expect(dock.locator(".cm-content")).toHaveText("='Page 2'!'Table 1'!B2");
  expect(writes).toBe(0);
  await dock.locator(".cm-content").press("Control+z");
  await expect(dock.locator(".cm-content")).toHaveText("=A1");
  await dock.locator(".cm-content").press("Control+y");
  await dock.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(pages.locator('[aria-current="page"]')).toContainText("Page 1");
  await expect(cell(page, "C3")).toHaveText("7");
  expect(writes).toBe(1);
});

test("multiline sources pick only in expressions, and unfinished new names pick without being created", async ({
  page,
}) => {
  await newSpreadsheet(page);
  await page.getByRole("button", { name: "Add text", exact: true }).last().click();
  const text = page.locator('[data-view="Text 1"]');
  await text.getByRole("button", { name: "Edit", exact: true }).click();
  const source = text.getByLabel("Text view source");
  await source.fill("Prose");
  await expect(text.getByRole("button", { name: "Pick reference", exact: true })).toBeDisabled();
  await source.fill("Prose {{ ");
  await cell(page, "A1").click();
  await expect(source).toHaveText("Prose {{ 'Table 1'!A1");
  await page.keyboard.type(" }}");
  await source.press("Control+Enter");
  await page.getByRole("button", { name: "Add script", exact: true }).last().click();
  const script = page.locator('[data-view="Script 1"]');
  await script.getByRole("button", { name: "Edit", exact: true }).click();
  const scriptSource = script.getByLabel("Script source");
  await scriptSource.fill("// Comment");
  await expect(script.getByRole("button", { name: "Pick reference", exact: true })).toBeDisabled();
  await scriptSource.fill("Total = ");
  await cell(page, "A1").click();
  await expect(scriptSource).toHaveText("Total = 'Table 1'!A1");
  await scriptSource.press("Control+Enter");
  await page.locator("[data-open-names]").click();
  const panel = page.getByRole("region", { name: "Names in Table 1" });
  await panel.getByLabel("New name", { exact: true }).fill("Total");
  const formula = panel.getByLabel("Formula of the new name", { exact: true });
  await formula.fill("SUM(");
  await cell(page, "B2").click();
  await expect(formula).toHaveText("SUM(B2");
  await expect(panel.locator("[data-name]")).toHaveCount(0);
  await page.keyboard.type(")");
  await formula.press("Enter");
  await expect(panel.locator('[data-name="Total"]')).toBeVisible();
});

test("ordinary headers pick whole rows and columns without selecting or resizing them", async ({
  page,
}) => {
  await newSpreadsheet(page);
  await cell(page, "E5").click();
  await page.keyboard.type("=SUM(");
  const source = page.getByLabel("Cell content");
  const headers = page.locator('[data-table="Table 1"] thead th[data-pick-kind="col"]');
  await dragReference(page, headers.nth(0), headers.nth(2));
  await expect(source).toHaveText("=SUM(A:C");
  await expect(cell(page, "E5")).toHaveAttribute("aria-selected", "true");
  await source.press("Control+z");
  await expect(source).toHaveText("=SUM(");
  const rowHeaders = page.locator('[data-table="Table 1"] tbody th[data-pick-kind="row"]');
  await dragReference(page, rowHeaders.nth(1), rowHeaders.nth(3));
  await expect(source).toHaveText("=SUM(2:4");
  await source.press("Escape");
  await expect(source).toBeVisible();
  await source.press("Escape");
  await expect(source).toHaveCount(0);
});

test("named headers use same-row filters, reject multiple columns, and keep hidden rows in whole-column references", async ({
  page,
}) => {
  await newSpreadsheet(page);
  for (const [row, inputs] of [
    ["Item", "Qty"],
    ["pear", "3"],
    ["apple", "1"],
    ["fig", "2"],
  ].entries()) {
    for (const [col, text] of inputs.entries())
      await enter(page, `${"AB"[col] ?? ""}${String(row + 1)}`, text);
  }
  await page.getByRole("button", { name: "Name columns", exact: true }).click();
  await page.getByRole("menuitem", { name: "Use the first row as the names", exact: true }).click();
  const item = page.locator('[data-table="Table 1"] thead th[data-column="Item"]');
  const qty = page.locator('[data-table="Table 1"] thead th[data-column="Qty"]');
  await item.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Sort ascending", exact: true }).click();
  const filter = page.getByLabel("Table filter");
  await filter.click();
  await filter.fill("=");
  await qty.click();
  await expect(filter).toHaveText("=[Qty]");
  await page.keyboard.type(" > 1");
  await filter.press("Enter");
  await expect(cell(page, "A2")).toHaveCount(0);
  await cell(page, "C1").click();
  await page.keyboard.type("=SUM(");
  const source = page.getByLabel("Cell content");
  await dragReference(page, cell(page, "B3"), cell(page, "B1"));
  await expect(source).toHaveText("=SUM(");
  await expect(page.getByRole("status").filter({ hasText: "stored rectangle" })).toBeVisible();
  await dragReference(page, item, qty);
  await expect(source).toHaveText("=SUM(");
  await expect(page.getByRole("status").filter({ hasText: "one named column" })).toBeVisible();
  await qty.click();
  await expect(source).toHaveText("=SUM('Table 1'[Qty]");
  await page.keyboard.type(")");
  await source.press("Enter");
  await expect(cell(page, "C1")).toHaveText("6");
  // Formula-column popovers also insert the same-row column form.
  const computed = page.locator('[data-table="Table 1"] thead th[data-column="Column 2"]');
  await computed.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Column holds: A formula…", exact: true }).click();
  const column = page.getByLabel("Column formula");
  await column.fill("=");
  await qty.click();
  await expect(column).toHaveText("=[Qty]");
  await page.keyboard.type(" * 2");
  await page
    .locator(".column-formula-popover")
    .getByRole("button", { name: "Apply", exact: true })
    .click();
  await expect(cell(page, "D1")).toHaveText("6");
});
