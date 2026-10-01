import { zValidator } from "@hono/zod-validator";
import {
  memberParam,
  nameBody,
  optionalNameBody,
  shareBody,
  spreadsheetFile,
  spreadsheetParam,
  versionParam,
} from "@spreadsheet-app/shared";
import { Hono } from "hono";
import { onInvalid, type Env } from "../http";

export function spreadsheetRoutes() {
  return (
    new Hono<Env>()
      .get("/", async (c) => c.json(await c.var.repository.listSpreadsheets()))
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
        return c.json(await c.var.repository.getSnapshot(spreadsheetId));
      })
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
          await c.var.repository.restoreVersion(spreadsheetId, versionId);
          return c.body(null, 204);
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
  );
}
