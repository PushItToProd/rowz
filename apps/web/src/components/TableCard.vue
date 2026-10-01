<script setup lang="ts">
import { columnLabel } from "@spreadsheet-app/engine";
import { LIMITS } from "@spreadsheet-app/shared";
import { computed } from "vue";
import type { TableRecord } from "../api/client";
import { useWorkbookStore } from "../stores/workbook";
import EditableName from "./EditableName.vue";
import GridView from "./GridView.vue";

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
        <button type="button" class="danger" @click="remove">Delete table</button>
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

    <GridView :table="table" />
  </section>
</template>
