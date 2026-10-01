import { defineConfig, devices } from "@playwright/test";

// Ports of their own, so a capture does not collide with `pnpm dev` or `pnpm e2e`.
const API_PORT = 3110;
const WEB_PORT = 5283;
const WEB_URL = `http://localhost:${String(WEB_PORT)}`;

/** Captures the screenshots in the README: `pnpm screenshots`. */
export default defineConfig({
  testDir: "e2e",
  testMatch: "screenshots.ts",
  reporter: "list",
  use: {
    baseURL: WEB_URL,
    ...devices["Desktop Chrome"],
    viewport: { width: 1200, height: 760 },
    // Twice the pixels, so the images stay sharp on dense displays.
    deviceScaleFactor: 2,
  },
  webServer: [
    {
      command: "pnpm --filter @spreadsheet-app/server start",
      url: `http://localhost:${String(API_PORT)}/api/auth/ok`,
      env: { PORT: String(API_PORT), DATABASE_URL: "memory://", BASE_URL: WEB_URL },
      reuseExistingServer: false,
    },
    {
      command: `pnpm --filter @spreadsheet-app/web exec vite --port ${String(WEB_PORT)} --strictPort`,
      url: WEB_URL,
      env: { API_SERVER: `http://localhost:${String(API_PORT)}`, BASE_URL: WEB_URL },
      reuseExistingServer: false,
    },
  ],
});
