/**
 * The name the app runs under in end-to-end tests. The Playwright config gives
 * it to both servers as `APP_NAME`, so a developer's `.env.local` does not
 * change what the tests see. It differs from the default to show the setting
 * reaches the page.
 */
export const APP_NAME = "Example Sheets";
