import { expect, test, type Locator, type Page } from "@playwright/test";

const PASSWORD = "correct horse battery staple";

function uniqueEmail(): string {
  return `user-${crypto.randomUUID()}@example.com`;
}

async function signUp(page: Page, email = uniqueEmail()): Promise<string> {
  await page.goto("/signup");
  await page.getByLabel("Name").fill("Ada");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page.getByRole("heading", { name: "Spreadsheets" })).toBeVisible();
  return email;
}

/** Signs up and opens a new spreadsheet in the editor. */
async function newSpreadsheet(page: Page): Promise<void> {
  await signUp(page);
  await page.getByRole("button", { name: "New spreadsheet" }).click();
  await expect(cell(page, "A1")).toBeVisible();
}

function cell(page: Page, address: string, table = "Table 1"): Locator {
  return page.locator(`[data-table="${table}"] [data-cell="${address}"]`);
}

/** Types into a cell the way a person does: click it, type, press Enter. */
async function enter(page: Page, address: string, text: string, table = "Table 1"): Promise<void> {
  await cell(page, address, table).click();
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
}

test("a button writes the sum of two cells into a third, and the result persists", async ({
  page,
}) => {
  await newSpreadsheet(page);
  await enter(page, "A1", "1");
  await enter(page, "A2", "2");
  await enter(page, "A4", '=BUTTON("Sum range", EXECUTE(SUM(A1,A2),A3))');
  await expect(cell(page, "A3")).toHaveText("");

  await page.getByRole("button", { name: "Sum range" }).click();
  await expect(cell(page, "A3")).toHaveText("3");
  await expect(page.getByRole("status")).toHaveText(/Updated A3/);

  // The button reads the cells as they are at each click.
  await enter(page, "A1", "10");
  await page.getByRole("button", { name: "Sum range" }).click();
  await expect(cell(page, "A3")).toHaveText("12");

  await page.reload();
  await expect(cell(page, "A1")).toHaveText("10");
  await expect(cell(page, "A3")).toHaveText("12");
  await expect(page.getByRole("button", { name: "Sum range" })).toBeVisible();
});

test("formulas read other tables and other pages, and follow their changes", async ({ page }) => {
  await newSpreadsheet(page);

  await page.getByRole("button", { name: "Add table" }).click();
  await enter(page, "A1", "5", "Table 2");
  await enter(page, "A1", "='Table 2'!A1*2");
  await expect(cell(page, "A1")).toHaveText("10");

  await page.getByRole("button", { name: "Add page" }).click();
  const pages = page.getByRole("navigation", { name: "Pages" });
  await expect(pages.locator('[aria-current="page"]')).toHaveText(/Page 2/);
  await enter(page, "A1", "='Page 1'!'Table 2'!A1+1");
  await expect(cell(page, "A1")).toHaveText("6");

  await pages.getByText("Page 1").click();
  await enter(page, "A1", "7", "Table 2");
  await expect(cell(page, "A1")).toHaveText("14");

  await pages.getByText("Page 2").click();
  await expect(cell(page, "A1")).toHaveText("8");

  await page.reload();
  await expect(cell(page, "A1")).toHaveText("8");
});

test("a button sends an email built from cells, and reports a bad address", async ({ page }) => {
  await newSpreadsheet(page);
  await enter(page, "A1", "ada@example.com");
  await enter(page, "A2", "Hello");
  await enter(page, "A3", "The total is 3");
  await enter(page, "B1", '=BUTTON("Click me!", SEND_EMAIL(A1,A2,A3))');

  await page.getByRole("button", { name: "Click me!" }).click();
  await expect(page.getByRole("status")).toHaveText(/Email sent/);

  await enter(page, "A1", "nobody");
  await page.getByRole("button", { name: "Click me!" }).click();
  await expect(page.getByRole("alert")).toHaveText(/"nobody" is not an email address/);
});

test("renaming a table or page rewrites the formulas that name it", async ({ page }) => {
  await newSpreadsheet(page);
  await page.getByRole("button", { name: "Add table" }).click();
  await enter(page, "A1", "5", "Table 2");
  await enter(page, "A1", "='Table 2'!A1+1");
  await enter(page, "A2", "='Page 1'!'Table 2'!A1*2");
  await expect(cell(page, "A1")).toHaveText("6");

  await page.locator('[data-table="Table 2"]').getByText("Table 2").dblclick();
  await page.getByLabel("Table name").fill("Sales");
  await page.getByLabel("Table name").press("Enter");
  await expect(page.locator('[data-table="Sales"]')).toBeVisible();
  await expect(cell(page, "A1")).toHaveText("6");
  await cell(page, "A1").click();
  await expect(page.getByLabel("Formula")).toHaveValue("=Sales!A1+1");

  await page.locator('[data-table="Sales"]').getByText("Sales").dblclick();
  await page.getByLabel("Table name").fill("Table 1");
  await page.getByLabel("Table name").press("Enter");
  await expect(page.getByRole("alert")).toHaveText(/A table named Table 1 already exists/);

  const pages = page.getByRole("navigation", { name: "Pages" });
  await pages.getByText("Page 1").dblclick();
  await page.getByLabel("Page name").fill("Summary");
  await page.getByLabel("Page name").press("Enter");
  await expect(pages.locator('[aria-current="page"]')).toHaveText(/Summary/);
  await expect(cell(page, "A2")).toHaveText("10");
  await cell(page, "A2").click();
  await expect(page.getByLabel("Formula")).toHaveValue("=Summary!Sales!A1*2");

  await page.reload();
  await expect(cell(page, "A1")).toHaveText("6");
  await expect(cell(page, "A2")).toHaveText("10");
  await expect(pages.locator('[aria-current="page"]')).toHaveText(/Summary/);
});

