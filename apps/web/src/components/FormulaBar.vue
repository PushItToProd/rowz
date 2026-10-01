<script setup lang="ts">
import { formatAddress } from "@spreadsheet-app/engine";
import { LIMITS } from "@spreadsheet-app/shared";
import { computed, ref, watch } from "vue";
import { useWorkbookStore } from "../stores/workbook";

const store = useWorkbookStore();

const stored = computed(() => (store.selection ? store.inputOf(store.selection) : ""));
const draft = ref("");
// Follow the selection and outside changes, such as a button writing to the selected cell.
watch(stored, (input) => (draft.value = input), { immediate: true });

const label = computed(() => {
  const { selection } = store;
  if (!selection) return "";
  const table = store.tables.find((candidate) => candidate.id === selection.tableId);
  return `${table?.name ?? ""} · ${formatAddress(selection)}`;
});

const placeholder = computed(() => {
  const anchor = store.selection ? store.filledBy(store.selection) : undefined;
  return anchor
    ? `Filled by the formula in ${formatAddress(anchor)}`
    : "Select a cell, then type a value or a formula such as =SUM(A1:A3)";
});

function commit(): void {
  if (store.selection && draft.value !== stored.value) {
    void store.setCell(store.selection, draft.value);
  }
}

function revert(event: Event): void {
  draft.value = stored.value;
  if (event.target instanceof HTMLElement) event.target.blur();
}
</script>

<template>
  <div class="formula-bar">
    <span class="formula-bar__cell">{{ label }}</span>
    <input
      v-model="draft"
      class="formula-bar__input"
      aria-label="Formula"
      :placeholder="placeholder"
      :disabled="!store.selection || !store.canEdit"
      :maxlength="LIMITS.inputLength"
      @keydown.enter="commit"
      @keydown.esc="revert"
      @blur="commit"
    />
  </div>
</template>
