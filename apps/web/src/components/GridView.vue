<script setup lang="ts">
import {
  columnLabel,
  literalInput,
  formatAddress,
  isError,
  type CellAddress,
  type CellId,
  type ColumnDefinition,
} from "@spreadsheet-app/engine";
import { GRID_SIZE, LIMITS } from "@spreadsheet-app/shared";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { ComponentPublicInstance } from "vue";
import type { TableRecord } from "../api/client";
import { useWorkbookStore } from "../stores/workbook";
import { useFormulaSessionStore } from "../formula/session";
import { cellStyle } from "../formatStyle";
import { contains, fillTarget, type GridRange } from "../formula/fill";
import type { MenuScope } from "./menu";
import { cellEditingRequest, editingLabel } from "../formula/cells";
import { namingContext } from "../formula/context";
import { referenceHighlights, referenceOutlines } from "../formula/references";
import SessionFormulaField from "./SessionFormulaField.vue";
import CellView from "./CellView.vue";
import EditableName from "./EditableName.vue";

const props = defineProps<{ table: TableRecord }>();
/**
 * Asks for the menu of row, column, and cell actions at a place on screen.
 * `scope` is what the menu was asked for: the selected cells, or the selected
 * rows or columns when it was asked for from one of their headers.
 */
const emit = defineEmits<{ menu: [at: { x: number; y: number; scope: MenuScope }] }>();
const store = useWorkbookStore();

const grid = ref<HTMLElement>();
const sessions = useFormulaSessionStore();
const active = computed(() =>
  sessions.active &&
  "tableId" in sessions.active.target &&
  sessions.active.target.tableId === props.table.id
    ? sessions.active
    : undefined,
);
const editingPosition = computed(() => {
  const session = active.value;
  if (!session) return undefined;
  const target = session.target;
  if (target.kind === "cell") return store.positionOf(target);
  if (target.kind === "append")
    return { row: props.table.rowCount, col: props.table.colIds.indexOf(target.colId) };
  if (target.kind === "column")
    return {
      row: session.context.rowId
        ? props.table.rows.findIndex((row) => row.id === session.context.rowId)
        : props.table.rowCount,
      col: props.table.colIds.indexOf(target.colId),
    };
  return undefined;
});
const draft = computed(() =>
  editingPosition.value ? (active.value?.state.doc.toString() ?? null) : null,
);
const cellField = ref<InstanceType<typeof SessionFormulaField> | null>();
function captureField(field: Element | ComponentPublicInstance | null): void {
  cellField.value = field as InstanceType<typeof SessionFormulaField> | null;
}
function isEditing(place: number, col: number): boolean {
  const position = editingPosition.value;
  return !!position && position.row === storedRow(place) && position.col === col;
}
/**
 * The rows the table shows, in the order it shows them. A row is addressed by
 * its place here, and by its stored row everywhere else: the selection, the
 * cell addresses, and the formulas that name it.
 */
const view = computed(() => store.rowView(props.table.id));
const outlines = computed(() => {
  const session = sessions.active;
  if (!session) return new Map<string, { boxShadow: string; color: string }>();
  return referenceOutlines(
    referenceHighlights(
      session.state.doc.toString(),
      session.mode,
      session.state.selection.main.head,
      namingContext(session.context),
    ),
    props.table.id,
    view.value.rows,
    props.table.colCount,
  );
});
const shownRows = computed(() => view.value.rows.length);
const displayedRows = computed(
  () => shownRows.value + (props.table.columns && props.table.rowCount < LIMITS.tableRows ? 1 : 0),
);

function storedRow(place: number): number {
  return view.value.storedRow(place);
}

function placeOf(row: number): number {
  return view.value.place(row) ?? row;
}

/** A cell at a place and a column, named by the stored row it shows. */
function cellAt(place: number, col: number): CellId {
  return cell(storedRow(place), col);
}

/** A place and column as the stored address the store's selection names. */
function stored({ row, col }: CellAddress): CellAddress {
  return { row: storedRow(row), col };
}
const selected = computed(() =>
  store.selection?.tableId === props.table.id ? store.selection : null,
);

function cell(row: number, col: number): CellId {
  return { tableId: props.table.id, row, col };
}

