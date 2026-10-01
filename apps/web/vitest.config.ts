import vue from "@vitejs/plugin-vue";
import { defineProject } from "vitest/config";

export default defineProject({
  plugins: [vue()],
  test: {
    name: "web",
    environment: "jsdom",
    include: ["src/**/*.test.ts"],
    setupFiles: ["src/test-setup.ts"],
  },
});
