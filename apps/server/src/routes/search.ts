import { documentSearchQuery } from "@spreadsheet-app/shared";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { onInvalid, type Env } from "../http";

export function searchRoutes() {
  return new Hono<Env>().get(
    "/",
    zValidator("query", documentSearchQuery, onInvalid),
    async (c) => {
      const { q, limit } = c.req.valid("query");
      return c.json(await c.var.repository.searchDocuments(q, limit));
    },
  );
}