/** The smallest permitted table size that includes this error's array result. */
function spillResizeTo(id: CellId): { rowCount: number; colCount: number } | undefined {
  const value = store.valueOf(id);
  const table = store.tables.find((candidate) => candidate.id === id.tableId);
  if (
    !table ||
    !isError(value) ||
    value.spill?.reason !== "table-size" ||
    value.spill.tableId !== id.tableId
  )
    return undefined;
  const size = {
    rowCount: Math.max(table.rowCount, value.spill.requiredRowCount),
    colCount: Math.max(table.colCount, value.spill.requiredColumnCount),
  };
  return store.canResizeTableTo(id.tableId, size) ? size : undefined;
}

function resizeForSpill(size: { rowCount: number; colCount: number }): void {
  focusGrid();
  void store.resizeTableTo(props.table.id, size);
}

function isSelected(place: number, col: number): boolean {
  return selected.value?.row === storedRow(place) && selected.value.col === col;
}

/** The selected cell as a place. */
const selectedPlace = computed<CellAddress | null>(() =>
  selected.value ? { row: placeOf(selected.value.row), col: selected.value.col } : null,
);

/** The selected cells, when the selection is in this table. */
const range = computed(() => (selected.value ? store.selectedRange : null));

function inRange(place: number, col: number): boolean {
  return range.value !== null && contains(range.value, { row: place, col });
}

function select(place: number, col: number): void {
  store.resetTabTraversal();
  // Clicking the cell being edited keeps the edit. Clicking it as part of a range selects it alone.
  if (isSelected(place, col) && store.selectionEnd === null) return;
  const target = cellAt(place, col);
  store.selection = target;
}

/** The definition of a column, when the table has named columns. */
function columnAt(col: number): ColumnDefinition | undefined {
  return props.table.columns?.[col];
}

type Axis = "row" | "col";

const resizeDrag = ref<{
  axis: Axis;
  id: string;
  pointerId: number;
  handle: HTMLElement;
  start: number;
  original: number;
  size: number;
} | null>(null);

function lineId(axis: Axis, index: number): string | undefined {
  return axis === "row" ? props.table.rows[storedRow(index)]?.id : props.table.colIds[index];
}

function lineSize(axis: Axis, index: number): number {
  const id = lineId(axis, index);
  if (resizeDrag.value?.axis === axis && resizeDrag.value.id === id) return resizeDrag.value.size;
  const sizes = axis === "row" ? props.table.gridSizes.rows : props.table.gridSizes.columns;
  return (id === undefined ? undefined : sizes[id]) ?? GRID_SIZE[axis].default;
}

const tableWidth = computed(
  () => 52 + props.table.colIds.reduce((sum, _, col) => sum + lineSize("col", col), 0),
);

function startResize(event: PointerEvent, axis: Axis, index: number): void {
  if (!store.canEdit || !event.isPrimary || event.button !== 0 || resizeDrag.value) return;
  const id = lineId(axis, index);
  if (!id) return;
  const handle = event.currentTarget;
  if (!(handle instanceof HTMLElement)) return;
  const original = lineSize(axis, index);
  resizeDrag.value = {
    axis,
    id,
    pointerId: event.pointerId,
    handle,
    start: axis === "row" ? event.clientY : event.clientX,
    original,
    size: original,
  };
  handle.setPointerCapture(event.pointerId);
  handle.addEventListener("lostpointercapture", stopResize);
  window.addEventListener("pointermove", moveResize);
  window.addEventListener("pointerup", finishResize);
  window.addEventListener("pointercancel", cancelResizePointer);
  window.addEventListener("keydown", cancelResize);
  window.addEventListener("blur", stopResize);
}

function moveResize(event: PointerEvent): void {
  const drag = resizeDrag.value;
  if (drag?.pointerId !== event.pointerId) return;
  const position = drag.axis === "row" ? event.clientY : event.clientX;
  const limits = GRID_SIZE[drag.axis];
  drag.size = Math.round(
    Math.max(limits.min, Math.min(limits.max, drag.original + position - drag.start)),
  );
}

