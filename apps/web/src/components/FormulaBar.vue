<script setup lang="ts">
import { formatAddress } from "@spreadsheet-app/engine";
import { LIMITS, type IdentifiedCell } from "@spreadsheet-app/shared";
import { computed, ref, shallowRef, watch } from "vue";
import { useFormulaAssist } from "../formula/useFormulaAssist";
import { useWorkbookStore } from "../stores/workbook";
import FormulaAssist from "./FormulaAssist.vue";

const store = useWorkbookStore();

/**
 * The cell the field is editing: the one selected when it took focus. A
 * click on another cell selects that cell before the field loses focus, and
 * what was typed belongs to this one.
 */
const editing = shallowRef<IdentifiedCell | null>(null);
/** The cell the field shows: the one being edited, or else the selected one. */
const shown = computed(() =>
  editing.value ? (store.positionOf(editing.value) ?? null) : store.selection,
);

const stored = computed(() => (shown.value ? store.inputOf(shown.value) : ""));
const draft = ref("");
// Follow the selection and outside changes, such as a button writing to the selected cell.
watch(
  stored,
  (input) => {
    if (!editing.value) draft.value = input;
  },
  { immediate: true },
);

watch(shown, (position) => {
  if (editing.value && !position) {
    editing.value = null;
    draft.value = "";
    store.notice = {
      kind: "error",
      text: "The row or column being edited was deleted. Your text was not saved.",
    };
  }
});

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

/** Saves what was typed to the cell being edited. */
function commit(): void {
  const target = editing.value;
  if (!target || !store.tables.some((table) => table.id === target.tableId)) return;
  const position = store.positionOf(target);
  if (!position || draft.value !== store.inputOf(position))
    void store.setIdentifiedCell(target, draft.value);
}

/** Saves, and moves on to the cell below, as Enter in a cell does. */
function finish(): void {
  commit();
  const target = editing.value && store.positionOf(editing.value);
  const table = store.tables.find((candidate) => candidate.id === target?.tableId);
  if (target && table) {
    store.selection = { ...target, row: Math.min(target.row + 1, table.rowCount - 1) };
    // Until the grid takes the keyboard, the field edits the cell now selected.
    editing.value = store.identityOf(store.selection) ?? null;
    draft.value = stored.value;
  }
  store.focusGrid();
}

function cancel(): void {
  draft.value = stored.value;
  store.focusGrid();
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
  if (event.key === "Enter") finish();
  else if (event.key === "Escape") cancel();
  else return;
  event.preventDefault();
}

function onFocus(): void {
  focused.value = true;
  editing.value = store.selection ? (store.identityOf(store.selection) ?? null) : null;
}

function onBlur(): void {
  focused.value = false;
  commit();
  editing.value = null;
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
