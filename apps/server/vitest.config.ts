import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "server",
    include: ["src/**/*.test.ts"],
    // Each test file starts an in-process Postgres and applies migrations.
    hookTimeout: 30_000,
  },
});
