import { Hono } from "hono";
import { onError, requireSession, type AppDependencies, type Env } from "./http";
import { pageRoutes } from "./routes/pages";
import { spreadsheetRoutes } from "./routes/spreadsheets";
import { tableRoutes } from "./routes/tables";

export type { ClickResult } from "./actions/run";
export type { PageRecord, Snapshot, SpreadsheetSummary, TableRecord } from "./repo/spreadsheets";

export function createApp(dependencies: AppDependencies) {
  const api = new Hono<Env>()
    .on(["GET", "POST"], "/auth/*", (c) => dependencies.auth.handler(c.req.raw))
    // Everything registered after this line requires a session.
    .use(requireSession(dependencies))
    .route("/spreadsheets", spreadsheetRoutes())
    .route("/pages", pageRoutes())
    .route("/tables", tableRoutes(dependencies));

  return new Hono().onError(onError).route("/api", api);
}

/** The type the web client derives its typed API calls from. */
export type AppType = ReturnType<typeof createApp>;
