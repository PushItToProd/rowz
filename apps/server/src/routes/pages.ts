import { zValidator } from "@hono/zod-validator";
import { nameBody, optionalNameBody, pageParam } from "@spreadsheet-app/shared";
import { Hono } from "hono";
import { onInvalid, type Env } from "../http";

export function pageRoutes() {
  return new Hono<Env>()
    .patch(
      "/:pageId",
      zValidator("param", pageParam, onInvalid),
      zValidator("json", nameBody, onInvalid),
      async (c) => {
        const { pageId } = c.req.valid("param");
        // The cells whose formulas named the page, with the new name written in.
        return c.json({
          cells: await c.var.repository.renamePage(pageId, c.req.valid("json").name),
        });
      },
    )
    .delete("/:pageId", zValidator("param", pageParam, onInvalid), async (c) => {
      await c.var.repository.deletePage(c.req.valid("param").pageId);
      return c.body(null, 204);
    })
    .post(
      "/:pageId/tables",
      zValidator("param", pageParam, onInvalid),
      zValidator("json", optionalNameBody, onInvalid),
      async (c) => {
        const { pageId } = c.req.valid("param");
        return c.json(await c.var.repository.createTable(pageId, c.req.valid("json").name), 201);
      },
    );
}
