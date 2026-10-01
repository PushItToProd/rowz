import { zValidator } from "@hono/zod-validator";
import {
  eventsQuery,
  memberParam,
  nameBody,
  optionalNameBody,
  reorderPagesBody,
  shareBody,
  spreadsheetFile,
  spreadsheetParam,
  versionParam,
} from "@spreadsheet-app/shared";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { ChangeFeed } from "../changes";
import { onInvalid, type Env } from "../http";

/** How long an open stream of changes goes without a word, at most. Proxies drop a connection that says nothing. */
const HEARTBEAT_MS = 25_000;

export function spreadsheetRoutes(changes: ChangeFeed, shutdown?: AbortSignal) {
  return (
    new Hono<Env>()
      .get("/", async (c) => c.json(await c.var.repository.listSpreadsheets()))
      .post("/", zValidator("json", nameBody, onInvalid), async (c) => {
        const { name } = c.req.valid("json");
        return c.json(await c.var.repository.createSpreadsheet(name), 201);
      })
      // Creates a spreadsheet from a file an export wrote.
      .post("/import", zValidator("json", spreadsheetFile, onInvalid), async (c) =>
        c.json(await c.var.repository.importSpreadsheet(c.req.valid("json")), 201),
      )
      .get("/:spreadsheetId", zValidator("param", spreadsheetParam, onInvalid), async (c) => {
        const { spreadsheetId } = c.req.valid("param");
        return c.json(await c.var.repository.getSnapshot(spreadsheetId));
      })
      .patch(
        "/:spreadsheetId",
        zValidator("param", spreadsheetParam, onInvalid),
        zValidator("json", nameBody, onInvalid),
        async (c) => {
          const { spreadsheetId } = c.req.valid("param");
          await c.var.repository.renameSpreadsheet(spreadsheetId, c.req.valid("json").name);
          return c.body(null, 204);
        },
      )
      .delete("/:spreadsheetId", zValidator("param", spreadsheetParam, onInvalid), async (c) => {
        await c.var.repository.deleteSpreadsheet(c.req.valid("param").spreadsheetId);
        return c.body(null, 204);
      })
      /**
       * A stream of the changes made to a spreadsheet, for the sessions that
       * have it open. A session that names itself in `client` is not told of
       * the changes it made itself, which it already shows.
       */
      .get(
        "/:spreadsheetId/events",
        zValidator("param", spreadsheetParam, onInvalid),
        zValidator("query", eventsQuery, onInvalid),
        async (c) => {
          const { spreadsheetId } = c.req.valid("param");
          const { client } = c.req.valid("query");
          await c.var.repository.findSpreadsheet(spreadsheetId, "read");
          return streamSSE(c, async (stream) => {
            let pending = 0;
            let closed = false;
            // Asked through a function, because the abort handler changes the answer between two awaits.
            const isOpen = (): boolean => !closed;
            let wake = (): void => undefined;
            const unsubscribe = changes.subscribe(spreadsheetId, (origin) => {
              if (client !== undefined && origin === client) return;
              pending += 1;
              wake();
            });
            const end = (): void => {
              closed = true;
              unsubscribe();
              shutdown?.removeEventListener("abort", end);
              wake();
            };
            stream.onAbort(end);
            shutdown?.addEventListener("abort", end);
            if (shutdown?.aborted) end();

            await stream.writeSSE({ event: "ready", data: "" });
            while (isOpen()) {
              if (pending === 0) {
                await new Promise<void>((resolve) => {
                  const timer = setTimeout(resolve, HEARTBEAT_MS);
                  wake = () => {
                    clearTimeout(timer);
                    resolve();
                  };
                });
              }
              if (!isOpen()) break;
              const event = pending === 0 ? "ping" : "change";
              pending = Math.max(0, pending - 1);
              await stream.writeSSE({ event, data: "" });
            }
          });
        },
      )
      // Everyone who can open the spreadsheet.
      .get("/:spreadsheetId/members", zValidator("param", spreadsheetParam, onInvalid), async (c) =>
        c.json(await c.var.repository.listMembers(c.req.valid("param").spreadsheetId)),
      )
      // Shares the spreadsheet with an account, or changes the role of a share.
      .put(
        "/:spreadsheetId/members",
        zValidator("param", spreadsheetParam, onInvalid),
        zValidator("json", shareBody, onInvalid),
        async (c) => {
          const { spreadsheetId } = c.req.valid("param");
          const { email, role } = c.req.valid("json");
          await c.var.repository.share(spreadsheetId, email, role);
          return c.json(await c.var.repository.listMembers(spreadsheetId));
        },
      )
      .delete(
        "/:spreadsheetId/members/:userId",
        zValidator("param", memberParam, onInvalid),
        async (c) => {
          const { spreadsheetId, userId } = c.req.valid("param");
          await c.var.repository.unshare(spreadsheetId, userId);
          return c.body(null, 204);
        },
      )
      // The kept versions of a spreadsheet, newest first.
      .get(
        "/:spreadsheetId/versions",
        zValidator("param", spreadsheetParam, onInvalid),
        async (c) =>
          c.json(await c.var.repository.listVersions(c.req.valid("param").spreadsheetId)),
      )
      .post(
        "/:spreadsheetId/versions/:versionId/restore",
        zValidator("param", versionParam, onInvalid),
        async (c) => {
          const { spreadsheetId, versionId } = c.req.valid("param");
          await c.var.repository.restoreVersion(spreadsheetId, versionId);
          return c.body(null, 204);
        },
      )
      // Makes a new spreadsheet of a kept version, and leaves this one alone.
      .post(
        "/:spreadsheetId/versions/:versionId/copy",
        zValidator("param", versionParam, onInvalid),
        async (c) => {
          const { spreadsheetId, versionId } = c.req.valid("param");
          return c.json(await c.var.repository.copyVersion(spreadsheetId, versionId), 201);
        },
      )
      .post(
        "/:spreadsheetId/pages",
        zValidator("param", spreadsheetParam, onInvalid),
        zValidator("json", optionalNameBody, onInvalid),
        async (c) => {
          const { spreadsheetId } = c.req.valid("param");
          const created = await c.var.repository.createPage(
            spreadsheetId,
            c.req.valid("json").name,
          );
          return c.json(created, 201);
        },
      )
      // Puts the pages of a spreadsheet in a new order.
      .put(
        "/:spreadsheetId/pages/order",
        zValidator("param", spreadsheetParam, onInvalid),
        zValidator("json", reorderPagesBody, onInvalid),
        async (c) => {
          await c.var.repository.reorderPages(
            c.req.valid("param").spreadsheetId,
            c.req.valid("json").pages,
          );
          return c.body(null, 204);
        },
      )
  );
}