test("rows and columns can be inserted and deleted, and formulas follow", async ({ page }) => {
  await newSpreadsheet(page);
  await enter(page, "A1", "1");
  await enter(page, "A2", "2");
  await enter(page, "A3", "3");
  await enter(page, "B1", "=SUM(A1:A3)");
  await enter(page, "C1", "=A2*10");
  await expect(cell(page, "B1")).toHaveText("6");

  // Delete row 2: the sum shrinks, and the formula that named A2 loses its target.
  await cell(page, "A2").click();
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Delete row" }).click();
  await expect(cell(page, "A2")).toHaveText("3");
  await expect(cell(page, "B1")).toHaveText("4");
  await expect(cell(page, "C1")).toHaveText("#REF!");

  // Insert a column left of B: the formulas move right and still read column A.
  await cell(page, "B1").click();
  await page.getByRole("button", { name: "Insert column left" }).click();
  await expect(cell(page, "B1")).toHaveText("");
  await expect(cell(page, "C1")).toHaveText("4");
  await cell(page, "C1").click();
  await expect(page.getByLabel("Formula")).toHaveValue("=SUM(A1:A2)");

  await page.reload();
  await expect(cell(page, "C1")).toHaveText("4");
  await expect(cell(page, "A2")).toHaveText("3");
});

test("editing shows errors, the formula bar, and keyboard navigation", async ({ page }) => {
  await newSpreadsheet(page);
  await enter(page, "A1", "=1/0");
  await expect(cell(page, "A1")).toHaveText("#DIV/0!");

  // Enter moved the selection down, so typing continues in A2. Tab moves right.
  await page.keyboard.type("4");
  await page.keyboard.press("Tab");
  await page.keyboard.type("=A2*A2");
  await page.keyboard.press("Enter");
  await expect(cell(page, "A2")).toHaveText("4");
  await expect(cell(page, "B2")).toHaveText("16");

  await cell(page, "B2").click();
  const formula = page.getByLabel("Formula");
  await expect(formula).toHaveValue("=A2*A2");
  await formula.fill("=A2+1");
  await formula.press("Enter");
  await expect(cell(page, "B2")).toHaveText("5");

  await cell(page, "B2").click();
  await page.keyboard.press("Delete");
  await expect(cell(page, "B2")).toHaveText("");
});

test("spreadsheets are private to the account that made them", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);

  const email = await signUp(page);
  await page.getByRole("button", { name: "New spreadsheet" }).click();
  await expect(cell(page, "A1")).toBeVisible();
  const privateUrl = page.url();

  await page.getByRole("link", { name: "← Spreadsheets" }).click();
  await expect(page.getByRole("link", { name: "Untitled spreadsheet" })).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);

  await signUp(page);
  await expect(page.getByText("No spreadsheets yet")).toBeVisible();
  await page.goto(privateUrl);
  await expect(page.getByRole("alert")).toHaveText("Spreadsheet not found");

  await page.goto("/");
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("link", { name: "Untitled spreadsheet" })).toBeVisible();
});

test("the help page documents formulas, with or without an account", async ({ page, context }) => {
  await page.goto("/help");
  await expect(page.getByRole("heading", { name: "Help", exact: true })).toBeVisible();
  await expect(page.locator('[data-function="SUM"]')).toContainText("gives 16");

  await page.getByRole("navigation", { name: "Contents" }).getByText("Errors").click();
  await expect(page).toHaveURL(/\/help#errors$/);
  await expect(page.locator('[data-error="#CYCLE!"]')).toBeInViewport();

  await newSpreadsheet(page);
  const opened = context.waitForEvent("page");
  await page.getByRole("link", { name: "Help" }).click();
  const help = await opened;
  await expect(help.getByRole("heading", { name: "Buttons and actions" })).toBeVisible();
  // The editor is still open in the first tab.
  await expect(cell(page, "A1")).toBeVisible();
});
