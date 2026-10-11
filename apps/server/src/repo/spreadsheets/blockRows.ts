import { eq } from "drizzle-orm";
import { type Change } from "../journal";
import { blockRows } from "../../db/schema";
import { type BlockRowRecord, type Created } from "./records";
import { nextName } from "./helpers";
import { place } from "./pages";
import type { RepositoryContext } from "./context";

/** Adds an empty row of blocks at an index, defaulting to the end of a page. */
export async function createBlockRow(
  ctx: RepositoryContext,
  pageId: string,
  insertAt?: number,
): Promise<Created<{ blockRow: BlockRowRecord }>> {
  const { result, change } = await ctx.changePage(pageId, async (_page, tx, writer) => {
    writer.setLabel("Add row of blocks");
    const position = await ctx.within(tx).insertPosition(pageId, writer, insertAt);
    const others = await tx
      .select({ name: blockRows.name })
      .from(blockRows)
      .where(eq(blockRows.pageId, pageId));
    const name = nextName(
      "Row",
      others.map((row) => row.name),
    );
    return writer.insertBlockRow({ pageId, name, position });
  });
  return { blockRow: result, change };
}

export async function renameBlockRow(
  ctx: RepositoryContext,
  blockRowId: string,
  name: string,
): Promise<Change> {
  const { change } = await ctx.changeBlockRow(blockRowId, async (blockRow, _tx, writer) => {
    writer.setLabel(`Rename row ${blockRow.name}`);
    await writer.updateBlockRow(blockRowId, { name });
  });
  return change;
}

/**
 * Removes a row of blocks and keeps what it held. Its tables and views take
 * its place on the page, in the order they had in the row.
 */
export async function ungroupBlockRow(ctx: RepositoryContext, blockRowId: string): Promise<Change> {
  const { change } = await ctx.changeBlockRow(blockRowId, async (blockRow, tx, writer) => {
    writer.setLabel(`Ungroup row ${blockRow.name}`);
    const placed = await ctx.within(tx).placedBlocks(blockRow.pageId);
    const inOrder = (rowId: string | null) =>
      placed.filter((block) => block.blockRowId === rowId).sort((a, b) => a.position - b.position);
    const onPage = inOrder(null).flatMap((block) =>
      block.id === blockRowId ? inOrder(blockRowId) : [block],
    );
    for (const [position, block] of onPage.entries()) {
      await place(writer, block, { position, blockRowId: null });
    }
    await writer.deleteBlockRow(blockRowId);
  });
  return change;
}

/** Deletes a row of blocks and the tables and views in it. */
export async function deleteBlockRow(ctx: RepositoryContext, blockRowId: string): Promise<Change> {
  const { change } = await ctx.changeBlockRow(blockRowId, async (blockRow, tx, writer) => {
    writer.setLabel(`Delete row ${blockRow.name}`);
    await ctx.keepVersion(tx, blockRow.spreadsheetId, `Before deleting the row ${blockRow.name}`);
    await writer.deleteBlockRow(blockRowId);
  });
  return change;
}
