import { zValidator } from "@hono/zod-validator";
import {
  createBlockRowBody,
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
      // Puts the blocks of a page, and of its rows of blocks, in a new arrangement.
      .put(
        "/:pageId/order",
        zValidator("param", pageParam, onInvalid),
        zValidator("json", reorderBody, onInvalid),
        async (c) =>
          c.json(
            await c.var.repository.reorderPage(c.req.valid("param").pageId, c.req.valid("json")),
          ),
      )
      .post(
        "/:pageId/views",
        zValidator("param", pageParam, onInvalid),
        zValidator("json", createViewBody, onInvalid),
        async (c) => {
          const { pageId } = c.req.valid("param");
          const { kind, position, blockRowId } = c.req.valid("json");
          return c.json(await c.var.repository.createView(pageId, kind, position, blockRowId), 201);
        },
      )
      .post(
        "/:pageId/tables",
        zValidator("param", pageParam, onInvalid),
        zValidator("json", createTableBody, onInvalid),
        async (c) => {
          const { pageId } = c.req.valid("param");
          const { name, position, blockRowId } = c.req.valid("json");
          return c.json(
            await c.var.repository.createTable(pageId, name, position, blockRowId),
            201,
          );
        },
      )
      .post(
        "/:pageId/block-rows",
        zValidator("param", pageParam, onInvalid),
        zValidator("json", createBlockRowBody, onInvalid),
        async (c) => {
          const { pageId } = c.req.valid("param");
          const { position } = c.req.valid("json");
          return c.json(await c.var.repository.createBlockRow(pageId, position), 201);
        },
      )
  );
}
