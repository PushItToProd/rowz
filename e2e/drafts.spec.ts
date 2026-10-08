import { expect, test } from "@playwright/test";
import { chooseBlockAction, newSpreadsheet, cell, enter, reload } from "./helpers";

test("an open draft follows its row when another tab inserts above it", async ({
  page,
  context,
}) => {
  await newSpreadsheet(page);
  await enter(page, "A2", "before");
  await expect(page.locator(".editor[data-saving]")).toHaveCount(0);
  const other = await context.newPage();
  await other.goto(page.url());
  await expect(cell(other, "A2")).toHaveText("before");

  await cell(page, "A2").click();
  await page.keyboard.type("mine");
  await cell(other, "A1").click();
  await other.getByRole("button", { name: "Insert row above" }).click();
  await expect(cell(other, "A3")).toHaveText("before");
  await expect(cell(page, "A3").getByLabel("Cell content")).toHaveText("mine");
  await cell(page, "A3").getByLabel("Cell content").press("Enter");
  await expect(cell(other, "A3")).toHaveText("mine");
  await reload(page);
  await expect(cell(page, "A3")).toHaveText("mine");
  await other.close();
});

test("Tab traversal works across the grid and formula bar", async ({ page }) => {
  await newSpreadsheet(page);
  await cell(page, "C3").click();
  await page.keyboard.press("Tab");
  await page.keyboard.type("12");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("grid", { name: "Table 1" })).toBeFocused();
  const formula = page.getByLabel("Formula");
  await formula.click();
  await formula.fill("13");
  await formula.press("Tab");
  await expect(cell(page, "F3")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("grid", { name: "Table 1" })).toBeFocused();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await expect(cell(page, "C4")).toHaveAttribute("aria-selected", "true");
  await expect(cell(page, "D3")).toHaveText("12");
  await expect(cell(page, "E3")).toHaveText("13");
  await formula.click();
  await formula.fill("14");
  await formula.press("Shift+Tab");
  await expect(cell(page, "B4")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("grid", { name: "Table 1" })).toBeFocused();
});

test("saving a script does not scroll to the selected cell", async ({ page }) => {
  await newSpreadsheet(page);
  await cell(page, "A1").click();
  await page.getByRole("button", { name: "Add script", exact: true }).last().click();
  const script = page.locator('[data-view="Script 1"]');
  await chooseBlockAction(page, "Script 1", "Edit");
  const source = script.getByLabel("Script source");
  await source.fill("Total = 42");
  await source.scrollIntoViewIfNeeded();
  const grid = page.getByRole("grid", { name: "Table 1" });
  await grid.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event("scroll"));
  });
  await expect.poll(() => grid.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await expect(cell(page, "A1")).not.toBeInViewport();
  const beforeGridTop = await grid.evaluate((element) => element.scrollTop);
  await source.evaluate((element) => {
    element.blur();
  });
  await expect(script.locator(".script")).toContainText("42");
  await expect(cell(page, "A1")).not.toBeInViewport();
  await expect.poll(() => grid.evaluate((element) => element.scrollTop)).toBe(beforeGridTop);
});

test("cell drafts keep history across pages and save literal text before navigation", async ({
  page,
}) => {
  await newSpreadsheet(page);
  await page.getByRole("button", { name: "Add page", exact: true }).click();
  const pages = page.getByRole("navigation", { name: "Pages" });
  await expect(pages.locator('[aria-current="page"]')).toContainText("Page 2");
  await pages.getByText("Page 1", { exact: true }).click();
  await expect(pages.locator('[aria-current="page"]')).toContainText("Page 1");
  let writes = 0;
  page.on("request", (request) => {
    if (request.method() === "PUT" && request.url().endsWith("/cells")) writes += 1;
  });
  await cell(page, "A1").click();
  await page.keyboard.type("1");
  await page.getByLabel("Formula").click();
  await page.getByLabel("Formula").fill("=");
  await pages.getByText("Page 2", { exact: true }).click();
  const dock = page.getByRole("region", { name: "Formula draft" });
  await expect(dock).toContainText("Page 1 · Table 1 · A1");
  await expect(dock.locator(".cm-content")).toHaveText("=");
  expect(writes).toBe(0);
  await dock.getByRole("button", { name: "Return to editor", exact: true }).click();
  await expect(page.getByLabel("Formula")).toBeFocused();
  await page.getByLabel("Formula").fill("=B2");
  await pages.getByText("Page 2", { exact: true }).click();
  await dock.locator(".cm-content").press("Control+z");
  await expect(dock.locator(".cm-content")).toHaveText("=");
  await dock.locator(".cm-content").press("Control+y");
  await expect(dock.locator(".cm-content")).toHaveText("=B2");
  expect(writes).toBe(0);
  await dock.locator(".cm-content").fill("1");
  await pages.getByText("Page 1", { exact: true }).click();
  await expect(dock).toHaveCount(0);
  await expect(cell(page, "A1")).toHaveText("1");
  expect(writes).toBe(1);
});