function stopResize(): void {
  const drag = resizeDrag.value;
  resizeDrag.value = null;
  window.removeEventListener("pointermove", moveResize);
  window.removeEventListener("pointerup", finishResize);
  window.removeEventListener("pointercancel", cancelResizePointer);
  window.removeEventListener("keydown", cancelResize);
  window.removeEventListener("blur", stopResize);
  if (drag) drag.handle.removeEventListener("lostpointercapture", stopResize);
  if (drag?.handle.hasPointerCapture(drag.pointerId))
    drag.handle.releasePointerCapture(drag.pointerId);
}

function finishResize(event: PointerEvent): void {
  const drag = resizeDrag.value;
  if (drag?.pointerId !== event.pointerId) return;
  if (drag.size !== drag.original)
    void store.resizeLines(props.table.id, drag.axis, [drag.id], drag.size);
  stopResize();
}

function cancelResizePointer(event: PointerEvent): void {
  if (resizeDrag.value?.pointerId === event.pointerId) stopResize();
}

function cancelResize(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    event.preventDefault();
    stopResize();
  }
}

function resetSize(axis: Axis, index: number): void {
  const id = lineId(axis, index);
  if (id) void store.resizeLines(props.table.id, axis, [id], null);
}

/** A press on a column header selects the column, unless it is in the box where the column is being renamed. */
function onColumnMousedown(event: MouseEvent, col: number): void {
  if (event.target instanceof HTMLInputElement) return;
  event.preventDefault();
  void onHeaderMousedown(event, "col", col);
}

/**
 * A press on a header selects its row or column, and a drag from there
 * selects the rows or columns it crosses. With Shift, the press selects from
 * the selected cell's row or column to this one.
 */
async function onHeaderMousedown(event: MouseEvent, axis: Axis, index: number): Promise<void> {
  if (event.button !== 0) return;
  const sessions = useFormulaSessionStore();
  if (sessions.active) {
    event.preventDefault();
    const id = lineId(axis, index);
    if (!(await sessions.submit(store.submitFormulaDraft))) {
      sessions.focus();
      return;
    }
    const storedIndex =
      axis === "row"
        ? props.table.rows.findIndex((row) => row.id === id)
        : props.table.colIds.findIndex((colId) => colId === id);
    const place = axis === "row" ? view.value.place(storedIndex) : storedIndex;
    if (place !== undefined && place >= 0) selectLines(axis, place, place);
    return;
  }
  const from = event.shiftKey && selectedPlace.value ? selectedPlace.value[axis] : index;
  selectLines(axis, from, index);
  drag.value = { kind: "lines", axis, from };
  window.addEventListener("mouseup", endDrag, { once: true });
}

function onHeaderMouseenter(axis: Axis, index: number): void {
  if (drag.value?.kind === "lines" && drag.value.axis === axis) {
    selectLines(axis, drag.value.from, index);
  }
}

/** Selects whole rows or columns: every one from `from` to `to`. */
function selectLines(axis: Axis, from: number, to: number): void {
  store.resetTabTraversal();
  const last = { row: Math.max(0, shownRows.value - 1), col: props.table.colCount - 1 };
  const anchor = axis === "row" ? cellAt(from, 0) : cellAt(0, from);
  const end = stored(axis === "row" ? { row: to, col: last.col } : { row: last.row, col: to });
  store.selection = anchor;
  store.extendSelection(end);
  focusGrid();
}

/** Whether a row or column is selected whole, alone or among others. */
function isLineSelected(axis: Axis, index: number): boolean {
  const rowCount = shownRows.value;
  const { colCount } = props.table;
  const whole = range.value;
  if (!whole) return false;
  return axis === "row"
    ? whole.startCol === 0 &&
        whole.endCol === colCount - 1 &&
        contains(whole, { row: index, col: 0 })
    : whole.startRow === 0 &&
        whole.endRow === rowCount - 1 &&
        contains(whole, { row: 0, col: index });
}

function selectAll(): void {
  store.resetTabTraversal();
  store.selection = cellAt(0, 0);
  store.extendSelection(
    stored({ row: Math.max(0, shownRows.value - 1), col: props.table.colCount - 1 }),
  );
}

/**
 * Opens the menu for a right-clicked cell. A cell outside the selection is
 * selected first, so the menu acts on what was clicked. A viewer gets the
 * browser's own menu.
 */
