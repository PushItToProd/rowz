import { expect, test } from "@playwright/test";
import { APP_NAME } from "./appName";
import { PASSWORD, signUp, newSpreadsheet, cell, enter } from "./helpers";

test("editing shows errors, the formula bar, and keyboard navigation", async ({ page }) => {
  await newSpreadsheet(page);
  await enter(page, "A1", "=1/0");
  await expect(cell(page, "A1")).toHaveText("#DIV/0!");

  // Enter moved the selection down, so typing continues in A2. Tab moves right.
  await page.keyboard.type("4");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("grid", { name: "Table 1" })).toBeFocused();
  await page.keyboard.type("=A2*A2");
  await page.keyboard.press("Enter");
  await expect(cell(page, "A2")).toHaveText("4");
  await expect(cell(page, "B2")).toHaveText("16");

  await cell(page, "B2").click();
  const formula = page.getByLabel("Formula");
  await expect(formula).toHaveValue("=A2*A2");
  await formula.click();
  await formula.fill("=A2+1");
  await formula.press("Enter");
  await expect(cell(page, "B2")).toHaveText("5");

  // Enter in the formula bar moves down and hands the keyboard back to the grid.
  await expect(cell(page, "B3")).toHaveAttribute("aria-selected", "true");
  await page.keyboard.type("typed in the grid");
  await page.keyboard.press("Enter");
  await expect(cell(page, "B3")).toHaveText("typed in the grid");
  await expect(page.getByRole("grid", { name: "Table 1" })).toBeFocused();

  // What is typed in the formula bar is saved when another cell is clicked.
  await cell(page, "B2").click();
  await formula.click();
  await formula.fill("=A2+2");
  await cell(page, "A1").click();
  await expect(cell(page, "B2")).toHaveText("6");
  await expect(cell(page, "A1")).toHaveText("#DIV/0!");
  await expect(formula).toHaveValue("=1/0");

  await cell(page, "B2").click();
  await page.keyboard.press("Delete");
  await expect(cell(page, "B2")).toHaveText("");
});

test("the in-cell formula editor fills the cell", async ({ page }) => {
  await newSpreadsheet(page);
  const target = cell(page, "A1");
  await target.click();
  await page.keyboard.type("x");

  const editor = target.locator(".formula-editor");
  await expect(editor).toBeVisible();
  await expect
    .poll(() =>
      editor.evaluate((element) => {
        const cell = element.closest("td")?.getBoundingClientRect();
        if (!cell) return false;
        const bounds = element.getBoundingClientRect();
        return (
          Math.abs(bounds.left - cell.left) <= 1 &&
          Math.abs(bounds.top - cell.top) <= 1 &&
          Math.abs(bounds.right - cell.right) <= 1 &&
          Math.abs(bounds.bottom - cell.bottom) <= 1
        );
      }),
    )
    .toBe(true);
});

test("keeps characters typed immediately after Enter or Tab", async ({ page }) => {
  await newSpreadsheet(page);

  await cell(page, "A1").click();
  await page.keyboard.type("cc", { delay: 0 });
  await page.keyboard.press("Tab");
  await page.keyboard.type("dd", { delay: 0 });
  await page.keyboard.press("Enter");
  await expect(cell(page, "A1")).toHaveText("cc");
  await expect(cell(page, "B1")).toHaveText("dd");

  await cell(page, "C1").click();
  await page.keyboard.type("previous", { delay: 0 });
  await page.keyboard.press("Enter");
  await page.keyboard.type("TRUE", { delay: 0 });
  await page.keyboard.press("Enter");
  await expect(cell(page, "C1")).toHaveText("previous");
  await expect(cell(page, "C2")).toHaveText("TRUE");
});

