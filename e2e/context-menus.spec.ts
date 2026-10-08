import { expect, test, type Locator } from "@playwright/test";
import { cell, newSpreadsheet, openBlockMenu } from "./helpers";

function pageTab(pages: Locator, name: string): Locator {
  return pages
    .getByRole("link", { name, exact: true })
    .locator("xpath=ancestor::*[contains(@class,'page-tabs__tab')][1]");
}

test("page and block context menus leave table cell actions to the grid", async ({ page }) => {
  await newSpreadsheet(page);
  await page.getByRole("button", { name: "Add page" }).click();

  const pages = page.getByRole("navigation", { name: "Pages" });
  await pages.getByRole("link", { name: "Page 1", exact: true }).click({ button: "right" });
  await page
    .getByRole("menu", { name: "Actions for Page 1" })
    .getByRole("menuitem", {
      name: "Move right",
    })
    .click();
  await expect(pages.getByRole("link")).toHaveText(["Page 2", "Page 1"]);

  const table = page.locator('.table-card[data-table="Table 1"]');
  await table.click({ button: "right", position: { x: 4, y: 4 } });
  await expect(page.getByRole("menu", { name: "Actions for Table 1" })).toBeVisible();

  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Block actions for Table 1" }).click();
  await expect(page.getByRole("menu", { name: "Actions for Table 1" })).toBeVisible();

  await page.keyboard.press("Escape");
  await cell(page, "A1").click({ button: "right" });
  await expect(page.getByRole("menu", { name: "Actions for A1" })).toBeVisible();
  await expect(page.getByRole("menu", { name: "Actions for Table 1" })).toHaveCount(0);
});

test("the block ellipsis opens its actions menu from the keyboard", async ({ page }) => {
  await newSpreadsheet(page);
  const button = page.getByRole("button", { name: "Block actions for Table 1" });
  const menu = page.getByRole("menu", { name: "Actions for Table 1" });

  await button.focus();
  await page.keyboard.press("Enter");
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Freeze rows and columns" })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(button).toBeFocused();
});

test("each block's ellipsis and right-click menus list the same actions", async ({ page }) => {
  await newSpreadsheet(page);
  await page.getByRole("button", { name: "Add chart" }).last().click();
  await page.getByRole("button", { name: "Add text" }).last().click();
  await page.getByRole("button", { name: "Add script" }).last().click();

  const checkMenus = async (blockName: string, header: Locator, actions: string[]) => {
    const ellipsisMenu = await openBlockMenu(page, blockName);
    const ellipsisLabels = await ellipsisMenu.getByRole("menuitem").allTextContents();
    for (const action of actions) expect(ellipsisLabels).toContain(action);
    await page.keyboard.press("Escape");

    await header.click({ button: "right", position: { x: 8, y: 8 } });
    const rightClickMenu = page.getByRole("menu", { name: `Actions for ${blockName}` });
    await expect(rightClickMenu).toBeVisible();
    await expect(rightClickMenu.getByRole("menuitem")).toHaveText(ellipsisLabels);
    await page.keyboard.press("Escape");
  };

  await checkMenus("Table 1", page.locator('[data-table="Table 1"] .table-card__header'), [
    "Resize",
    "Freeze rows and columns",
    "Names",
    "Conditional formats",
    "Use the first row as the names",
    "Name them Column 1, Column 2, …",
    "Import CSV",
    "Append CSV rows",
    "Export CSV",
    "Delete table",
  ]);
  await checkMenus("Chart 1", page.locator('[data-view="Chart 1"] .view-card__header'), [
    "Edit",
    "✓ Chart type: Bar",
    "Chart type: Line",
    "Chart type: Pie",
    "Chart type: Scatter",
    "Delete chart",
  ]);
  await checkMenus("Text 1", page.locator('[data-view="Text 1"] .view-card__header'), [
    "Edit",
    "Delete text",
  ]);
  await checkMenus("Script 1", page.locator('[data-view="Script 1"] .view-card__header'), [
    "Edit",
    "Delete script",
  ]);
});

test("page tab menus stay above the table and entirely inside the viewport", async ({ page }) => {
  await newSpreadsheet(page);
  await page.getByRole("button", { name: "Add page" }).click();

  const pages = page.getByRole("navigation", { name: "Pages" });
  await expect(pages.getByRole("link", { name: "Page 2", exact: true })).toBeVisible();
  await pages.getByRole("link", { name: "Page 1", exact: true }).click();
  const tabsBox = await pages.boundingBox();
  const table = page.locator('.table-card[data-table="Table 1"]');
  await expect(table).toBeVisible();
  const tableBox = await table.boundingBox();
  if (!tabsBox || !tableBox) throw new Error("Expected page tabs and a table");
  expect(tableBox.y).toBeGreaterThan(tabsBox.y + tabsBox.height - 1);

  const tab = pageTab(pages, "Page 1");
  await expect(tab).toBeVisible();
  const tabBox = await tab.boundingBox();
  if (!tabBox) throw new Error("Expected the Page 1 tab to be visible");
  await page.mouse.click(tabBox.x + tabBox.width / 2, tabBox.y + tabBox.height - 1, {
    button: "right",
  });

  const menu = page.getByRole("menu", { name: "Actions for Page 1" });
  await expect(menu).toBeVisible();
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  const items = await menu.getByRole("menuitem").all();
  for (const item of items) {
    const box = await item.boundingBox();
    if (!box) throw new Error("Expected every menu item to be visible");
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  }

  const lastItem = menu.getByRole("menuitem").last();
  const lastBox = await lastItem.boundingBox();
  if (!lastBox) throw new Error("Expected the final menu item to be visible");
  expect(
    await lastItem.evaluate((item, point) => document.elementFromPoint(point.x, point.y) === item, {
      x: lastBox.x + lastBox.width / 2,
      y: lastBox.y + lastBox.height / 2,
    }),
  ).toBe(true);
});

test("right-clicking each page tab control opens its tab menu", async ({ page }) => {
  await newSpreadsheet(page);
  await page.getByRole("button", { name: "Add page" }).click();

  const pages = page.getByRole("navigation", { name: "Pages" });
  await expect(pages.getByRole("link", { name: "Page 2", exact: true })).toBeVisible();
  const page1Tab = pageTab(pages, "Page 1");
  await page1Tab.getByRole("link", { name: "Page 1", exact: true }).click();
  await page1Tab.getByRole("button", { name: "Move Page 1 right" }).click({ button: "right" });
  await expect(page.getByRole("menu", { name: "Actions for Page 1" })).toBeVisible();
  await page.keyboard.press("Escape");

  const page2Tab = pageTab(pages, "Page 2");
  await page2Tab.getByRole("link", { name: "Page 2", exact: true }).click();
  await page2Tab.getByRole("button", { name: "Move Page 2 left" }).click({ button: "right" });
  await expect(page.getByRole("menu", { name: "Actions for Page 2" })).toBeVisible();
  await page.keyboard.press("Escape");

  await page2Tab.getByRole("button", { name: "Delete page Page 2" }).click({ button: "right" });
  await expect(page.getByRole("menu", { name: "Actions for Page 2" })).toBeVisible();
});