async function onCellContextMenu(event: MouseEvent, row: number, col: number): Promise<void> {
  if (!store.canEdit) return;
  event.preventDefault();
  const sessions = useFormulaSessionStore();
  if (
    sessions.active?.target.kind === "column" &&
    sessions.active.target.tableId === props.table.id &&
    sessions.active.target.colId === props.table.colIds[col]
  ) {
    emit("menu", { x: event.clientX, y: event.clientY, scope: "cells" });
    return;
  }
  if (sessions.active) {
    const target = store.identityOf(cellAt(row, col));
    if (!(await sessions.submit(store.submitFormulaDraft))) {
      sessions.focus();
      return;
    }
    const position = target && store.positionOf(target);
    const place = position && view.value.place(position.row);
    if (!position || place === undefined) return;
    row = place;
    col = position.col;
  }
  if (!inRange(row, col)) select(row, col);
  focusGrid();
  emit("menu", { x: event.clientX, y: event.clientY, scope: "cells" });
}

/**
 * Opens the menu for a right-clicked header. A row or column outside the
 * rows or columns selected whole is selected first.
 */
async function onHeaderContextMenu(event: MouseEvent, axis: Axis, index: number): Promise<void> {
  if (!store.canEdit) return;
  event.preventDefault();
  const sessions = useFormulaSessionStore();
  if (
    axis === "col" &&
    sessions.active?.target.kind === "column" &&
    sessions.active.target.tableId === props.table.id &&
    sessions.active.target.colId === props.table.colIds[index]
  ) {
    emit("menu", { x: event.clientX, y: event.clientY, scope: axis });
    return;
  }
  if (sessions.active) {
    const id = lineId(axis, index);
    if (!(await sessions.submit(store.submitFormulaDraft))) {
      sessions.focus();
      return;
    }
    const storedIndex =
      axis === "row"
        ? props.table.rows.findIndex((row) => row.id === id)
        : props.table.colIds.findIndex((colId) => colId === id);
    const place = axis === "row" ? view.value.place(storedIndex) : storedIndex;
    if (place === undefined || place < 0) return;
    index = place;
  }
  if (!isLineSelected(axis, index)) selectLines(axis, index, index);
  emit("menu", { x: event.clientX, y: event.clientY, scope: axis });
}

/** Opens the menu from the keyboard, under the selected cell. */
function openMenuAtSelection(): void {
  if (!store.canEdit || !selected.value) return;
  const box = grid.value
    ?.querySelector(`[data-cell="${formatAddress(selected.value)}"]`)
    ?.getBoundingClientRect();
  if (box) emit("menu", { x: box.left, y: box.bottom, scope: "cells" });
}

/** Keeps a position inside the table. */
function clamp({ row, col }: CellAddress): CellAddress {
  return {
    row: Math.min(Math.max(row, 0), displayedRows.value - 1),
    col: Math.min(Math.max(col, 0), props.table.colCount - 1),
  };
}

function move(rows: number, cols: number): void {
  store.resetTabTraversal();
  const from = selectedPlace.value;
  if (!from) return;
  const next = clamp({ row: from.row + rows, col: from.col + cols });
  store.selection = cellAt(next.row, next.col);
}

/** Grows or shrinks the selected range by moving its far corner. */
function extend(rows: number, cols: number): void {
  store.resetTabTraversal();
  const end = store.selectionEnd;
  const corner = end ? { row: placeOf(end.row), col: end.col } : selectedPlace.value;
  if (corner) {
    store.extendSelection(stored(clamp({ row: corner.row + rows, col: corner.col + cols })));
  }
}

/**
 * What a mouse drag in the grid is doing: selecting a range, selecting whole
 * rows or columns from the header where it began, or filling from the fill handle.
 */
const drag = ref<
  | { kind: "select" }
  | { kind: "lines"; axis: Axis; from: number }
  | { kind: "fill"; source: GridRange }
  | null
>(null);
/** The cells a fill in progress would cover. */
const fillPreview = ref<GridRange | null>(null);

function inFillPreview(place: number, col: number): boolean {
  return fillPreview.value !== null && contains(fillPreview.value, { row: place, col });
}

function isHandleCell(place: number, col: number): boolean {
  return range.value?.endRow === place && range.value.endCol === col;
}

