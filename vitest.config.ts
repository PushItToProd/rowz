import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: ["packages/*/vitest.config.ts", "apps/*/vitest.config.ts"],
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**", "apps/*/src/**"],
      exclude: ["**/*.test.ts", "**/*.d.ts", "**/testing.ts", "**/test-setup.ts"],
      thresholds: {
        // The engine decides what every cell shows and what every button does.
        "packages/engine/src/**": { lines: 90 },
      },
    },
  },
});
