<script setup lang="ts">
import {
  cellKey,
  columnLabel,
  formatAddress,
  type CellAddress,
  type CellId,
} from "@spreadsheet-app/engine";
import { LIMITS } from "@spreadsheet-app/shared";
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  watch,
  type ComponentPublicInstance,
} from "vue";
import type { TableRecord } from "../api/client";
import { useWorkbookStore } from "../stores/workbook";
import { contains, fillTarget, type Block } from "../formula/fill";
import { useFormulaAssist } from "../formula/useFormulaAssist";
import CellView from "./CellView.vue";
import FormulaAssist from "./FormulaAssist.vue";

const props = defineProps<{ table: TableRecord }>();
const store = useWorkbookStore();

const grid = ref<HTMLElement>();
/** The text being typed into the selected cell, or `null` when not editing. */
const draft = ref<string | null>(null);

/** The input of the cell being edited, while there is one. */
const editor = shallowRef<HTMLInputElement>();
const assist = useFormulaAssist(
  draft,
  () => editor.value,
  () => props.table.id,
);

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

/** The selected cells, when the selection is in this table. */
const block = computed(() => (selected.value ? store.selectedBlock : null));

function inBlock(row: number, col: number): boolean {
  return block.value !== null && contains(block.value, { row, col });
}

function select(row: number, col: number): void {
  // Clicking the cell being edited keeps the edit. Clicking it as part of a range selects it alone.
  if (isSelected(row, col) && store.selectionEnd === null) return;
  commit();
  store.selection = cell(row, col);
}

/** Keeps a position inside the table. */
function clamp({ row, col }: CellAddress): CellAddress {
  return {
    row: Math.min(Math.max(row, 0), props.table.rowCount - 1),
    col: Math.min(Math.max(col, 0), props.table.colCount - 1),
  };
}

function move(rows: number, cols: number): void {
  const from = selected.value;
  if (!from) return;
  const next = clamp({ row: from.row + rows, col: from.col + cols });
  store.selection = cell(next.row, next.col);
}

/** Grows or shrinks the selected range by moving its far corner. */
function extend(rows: number, cols: number): void {
  const corner = store.selectionEnd ?? selected.value;
  if (corner) store.extendSelection(clamp({ row: corner.row + rows, col: corner.col + cols }));
}

/** What a mouse drag in the grid is doing: selecting a range, or filling from the fill handle. */
const drag = ref<{ kind: "select" } | { kind: "fill"; source: Block } | null>(null);
/** The cells a fill in progress would cover. */
const fillPreview = ref<Block | null>(null);

function inFillPreview(row: number, col: number): boolean {
  return fillPreview.value !== null && contains(fillPreview.value, { row, col });
}

function isHandleCell(row: number, col: number): boolean {
  return block.value?.endRow === row && block.value.endCol === col;
}

function onCellMousedown(event: MouseEvent, row: number, col: number): void {
  if (event.button !== 0) return;
  if (event.shiftKey && selected.value) {
    commit();
    store.extendSelection({ row, col });
  } else {
    select(row, col);
  }
  drag.value = { kind: "select" };
  window.addEventListener("mouseup", endDrag, { once: true });
}

function onCellMouseenter(row: number, col: number): void {
  if (drag.value?.kind === "select") store.extendSelection({ row, col });
  else if (drag.value?.kind === "fill")
    fillPreview.value = fillTarget(drag.value.source, { row, col });
}

function startFill(): void {
  if (!block.value) return;
  drag.value = { kind: "fill", source: block.value };
  fillPreview.value = block.value;
  window.addEventListener("mouseup", endDrag, { once: true });
}

function endDrag(): void {
  const finished = drag.value;
  const target = fillPreview.value;
  drag.value = null;
  fillPreview.value = null;
  if (finished?.kind !== "fill" || !target) return;
  void store.fill(props.table.id, finished.source, target);
  // Leave the filled cells selected, so the fill can be continued or undone by hand.
  store.selection = cell(target.startRow, target.startCol);
  store.extendSelection({ row: target.endRow, col: target.endCol });
}

