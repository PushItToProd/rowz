import { expect, test } from "@playwright/test";
import { cell, enter, newSpreadsheet, reload } from "./helpers";

test("a table collapses to its header and stays collapsed after reload", async ({ page }) => {
  await newSpreadsheet(page);
  const table = page.locator('.table-card[data-table="Table 1"]');
  const body = table.locator(".table-card__grid");

  const collapse = page.getByRole("button", { name: "Collapse Table 1" });
  await collapse.focus();
  await page.keyboard.press("Enter");
  await expect(table.locator(".table-card__header")).toBeVisible();
  await expect(table.getByText("Table 1", { exact: true })).toBeVisible();
  await expect(table.getByRole("button", { name: "Block actions for Table 1" })).toBeVisible();
  await expect(body).toBeHidden();

  await reload(page);
  const expand = page.getByRole("button", { name: "Expand Table 1" });
  await expect(expand).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator('.table-card[data-table="Table 1"] .table-card__grid')).toBeHidden();
  await expand.focus();
  await page.keyboard.press("Space");
  await expect(page.getByRole("button", { name: "Collapse Table 1" })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
});

test("going to an error expands its collapsed table", async ({ page }) => {
  await newSpreadsheet(page);
  await enter(page, "A1", "=1/0");
  await page.getByRole("button", { name: "Collapse Table 1" }).click();
  await page.getByRole("button", { name: "1 error", exact: true }).click();

  const errors = page.getByRole("dialog", { name: "Document errors" });
  await errors.getByRole("button", { name: /^Go to #DIV\/0!/ }).click();

  await expect(page.getByRole("button", { name: "Collapse Table 1" })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect(cell(page, "A1")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("grid", { name: "Table 1" })).toBeFocused();
});

test("printing shows collapsed table bodies and renders their windowed rows", async ({ page }) => {
  await newSpreadsheet(page);
  const table = page.locator('.table-card[data-table="Table 1"]');
  await table.getByRole("button", { name: "Resize", exact: true }).click();
  const resize = table.getByRole("dialog", { name: "Resize Table 1" });
  await resize.getByLabel("Rows").fill("201");
  await resize.getByRole("button", { name: "Resize", exact: true }).click();
  await expect(page.locator(".editor[data-saving]")).toHaveCount(0);

  const lastCell = table.locator('[data-pick-row="200"][data-pick-col="0"]');
  await expect(lastCell).toHaveCount(0);
  await table.getByRole("button", { name: "Collapse Table 1" }).click();
  const body = table.locator(".block-card__body");
  await expect(body).toBeHidden();

  await page.emulateMedia({ media: "print" });
  await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
  await expect(body).toBeVisible();
  await expect(lastCell).toHaveCount(1);

  await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
  await page.emulateMedia({ media: "screen" });
  await expect(body).toBeHidden();
});

test("a long text view scrolls inside its own card", async ({ page }) => {
  await newSpreadsheet(page);
  await page.getByRole("button", { name: "Add text", exact: true }).last().click();
  const card = page.locator('[data-view="Text 1"]');
  await card.getByRole("button", { name: "Edit", exact: true }).click();
  const source = Array.from(
    { length: 100 },
    (_, index) => `Paragraph ${String(index + 1)} with enough text to create a tall report.`,
  ).join("\n\n");
  await card.getByLabel("Text view source").fill(source);
  await card.getByRole("button", { name: "Done", exact: true }).click();

  const output = card.locator(".text-view");
  await expect(output).toHaveAttribute("role", "region");
  await expect(output).toHaveAttribute("aria-label", "Text 1 content");
  await expect(output).toHaveAttribute("tabindex", "0");
  await expect
    .poll(() => output.evaluate((element) => element.scrollHeight - element.clientHeight))
    .toBeGreaterThan(0);
  await output.hover();
  await page.mouse.wheel(0, 500);
  await expect.poll(() => output.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
});
