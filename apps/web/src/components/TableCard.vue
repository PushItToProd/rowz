<script setup lang="ts">
import { columnLabel, formatAddress, type ColumnType } from "@spreadsheet-app/engine";
import { LIMITS } from "@spreadsheet-app/shared";
import { computed, ref } from "vue";
import { parseCsv, toCsv } from "../files/csv";
import { download, fileName } from "../files/download";
import type { TableRecord } from "../api/client";
import { useWorkbookStore } from "../stores/workbook";
import ContextMenu from "./ContextMenu.vue";
import ChoicesPanel from "./ChoicesPanel.vue";
import EditableName from "./EditableName.vue";
import GridView from "./GridView.vue";
import NamesPanel from "./NamesPanel.vue";
import ResizeTable from "./ResizeTable.vue";
import TableDisplayBar from "./TableDisplayBar.vue";
import type { MenuItem, MenuScope } from "./menu";

const props = defineProps<{ table: TableRecord }>();
const store = useWorkbookStore();

/** The selected cell when it is in this table. Row and column actions apply to it. */
const selected = computed(() =>
  store.selection?.tableId === props.table.id ? store.selection : null,
);
/** The rows the table shows, which are what a selection of rows names. */
const view = computed(() => store.rowView(props.table.id));
const rowsFull = computed(() => props.table.rowCount >= LIMITS.tableRows);
const colsFull = computed(() => props.table.colCount >= LIMITS.tableCols);

function remove(): void {
  if (window.confirm(`Delete ${props.table.name} and everything in it?`)) {
    void store.deleteTable(props.table.id);
  }
}

function exportCsv(): void {
  download(fileName(props.table.name, "csv"), toCsv(store.shownRows(props.table)), "text/csv");
}

/** Reads a chosen CSV file into the table, starting at its first cell. */
async function importCsv(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const [file] = input.files ?? [];
  // Cleared so that choosing the same file again is a change the input reports.
  input.value = "";
  if (!file) return;
  const rows = parseCsv(await file.text());
  const replaces = store.shownRows(props.table).length > 0;
  if (replaces && !window.confirm(`Import ${file.name} over what ${props.table.name} holds?`)) {
    return;
  }
  await store.importRows(props.table.id, rows);
}

type Axis = "row" | "col";

/**
 * Rows or columns that sit next to each other: `count` of them from `first`.
 * Rows are places in what the table shows, which are its stored rows unless
 * the table is sorted or filtered.
 */
interface Lines {
  axis: Axis;
  first: number;
  count: number;
}

/** The stored rows or columns the lines name. Places past the last row are rows the table does not have. */
function indexesOf({ axis, first, count }: Lines): number[] {
  return Array.from({ length: count }, (_, offset) =>
    axis === "row" ? view.value.storedRow(first + offset) : first + offset,
  ).filter((index) => index < (axis === "row" ? props.table.rowCount : props.table.colCount));
}

/** "row 3", "rows 3-6", "3 rows", "column C", or "columns C-E". */
function describeLines(lines: Lines): string {
  const { axis } = lines;
  const indexes = indexesOf(lines).toSorted((a, b) => a - b);
  const label = (index: number): string =>
    axis === "row" ? String(index + 1) : columnLabel(index);
  const noun = axis === "row" ? "row" : "column";
  const [first = 0] = indexes;
  const last = indexes.at(-1) ?? first;
  if (indexes.length === 1) return `${noun} ${label(first)}`;
  // Rows of a sorted table need not sit next to each other.
  if (last - first + 1 !== indexes.length) return `${String(indexes.length)} ${noun}s`;
  return `${noun}s ${label(first)}-${label(last)}`;
}

/** Whether any cell of the rows or columns holds something. */
function holdContent(lines: Lines): boolean {
  const { id, rowCount, colCount } = props.table;
  const across = lines.axis === "row" ? colCount : rowCount;
  for (const index of indexesOf(lines)) {
    for (let other = 0; other < across; other += 1) {
      const cell = lines.axis === "row" ? { row: index, col: other } : { row: other, col: index };
      if (store.inputOf({ tableId: id, ...cell }) !== "") return true;
    }
  }
  return false;
}

/** Inserts `count` rows or columns, the first of them at `index`. */
function insert(axis: Axis, index: number, count = 1): void {
  void store.editTable(props.table.id, { axis, kind: "insert", index, count });
}

