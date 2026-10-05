<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { LIMITS } from "@spreadsheet-app/shared";
import type { TableRecord } from "../api/client";
import { useWorkbookStore } from "../stores/workbook";
import { sameEditingTarget, useFormulaSessionStore } from "../formula/session";
import { editingLabel } from "../formula/cells";
import SessionFormulaField from "./SessionFormulaField.vue";

const props = defineProps<{ table: TableRecord; colId: string }>();
const emit = defineEmits<{ close: [] }>();
const store = useWorkbookStore();
const sessions = useFormulaSessionStore();
const column = props.table.columns?.[props.table.colIds.indexOf(props.colId)];
const target = {
  kind: "column" as const,
  tableId: props.table.id,
  colId: props.colId,
};
const selected = store.selection;
const context = {
  pageId: props.table.pageId,
  tableId: props.table.id,
  rowId: selected?.tableId === props.table.id ? store.identityOf(selected)?.rowId : undefined,
};
const field = ref<InstanceType<typeof SessionFormulaField>>();
const label = computed(() => editingLabel(target) ?? "Editing formula for every row");
const active = computed(() =>
  sessions.active && sameEditingTarget(sessions.active.target, target)
    ? sessions.active
    : undefined,
);
watch(active, (current, previous) => {
  if (!current && previous) emit("close");
});
onMounted(async () => {
  await nextTick();
  await field.value?.begin();
});
async function apply(): Promise<void> {
  await field.value?.submit();
}
function cancel(): void {
  if (sessions.cancel()) {
    emit("close");
    store.focusGrid();
  }
}
</script>

<template>
  <section class="column-formula-popover" role="region" :aria-label="label" data-formula-field>
    <SessionFormulaField
      ref="field"
      :target="target"
      :context="context"
      :value="column?.formula ?? '='"
      label="Column formula"
      :target-label="label"
      show-label
      :max-length="LIMITS.inputLength"
      :readonly="!store.canEdit"
    />
    <button type="button" :disabled="active?.saving" @mousedown.prevent @click="apply">
      Apply
    </button>
    <button type="button" :disabled="active?.saving" @mousedown.prevent @click="cancel">
      Cancel
    </button>
  </section>
</template>

<style scoped>
.column-formula-popover {
  padding: 12px;
  margin: 8px 0;
  border: 1px solid #ccc;
  background: white;
}
</style>
