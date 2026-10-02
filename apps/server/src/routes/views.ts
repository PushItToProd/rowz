import { zValidator } from "@hono/zod-validator";
import { moveBlockBody, updateViewBody, viewParam } from "@spreadsheet-app/shared";
import { Hono } from "hono";
import { onInvalid, type Env } from "../http";

/** Charts and text views: the things on a page that are not tables. */
export function viewRoutes() {
  return (
    new Hono<Env>()
      .patch(
        "/:viewId",
        zValidator("param", viewParam, onInvalid),
        zValidator("json", updateViewBody, onInvalid),
        async (c) => {
          const { viewId } = c.req.valid("param");
          return c.json(await c.var.repository.updateView(viewId, c.req.valid("json")));
        },
      )
      // Moves the view to another page of its spreadsheet.
      .put(
        "/:viewId/page",
        zValidator("param", viewParam, onInvalid),
        zValidator("json", moveBlockBody, onInvalid),
        async (c) => {
          const { viewId } = c.req.valid("param");
          return c.json(await c.var.repository.moveView(viewId, c.req.valid("json").pageId));
        },
      )
      .delete("/:viewId", zValidator("param", viewParam, onInvalid), async (c) =>
        c.json(await c.var.repository.deleteView(c.req.valid("param").viewId)),
      )
  );
}