/** Deletes rows or columns, asking first when that would discard content. */
function removeLines(lines: Lines): void {
  const held = lines.count === 1 ? "what it holds" : "what they hold";
  if (holdContent(lines) && !window.confirm(`Delete ${describeLines(lines)} and ${held}?`)) return;
  void store.deleteLines(props.table.id, lines.axis, indexesOf(lines));
}

/** Whether the form that sets the table's size is open. */
const resizing = ref(false);

/** Whether the rows and columns past a size hold anything. */
function holdsContentPast(rowCount: number, colCount: number): boolean {
  const { id } = props.table;
  for (let row = 0; row < props.table.rowCount; row += 1) {
    for (let col = row < rowCount ? colCount : 0; col < props.table.colCount; col += 1) {
      if (store.inputOf({ tableId: id, row, col }) !== "") return true;
    }
  }
  return false;
}

/** Sets the table's size, asking first when a smaller one would discard content. */
function resize({ rowCount, colCount }: { rowCount: number; colCount: number }): void {
  const { id, name } = props.table;
  const size = `${String(colCount)} ${colCount === 1 ? "column" : "columns"} and ${String(rowCount)} ${rowCount === 1 ? "row" : "rows"}`;
  const asked = `Resizing ${name} to ${size} deletes what its other rows and columns hold. Resize it?`;
  if (holdsContentPast(rowCount, colCount) && !window.confirm(asked)) return;
  resizing.value = false;
  if (rowCount === props.table.rowCount && colCount === props.table.colCount) return;
  void store.updateTable(id, { rowCount, colCount });
}

/** Whether the panel of the table's names is open, and the formula a new name starts with. */
const namesOpen = ref(false);
const nameSuggestion = ref<string>();

/** Opens the names panel with a new name for the selected range. */
function nameRange(): void {
  const range = store.selectedRange;
  if (!range) return;
  const start = formatAddress({ row: range.startRow, col: range.startCol });
  const end = formatAddress({ row: range.endRow, col: range.endCol });
  nameSuggestion.value = start === end ? start : `${start}:${end}`;
  namesOpen.value = true;
}

/** Where the menu that offers the two ways to name columns is open, if it is. */
const namingAt = ref<{ x: number; y: number } | null>(null);

function openNaming(event: MouseEvent): void {
  const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
  namingAt.value = { x: box.left, y: box.bottom + 4 };
}

const namingItems: MenuItem[] = [
  {
    label: "Use the first row as the names",
    run: () => {
      void store.nameColumns(props.table.id, true);
    },
  },
  {
    label: "Name them Column 1, Column 2, …",
    run: () => {
      void store.nameColumns(props.table.id, false);
    },
  },
];

function dropColumns(): void {
  const computed = (props.table.columns ?? []).some((column) => column.type === "formula");
  const warning = computed ? " Its formula columns will become empty." : "";
  if (window.confirm(`Remove the column names of ${props.table.name}?${warning}`)) {
    void store.dropColumns(props.table.id);
  }
}

const COLUMN_TYPES: readonly { type: ColumnType; label: string }[] = [
  { type: "any", label: "Anything" },
  { type: "text", label: "Text" },
  { type: "number", label: "Number" },
  { type: "date", label: "Date" },
  { type: "checkbox", label: "Checkbox" },
];

/** The column whose choices are being edited, while the panel for them is open. */
const choosingFor = ref<number | null>(null);

