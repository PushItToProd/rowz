import { zValidator } from "@hono/zod-validator";
import { updateViewBody, viewParam } from "@spreadsheet-app/shared";
import { Hono } from "hono";
import { onInvalid, type Env } from "../http";

/** Charts and text views: the things on a page that are not tables. */
export function viewRoutes() {
  return new Hono<Env>()
    .patch(
      "/:viewId",
      zValidator("param", viewParam, onInvalid),
      zValidator("json", updateViewBody, onInvalid),
      async (c) => {
        const { viewId } = c.req.valid("param");
        return c.json(await c.var.repository.updateView(viewId, c.req.valid("json")));
      },
    )
    .delete("/:viewId", zValidator("param", viewParam, onInvalid), async (c) => {
      await c.var.repository.deleteView(c.req.valid("param").viewId);
      return c.body(null, 204);
    });
}
