import { defineConfig, devices } from "@playwright/test";
import { APP_NAME } from "./e2e/appName";

// Ports of their own, so a test run does not collide with `pnpm dev`.
const API_PORT = 3100;
const WEB_PORT = 5273;
const WEB_URL = `http://localhost:${String(WEB_PORT)}`;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: WEB_URL,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      // An in-memory database: every run starts empty and leaves nothing behind.
      command: "pnpm --filter @spreadsheet-app/server start",
      url: `http://localhost:${String(API_PORT)}/api/auth/ok`,
      env: { PORT: String(API_PORT), DATABASE_URL: "memory://", BASE_URL: WEB_URL, APP_NAME },
      reuseExistingServer: false,
    },
    {
      command: `pnpm --filter @spreadsheet-app/web exec vite --port ${String(WEB_PORT)} --strictPort`,
      url: WEB_URL,
      // BASE_URL is set so that a developer's `.env.local` does not move this server to another URL.
      env: { API_SERVER: `http://localhost:${String(API_PORT)}`, BASE_URL: WEB_URL, APP_NAME },
      reuseExistingServer: false,
    },
  ],
});
