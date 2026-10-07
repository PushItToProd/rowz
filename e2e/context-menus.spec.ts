import { expect, test, type Locator } from "@playwright/test";
import { cell, newSpreadsheet } from "./helpers";

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