/**
 * A tap on the cell that is already selected starts editing it. A phone has
 * no Enter key to press until an input has focus and the keyboard is up.
 */
let tapOnSelected = false;

function onCellPointerdown(event: PointerEvent, place: number, col: number): void {
  tapOnSelected =
    event.pointerType === "touch" && isSelected(place, col) && store.selectionEnd === null;
}

function onCellClick(): void {
  if (tapOnSelected && draft.value === null) void edit();
  tapOnSelected = false;
}

async function onCellMousedown(event: MouseEvent, place: number, col: number): Promise<void> {
  if (event.button !== 0) return;
  const sessions = useFormulaSessionStore();
  if (sessions.active) {
    event.preventDefault();
    if (isEditing(place, col)) {
      await cellField.value?.begin();
      return;
    }
    const clicked = cellAt(place, col);
    const target = store.identityOf(clicked);
    if (!(await sessions.submit(store.submitFormulaDraft))) {
      sessions.focus();
      return;
    }
    const position = target && store.positionOf(target);
    if (!position && clicked.row === props.table.rowCount && props.table.columns) {
      store.selection = clicked;
      focusGrid();
    }
    if (position) {
      store.selectionEnd = null;
      store.selection = position;
      focusGrid();
    }
    return;
  }
  store.resetTabTraversal();
  if (event.shiftKey && selected.value) {
    const end = stored({ row: place, col });
    store.extendSelection(end);
  } else {
    select(place, col);
  }
  focusGrid();
  drag.value = { kind: "select" };
  window.addEventListener("mouseup", endDrag, { once: true });
}

function onCellMouseenter(place: number, col: number): void {
  if (drag.value?.kind === "select") store.extendSelection(stored({ row: place, col }));
  // A drag that began on a header and strays into the cells still selects whole rows or columns.
  else if (drag.value?.kind === "lines")
    onHeaderMouseenter(drag.value.axis, { row: place, col }[drag.value.axis]);
  else if (drag.value?.kind === "fill")
    fillPreview.value = fillTarget(drag.value.source, { row: place, col });
}

function startFill(): void {
  if (!range.value) return;
  drag.value = { kind: "fill", source: range.value };
  fillPreview.value = range.value;
  window.addEventListener("mouseup", endDrag, { once: true });
}

function endDrag(): void {
  const finished = drag.value;
  const target = fillPreview.value;
  drag.value = null;
  fillPreview.value = null;
  if (finished?.kind !== "fill" || !target) return;
  // Dragging continues a series such as 1, 2. Ctrl+D and Ctrl+R copy exactly.
  void store.fill(props.table.id, finished.source, target, true);
  // Leave the filled cells selected, so the fill can be continued or undone by hand.
  store.selection = cellAt(target.startRow, target.startCol);
  store.extendSelection(stored({ row: target.endRow, col: target.endCol }));
}

/** Copies the first row of the selection down, or its first column across. */
function fillSelection(direction: "down" | "right"): void {
  const whole = range.value;
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
  if (!hasGridFocus() || !range.value) return;
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
  stopResize();
  document.removeEventListener("copy", onCopy);
  document.removeEventListener("cut", onCopy);
  document.removeEventListener("paste", onPaste);
  window.removeEventListener("mouseup", endDrag);
});

async function edit(initial?: string): Promise<void> {
  if (!store.canEdit || !selected.value) return;
  const request = cellEditingRequest(selected.value, initial);
  if (!request) return;
  if (!(await sessions.start(request, store.submitFormulaDraft))) {
    sessions.focus();
    return;
  }
  await nextTick();
  await cellField.value?.begin();
}
watch(
  () => props.table.rowCount,
  () => {
    const target = active.value?.target;
    if (target?.kind !== "append") return;
    const col = props.table.colIds.indexOf(target.colId);
    if (col >= 0) store.selection = cell(props.table.rowCount, col);
  },
);

// Focusing must not scroll: the grid can be taller than the window, and
// scrolling it into view would move the cell being worked on.
function focusGrid(): void {
  grid.value?.focus({ preventScroll: true });
}

