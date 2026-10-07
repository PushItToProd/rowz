import { expect, test } from "@playwright/test";
import { cell, enter, newSpreadsheet } from "./helpers";

test("find navigates matches and replace all is one undo step", async ({ page }) => {
  await newSpreadsheet(page);
  await enter(page, "A1", "old");
  await enter(page, "A2", '=UPPER("old")');
  await cell(page, "A1").click();
  await page.keyboard.press("ControlOrMeta+f");
  const panel = page.getByRole("dialog", { name: "Find and replace" });
  await panel.getByLabel("Find text").fill("old");
  await expect(panel.getByRole("status")).toHaveText("2 matches");
  await page.keyboard.press("Enter");
  await expect(cell(page, "A1")).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("F3");
  await expect(cell(page, "A2")).toHaveAttribute("aria-selected", "true");
  await panel.getByLabel("Replace with").fill("new");
  await panel.getByRole("button", { name: "Replace all", exact: true }).click();
  await expect(cell(page, "A1")).toHaveText("new");
  await expect(cell(page, "A2")).toHaveText("NEW");
  await cell(page, "A1").click();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(cell(page, "A1")).toHaveText("old");
  await expect(cell(page, "A2")).toHaveText("OLD");
  await expect(panel.getByRole("status")).toContainText("2 matches");
});
