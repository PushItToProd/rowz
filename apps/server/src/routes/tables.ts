import { zValidator } from "@hono/zod-validator";
import {
  cellParam,
  controlInputBody,
  setCellsBody,
  structuralEditBody,
  tableParam,
  updateTableBody,
} from "@spreadsheet-app/shared";
import { Hono } from "hono";
import { runButton, runControl, type ActionDependencies } from "../actions/run";
import { onInvalid, type Env } from "../http";

export function tableRoutes(dependencies: ActionDependencies) {
  return new Hono<Env>()
    .patch(
      "/:tableId",
      zValidator("param", tableParam, onInvalid),
      zValidator("json", updateTableBody, onInvalid),
      async (c) => {
        const { tableId } = c.req.valid("param");
        return c.json(await c.var.repository.updateTable(tableId, c.req.valid("json")));
      },
    )
    .delete("/:tableId", zValidator("param", tableParam, onInvalid), async (c) => {
      await c.var.repository.deleteTable(c.req.valid("param").tableId);
      return c.body(null, 204);
    })
    .post(
      "/:tableId/edits",
      zValidator("param", tableParam, onInvalid),
      zValidator("json", structuralEditBody, onInvalid),
      async (c) => {
        const { tableId } = c.req.valid("param");
        return c.json(await c.var.repository.editStructure(tableId, c.req.valid("json")));
      },
    )
    .put(
      "/:tableId/cells",
      zValidator("param", tableParam, onInvalid),
      zValidator("json", setCellsBody, onInvalid),
      async (c) => {
        await c.var.repository.setCells(c.req.valid("param").tableId, c.req.valid("json").cells);
        return c.body(null, 204);
      },
    )
    .post(
      "/:tableId/cells/:row/:col/input",
      zValidator("param", cellParam, onInvalid),
      zValidator("json", controlInputBody, onInvalid),
      async (c) => {
        const { value } = c.req.valid("json");
        return c.json(await runControl(dependencies, c.var.userId, c.req.valid("param"), value));
      },
    )
    .post("/:tableId/cells/:row/:col/click", zValidator("param", cellParam, onInvalid), async (c) =>
      c.json(await runButton(dependencies, c.var.userId, c.req.valid("param"))),
    );
}
