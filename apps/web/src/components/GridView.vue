<script setup lang="ts">
import { cellKey, columnLabel, formatAddress, type CellId } from "@spreadsheet-app/engine";
import { LIMITS } from "@spreadsheet-app/shared";
import { computed, nextTick, ref, watch, type ComponentPublicInstance } from "vue";
import type { TableRecord } from "../api/client";
import { useWorkbookStore } from "../stores/workbook";
import CellView from "./CellView.vue";

const props = defineProps<{ table: TableRecord }>();
const store = useWorkbookStore();

const grid = ref<HTMLElement>();
/** The text being typed into the selected cell, or `null` when not editing. */
const draft = ref<string | null>(null);

const selected = computed(() =>
  store.selection?.tableId === props.table.id ? store.selection : null,
);

function cell(row: number, col: number): CellId {
  return { tableId: props.table.id, row, col };
}

function isSelected(row: number, col: number): boolean {
  return selected.value?.row === row && selected.value.col === col;
}

function commit(): void {
  const input = draft.value;
  draft.value = null;
  if (input !== null && selected.value) void store.setCell(selected.value, input);
}

function select(row: number, col: number): void {
  if (isSelected(row, col)) return;
  commit();
  store.selection = cell(row, col);
}

function move(rows: number, cols: number): void {
  const from = selected.value;
  if (!from) return;
  const clamp = (value: number, count: number): number => Math.min(Math.max(value, 0), count - 1);
  store.selection = cell(
    clamp(from.row + rows, props.table.rowCount),
    clamp(from.col + cols, props.table.colCount),
  );
}

function edit(initial?: string): void {
  if (!store.canEdit || !selected.value) return;
  draft.value = initial ?? store.inputOf(selected.value);
}

// Focusing must not scroll: the grid can be taller than the window, and
// scrolling it into view would move the cell being worked on.
function focusGrid(): void {
  grid.value?.focus({ preventScroll: true });
}

// Keep the selected cell in view when the keyboard moves it past the visible part of the table.
watch(selected, async (current) => {
  if (!current) return;
  await nextTick();
  grid.value
    ?.querySelector(`[data-cell="${formatAddress(current)}"]`)
    ?.scrollIntoView({ block: "nearest", inline: "nearest" });
});

/**
 * Runs the button in a cell. A running button is disabled, and a disabled
 * element drops keyboard focus, so focus moves to the grid first.
 */
function run(row: number, col: number): void {
  focusGrid();
  void store.click(cell(row, col));
}

async function finish(rows: number, cols: number): Promise<void> {
  commit();
  move(rows, cols);
  await nextTick();
  focusGrid();
}

async function cancel(): Promise<void> {
  draft.value = null;
  await nextTick();
  focusGrid();
}

const MOVES: Record<string, [rows: number, cols: number]> = {
  ArrowUp: [-1, 0],
  ArrowDown: [1, 0],
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1],
};

function onGridKeydown(event: KeyboardEvent): void {
  // While editing, keys belong to the editor input.
  if (draft.value !== null || !selected.value) return;
  const { key } = event;
  const step = MOVES[key];
  if (step) move(...step);
  else if (key === "Tab") move(0, event.shiftKey ? -1 : 1);
  else if (key === "Enter" || key === "F2") edit();
  else if (key === "Delete" || key === "Backspace") {
    if (store.canEdit) void store.setCell(selected.value, "");
  } else if (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
    // Typing replaces the cell's content, starting with the typed character.
    edit(key);
  } else return;
  event.preventDefault();
}

function onEditorKeydown(event: KeyboardEvent): void {
  // Up and down save and move, as Enter does. Left and right stay with the
  // editor, where they move the caret through the text.
  if (event.key === "Enter" || event.key === "ArrowDown") void finish(1, 0);
  else if (event.key === "ArrowUp") void finish(-1, 0);
  else if (event.key === "Tab") void finish(0, event.shiftKey ? -1 : 1);
  else if (event.key === "Escape") void cancel();
  else return;
  event.preventDefault();
}

function focusEditor(element: Element | ComponentPublicInstance | null): void {
  if (element instanceof HTMLInputElement && document.activeElement !== element) {
    element.focus({ preventScroll: true });
    element.setSelectionRange(element.value.length, element.value.length);
  }
}
</script>

<template>
  <div
    ref="grid"
    class="grid"
    role="grid"
    tabindex="0"
    :aria-label="table.name"
    @keydown="onGridKeydown"
  >
    <table>
      <thead>
        <tr>
          <th class="grid__corner"></th>
          <th v-for="col in table.colCount" :key="col" scope="col">{{ columnLabel(col - 1) }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in table.rowCount" :key="row" role="row">
          <th scope="row">{{ row }}</th>
          <td
            v-for="col in table.colCount"
            :key="col"
            role="gridcell"
            :data-cell="formatAddress({ row: row - 1, col: col - 1 })"
            :aria-selected="isSelected(row - 1, col - 1)"
            :class="{ 'grid__cell--selected': isSelected(row - 1, col - 1) }"
            @mousedown="select(row - 1, col - 1)"
            @dblclick="edit()"
          >
            <input
              v-if="draft !== null && isSelected(row - 1, col - 1)"
              :ref="focusEditor"
              v-model="draft"
              class="grid__editor"
              aria-label="Cell content"
              :maxlength="LIMITS.inputLength"
              @keydown.stop="onEditorKeydown"
              @blur="commit"
            />
            <CellView
              v-else
              :value="store.valueOf(cell(row - 1, col - 1))"
              :running="store.running.has(cellKey(cell(row - 1, col - 1)))"
              :can-run="store.canEdit"
              @run="run(row - 1, col - 1)"
            />
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