/** Focuses the resize action for a selected table-size spill error. */
function focusSpillResizeAction(): boolean {
  if (!selected.value) return false;
  const cellElement = grid.value?.querySelector<HTMLElement>(
    `[data-cell="${formatAddress(selected.value)}"]`,
  );
  const error = cellElement?.querySelector<HTMLElement>(
    '.cell-value--error[aria-haspopup="dialog"]',
  );
  if (!error) return false;
  error.focus({ preventScroll: true });
  void nextTick(() => {
    const popoverId = error.getAttribute("aria-controls");
    if (!popoverId) return;
    document
      .getElementById(popoverId)
      ?.querySelector<HTMLButtonElement>(".cell-error-popover__action")
      ?.focus({ preventScroll: true });
  });
  return true;
}

// The formula bar hands the keyboard back when it is done with the selected cell.
watch(
  () => store.gridFocusRequests,
  () => {
    if (selected.value) {
      focusGrid();
      scrollSelection();
    }
  },
);

// Keep the selected cell in view when the keyboard moves it past the visible part of the table.
watch(selected, async (current, previous) => {
  if (!current) {
    return;
  }
  if (
    current.tableId === previous?.tableId &&
    current.row === previous.row &&
    current.col === previous.col
  )
    return;
  await nextTick();
  if (selected.value !== current || !hasGridFocus()) return;
  scrollSelection();
});

function scrollSelection(): void {
  if (!selected.value) return;
  grid.value
    ?.querySelector(`[data-cell="${formatAddress(selected.value)}"]`)
    ?.scrollIntoView({ block: "nearest", inline: "nearest" });
}

/**
 * Runs the button in a cell. A running button is disabled, and a disabled
 * element drops keyboard focus, so focus moves to the grid first.
 */
