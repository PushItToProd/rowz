import { expect, type Locator, type Page } from "@playwright/test";

interface FilePayload {
  name: string;
  mimeType: string;
  buffer: Buffer;
}

export const PASSWORD = "correct horse battery staple";

function uniqueEmail(): string {
  return `user-${crypto.randomUUID()}@example.com`;
}

export async function signUp(page: Page, email = uniqueEmail()): Promise<string> {
  await page.goto("/signup");
  await page.getByLabel("Name").fill("Ada");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page.getByRole("heading", { name: "Documents" })).toBeVisible();
  return email;
}

/** Signs up and opens a new spreadsheet in the editor. */
export async function newSpreadsheet(page: Page): Promise<void> {
  await signUp(page);
  await page.getByRole("button", { name: "New document" }).click();
  await expect(cell(page, "A1")).toBeVisible();
}

export function cell(page: Page, address: string, table = "Table 1"): Locator {
  return page.locator(`[data-table="${table}"] [data-cell="${address}"]`);
}

/** Opens the shared menu for a block from its ellipsis button. */
export async function openBlockMenu(page: Page, blockName: string): Promise<Locator> {
  const button = page.getByRole("button", { name: `Block actions for ${blockName}` });
  const menu = page.getByRole("menu", { name: `Actions for ${blockName}` });
  await button.scrollIntoViewIfNeeded();
  await button.click();
  await expect(menu).toBeVisible();
  return menu;
}

/** Chooses a block action from its ellipsis menu. */
export async function chooseBlockAction(
  page: Page,
  blockName: string,
  action: string,
): Promise<void> {
  const menu = await openBlockMenu(page, blockName);
  await menu.getByRole("menuitem", { name: action, exact: true }).click();
}

/** Opens a file chooser from a block menu action and selects a file. */
export async function uploadFromBlockMenu(
  page: Page,
  blockName: string,
  action: "Import CSV" | "Append CSV rows",
  path: string | FilePayload,
): Promise<void> {
  const chooser = page.waitForEvent("filechooser");
  await chooseBlockAction(page, blockName, action);
  await (await chooser).setFiles(path);
}

export async function dragReference(page: Page, from: Locator, to: Locator): Promise<void> {
  await from.scrollIntoViewIfNeeded();
  const start = await from.boundingBox(),
    end = await to.boundingBox();
  if (!start || !end) throw new Error("The reference drag endpoints are not visible");
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 5 });
  await page.mouse.up();
}

/** Collapsed table borders can make the rendered size differ by a fraction of a pixel. */
export async function expectCellSize(
  page: Page,
  address: string,
  dimension: "width" | "height",
  size: number,
): Promise<void> {
  await expect
    .poll(() =>
      cell(page, address).evaluate(
        (element, dimension) => Math.round(element.getBoundingClientRect()[dimension]),
        dimension,
      ),
    )
    .toBe(size);
}

/** Types into a cell the way a person does: click it, type, press Enter. */
export async function enter(
  page: Page,
  address: string,
  text: string,
  table = "Table 1",
): Promise<void> {
  await cell(page, address, table).click();
  await expect(cell(page, address, table)).toHaveAttribute("aria-selected", "true");
  const grid = page.getByRole("grid", { name: table, exact: true });
  await page.keyboard.type(text);
  const editing = page.getByLabel("Cell content");
  await expect(editing).toHaveText(text);
  await page.keyboard.press("Enter");
  await expect(grid).toBeFocused();
}

/**
 * Reloads the editor once the server has answered every change. Changes are
 * sent one at a time, and a reload drops the ones still waiting.
 */
export async function reload(page: Page): Promise<void> {
  await expect(page.locator(".editor[data-saving]")).toHaveCount(0);
  await page.reload();
}

/**
 * Opens the menu of pages a block can move to. A menu closes when the page
 * scrolls, and the scroll that brings the button into view can end after the
 * click, so the click is made again until the menu stays open.
 */
export async function openPageMenu(page: Page, block: string): Promise<void> {
  const button = page.getByRole("button", { name: `Move ${block} to another page` });
  await button.scrollIntoViewIfNeeded();
  await expect(async () => {
    await button.click();
    await expect(page.getByRole("menu")).toBeVisible({ timeout: 500 });
  }).toPass();
}
