import { resolve } from "node:path";
import basicSsl from "@vitejs/plugin-basic-ssl";
import vue from "@vitejs/plugin-vue";
import { defineConfig, loadEnv } from "vite";

const REPOSITORY_ROOT = resolve(import.meta.dirname, "../..");
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export default defineConfig(({ mode }) => {
  // The API server reads the same variables, so both agree on the URL browsers use.
  const env = loadEnv(mode, REPOSITORY_ROOT, "");
  const apiServer = env.API_SERVER ?? "http://localhost:3000";
  const baseUrl = new URL(env.BASE_URL ?? "http://localhost:5173");
  const remote = !LOCAL_HOSTS.has(baseUrl.hostname);

  return {
    plugins: [
      vue(),
      // A self-signed certificate. Browsers offer `crypto.randomUUID` and other
      // secure-context APIs over plain HTTP only on localhost.
      ...(baseUrl.protocol === "https:" ? [basicSsl({ domains: [baseUrl.hostname] })] : []),
    ],
    server: {
      // Vite listens on localhost alone and refuses other Host headers unless told otherwise.
      ...(remote ? { host: true, allowedHosts: [baseUrl.hostname] } : {}),
      ...(baseUrl.port === "" ? {} : { port: Number(baseUrl.port) }),
      // The API server trusts requests from `BASE_URL` alone, so the next free port would not work.
      strictPort: true,
      // The browser sees one origin, so the session cookie needs no cross-site setup.
      proxy: { "/api": apiServer },
    },
    preview: {
      proxy: { "/api": apiServer },
    },
  };
});
