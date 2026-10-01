import { relative } from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";

/**
 * Serves the built web app next to the API, so one process and one address
 * serve both. A path that is not a file answers with the app's page: the web
 * app has its own router, and an address such as `/s/…/p/…` exists only there.
 *
 * `webRoot` is the directory `pnpm build` writes, `apps/web/dist`.
 */
export function withWebApp(api: Hono, webRoot: string): Hono {
  // The file server takes a path relative to where the process was started.
  const root = relative(process.cwd(), webRoot) || ".";
  return (
    new Hono()
      .route("/", api)
      .use("*", serveStatic({ root }))
      // Not for /api: an unknown API path stays a 404 and never becomes a page.
      .get("*", async (c, next) => {
        if (c.req.path.startsWith("/api/")) return c.notFound();
        return serveStatic({ root, path: "index.html" })(c, next);
      })
  );
}
