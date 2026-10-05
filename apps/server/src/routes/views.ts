import { zValidator } from "@hono/zod-validator";
import { moveBlockBody, updateViewBody, viewButtonParam, viewParam } from "@spreadsheet-app/shared";
import { Hono } from "hono";
import {
  clientClock,
  runViewButton,
  UTC_OFFSET_HEADER,
  type ActionDependencies,
} from "../actions/run";
import { onInvalid, type Env } from "../http";

/** Charts and text views: the things on a page that are not tables. */
export function viewRoutes(dependencies: ActionDependencies) {
  return (
    new Hono<Env>()
      .post(
        "/:viewId/buttons/:buttonIndex/click",
        zValidator("param", viewButtonParam, onInvalid),
        async (c) => {
          const { viewId, buttonIndex } = c.req.valid("param");
          return c.json(
            await runViewButton(
              dependencies,
              c.var.userId,
              viewId,
              buttonIndex,
              clientClock(c.req.header(UTC_OFFSET_HEADER)),
            ),
          );
        },
      )
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
