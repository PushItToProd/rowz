import { zValidator } from "@hono/zod-validator";
import {
  eventsQuery,
  replaceBody,
  memberParam,
  moveSpreadsheetFolderBody,
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
import type { Announcement, ChangeFeed } from "../changes";
import { onInvalid, type Env } from "../http";

/** How long an open stream of changes goes without a word, at most. Proxies drop a connection that says nothing. */
const HEARTBEAT_MS = 25_000;

export function spreadsheetRoutes(changes: ChangeFeed, shutdown?: AbortSignal) {
  return (
    new Hono<Env>()
      .get("/", async (c) => c.json(await c.var.repository.listSpreadsheets()))
      .put(
        "/:spreadsheetId/folder",
        zValidator("param", spreadsheetParam, onInvalid),
        zValidator("json", moveSpreadsheetFolderBody, onInvalid),
        async (c) => {
          const { spreadsheetId } = c.req.valid("param");
          await c.var.repository.moveDocument(spreadsheetId, c.req.valid("json").folderId);
          return c.body(null, 204);
        },
      )
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
        const snapshot = await c.var.repository.getSnapshot(spreadsheetId);
        const undoState = await c.var.repository.undoState(spreadsheetId);
        return c.json({ ...snapshot, ...undoState });
      })
      // The latest 100 button and control runs, newest first.
      .get("/:spreadsheetId/runs", zValidator("param", spreadsheetParam, onInvalid), async (c) =>
        c.json(await c.var.repository.listRuns(c.req.valid("param").spreadsheetId)),
      )
      .post("/:spreadsheetId/copy", zValidator("param", spreadsheetParam, onInvalid), async (c) =>
        c.json(await c.var.repository.copySpreadsheet(c.req.valid("param").spreadsheetId), 201),
      )
      .post("/:spreadsheetId/undo", zValidator("param", spreadsheetParam, onInvalid), async (c) =>
        c.json(await c.var.repository.undo(c.req.valid("param").spreadsheetId)),
      )
      .post(
        "/:spreadsheetId/replace",
        zValidator("param", spreadsheetParam, onInvalid),
        zValidator("json", replaceBody, onInvalid),
        async (c) =>
          c.json(
            await c.var.repository.replace(c.req.valid("param").spreadsheetId, c.req.valid("json")),
          ),
      )
      .post("/:spreadsheetId/redo", zValidator("param", spreadsheetParam, onInvalid), async (c) =>
        c.json(await c.var.repository.redo(c.req.valid("param").spreadsheetId)),
      )
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
       * A stream of what happens to a spreadsheet, for the sessions that have
       * it open. A change to what it holds is sent with its revision and its
       * content, to every session, the one that made it included: a session
       * applies changes in the order of their revisions and would take a
       * missing one for a gap. Anything else that happens is sent as an event
       * with no data, on which a session reads the spreadsheet again. A
       * session that names itself in `client` is not sent those for what it
       * did itself.
       */
      .get(
        "/:spreadsheetId/events",
        zValidator("param", spreadsheetParam, onInvalid),
        zValidator("query", eventsQuery, onInvalid),
        async (c) => {
          const { spreadsheetId } = c.req.valid("param");
          const { client } = c.req.valid("query");
          const { repository } = c.var;
          await repository.findSpreadsheet(spreadsheetId, "read");
          return streamSSE(c, async (stream) => {
            const pending: Announcement[] = [];
            let closed = false;
            // Asked through a function, because the abort handler changes the answer between two awaits.
            const isOpen = (): boolean => !closed;
            let wake = (): void => undefined;
            const unsubscribe = changes.subscribe(spreadsheetId, (announcement) => {
              const own = client !== undefined && announcement.origin === client;
              if (own && !announcement.change) return;
              pending.push(announcement);
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

            // Read after subscribing, so no change falls between this revision and the first event.
            // A session that has applied fewer changes than this reads the spreadsheet again.
            const revision = await repository.revisionOf(spreadsheetId);
            await stream.writeSSE({ event: "ready", data: JSON.stringify({ revision }) });
            while (isOpen()) {
              if (pending.length === 0) {
                await new Promise<void>((resolve) => {
                  const timer = setTimeout(resolve, HEARTBEAT_MS);
                  wake = () => {
                    clearTimeout(timer);
                    resolve();
                  };
                });
              }
              if (!isOpen()) break;
              const next = pending.shift();
              if (!next) {
                await stream.writeSSE({ event: "ping", data: "" });
                continue;
              }
              // An event with content is sent only to someone who may still read the
              // spreadsheet. Whoever no longer may is told that something changed, reads
              // again, and learns so from that.
              const allowed =
                !next.change ||
                (await repository.findSpreadsheet(spreadsheetId, "read").then(
                  () => true,
                  () => false,
                ));
              await stream.writeSSE({
                event: "change",
                data: allowed && next.change ? JSON.stringify(next.change) : "",
              });
              if (!allowed) end();
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
          return c.json(await c.var.repository.restoreVersion(spreadsheetId, versionId));
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
        async (c) =>
          c.json(
            await c.var.repository.reorderPages(
              c.req.valid("param").spreadsheetId,
              c.req.valid("json").pages,
            ),
          ),
      )
  );
}
