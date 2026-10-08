import { expect, test } from "@playwright/test";
import { cell, enter, expectCellSize, newSpreadsheet, uploadFromBlockMenu } from "./helpers";

test("a large grid windows cells and keeps an offscreen edit alive", async ({ page }) => {
  await newSpreadsheet(page);
  const csv = Array.from({ length: 1000 }, (_, row) => `${String(row)},value`).join("\n");
  await uploadFromBlockMenu(page, "Table 1", "Import CSV", {
    name: "large.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  });
  const grid = page.getByRole("grid", { name: "Table 1", exact: true });
  await expect(cell(page, "A1")).toHaveText("0");
  await expect.poll(() => grid.locator('[role="gridcell"]').count()).toBeLessThan(1000);
  await cell(page, "A1").click();
  await page.keyboard.type("draft");
  await grid.evaluate((element) => {
    element.scrollTop = 15000;
    element.dispatchEvent(new Event("scroll"));
  });
  await expect.poll(() => grid.locator('[data-pick-row="500"]').count()).toBeGreaterThan(0);
  await expect(page.getByLabel("Cell content")).toHaveText("draft");
  await page.keyboard.type(" kept");
  await expect(page.getByLabel("Cell content")).toHaveText("draft kept");
  await page.keyboard.press("Escape");
  await expect(grid).toBeFocused();
  await grid.evaluate((element) => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event("scroll"));
  });
  await expect(cell(page, "A1")).toBeVisible();
  await expect(cell(page, "A1")).toHaveText("0");
  await expect.poll(() => grid.locator('[role="gridcell"]').count()).toBeLessThan(1000);
});

test("grid keyboard shortcuts jump through data and format the selection", async ({ page }) => {
  await newSpreadsheet(page);
  await cell(page, "A1").click();
  await page.keyboard.press("Control+End");
  await expect(cell(page, "A1")).toHaveAttribute("aria-selected", "true");

  await enter(page, "A1", "one");
  await enter(page, "A2", "two");
  await enter(page, "A3", "three");

  const grid = page.getByRole("grid", { name: "Table 1", exact: true });
  await cell(page, "A1").click();
  await page.keyboard.press("Control+ArrowDown");
  await expect(cell(page, "A3")).toHaveAttribute("aria-selected", "true");

  await page.keyboard.press("Control+Home");
  await expect(cell(page, "A1")).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Control+End");
  await expect(cell(page, "A3")).toHaveAttribute("aria-selected", "true");

  await page.keyboard.press("Control+b");
  await expect(page.getByRole("button", { name: "Bold" })).toHaveAttribute("aria-pressed", "true");
  await expect(grid).toBeFocused();
});

test("Markdown line breaks do not change windowed row geometry", async ({ page }) => {
  await newSpreadsheet(page);
  const csv = Array.from({ length: 201 }, (_, row) =>
    Array.from({ length: 40 }, () => String(row)).join(","),
  ).join("\n");
  await uploadFromBlockMenu(page, "Table 1", "Import CSV", {
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
    element.scrollTop = 3000;
    element.dispatchEvent(new Event("scroll"));
  });
  await expect(cell(page, "A101")).toHaveCount(1);
  await expect(cell(page, "A1")).toHaveCount(0);
  await expect
    .poll(() => grid.evaluate((element) => element.getBoundingClientRect().height))
    .toBeCloseTo(height, 0);

  await grid.evaluate((element) => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event("scroll"));
  });
  await expect(cell(page, "A1")).toHaveCount(1);
  await expectCellSize(page, "A1", "height", 30);
  await cell(page, "A1").click();
  await page.keyboard.press("ArrowDown");
  await expect(cell(page, "A2")).toHaveAttribute("aria-selected", "true");
  await expect(cell(page, "A2")).toBeVisible();
});

