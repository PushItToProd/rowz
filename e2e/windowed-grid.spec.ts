import { expect, test } from "@playwright/test";
import { cell, enter, expectCellSize, newSpreadsheet } from "./helpers";

test("a large grid windows cells and keeps an offscreen edit alive", async ({ page }) => {
  await newSpreadsheet(page);
  const csv = Array.from({ length: 1000 }, (_, row) => `${String(row)},value`).join("\n");
  await page.getByLabel("Import CSV").setInputFiles({
    name: "large.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  });
  const grid = page.getByRole("grid", { name: "Table 1", exact: true });
  await expect(cell(page, "A1")).toHaveText("0");
  await expect.poll(() => grid.locator('[role="gridcell"]').count()).toBeLessThan(1000);
  await cell(page, "A1").click();
  await page.keyboard.type("draft");
  await page.evaluate(() => {
    const grid = document.querySelector<HTMLElement>('[role="grid"]');
    if (!grid) throw new Error("Grid not mounted");
    window.scrollTo(0, window.scrollY + grid.getBoundingClientRect().top + 15000);
  });
  await expect.poll(() => grid.locator('[data-pick-row="500"]').count()).toBeGreaterThan(0);
  await expect(page.getByLabel("Cell content")).toHaveText("draft");
  await page.keyboard.type(" kept");
  await expect(page.getByLabel("Cell content")).toHaveText("draft kept");
  await page.keyboard.press("Escape");
  await expect(grid).toBeFocused();
  await expect(cell(page, "A1")).toBeVisible();
  await expect(cell(page, "A1")).toHaveText("0");
  await expect.poll(() => grid.locator('[role="gridcell"]').count()).toBeLessThan(1000);
});

test("Markdown line breaks do not change windowed row geometry", async ({ page }) => {
  await newSpreadsheet(page);
  const csv = Array.from({ length: 201 }, (_, row) =>
    Array.from({ length: 40 }, () => String(row)).join(","),
  ).join("\n");
  await page.getByLabel("Import CSV").setInputFiles({
    name: "wide.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  });
  await expect(cell(page, "A1")).toHaveText("0");
  await enter(page, "A1", '=MARKDOWN("first  " & CHAR(10) & "second  " & CHAR(10) & "third")');
  await expect(cell(page, "A1").locator("br")).toHaveCount(2);
  await expectCellSize(page, "A1", "height", 30);
  await enter(page, "A2", '=BUTTON("Write", EXECUTE(1, A3))');
  await expectCellSize(page, "A2", "height", 30);
  const grid = page.getByRole("grid", { name: "Table 1", exact: true });
  const height = await grid.evaluate((element) => element.getBoundingClientRect().height);

  await grid.evaluate((element) => {
    element.scrollLeft = element.scrollWidth;
  });
  await expect(cell(page, "A1")).toHaveCount(0);
  await expect
    .poll(() => grid.evaluate((element) => element.getBoundingClientRect().height))
    .toBeCloseTo(height, 0);

  await grid.evaluate((element) => {
    element.scrollLeft = 0;
    window.scrollTo(0, window.scrollY + element.getBoundingClientRect().top + 3000);
  });
  await expect(cell(page, "A101")).toHaveCount(1);
  await expect(cell(page, "A1")).toHaveCount(0);
  await expect
    .poll(() => grid.evaluate((element) => element.getBoundingClientRect().height))
    .toBeCloseTo(height, 0);

  await grid.evaluate((element) => {
    window.scrollTo(0, window.scrollY + element.getBoundingClientRect().top - 250);
  });
  await expect(cell(page, "A1")).toHaveCount(1);
  await expectCellSize(page, "A1", "height", 30);
  await cell(page, "A1").click();
  await page.keyboard.press("ArrowDown");
  await expect(cell(page, "A2")).toHaveAttribute("aria-selected", "true");
  await expect(cell(page, "A2")).toBeVisible();
});
