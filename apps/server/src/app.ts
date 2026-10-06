import { FILE_LIMITS, type ApiError } from "@spreadsheet-app/shared";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { announceChanges, ChangeFeed } from "./changes";
import {
  onError,
  requireSession,
  requireTrustedOrigin,
  type AppDependencies,
  type Env,
} from "./http";
import { pageRoutes } from "./routes/pages";
import { folderRoutes } from "./routes/folders";
import { spreadsheetRoutes } from "./routes/spreadsheets";
import { tableRoutes } from "./routes/tables";
import { viewRoutes } from "./routes/views";

export type { ClickResult } from "./actions/run";
export type {
  Change,
  ChangedContent,
  ActionRunRecord,
  Created,
  DocumentList,
  FolderRecord,
  ListedSpreadsheet,
  MemberRecord,
  PageRecord,
  Snapshot,
  SnapshotWithHistory,
  SpreadsheetSummary,
  TableRecord,
  UndoResult,
  VersionRecord,
  ViewRecord,
} from "./repo/spreadsheets";

export function createApp(dependencies: AppDependencies) {
  const changes = new ChangeFeed();
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
    .use(requireTrustedOrigin(dependencies))
    .use(requireSession(dependencies))
    .use(announceChanges(changes))
    .route("/folders", folderRoutes())
    .route("/spreadsheets", spreadsheetRoutes(changes, dependencies.shutdown))
    .route("/pages", pageRoutes())
    .route("/tables", tableRoutes(dependencies))
    .route("/views", viewRoutes(dependencies));

  return new Hono().onError(onError).route("/api", api);
}

/** The type the web client derives its typed API calls from. */
export type AppType = ReturnType<typeof createApp>;
