import { FILE_LIMITS, type ApiError } from "@spreadsheet-app/shared";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { onError, requireSession, type AppDependencies, type Env } from "./http";
import { pageRoutes } from "./routes/pages";
import { spreadsheetRoutes } from "./routes/spreadsheets";
import { tableRoutes } from "./routes/tables";
import { viewRoutes } from "./routes/views";

export type { ClickResult } from "./actions/run";
export type {
  PageRecord,
  Rewritten,
  Snapshot,
  SpreadsheetSummary,
  TableRecord,
  ViewRecord,
} from "./repo/spreadsheets";

export function createApp(dependencies: AppDependencies) {
  const api = new Hono<Env>()
    // No request needs more than an imported file does, and without a bound a body is read whole into memory.
    .use(
      bodyLimit({
        maxSize: FILE_LIMITS.bytes,
        onError: (c) =>
          c.json<ApiError>(
            { error: { code: "too_large", message: "The request is too large" } },
            413,
          ),
      }),
    )
    .on(["GET", "POST"], "/auth/*", (c) => dependencies.auth.handler(c.req.raw))
    // Everything registered after this line requires a session.
    .use(requireSession(dependencies))
    .route("/spreadsheets", spreadsheetRoutes())
    .route("/pages", pageRoutes())
    .route("/tables", tableRoutes(dependencies))
    .route("/views", viewRoutes());

  return new Hono().onError(onError).route("/api", api);
}

/** The type the web client derives its typed API calls from. */
export type AppType = ReturnType<typeof createApp>;