test("spreadsheets are private to the account that made them", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);

  const email = await signUp(page);
  await page.getByRole("button", { name: "New document" }).click();
  await expect(cell(page, "A1")).toBeVisible();
  const privateUrl = page.url();

  await page.getByRole("link", { name: "← Documents" }).click();
  await expect(page.getByRole("link", { name: "Untitled document" })).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);

  await signUp(page);
  await expect(page.getByText("No documents yet")).toBeVisible();
  await page.goto(privateUrl);
  await expect(page.getByRole("alert")).toHaveText("Document not found");

  await page.goto("/");
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("link", { name: "Untitled document" })).toBeVisible();
});

test("folders organize documents in the list, and deleting one returns them to Unfiled", async ({
  page,
}) => {
  await signUp(page);
  await page.getByRole("button", { name: "New document" }).click();
  await expect(cell(page, "A1")).toBeVisible();
  await page.getByRole("link", { name: "← Documents" }).click();

  await page.getByRole("button", { name: "New folder" }).click();
  await page.getByLabel("New folder name").fill("Planning");
  await page.getByRole("button", { name: "Create folder" }).click();
  const planning = page
    .locator(".list__group")
    .filter({ has: page.getByRole("button", { name: /^Planning/ }) });
  await expect(planning).toBeVisible();

  await page.getByRole("button", { name: "Move Untitled document to a folder" }).click();
  await page.getByRole("menuitem", { name: "Move to Planning" }).click();
  await expect(planning.getByRole("link", { name: "Untitled document" })).toBeVisible();

  await planning.getByRole("button", { name: "Delete folder Planning" }).click();
  await expect(page.getByRole("button", { name: /^Planning/ })).toHaveCount(0);
  const unfiled = page
    .locator(".list__group")
    .filter({ has: page.getByRole("button", { name: /^Unfiled/ }) });
  await expect(unfiled.getByRole("link", { name: "Untitled document" })).toBeVisible();
});

