import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

const API_SERVER = process.env.API_SERVER ?? "http://localhost:3000";

export default defineConfig({
  plugins: [vue()],
  server: {
    // The browser sees one origin, so the session cookie needs no cross-site setup.
    proxy: { "/api": API_SERVER },
  },
  preview: {
    proxy: { "/api": API_SERVER },
  },
});
