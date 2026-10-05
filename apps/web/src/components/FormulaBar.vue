<script setup lang="ts">
import { computed } from "vue";
import { formatAddress } from "@spreadsheet-app/engine";
import { LIMITS } from "@spreadsheet-app/shared";
import { useWorkbookStore } from "../stores/workbook";
import { useFormulaSessionStore } from "../formula/session";
import { pickingSpan, useReferencePickingStore } from "../formula/picking";
import { cellEditingRequest, editingLabel } from "../formula/cells";
import SessionFormulaField from "./SessionFormulaField.vue";

const props = defineProps<{ pageId?: string }>();
const store = useWorkbookStore();
const sessions = useFormulaSessionStore();
const picking = useReferencePickingStore();
const canPick = computed(
  () =>
    sessions.active &&
    !sessions.active.saving &&
    picking.current &&
    pickingSpan(picking.current, sessions.active.mode, true) !== undefined,
);
const request = computed(() => {
  const active = sessions.active;
  if (
    active &&
    ["cell", "column", "append"].includes(active.target.kind) &&
    (!props.pageId || props.pageId === active.context.pageId)
  ) {
    return { ...active, text: active.state.doc.toString() };
  }
  const selected = store.selection;
  const table = store.tables.find((table) => table.id === selected?.tableId);
  return selected && (!props.pageId || table?.pageId === props.pageId)
    ? cellEditingRequest(selected)
    : undefined;
});
const label = computed(() => {
  const target = request.value?.target;
  if (target?.kind === "column") return editingLabel(target);
  const selected = target?.kind === "cell" ? store.positionOf(target) : store.selection;
  const table = store.tables.find((table) => table.id === selected?.tableId);
  return selected ? `${table?.name ?? ""} · ${formatAddress(selected)}` : "";
});
const placeholder = computed(() => {
  const anchor = store.selection ? store.filledBy(store.selection) : undefined;
  return anchor
    ? `Filled by the formula in ${formatAddress(anchor)}`
    : "Select a cell, then type a value or a formula such as =SUM(A1:A3)";
});
</script>

<template>
  <div class="formula-bar">
    <span class="formula-bar__cell">{{ label }}</span>
    <SessionFormulaField
      v-if="request"
      class="formula-bar__input"
      :target="request.target"
      :context="request.context"
      :mode="request.mode"
      :value="request.text"
      :label="
        request.target.kind === 'column' ? `Formula · ${editingLabel(request.target)}` : 'Formula'
      "
      :target-label="editingLabel(request.target) ?? request.label"
      :placeholder="placeholder"
      :readonly="!store.canEdit"
      :max-length="LIMITS.inputLength"
      cell-navigation
    />
    <input
      v-else
      class="formula-bar__input"
      aria-label="Formula"
      :placeholder="placeholder"
      disabled
      value=""
    />
    <button
      v-if="
        request &&
        sessions.active &&
        picking.key === sessions.active.id &&
        !picking.hasControl &&
        store.canEdit
      "
      type="button"
      data-formula-field
      :disabled="!canPick"
      :aria-pressed="picking.explicit"
      @mousedown.prevent
      @click="picking.request"
    >
      Pick reference
    </button>
    <button
      v-if="request?.target.kind === 'column' && store.canEdit"
      type="button"
      data-formula-field
      @mousedown.prevent
      @click="
        sessions.columnPopover = { tableId: request.target.tableId, colId: request.target.colId }
      "
    >
      Edit column formula
    </button>
  </div>
</template>