function run(place: number, col: number): void {
  focusGrid();
  void store.click(cellAt(place, col));
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
  if (key === "Enter" && event.altKey && !command && focusSpillResizeAction())
    event.preventDefault();
  else if (step && event.shiftKey) extend(...step);
  else if (step) move(...step);
  else if (key === "Tab") store.prepareCellMove("Tab", event.shiftKey)();
  else if (key === "Enter" || key === "F2") void edit();
  else if (key === "Delete" || key === "Backspace") void store.clearSelection();
  else if (key === "ContextMenu" || (key === "F10" && event.shiftKey)) openMenuAtSelection();
  else if (command && key.toLowerCase() === "a") selectAll();
  else if (command && key.toLowerCase() === "z" && !event.shiftKey) void store.undo();
  else if (command && (key.toLowerCase() === "y" || key.toLowerCase() === "z")) void store.redo();
  else if (command && key.toLowerCase() === "d") fillSelection("down");
  else if (command && key.toLowerCase() === "r") fillSelection("right");
  else if (key.length === 1 && !command && !event.altKey) {
    // Typing replaces the cell's content, starting with the typed character.
    void edit(key);
  } else return;
  event.preventDefault();
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
    <table :style="{ width: `${tableWidth}px` }">
      <colgroup>
        <col style="width: 52px" />
        <col
          v-for="(id, col) in table.colIds"
          :key="id"
          :style="{ width: `${lineSize('col', col)}px` }"
        />
      </colgroup>
      <thead>
        <tr>
          <th class="grid__corner"></th>
          <th
            v-for="col in table.colCount"
            :key="table.colIds[col - 1]"
            scope="col"
            :class="{
              'grid__column--named': columnAt(col - 1),
              'grid__header--selected': isLineSelected('col', col - 1),
            }"
            :data-column="columnAt(col - 1)?.name"
            @mousedown.left="onColumnMousedown($event, col - 1)"
            @mouseenter="onHeaderMouseenter('col', col - 1)"
            @contextmenu="onHeaderContextMenu($event, 'col', col - 1)"
          >
            <template v-if="columnAt(col - 1)">
              <span class="grid__column-letter">{{ columnLabel(col - 1) }}</span>
              <EditableName
                :value="columnAt(col - 1)?.name ?? ''"
                label="Column name"
                :disabled="!store.canEdit"
                @rename="store.updateColumn(table.id, col - 1, { name: $event })"
              />
              <span v-if="columnAt(col - 1)?.type !== 'any'" class="grid__column-type">
                {{ columnAt(col - 1)?.type }}
              </span>
            </template>
            <template v-else>{{ columnLabel(col - 1) }}</template>
            <span
              v-if="store.canEdit"
              class="grid__resize grid__resize--col"
              :aria-label="`Resize column ${columnLabel(col - 1)}`"
              @pointerdown.stop.prevent="startResize($event, 'col', col - 1)"
              @dblclick.stop.prevent="resetSize('col', col - 1)"
            ></span>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="row in displayedRows"
          :key="table.rows[storedRow(row - 1)]?.id ?? 'new'"
          role="row"
          :style="{ '--row-height': `${lineSize('row', row - 1)}px` }"
        >
          <th
            scope="row"
            :class="{ 'grid__header--selected': isLineSelected('row', row - 1) }"
            @mousedown.left.prevent="onHeaderMousedown($event, 'row', row - 1)"
            @mouseenter="onHeaderMouseenter('row', row - 1)"
            @contextmenu="onHeaderContextMenu($event, 'row', row - 1)"
          >
            {{ row > shownRows ? "+" : storedRow(row - 1) + 1 }}
            <span
              v-if="store.canEdit && row <= shownRows"
              class="grid__resize grid__resize--row"
              :aria-label="`Resize row ${storedRow(row - 1) + 1}`"
              @pointerdown.stop.prevent="startResize($event, 'row', row - 1)"
              @dblclick.stop.prevent="resetSize('row', row - 1)"
            ></span>
          </th>
          <td
            v-for="col in table.colCount"
            :key="table.colIds[col - 1]"
            role="gridcell"
            :data-cell="formatAddress({ row: storedRow(row - 1), col: col - 1 })"
            :aria-selected="isSelected(row - 1, col - 1)"
            :class="{
              'grid__cell--selected': isSelected(row - 1, col - 1),
              'grid__cell--in-range': inRange(row - 1, col - 1),
              'grid__cell--fill-preview': inFillPreview(row - 1, col - 1),
              'grid__cell--filled': store.filledBy(cellAt(row - 1, col - 1)) !== undefined,
              'grid__cell--computed': columnAt(col - 1)?.type === 'formula',
            }"
            :style="[
              cellStyle(store.formatOf(cellAt(row - 1, col - 1))),
              { boxShadow: outlines.get(`${row - 1}:${col - 1}`)?.boxShadow },
            ]"
            :data-reference-color="outlines.get(`${row - 1}:${col - 1}`)?.color"
            @pointerdown="onCellPointerdown($event, row - 1, col - 1)"
            @mousedown="onCellMousedown($event, row - 1, col - 1)"
            @click="onCellClick"
            @mouseenter="onCellMouseenter(row - 1, col - 1)"
            @contextmenu="onCellContextMenu($event, row - 1, col - 1)"
            @dblclick="edit()"
          >
            <SessionFormulaField
              v-if="active && isEditing(row - 1, col - 1)"
              :ref="captureField"
              class="grid__editor"
              :target="active.target"
              :context="active.context"
              :mode="active.mode"
              :value="active.state.doc.toString()"
              label="Cell content"
              :target-label="editingLabel(active.target) ?? active.label"
              :show-label="active.target.kind === 'column'"
              :readonly="!store.canEdit"
              :max-length="LIMITS.inputLength"
              cell-navigation
              @mousedown.stop
              @click.stop
            />
            <CellView
              v-else
              :value="store.valueOf(cellAt(row - 1, col - 1))"
              :spill-resize-to="spillResizeTo(cellAt(row - 1, col - 1))"
              :running="store.isRunning(cellAt(row - 1, col - 1))"
              :can-run="store.canEdit"
              :checkbox="columnAt(col - 1)?.type === 'checkbox'"
              :choices="store.choicesOf(props.table.id, col - 1)"
              :format="store.formatOf(cellAt(row - 1, col - 1))"
              @toggle="store.setCell(cellAt(row - 1, col - 1), $event ? 'TRUE' : 'FALSE')"
              @pick="store.setCell(cellAt(row - 1, col - 1), literalInput($event))"
              @run="run(row - 1, col - 1)"
              @choose="store.input(cellAt(row - 1, col - 1), $event)"
              @resize-table="resizeForSpill"
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
  </div>
</template>
