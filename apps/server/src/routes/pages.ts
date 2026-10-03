import { zValidator } from "@hono/zod-validator";
import {
  createViewBody,
  nameBody,
  createTableBody,
  pageParam,
  reorderBody,
} from "@spreadsheet-app/shared";
import { Hono } from "hono";
import { onInvalid, type Env } from "../http";

export function pageRoutes() {
  return (
    new Hono<Env>()
      .patch(
        "/:pageId",
        zValidator("param", pageParam, onInvalid),
        zValidator("json", nameBody, onInvalid),
        async (c) => {
          const { pageId } = c.req.valid("param");
          return c.json(await c.var.repository.renamePage(pageId, c.req.valid("json").name));
        },
      )
      .delete("/:pageId", zValidator("param", pageParam, onInvalid), async (c) =>
        c.json(await c.var.repository.deletePage(c.req.valid("param").pageId)),
      )
      // Puts the blocks of a page in a new order.
      .put(
        "/:pageId/order",
        zValidator("param", pageParam, onInvalid),
        zValidator("json", reorderBody, onInvalid),
        async (c) =>
          c.json(
            await c.var.repository.reorderPage(
              c.req.valid("param").pageId,
              c.req.valid("json").blocks,
            ),
          ),
      )
      .post(
        "/:pageId/views",
        zValidator("param", pageParam, onInvalid),
        zValidator("json", createViewBody, onInvalid),
        async (c) => {
          const { pageId } = c.req.valid("param");
          const { kind, position } = c.req.valid("json");
          return c.json(await c.var.repository.createView(pageId, kind, position), 201);
        },
      )
      .post(
        "/:pageId/tables",
        zValidator("param", pageParam, onInvalid),
        zValidator("json", createTableBody, onInvalid),
        async (c) => {
          const { pageId } = c.req.valid("param");
          const { name, position } = c.req.valid("json");
          return c.json(await c.var.repository.createTable(pageId, name, position), 201);
        },
      )
  );
}