/** Copies the first row of the selection down, or its first column across. */
function fillSelection(direction: "down" | "right"): void {
  const whole = block.value;
  if (!whole || !store.canEdit) return;
  const source =
    direction === "down"
      ? { ...whole, endRow: whole.startRow }
      : { ...whole, endCol: whole.startCol };
  void store.fill(props.table.id, source, whole);
}

/** Whether the keyboard is in this grid and not in a cell being edited. */
function hasGridFocus(): boolean {
  return draft.value === null && document.activeElement === grid.value;
}

// Clipboard events go to the document unless an editable element has focus,
// so they are caught there and handled by the grid that has focus.
function onCopy(event: ClipboardEvent): void {
  if (!hasGridFocus() || !block.value) return;
  event.clipboardData?.setData("text/plain", store.copySelection());
  event.preventDefault();
  if (event.type === "cut") void store.clearSelection();
}

function onPaste(event: ClipboardEvent): void {
  const text = event.clipboardData?.getData("text/plain");
  if (!hasGridFocus() || !selected.value || text === undefined) return;
  event.preventDefault();
  void store.paste(text);
}

onMounted(() => {
  document.addEventListener("copy", onCopy);
  document.addEventListener("cut", onCopy);
  document.addEventListener("paste", onPaste);
});
onBeforeUnmount(() => {
  document.removeEventListener("copy", onCopy);
  document.removeEventListener("cut", onCopy);
  document.removeEventListener("paste", onPaste);
  window.removeEventListener("mouseup", endDrag);
});

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
  // While editing, keys belong to the editor input. A checkbox or dropdown in
  // a cell also keeps its own keys, such as the arrows that change a choice.
  const inControl =
    event.target instanceof HTMLSelectElement || event.target instanceof HTMLInputElement;
  if (draft.value !== null || !selected.value || inControl) return;
  const { key } = event;
  const step = MOVES[key];
  const command = event.ctrlKey || event.metaKey;
  if (step && event.shiftKey) extend(...step);
  else if (step) move(...step);
  else if (key === "Tab") move(0, event.shiftKey ? -1 : 1);
  else if (key === "Enter" || key === "F2") edit();
  else if (key === "Delete" || key === "Backspace") void store.clearSelection();
  else if (command && key.toLowerCase() === "d") fillSelection("down");
  else if (command && key.toLowerCase() === "r") fillSelection("right");
  else if (key.length === 1 && !command && !event.altKey) {
    // Typing replaces the cell's content, starting with the typed character.
    edit(key);
  } else return;
  event.preventDefault();
}

function onEditorKeydown(event: KeyboardEvent): void {
  // An open suggestion list takes the arrows, Tab, and Escape first.
  if (assist.onKeydown(event)) return;
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
  editor.value = element instanceof HTMLInputElement ? element : undefined;
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
            :class="{
              'grid__cell--selected': isSelected(row - 1, col - 1),
              'grid__cell--in-range': inBlock(row - 1, col - 1),
              'grid__cell--fill-preview': inFillPreview(row - 1, col - 1),
              'grid__cell--filled': store.filledBy(cell(row - 1, col - 1)) !== undefined,
            }"
            @mousedown="onCellMousedown($event, row - 1, col - 1)"
            @mouseenter="onCellMouseenter(row - 1, col - 1)"
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
              @input="assist.track"
              @keyup="assist.track"
              @click="assist.track"
              @blur="commit"
            />
            <CellView
              v-else
              :value="store.valueOf(cell(row - 1, col - 1))"
              :running="store.running.has(cellKey(cell(row - 1, col - 1)))"
              :can-run="store.canEdit"
              @run="run(row - 1, col - 1)"
              @choose="store.input(cell(row - 1, col - 1), $event)"
            />
            <span
              v-if="store.canEdit && draft === null && isHandleCell(row - 1, col - 1)"
              class="grid__fill-handle"
              title="Drag to fill"
              @mousedown.stop.prevent="startFill"
            ></span>
          </td>
        </tr>
      </tbody>
    </table>
    <FormulaAssist
      v-if="draft !== null"
      :items="assist.suggestions.value.items"
      :active="assist.active.value"
      :signature="assist.signature.value"
      :anchor="editor"
      @pick="assist.accept($event)"
    />
  </div>
</template>