/** The menu items that set what a named column holds. */
function columnItems(col: number): MenuItem[] {
  const column = props.table.columns?.[col];
  if (!column) return [];
  const { id } = props.table;
  const colId = props.table.colIds[col];
  const sortBy = (descending: boolean): void => {
    if (!colId) return;
    const { filter } = props.table.display;
    void store.setTableDisplay(
      id,
      { sort: [{ colId, descending }], ...(filter === undefined ? {} : { filter }) },
      store.revision,
    );
  };
  const sorted = props.table.display.sort.some((key) => key.colId === colId);
  return [
    {
      label: "Sort ascending",
      run: () => {
        sortBy(false);
      },
    },
    {
      label: "Sort descending",
      run: () => {
        sortBy(true);
      },
    },
    {
      label: "Clear sort",
      disabled: props.table.display.sort.length === 0 && !sorted,
      run: () => {
        const { filter } = props.table.display;
        void store.setTableDisplay(
          id,
          { sort: [], ...(filter === undefined ? {} : { filter }) },
          store.revision,
        );
      },
    },
    ...COLUMN_TYPES.map(({ type, label }) => ({
      label: `${column.type === type ? "✓ " : ""}Column holds: ${label}`,
      run: () => {
        void store.updateColumn(id, col, { type });
      },
    })),
    {
      label: `${column.type === "choice" ? "✓ " : ""}Column holds: A choice…`,
      run: () => {
        choosingFor.value = col;
      },
    },
    {
      label: `${column.type === "formula" ? "✓ " : ""}Column holds: A formula…`,
      run: () => {
        const formula = window.prompt(
          `The formula for every row of ${column.name}. Name a column of the same row in square brackets, as in =[Price] * [Qty]`,
          column.formula ?? "=",
        );
        if (formula !== null && formula.trim() !== "" && formula.trim() !== "=") {
          void store.updateColumn(id, col, { type: "formula", formula });
        }
      },
    },
  ];
}

/** Where the menu of row, column, and cell actions is open, if it is, and what it acts on. */
const menuAt = ref<{ x: number; y: number; scope: MenuScope } | null>(null);

/** The items that insert and delete the selected rows, or the selected columns. */
function lineItems(lines: Lines): MenuItem[] {
  const { axis, first, count } = lines;
  const rows = axis === "row";
  const size = rows ? props.table.rowCount : props.table.colCount;
  const full = size + count > (rows ? LIMITS.tableRows : LIMITS.tableCols);
  const noun = rows ? "row" : "column";
  const counted = count === 1 ? noun : `${String(count)} ${noun}s`;
  // Above and below mean places in the order shown, and a row is inserted at a stored place.
  const unplaced = rows && view.value.reordered;
  return [
    {
      label: `Insert ${counted} ${rows ? "above" : "left"}`,
      disabled: full || unplaced,
      run: () => {
        insert(axis, first, count);
      },
    },
    {
      label: `Insert ${counted} ${rows ? "below" : "right"}`,
      disabled: full || unplaced,
      run: () => {
        insert(axis, first + count, count);
      },
    },
    {
      label: `Delete ${describeLines(lines)}`,
      danger: true,
      // Plain grids keep one row; every table keeps one column.
      disabled: count >= size && (!rows || !props.table.columns),
      run: () => {
        removeLines(lines);
      },
    },
  ];
}

/**
 * The actions for the selected cells. They insert as many rows or columns as
 * the selection spans, and delete the ones it spans. A menu opened from a row
 * header has no column actions, and one opened from a column header no row actions.
 */
const menuItems = computed((): MenuItem[] => {
  const range = selected.value ? store.selectedRange : null;
  const scope = menuAt.value?.scope;
  if (!range || !scope) return [];
  const rows: Lines = {
    axis: "row",
    first: range.startRow,
    count: range.endRow - range.startRow + 1,
  };
  const cols: Lines = {
    axis: "col",
    first: range.startCol,
    count: range.endCol - range.startCol + 1,
  };
  const groups: MenuItem[][] = [
    scope === "col" ? [] : lineItems(rows),
    scope === "row" ? [] : lineItems(cols),
    // What a column holds is set one column at a time.
    scope === "row" || cols.count > 1 ? [] : columnItems(cols.first),
    scope !== "cells" || props.table.columns ? [] : [{ label: "Name this range…", run: nameRange }],
    [{ label: "Clear cells", run: () => void store.clearSelection() }],
  ];
  return groups
    .filter((group) => group.length > 0)
    .flatMap((group, index) =>
      group.map((item, position) => ({ ...item, separated: index > 0 && position === 0 })),
    );
});

/** What the open menu acts on, for its accessible name. */
const menuLabel = computed(() => {
  const range = selected.value ? store.selectedRange : null;
  if (!range) return "";
  const row = view.value.storedRow;
  const start = formatAddress({ row: row(range.startRow), col: range.startCol });
  const end = formatAddress({ row: row(range.endRow), col: range.endCol });
  return `Actions for ${start === end ? start : `${start}:${end}`}`;
});
</script>