test("renames, duplicates, and deletes a document from the list", async ({ page }) => {
  await newSpreadsheet(page);
  await page.getByRole("link", { name: "← Documents" }).click();

  await page.getByRole("button", { name: "Actions for Untitled document" }).click();
  await page.getByRole("menuitem", { name: "Rename" }).click();
  const name = page.getByRole("textbox", { name: "Document name for Untitled document" });
  await name.fill("Planning doc");
  await name.press("Enter");
  await expect(page.getByRole("link", { name: "Planning doc" })).toBeVisible();

  await page.getByRole("button", { name: "Actions for Planning doc" }).click();
  await page.getByRole("menuitem", { name: "Duplicate" }).click();
  await expect(page.getByRole("status")).toContainText('Created "Planning doc (copy)"');
  const copy = page.getByRole("link", { name: "Planning doc (copy)" });
  await expect(copy).toBeVisible();

  await page.getByRole("button", { name: "Actions for Planning doc (copy)" }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Delete document" });
  await expect(confirm).toContainText("Delete Planning doc (copy)? This cannot be undone.");
  await confirm.getByRole("button", { name: "Delete document" }).click();

  await expect(copy).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Planning doc" })).toBeVisible();
});

test("duplicate-folder errors dismiss on Escape without moving the document list", async ({
  page,
}) => {
  await signUp(page);
  await page.getByRole("button", { name: "New folder" }).click();
  await page.getByLabel("New folder name").fill("Planning");
  await page.getByRole("button", { name: "Create folder" }).click();
  await expect(page.locator(".list__group")).toHaveCount(2);

  await page.getByRole("button", { name: "New folder" }).click();
  await page.getByLabel("New folder name").fill("Planning");
  const groups = page.locator(".list__groups");
  const listTop = await groups.evaluate((element) => element.getBoundingClientRect().top);

  await page.getByRole("button", { name: "Create folder" }).click();
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("already exists");
  expect(await groups.evaluate((element) => element.getBoundingClientRect().top)).toBe(listTop);

  await page.keyboard.press("Escape");
  await expect(alert).toHaveCount(0);
  expect(await groups.evaluate((element) => element.getBoundingClientRect().top)).toBe(listTop);
});

test("a spreadsheet is shared with another account, which can edit it until the share ends", async ({
  page,
  browser,
}) => {
  // The guest signs up first, in a browser of their own.
  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  const guestEmail = await signUp(guest);

  await newSpreadsheet(page);
  await enter(page, "A1", "from the owner");
  await page.getByRole("button", { name: "Share" }).click();
  const share = page.getByRole("dialog", { name: "Share" });
  await share.getByLabel("Email of the person to share with").fill("nobody@example.com");
  await share.getByRole("button", { name: "Share" }).click();
  await expect(share.getByRole("alert")).toContainText("No account uses nobody@example.com");

  await share.getByLabel("Email of the person to share with").fill(guestEmail);
  await share.getByRole("button", { name: "Share" }).click();
  await expect(share.locator(`[data-member="${guestEmail}"]`)).toBeVisible();

  // The guest sees it in their list, opens it, and edits it.
  await guest.reload();
  await expect(guest.getByText("Shared with you · can edit")).toBeVisible();
  await guest.getByRole("link", { name: "Untitled document" }).click();
  await expect(cell(guest, "A1")).toHaveText("from the owner");
  await enter(guest, "B1", "from the guest");
  await expect(guest.getByRole("button", { name: "Delete table" })).toBeVisible();

  // The owner sees the guest's edit without reloading, and the guest the owner's.
  await expect(cell(page, "B1")).toHaveText("from the guest");
  await page.getByRole("button", { name: "Close sharing" }).click();
  await enter(page, "C1", "=LEN(B1)");
  await expect(cell(guest, "C1")).toHaveText("14");

  // The owner makes the guest a viewer, which the guest's page shows at once.
  await page.getByRole("button", { name: "Share" }).click();
  await share.getByLabel("What Ada can do").nth(0).selectOption("viewer");
  await expect(guest.getByText("View only")).toBeVisible();
  await expect(guest.getByRole("button", { name: "Delete table" })).toHaveCount(0);

  // Ending the share takes the spreadsheet away.
  const stopSharing = page.getByRole("alertdialog", { name: "Stop sharing" });
  await share.getByRole("button", { name: "Stop sharing with Ada" }).click();
  await stopSharing.getByRole("button", { name: "Stop sharing" }).click();
  await expect(share.locator(`[data-member="${guestEmail}"]`)).toHaveCount(0);
  await expect(guest.getByRole("alert")).toContainText("not found");
  await guestContext.close();
});

test("the help page documents formulas, with or without an account", async ({ page, context }) => {
  await page.goto("/help");
  await expect(page.getByRole("heading", { name: "Help", exact: true })).toBeVisible();
  await expect(page.locator('[data-function="SUM"]')).toContainText("gives 16");

  await page.getByRole("navigation", { name: "Contents" }).getByText("Errors").click();
  await expect(page).toHaveURL(/\/help#errors$/);
  await expect(page.locator('[data-error="#CYCLE!"]')).toBeInViewport();

  // The contents stay on screen and mark the section being read.
  const contents = page.getByRole("navigation", { name: "Contents" });
  await expect(contents.locator('[aria-current="true"]')).toHaveText("Errors");
  await contents.getByText("Queries").click();
  await expect(contents.locator('[aria-current="true"]')).toHaveText("Queries");
  await expect(contents.getByText("Queries")).toBeInViewport();
  await page.getByRole("heading", { name: "Sharing" }).scrollIntoViewIfNeeded();
  await page.mouse.wheel(0, 300);
  await expect(contents.locator('[aria-current="true"]')).not.toHaveText("Queries");
  await expect(contents.locator('[aria-current="true"]')).toBeInViewport();

  await newSpreadsheet(page);
  const opened = context.waitForEvent("page");
  await page.getByRole("link", { name: "Help" }).click();
  const help = await opened;
  await expect(help.getByRole("heading", { name: "Buttons and actions" })).toBeVisible();
  // The editor is still open in the first tab.
  await expect(cell(page, "A1")).toBeVisible();
});

test("the browser tab names what is open, then the app", async ({ page }) => {
  await page.goto("/help");
  await expect(page).toHaveTitle(`Help | ${APP_NAME}`);

  await signUp(page);
  await expect(page).toHaveTitle(`Documents | ${APP_NAME}`);
  await expect(page.getByText(APP_NAME, { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "New document" }).click();
  await expect(page).toHaveTitle(`Untitled document | ${APP_NAME}`);

  await page.getByRole("heading", { level: 1 }).getByText("Untitled document").dblclick();
  await page.getByLabel("Document name").fill("My budget");
  await page.getByLabel("Document name").press("Enter");
  await expect(page).toHaveTitle(`My budget | ${APP_NAME}`);
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("pages fit the screen, and a cell is edited by tapping it twice", async ({ page }) => {
    // Evaluated in the page, as text: this file is not compiled against the browser's types.
    const fitsScreen = (): Promise<boolean> =>
      page.evaluate<boolean>("document.documentElement.scrollWidth <= window.innerWidth");

    await signUp(page);
    expect(await fitsScreen()).toBe(true);
    await page.getByRole("button", { name: "New document" }).tap();
    await expect(cell(page, "A1")).toBeVisible();
    expect(await fitsScreen()).toBe(true);

    await cell(page, "A1").tap();
    await expect(page.getByLabel("Cell content")).toHaveCount(0);
    await cell(page, "A1").tap();
    await page.getByLabel("Cell content").fill("=6*7");
    await page.keyboard.press("Enter");
    await expect(cell(page, "A1")).toHaveText("42");

    // The formula bar edits the selected cell too.
    await cell(page, "B1").tap();
    await page.getByLabel("Formula").click();
    await page.getByLabel("Formula").fill("=A1+1");
    await page.keyboard.press("Enter");
    await expect(cell(page, "B1")).toHaveText("43");

    await page.goto("/help");
    await expect(page.getByRole("heading", { name: "Help" })).toBeVisible();
    expect(await fitsScreen()).toBe(true);
  });

  test("a checkbox control toggles when tapped without making its whole cell a hit target", async ({
    page,
  }) => {
    await newSpreadsheet(page);
    await enter(page, "A1", "FALSE");
    await enter(page, "B1", '=CHECKBOX(A1, "Done")');

    const controlCell = cell(page, "B1");
    const controlSize = await controlCell.boundingBox();
    if (!controlSize) throw new Error("The checkbox control cell is not visible");
    const checkbox = controlCell.getByRole("checkbox");
    const checkboxSize = await checkbox.boundingBox();
    if (!checkboxSize) throw new Error("The checkbox is not visible");
    expect(checkboxSize.width).toBeGreaterThanOrEqual(32);
    expect(checkboxSize.height).toBeGreaterThanOrEqual(32);
    const checkboxTarget = controlCell.locator(".cell-control__checkbox-target");
    const targetSize = await checkboxTarget.boundingBox();
    if (!targetSize) throw new Error("The checkbox hit area is not visible");
    expect(targetSize.width).toBeGreaterThanOrEqual(32);
    expect(targetSize.height).toBeGreaterThanOrEqual(32);

    await controlCell.tap({
      position: { x: controlSize.width - 5, y: controlSize.height / 2 },
    });
    await expect(controlCell).toHaveAttribute("aria-selected", "true");
    await expect(checkbox).not.toBeChecked();
    await expect(page.getByLabel("Cell content")).toHaveCount(0);

    await checkboxTarget.tap({ position: { x: 2, y: 2 } });
    await expect(checkbox).toBeChecked();
    await expect(cell(page, "A1")).toHaveText("TRUE");

    await checkbox.tap();
    await expect(checkbox).not.toBeChecked();
    await expect(cell(page, "A1")).toHaveText("FALSE");

    await controlCell.locator(".cell-control__checkbox-label").tap();
    await expect(checkbox).toBeChecked();
    await expect(cell(page, "A1")).toHaveText("TRUE");
  });
});