test("wrapped text is clamped to the fixed row height", async ({ page }) => {
  await newSpreadsheet(page);
  const text =
    "Wrap this long text across multiple visible lines before the row clips what remains and show the whole original through its title.";
  await enter(page, "A1", text);

  const handle = page.getByLabel("Resize row 1", { exact: true });
  const box = await handle.boundingBox();
  if (!box) throw new Error("The first row resize handle is not visible");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 40);
  await page.mouse.up();
  await expectCellSize(page, "A1", "height", 70);
  const heightBeforeWrap = await cell(page, "A1").evaluate(
    (element) => element.getBoundingClientRect().height,
  );

  await cell(page, "A1").click();
  const wrap = page.getByRole("toolbar", { name: "Format" }).getByRole("button", {
    name: "Wrap text",
  });
  await wrap.click();
  await expect(wrap).toHaveAttribute("aria-pressed", "true");

  const value = cell(page, "A1").locator(".cell-value");
  await expect(value).toHaveClass(/cell-value--wrap/);
  await expect(value).toHaveAttribute("title", text);
  const display = await value.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      height: element.getBoundingClientRect().height,
      lineClamp: style.getPropertyValue("-webkit-line-clamp"),
      whiteSpace: style.whiteSpace,
      overflowWrap: style.overflowWrap,
    };
  });
  expect(display.lineClamp).toBe("2");
  expect(display.height).toBeGreaterThan(28);
  expect(display.height).toBeLessThanOrEqual(56);
  expect(display.whiteSpace).toBe("pre-wrap");
  expect(display.overflowWrap).toBe("anywhere");
  await expectCellSize(page, "A1", "height", heightBeforeWrap);
});

test("frozen first row and column stay in place while a windowed grid scrolls", async ({
  page,
}) => {
  await newSpreadsheet(page);
  const csv = Array.from({ length: 250 }, (_, row) =>
    Array.from({ length: 40 }, (_, col) => `${String(row)}-${String(col)}`).join(","),
  ).join("\n");
  await uploadFromBlockMenu(page, "Table 1", "Import CSV", {
    name: "wide.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  });

  const grid = page.getByRole("grid", { name: "Table 1", exact: true });
  await expect(cell(page, "A1")).toHaveText("0-0");
  await grid.locator("tbody th").first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "Freeze up to this row" }).click();
  await grid.locator("thead th").nth(1).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Freeze up to this column" }).click();

  const before = await page.evaluate(() => {
    const grid = document.querySelector<HTMLElement>('[role="grid"]');
    const firstRow = grid?.querySelector<HTMLElement>('[data-cell="B1"]');
    const firstColumn = grid?.querySelector<HTMLElement>('[data-cell="A15"]');
    if (!grid || !firstRow || !firstColumn) throw new Error("Frozen cells are not mounted");
    return {
      rowTop: firstRow.getBoundingClientRect().top,
      columnLeft: firstColumn.getBoundingClientRect().left,
    };
  });

  await grid.evaluate((element) => {
    element.scrollTop = 350;
    element.scrollLeft = 600;
    element.dispatchEvent(new Event("scroll"));
  });
  await expect(cell(page, "A15")).toBeVisible();
  await expect
    .poll(async () => {
      const after = await page.evaluate(() => {
        const grid = document.querySelector<HTMLElement>('[role="grid"]');
        const firstRow = grid?.querySelector<HTMLElement>('[data-cell="B1"]');
        const firstColumn = grid?.querySelector<HTMLElement>('[data-cell="A15"]');
        if (!grid || !firstRow || !firstColumn) return null;
        return {
          rowTop: firstRow.getBoundingClientRect().top,
          columnLeft: firstColumn.getBoundingClientRect().left,
        };
      });
      return after
        ? Math.max(
            Math.abs(after.rowTop - before.rowTop),
            Math.abs(after.columnLeft - before.columnLeft),
          )
        : Number.POSITIVE_INFINITY;
    })
    .toBeLessThanOrEqual(1);
});
