<script setup lang="ts">
import { LIMITS } from "@spreadsheet-app/shared";
import type { TableRecord } from "../api/client";
import { useWorkbookStore } from "../stores/workbook";
import EditableName from "./EditableName.vue";
import GridView from "./GridView.vue";

const props = defineProps<{ table: TableRecord }>();
const store = useWorkbookStore();

function remove(): void {
  if (window.confirm(`Delete ${props.table.name} and everything in it?`)) {
    void store.deleteTable(props.table.id);
  }
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
          :disabled="table.rowCount >= LIMITS.tableRows"
          @click="store.updateTable(table.id, { rowCount: table.rowCount + 1 })"
        >
          Add row
        </button>
        <button
          type="button"
          :disabled="table.colCount >= LIMITS.tableCols"
          @click="store.updateTable(table.id, { colCount: table.colCount + 1 })"
        >
          Add column
        </button>
        <button type="button" class="danger" @click="remove">Delete table</button>
      </div>
    </header>
    <GridView :table="table" />
  </section>
</template>
