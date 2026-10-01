<script setup lang="ts">
import { formatAddress, type CellId } from "@spreadsheet-app/engine";
import { LIMITS } from "@spreadsheet-app/shared";
import { computed, ref, watch } from "vue";
import { useFormulaAssist } from "../formula/useFormulaAssist";
import { useWorkbookStore } from "../stores/workbook";
import FormulaAssist from "./FormulaAssist.vue";

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

/**
 * The cell the field is editing: the one selected when it took focus. A
 * click on another cell selects that cell before the field loses focus, and
 * what was typed belongs to this one.
 */
let editing: CellId | null = null;

function commit(): void {
  const target = editing ?? store.selection;
  if (!target || !store.tables.some((table) => table.id === target.tableId)) return;
  if (draft.value !== store.inputOf(target)) void store.setCell(target, draft.value);
}

const field = ref<HTMLInputElement>();
const focused = ref(false);
// Suggestions are offered only while the bar is being typed in.
const typed = computed({
  get: () => (focused.value ? draft.value : null),
  set: (text) => (draft.value = text ?? ""),
});
const assist = useFormulaAssist(
  typed,
  () => field.value,
  () => store.selection?.tableId,
);

function onKeydown(event: KeyboardEvent): void {
  if (assist.onKeydown(event)) return;
  if (event.key === "Enter") commit();
  else if (event.key === "Escape") {
    draft.value = stored.value;
    field.value?.blur();
  }
}

function onFocus(): void {
  focused.value = true;
  editing = store.selection;
}

function onBlur(): void {
  focused.value = false;
  commit();
  editing = null;
  // The draft may be of the cell just left. Show the selected cell's input.
  draft.value = stored.value;
}
</script>

<template>
  <div class="formula-bar">
    <span class="formula-bar__cell">{{ label }}</span>
    <input
      ref="field"
      v-model="draft"
      class="formula-bar__input"
      aria-label="Formula"
      :placeholder="placeholder"
      :disabled="!store.selection || !store.canEdit"
      :maxlength="LIMITS.inputLength"
      @keydown="onKeydown"
      @input="assist.track"
      @keyup="assist.track"
      @click="assist.track"
      @focus="onFocus"
      @blur="onBlur"
    />
    <FormulaAssist
      :items="assist.suggestions.value.items"
      :active="assist.active.value"
      :signature="assist.signature.value"
      :anchor="focused ? field : undefined"
      @pick="assist.accept($event)"
    />
  </div>
</template>
