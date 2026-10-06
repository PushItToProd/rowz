import { expect, test } from "@playwright/test";
import { newSpreadsheet, cell, enter, reload } from "./helpers";

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

test("a text view button runs the selected stored action", async ({ page }) => {
  await newSpreadsheet(page);
  await enter(page, "A1", "1");
  await page.getByRole("button", { name: "Add text" }).last().click();
  const text = page.locator('[data-view="Text 1"]');
  await text.getByRole("button", { name: "Edit" }).click();
  await text
    .getByLabel("Text view source")
    .fill(
      [
        `{{ BUTTON("Increment", EXECUTE('Table 1'!A1 + 1, 'Table 1'!A1)) }}`,
        `{{ BUTTON("Set nine", EXECUTE(9, 'Table 1'!A1)) }}`,
      ].join("\n\n"),
    );
  await text.getByRole("button", { name: "Done" }).click();

  await text.getByRole("button", { name: "Set nine" }).click();
  await expect(cell(page, "A1")).toHaveText("9");
  await expect(page.getByRole("status")).toHaveText(/Updated Table 1!A1/);

  await text.getByRole("button", { name: "Increment" }).click();
  await expect(cell(page, "A1")).toHaveText("10");
  await reload(page);
  await expect(text.getByRole("button", { name: "Increment" })).toBeVisible();
});

test("text-view input controls commit to their bound cells", async ({ page }) => {
  await newSpreadsheet(page);
  await enter(page, "A1", "initial name");
  await enter(page, "A2", "1.5");
  await page.getByRole("button", { name: "Add text" }).last().click();
  const text = page.locator('[data-view="Text 1"]');
  await text.getByRole("button", { name: "Edit" }).click();
  await text
    .getByLabel("Text view source")
    .fill(
      [
        `Name: {{ TEXTBOX('Table 1'!A1, "Name") }}`,
        `Count: {{ NUMBERBOX('Table 1'!A2, "Count") }}`,
      ].join("\n\n"),
    );
  await text.getByRole("button", { name: "Done" }).click();

  const name = text.getByRole("textbox", { name: "Name" });
  const count = text.getByRole("spinbutton", { name: "Count" });
  await expect(name).toHaveValue("initial name");
  await expect(count).toHaveValue("1.5");
  await name.fill("updated name");
  await name.press("Enter");
  await expect(cell(page, "A1")).toHaveText("updated name");
  await count.fill("3.25");
  await count.blur();
  await expect(cell(page, "A2")).toHaveText("3.25");

  await reload(page);
  const restoredText = page.locator('[data-view="Text 1"]');
  await expect(restoredText.getByRole("textbox", { name: "Name" })).toHaveValue("updated name");
  await expect(restoredText.getByRole("spinbutton", { name: "Count" })).toHaveValue("3.25");
});
