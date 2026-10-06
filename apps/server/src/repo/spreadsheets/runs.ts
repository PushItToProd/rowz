import { formatAddress, type Effect } from "@spreadsheet-app/engine";
import { desc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { actionRuns, pages, tables, users, views } from "../../db/schema";
import type { ActionRunRecord } from "./records";
import type { RepositoryContext } from "./context";

const RUN_LIMIT = 100;
const tablePages = alias(pages, "action_run_table_pages");
const viewPages = alias(pages, "action_run_view_pages");

/** The latest action runs visible to anyone who can read the spreadsheet. */
export async function listRuns(
  ctx: RepositoryContext,
  spreadsheetId: string,
): Promise<ActionRunRecord[]> {
  return ctx.db.transaction(
    async (tx) => {
      await ctx.within(tx).repository.findSpreadsheet(spreadsheetId, "read");
      const rows = await tx
        .select({
          id: actionRuns.id,
          createdAt: actionRuns.createdAt,
          kind: actionRuns.kind,
          status: actionRuns.status,
          error: actionRuns.error,
          effects: actionRuns.effects,
          emails: actionRuns.emails,
          userName: users.name,
          userEmail: users.email,
          tableId: actionRuns.tableId,
          row: actionRuns.row,
          col: actionRuns.col,
          tableName: tables.name,
          tablePageName: tablePages.name,
          viewId: actionRuns.viewId,
          buttonIndex: actionRuns.buttonIndex,
          viewName: views.name,
          viewPageName: viewPages.name,
        })
        .from(actionRuns)
        .leftJoin(users, eq(users.id, actionRuns.userId))
        .leftJoin(tables, eq(tables.id, actionRuns.tableId))
        .leftJoin(tablePages, eq(tablePages.id, tables.pageId))
        .leftJoin(views, eq(views.id, actionRuns.viewId))
        .leftJoin(viewPages, eq(viewPages.id, views.pageId))
        .where(eq(actionRuns.spreadsheetId, spreadsheetId))
        .orderBy(desc(actionRuns.createdAt), desc(actionRuns.id))
        .limit(RUN_LIMIT);

      return rows.map((run): ActionRunRecord => {
        let target: ActionRunRecord["target"];
        if (run.tableId !== null) {
          if (run.row === null || run.col === null)
            throw new Error("Action run has no cell target");
          target = {
            type: "cell",
            id: run.tableId,
            pageName: run.tablePageName,
            name: run.tableName,
            cell: formatAddress({ row: run.row, col: run.col }),
          };
        } else if (run.viewId !== null && run.buttonIndex !== null) {
          target = {
            type: "view",
            id: run.viewId,
            pageName: run.viewPageName,
            name: run.viewName,
            occurrence: run.buttonIndex,
          };
        } else {
          throw new Error("Action run has no target");
        }

        return {
          id: run.id,
          createdAt: run.createdAt,
          kind: run.kind,
          user:
            run.userName === null || run.userEmail === null
              ? null
              : { name: run.userName, email: run.userEmail },
          target,
          cellsWritten: countEffect(run.effects, "setCell"),
          tablesExpanded: countEffect(run.effects, "ensureRows"),
          rowsDeleted: run.effects.reduce(
            (total, effect) => total + (effect.type === "deleteRows" ? effect.count : 0),
            0,
          ),
          emails: run.emails,
          status: run.status,
          error: run.error,
        };
      });
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

function countEffect(effects: Effect[], type: Effect["type"]): number {
  return effects.filter((effect) => effect.type === type).length;
}
