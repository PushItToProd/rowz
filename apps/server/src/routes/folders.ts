import { zValidator } from "@hono/zod-validator";
import { folderParam, nameBody } from "@spreadsheet-app/shared";
import { Hono } from "hono";
import { onInvalid, type Env } from "../http";

export function folderRoutes() {
  return new Hono<Env>()
    .post("/", zValidator("json", nameBody, onInvalid), async (c) =>
      c.json(await c.var.repository.createFolder(c.req.valid("json").name), 201),
    )
    .patch(
      "/:folderId",
      zValidator("param", folderParam, onInvalid),
      zValidator("json", nameBody, onInvalid),
      async (c) => {
        const { folderId } = c.req.valid("param");
        return c.json(await c.var.repository.renameFolder(folderId, c.req.valid("json").name));
      },
    )
    .delete("/:folderId", zValidator("param", folderParam, onInvalid), async (c) => {
      await c.var.repository.deleteFolder(c.req.valid("param").folderId);
      return c.body(null, 204);
    });
}
