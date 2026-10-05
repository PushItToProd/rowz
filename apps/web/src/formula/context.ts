import type { EditingContext } from "./session";
import type { NamingContext } from "./assist";
import { useWorkbookStore } from "../stores/workbook";

/** The original page decides unqualified references even after a block is moved. */
export function namingContext(context: EditingContext): NamingContext {
  const store = useWorkbookStore();
  return {
    pages: store.pages,
    tables: store.tables,
    pageId: context.pageId,
    columns: store.tables.find((table) => table.id === context.tableId)?.columns,
    names: store.documentNames,
    holderId: context.holderId,
    holder:
      store.views.find((view) => view.id === context.holderId)?.name ??
      store.tables.find((table) => table.id === context.holderId)?.name,
  };
}
