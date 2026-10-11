import { zValidator } from "@hono/zod-validator";
import { blockRowParam, nameBody } from "@spreadsheet-app/shared";
import { Hono } from "hono";
import { onInvalid, type Env } from "../http";

/** Rows of blocks: the blocks that lay tables and views out side by side. */
export function blockRowRoutes() {
  return (
    new Hono<Env>()
      .patch(
        "/:blockRowId",
        zValidator("param", blockRowParam, onInvalid),
        zValidator("json", nameBody, onInvalid),
        async (c) => {
          const { blockRowId } = c.req.valid("param");
          return c.json(
            await c.var.repository.renameBlockRow(blockRowId, c.req.valid("json").name),
          );
        },
      )
      // Removes the row and leaves what it held on the page.
      .post("/:blockRowId/ungroup", zValidator("param", blockRowParam, onInvalid), async (c) =>
        c.json(await c.var.repository.ungroupBlockRow(c.req.valid("param").blockRowId)),
      )
      .delete("/:blockRowId", zValidator("param", blockRowParam, onInvalid), async (c) =>
        c.json(await c.var.repository.deleteBlockRow(c.req.valid("param").blockRowId)),
      )
  );
}