test("named formulas use shared editing while new names require an explicit submission", async ({
  page,
}) => {
  await newSpreadsheet(page);
  await chooseBlockAction(page, "Table 1", "Names");
  const panel = page.getByRole("region", { name: "Names in Table 1" });
  let created = 0;
  page.on("request", (request) => {
    if (request.method() === "PUT" && request.url().endsWith("/names")) created += 1;
  });
  await panel.getByLabel("New name", { exact: true }).fill("Fee");
  const newFormula = panel.getByLabel("Formula of the new name", { exact: true });
  await newFormula.fill("1 + 2");
  await newFormula.press("Tab");
  await expect(panel.getByRole("button", { name: "Add name", exact: true })).toBeFocused();
  expect(created).toBe(0);
  await cell(page, "A1").click();
  await expect(newFormula).toHaveText("1 + 2");
  expect(created).toBe(0);
  await newFormula.press("Enter");
  await expect(panel.locator(".names-panel__value")).toHaveText("3");
  expect(created).toBe(1);

  let fail = true;
  let saved = 0;
  await page.route("**/api/tables/*/names/*", async (route) => {
    if (route.request().method() !== "PATCH") {
      await route.continue();
      return;
    }
    saved += 1;
    if (fail)
      await route.fulfill({
        status: 422,
        contentType: "application/json",
        body: JSON.stringify({ error: { code: "test_failure", message: "Offline" } }),
      });
    else await route.continue();
  });
  const formula = panel.getByLabel("Formula of the name", { exact: true });
  await formula.click();
  await formula.click();
  await formula.fill("4 + 5");
  await formula.press("Tab");
  await expect(panel.getByRole("alert")).toHaveText("Offline");
  await expect(formula).toBeFocused();
  await expect(formula).toHaveText("4 + 5");
  await expect(panel.locator(".names-panel__value")).toHaveText("3");
  expect(saved).toBe(1);
  fail = false;
  await formula.press("Enter");
  await expect(panel.locator(".names-panel__value")).toHaveText("9");
  expect(saved).toBe(2);
});

test("chart drafts keep their original target while browsing pages and block actions on failed saves", async ({
  page,
}) => {
  await newSpreadsheet(page);
  await page.getByRole("button", { name: "Add page", exact: true }).click();
  const pages = page.getByRole("navigation", { name: "Pages" });
  await expect(pages.locator('[aria-current="page"]')).toContainText("Page 2");
  await pages.getByText("Page 1", { exact: true }).click();
  await expect(pages.locator('[aria-current="page"]')).toContainText("Page 1");
  await page.getByRole("button", { name: "Add chart", exact: true }).last().click();
  const chart = page.locator('[data-view="Chart 1"]');
  let writes = 0;
  let copies = 0;
  let fail = true;
  page.on("request", (request) => {
    if (request.url().endsWith("/copy")) copies += 1;
  });
  await page.route("**/api/views/*", async (route) => {
    if (route.request().method() !== "PATCH") {
      await route.continue();
      return;
    }
    writes += 1;
    if (fail)
      await route.fulfill({
        status: 422,
        contentType: "application/json",
        body: JSON.stringify({ error: { code: "test_failure", message: "Offline" } }),
      });
    else await route.continue();
  });
  await chart.getByLabel("Chart data").click();
  await chart.getByLabel("Chart data").fill("SUM(1, 2)");
  await expect(chart.locator(".formula-token--identifier").first()).toHaveText("SUM");
  expect(writes).toBe(0);
  await pages.getByText("Page 2", { exact: true }).click();
  expect(writes).toBe(0);
  const dock = page.locator(".formula-session-fallback");
  await expect(dock).toContainText("Page 1 · Chart 1 · Chart data");
  await expect(dock.locator(".cm-content")).toHaveText("SUM(1, 2)");
  expect(writes).toBe(0);
  await dock.getByRole("button", { name: "Return to editor" }).click();
  await expect(chart.getByLabel("Chart data")).toBeFocused();
  await expect(chart.getByLabel("Chart data")).toHaveText("SUM(1, 2)");
  expect(writes).toBe(0);
  const original = page.url();
  await page.getByRole("button", { name: "Save a copy", exact: true }).click();
  await expect(chart.getByRole("alert")).toHaveText("Offline");
  await expect(chart.getByLabel("Chart data")).toBeFocused();
  expect(page.url()).toBe(original);
  expect(copies).toBe(0);
  fail = false;
  await chart.getByLabel("Chart data").press("Enter");
  await expect(chart.locator(".cm-editor")).toHaveCount(0);
  await expect(chart.getByLabel("Chart data")).toHaveValue("SUM(1, 2)");
  expect(copies).toBe(0);
});