<template>
  <section class="table-card" :data-table="table.name">
    <header class="table-card__header">
      <h2>
        <EditableName
          :value="table.name"
          label="Table name"
          :disabled="!store.canEdit"
          @rename="store.updateTable(table.id, { name: $event })"
        />
      </h2>
      <div v-if="store.canEdit" class="table-card__actions">
        <button type="button" aria-haspopup="dialog" @click="resizing = !resizing">Resize</button>
        <button
          v-if="!table.columns"
          type="button"
          :aria-expanded="namesOpen"
          @click="namesOpen = !namesOpen"
        >
          Names{{ table.names.length > 0 ? ` (${table.names.length})` : "" }}
        </button>
        <button v-if="table.columns" type="button" @click="dropColumns">Remove column names</button>
        <button v-else type="button" aria-haspopup="menu" @click="openNaming">Name columns</button>
        <label class="file-button">
          Import CSV
          <input type="file" accept=".csv,.tsv,.txt,text/csv" @change="importCsv" />
        </label>
        <button type="button" @click="exportCsv">Export CSV</button>
        <button type="button" class="danger" @click="remove">Delete table</button>
      </div>
      <div v-else class="table-card__actions">
        <button type="button" @click="exportCsv">Export CSV</button>
      </div>
      <ResizeTable v-if="resizing" :table="table" @close="resizing = false" @resize="resize" />
    </header>

    <NamesPanel
      v-if="namesOpen && !table.columns"
      :table="table"
      :suggestion="nameSuggestion"
      @close="namesOpen = false"
    />

    <!-- Always present, so selecting a cell does not push the grid down. -->
    <div v-if="store.canEdit" class="table-card__lines">
      <span v-if="!selected" class="table-card__line">
        Select a cell to insert or delete its row or column.
      </span>
      <span v-if="selected" role="group" :aria-label="`Row ${selected.row + 1}`">
        <span class="table-card__line">Row {{ selected.row + 1 }}</span>
        <button
          type="button"
          :disabled="rowsFull || view.reordered"
          :title="view.reordered ? 'Not while the table is sorted or filtered' : undefined"
          @click="insert('row', selected.row)"
        >
          Insert row above
        </button>
        <button
          type="button"
          class="danger"
          :disabled="selected.row >= table.rowCount || (!table.columns && table.rowCount <= 1)"
          @click="
            removeLines({ axis: 'row', first: view.place(selected.row) ?? selected.row, count: 1 })
          "
        >
          Delete row
        </button>
      </span>
      <span v-if="selected" role="group" :aria-label="`Column ${columnLabel(selected.col)}`">
        <span class="table-card__line">Column {{ columnLabel(selected.col) }}</span>
        <button type="button" :disabled="colsFull" @click="insert('col', selected.col)">
          Insert column left
        </button>
        <button
          type="button"
          class="danger"
          :disabled="table.colCount <= 1"
          @click="removeLines({ axis: 'col', first: selected.col, count: 1 })"
        >
          Delete column
        </button>
      </span>
    </div>

    <ChoicesPanel
      v-if="choosingFor !== null && table.columns?.[choosingFor]"
      :key="choosingFor"
      :table="table"
      :col="choosingFor"
      @close="choosingFor = null"
    />

    <TableDisplayBar v-if="table.columns" :table="table" />

    <!-- A strip along the right edge adds a column, and one along the bottom edge adds a row. -->
    <div class="table-card__grid">
      <GridView :table="table" @menu="menuAt = $event" />
      <template v-if="store.canEdit">
        <button
          type="button"
          class="table-card__grow table-card__grow--col"
          aria-label="Add column"
          title="Add column"
          :disabled="colsFull"
          @click="store.updateTable(table.id, { colCount: table.colCount + 1 })"
        >
          +
        </button>
        <button
          type="button"
          class="table-card__grow table-card__grow--row"
          aria-label="Add row"
          title="Add row"
          :disabled="rowsFull"
          @click="store.editTable(table.id, { axis: 'row', kind: 'insert', index: table.rowCount })"
        >
          +
        </button>
      </template>
    </div>
    <ContextMenu
      v-if="namingAt"
      :x="namingAt.x"
      :y="namingAt.y"
      label="Name columns"
      :items="namingItems"
      @close="namingAt = null"
    />
    <ContextMenu
      v-if="menuAt && selected"
      :x="menuAt.x"
      :y="menuAt.y"
      :label="menuLabel"
      :items="menuItems"
      @close="menuAt = null"
    />
  </section>
</template>
