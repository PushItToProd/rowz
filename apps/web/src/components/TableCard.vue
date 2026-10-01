<script setup lang="ts">
import { columnLabel, type ColumnType } from "@spreadsheet-app/engine";
import { LIMITS } from "@spreadsheet-app/shared";
import { computed, ref } from "vue";
import { parseCsv, toCsv } from "../files/csv";
import { download, fileName } from "../files/download";
import type { TableRecord } from "../api/client";
import { useWorkbookStore } from "../stores/workbook";
import ContextMenu from "./ContextMenu.vue";
import EditableName from "./EditableName.vue";
import GridView from "./GridView.vue";
import type { MenuItem } from "./menu";

const props = defineProps<{ table: TableRecord }>();
const store = useWorkbookStore();

/** The selected cell when it is in this table. Row and column actions apply to it. */
const selected = computed(() =>
  store.selection?.tableId === props.table.id ? store.selection : null,
);
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

/** Whether any cell of a row or column holds something. */
function holdsContent(axis: "row" | "col", index: number): boolean {
  const length = axis === "row" ? props.table.colCount : props.table.rowCount;
  return Array.from({ length }, (_, other) =>
    axis === "row" ? { row: index, col: other } : { row: other, col: index },
  ).some((cell) => store.inputOf({ tableId: props.table.id, ...cell }) !== "");
}

function insert(axis: "row" | "col", index: number): void {
  void store.editTable(props.table.id, { axis, kind: "insert", index });
}

/** Deletes a row or column, asking first when that would discard content. */
function removeLine(axis: "row" | "col", index: number): void {
  const name = axis === "row" ? `row ${String(index + 1)}` : `column ${columnLabel(index)}`;
  if (holdsContent(axis, index) && !window.confirm(`Delete ${name} and what it holds?`)) return;
  void store.editTable(props.table.id, { axis, kind: "delete", index });
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

/** The menu items that set what a named column holds. */
function columnItems(col: number): MenuItem[] {
  const column = props.table.columns?.[col];
  if (!column) return [];
  const { id } = props.table;
  return [
    ...COLUMN_TYPES.map(({ type, label }, index) => ({
      label: `${column.type === type ? "✓ " : ""}Column holds: ${label}`,
      separated: index === 0,
      run: () => {
        void store.updateColumn(id, col, { type });
      },
    })),
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

/** Where the menu of row, column, and cell actions is open, if it is. */
const menuAt = ref<{ x: number; y: number } | null>(null);

/** The actions for the selected cell. Each one acts on that cell's row or column. */
const menuItems = computed((): MenuItem[] => {
  const cell = selected.value;
  if (!cell) return [];
  const { row, col } = cell;
  return [
    {
      label: "Insert row above",
      disabled: rowsFull.value,
      run: () => {
        insert("row", row);
      },
    },
    {
      label: "Insert row below",
      disabled: rowsFull.value,
      run: () => {
        insert("row", row + 1);
      },
    },
    {
      label: `Delete row ${String(row + 1)}`,
      danger: true,
      disabled: props.table.rowCount <= 1,
      run: () => {
        removeLine("row", row);
      },
    },
    {
      label: "Insert column left",
      separated: true,
      disabled: colsFull.value,
      run: () => {
        insert("col", col);
      },
    },
    {
      label: "Insert column right",
      disabled: colsFull.value,
      run: () => {
        insert("col", col + 1);
      },
    },
    {
      label: `Delete column ${columnLabel(col)}`,
      danger: true,
      disabled: props.table.colCount <= 1,
      run: () => {
        removeLine("col", col);
      },
    },
    ...columnItems(col),
    { label: "Clear cells", separated: true, run: () => void store.clearSelection() },
  ];
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
        <button
          type="button"
          :disabled="rowsFull"
          @click="store.updateTable(table.id, { rowCount: table.rowCount + 1 })"
        >
          Add row
        </button>
        <button
          type="button"
          :disabled="colsFull"
          @click="store.updateTable(table.id, { colCount: table.colCount + 1 })"
        >
          Add column
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
    </header>

    <!-- Always present, so selecting a cell does not push the grid down. -->
    <div v-if="store.canEdit" class="table-card__lines">
      <span v-if="!selected" class="table-card__line">
        Select a cell to insert or delete its row or column.
      </span>
      <span v-if="selected" role="group" :aria-label="`Row ${selected.row + 1}`">
        <span class="table-card__line">Row {{ selected.row + 1 }}</span>
        <button type="button" :disabled="rowsFull" @click="insert('row', selected.row)">
          Insert row above
        </button>
        <button
          type="button"
          class="danger"
          :disabled="table.rowCount <= 1"
          @click="removeLine('row', selected.row)"
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
          @click="removeLine('col', selected.col)"
        >
          Delete column
        </button>
      </span>
    </div>

    <GridView :table="table" @menu="menuAt = $event" />
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
      :label="`Actions for ${columnLabel(selected.col)}${selected.row + 1}`"
      :items="menuItems"
      @close="menuAt = null"
    />
  </section>
</template>
