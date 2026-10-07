<script setup lang="ts">
import {
  columnLabel,
  literalInput,
  formatAddress,
  isControl,
  isError,
  type CellAddress,
  type CellId,
  type ColumnDefinition,
} from "@spreadsheet-app/engine";
import { GRID_SIZE, LIMITS } from "@spreadsheet-app/shared";
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onBeforeUpdate,
  onMounted,
  onUpdated,
  ref,
  watch,
} from "vue";
import type { ComponentPublicInstance } from "vue";
import type { TableRecord } from "../api/client";
import { useWorkbookStore } from "../stores/workbook";
import { useFormulaSessionStore } from "../formula/session";
import { cellStyle } from "../formatStyle";
import { contains, fillTarget, type GridRange } from "../formula/fill";
import type { MenuScope } from "./menu";
import { cellEditingRequest, editingLabel } from "../formula/cells";
import { referenceOutlines } from "../formula/references";
import { useReferencePickingStore } from "../formula/picking";
import { useGridPicking } from "../formula/useGridPicking";
import SessionFormulaField from "./SessionFormulaField.vue";
import CellView from "./CellView.vue";
import EditableName from "./EditableName.vue";
import type { ErrorTraceFrame } from "@spreadsheet-app/engine";
import { countVisibleRows, dataRegionDestination, usedRangeDestination } from "./gridNavigation";

const props = defineProps<{ table: TableRecord }>();
/**
 * Asks for the menu of row, column, and cell actions at a place on screen.
 * `scope` is what the menu was asked for: the selected cells, or the selected
 * rows or columns when it was asked for from one of their headers.
 */
const emit = defineEmits<{
  menu: [at: { x: number; y: number; scope: MenuScope }];
  trace: [trace: ErrorTraceFrame[]];
}>();
const store = useWorkbookStore();

const grid = ref<HTMLElement>();
let scrollBeforeUpdate:
  { gridTop: number; gridLeft: number; pageTop: number; pageLeft: number } | undefined;
onBeforeUpdate(() => {
  const element = grid.value;
  if (!element) return;
  scrollBeforeUpdate = {
    gridTop: element.scrollTop,
    gridLeft: element.scrollLeft,
    pageTop: window.scrollY,
    pageLeft: window.scrollX,
  };
});
onUpdated(() => {
  const previous = scrollBeforeUpdate;
  scrollBeforeUpdate = undefined;
  const element = grid.value;
  if (!previous || !element) return;

  const pageMoved = window.scrollY !== previous.pageTop || window.scrollX !== previous.pageLeft;
  const gridMoved =
    element.scrollTop !== previous.gridTop || element.scrollLeft !== previous.gridLeft;
  if (pageMoved) window.scrollTo(previous.pageLeft, previous.pageTop);
  if (gridMoved) {
    element.scrollTop = previous.gridTop;
    element.scrollLeft = previous.gridLeft;
  }
  if (pageMoved || gridMoved) updateViewport();
});
const sessions = useFormulaSessionStore();
const referencePicking = useReferencePickingStore();
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
const pendingOpeningNavigation: { key: "Enter" | "Tab"; backwards: boolean }[] = [];
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
const picking = useGridPicking(
  () => props.table,
  () => view.value.rows,
);
const outlines = computed(() => {
  return referenceOutlines(
    referencePicking.highlights,
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

/** A cell has data when it has input, a value, or a spill result. */
function isNonEmpty(at: CellAddress): boolean {
  const id = cellAt(at.row, at.col);
  return (
    store.inputOf(id) !== "" ||
    store.valueOf(id) !== null ||
    store.filledBy(id) !== undefined ||
    (columnAt(at.col)?.type === "formula" && id.row < props.table.rowCount)
  );
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

function setPendingConfirmation(id: CellId, open: boolean): void {
  if (open) {
    pendingConfirmation.value = id;
    return;
  }
  const pending = pendingConfirmation.value;
  if (pending?.tableId === id.tableId && pending.row === id.row && pending.col === id.col)
    pendingConfirmation.value = null;
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

/** The selected cells, when the selection is in this table. */
const range = computed(() => (selected.value ? store.selectedRange : null));

/** The selected cell as a place. */
const selectedPlace = computed<CellAddress | null>(() =>
  selected.value
    ? { row: range.value?.entireColumn ? 0 : placeOf(selected.value.row), col: selected.value.col }
    : null,
);

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
const CELL_VALUE_LINE_HEIGHT = 28;

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

/** The number of cell text lines that fit inside a row at the existing line height. */
function wrappedLinesForRow(index: number): number {
  return Math.max(1, Math.floor((lineSize("row", index) - 1) / CELL_VALUE_LINE_HEIGHT));
}

const tableWidth = computed(
  () => 52 + props.table.colIds.reduce((sum, _, col) => sum + lineSize("col", col), 0),
);

// Coordinates remain display places; only the DOM is windowed.
const virtual = computed(() => displayedRows.value > 200 || props.table.colCount > 30);
const viewport = ref({ top: 0, bottom: 800, left: 0, right: 1200, visible: true });
const headerHeight = ref(31);
const focused = ref<Partial<CellAddress> | null>(null);
const pendingConfirmation = ref<CellId | null>(null);
const printing = ref(false);
const rowOffsets = computed(() => offsets(displayedRows.value, "row"));
const colOffsets = computed(() => offsets(props.table.colCount, "col"));
const frozenRows = computed(() =>
  props.table.columns ? 0 : Math.min(props.table.display.freezeRows ?? 0, props.table.rowCount),
);
const frozenColumns = computed(() =>
  Math.min(props.table.display.freezeColumns ?? 0, props.table.colCount),
);
function offsets(count: number, axis: Axis): number[] {
  const result = [0];
  for (let index = 0; index < count; index++)
    result.push((result[index] ?? 0) + lineSize(axis, index));
  return result;
}
function updateViewport(): void {
  if (!grid.value) return;
  const measuredHeaderHeight = grid.value.querySelector("thead")?.getBoundingClientRect().height;
  if (measuredHeaderHeight && measuredHeaderHeight !== headerHeight.value)
    headerHeight.value = measuredHeaderHeight;
  const box = grid.value.getBoundingClientRect();
  const height = grid.value.clientHeight || grid.value.scrollHeight || window.innerHeight;
  const width = grid.value.clientWidth || grid.value.scrollWidth || window.innerWidth;
  const boxTop = Number.isFinite(box.top) ? box.top : 0;
  const boxLeft = Number.isFinite(box.left) ? box.left : 0;
  const boxBottom = Number.isFinite(box.bottom) ? box.bottom : boxTop + (box.height || height);
  const boxRight = Number.isFinite(box.right) ? box.right : boxLeft + (box.width || width);
  const verticalVisible =
    box.height > 0 || grid.value.clientHeight > 0
      ? boxBottom > 0 && boxTop < window.innerHeight
      : boxTop === 0;
  const horizontalVisible =
    box.width > 0 || grid.value.clientWidth > 0
      ? boxRight > 0 && boxLeft < window.innerWidth
      : boxLeft === 0;
  const visible = verticalVisible && horizontalVisible;
  const top = Math.max(0, Math.min(height, -boxTop));
  const bottom = Math.max(0, Math.min(height, window.innerHeight - boxTop));
  const left = Math.max(0, Math.min(width, -boxLeft));
  const right = Math.max(0, Math.min(width, window.innerWidth - boxLeft));
  const next = {
    top: grid.value.scrollTop + top - headerHeight.value,
    bottom: grid.value.scrollTop + bottom - headerHeight.value,
    left: grid.value.scrollLeft + left - 52,
    right: grid.value.scrollLeft + right - 52,
    visible,
  };
  const previous = viewport.value;
  if (
    next.top !== previous.top ||
    next.bottom !== previous.bottom ||
    next.left !== previous.left ||
    next.right !== previous.right ||
    next.visible !== previous.visible
  )
    viewport.value = next;
}
function visibleLines(axis: Axis): number[] {
  const positions = axis === "row" ? rowOffsets.value : colOffsets.value;
  const count = positions.length - 1;
  if (!virtual.value || printing.value) return Array.from({ length: count }, (_, i) => i + 1);
  const { top, bottom, left, right } = viewport.value;
  const start = axis === "row" ? top : left;
  const end = axis === "row" ? bottom : right;
  const margin = axis === "row" ? 180 : 300;
  const result = new Set<number>();
  // A table outside the page viewport needs no cells.
  if (
    viewport.value.visible &&
    bottom >= -margin &&
    top <= (rowOffsets.value[displayedRows.value] ?? 0) + margin
  ) {
    for (let i = 0; i < count; i++)
      if ((positions[i + 1] ?? 0) >= start - margin && (positions[i] ?? 0) <= end + margin)
        result.add(i + 1);
  }
  const editing = editingPosition.value;
  if (editing) result.add((axis === "row" ? placeOf(editing.row) : editing.col) + 1);
  const confirming = pendingConfirmation.value;
  if (confirming?.tableId === props.table.id)
    result.add((axis === "row" ? placeOf(confirming.row) : confirming.col) + 1);
  const focusedIndex = focused.value?.[axis];
  if (focusedIndex !== undefined) result.add(focusedIndex + 1);
  const frozen = axis === "row" ? frozenRows.value : frozenColumns.value;
  for (let index = 0; index < frozen; index += 1) result.add(index + 1);
  if (resizeDrag.value?.axis === axis) {
    for (let i = 0; i < count; i++) if (lineId(axis, i) === resizeDrag.value.id) result.add(i + 1);
  }
  return [...result].filter((i) => i > 0 && i <= count).sort((a, b) => a - b);
}
const renderedRows = computed(() => visibleLines("row"));
const renderedCols = computed(() => visibleLines("col"));

function frozenColumnStyle(col: number): Record<string, string | number> {
  return col < frozenColumns.value
    ? { left: `${String(52 + (colOffsets.value[col] ?? 0))}px`, zIndex: 5 }
    : {};
}

function frozenRowStyle(place: number): Record<string, string | number> {
  return place < frozenRows.value
    ? { top: `${String(headerHeight.value + (rowOffsets.value[place] ?? 0))}px`, zIndex: 6 }
    : {};
}

function frozenCellStyle(place: number, col: number): Record<string, string | number> {
  const rowFrozen = place < frozenRows.value;
  const colFrozen = col < frozenColumns.value;
  return {
    ...(rowFrozen ? frozenRowStyle(place) : {}),
    ...(colFrozen ? { left: `${String(52 + (colOffsets.value[col] ?? 0))}px` } : {}),
    ...(rowFrozen && colFrozen ? { zIndex: 7 } : colFrozen ? { zIndex: 3 } : {}),
  };
}
function gap(lines: number[], index: number, positions: number[]): number {
  return (
    (positions[(lines[index] ?? 1) - 1] ?? 0) -
    (positions[index ? (lines[index - 1] ?? 0) : 0] ?? 0)
  );
}
function trackFocus(event: FocusEvent): void {
  const element = (event.target as HTMLElement).closest<HTMLElement>("[data-pick-kind]");
  const kind = element?.dataset.pickKind;
  if (kind === "cells")
    focused.value = {
      row: Number(element?.dataset.pickRow),
      col: Number(element?.dataset.pickCol),
    };
  else if (kind === "col") focused.value = { col: Number(element?.dataset.pickIndex) };
  else if (kind === "row") focused.value = { row: Number(element?.dataset.pickIndex) };
  else focused.value = null;
}
function beforePrint(): void {
  printing.value = true;
}
function afterPrint(): void {
  printing.value = false;
}
let viewportObserver: ResizeObserver | undefined;
let layoutObserver: MutationObserver | undefined;
onMounted(() => {
  updateViewport();
  window.addEventListener("scroll", updateViewport, { passive: true, capture: true });
  window.addEventListener("resize", updateViewport);
  window.addEventListener("beforeprint", beforePrint);
  window.addEventListener("afterprint", afterPrint);
  // Grid size alone does not report position changes from moving blocks or
  // changing content above this table. Watch the containing editor as well.
  const layoutRoot = grid.value?.closest(".editor") ?? grid.value?.parentElement;
  if (typeof ResizeObserver !== "undefined") {
    viewportObserver = new ResizeObserver(updateViewport);
    if (grid.value) viewportObserver.observe(grid.value);
    if (layoutRoot) viewportObserver.observe(layoutRoot);
  }
  if (layoutRoot) {
    layoutObserver = new MutationObserver((records) => {
      // Ignore our window's DOM updates; other blocks may change our position.
      if (records.some((record) => !grid.value?.contains(record.target))) updateViewport();
    });
    layoutObserver.observe(layoutRoot, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["class", "style", "hidden"],
    });
  }
});
onBeforeUnmount(() => {
  viewportObserver?.disconnect();
  layoutObserver?.disconnect();
  window.removeEventListener("scroll", updateViewport, true);
  window.removeEventListener("resize", updateViewport);
  window.removeEventListener("beforeprint", beforePrint);
  window.removeEventListener("afterprint", afterPrint);
});

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
  store.extendSelection(end, axis);
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
  const wholeColumn = range.value?.entireColumn === true && rows === 0 && cols !== 0;
  const corner = wholeColumn
    ? { row: 0, col: end?.col ?? selectedPlace.value?.col ?? 0 }
    : end
      ? { row: placeOf(end.row), col: end.col }
      : selectedPlace.value;
  if (corner) {
    store.extendSelection(
      stored(clamp({ row: corner.row + rows, col: corner.col + cols })),
      wholeColumn ? "col" : undefined,
    );
    const target = store.selectionEnd;
    if (virtual.value && target)
      void nextTick(() => {
        scrollSelection(target);
      });
  }
}

/** The active corner moves when Shift extends an existing range. */
function selectionCorner(): CellAddress | null {
  if (!selected.value) return null;
  const end = store.selectionEnd;
  if (range.value?.entireColumn)
    return { row: 0, col: end?.col ?? selectedPlace.value?.col ?? selected.value.col };
  return end ? { row: placeOf(end.row), col: end.col } : selectedPlace.value;
}

/** Moves to a display place, optionally extending the current range to it. */
function navigateTo(target: CellAddress, extendRange = false, preserveWholeColumn = false): void {
  store.resetTabTraversal();
  const next = clamp(target);
  const current = selectedPlace.value;
  const scrollTarget = extendRange || (current?.row === next.row && current.col === next.col);
  if (extendRange) {
    const wholeColumn = preserveWholeColumn && range.value?.entireColumn === true;
    store.extendSelection(stored(next), wholeColumn ? "col" : undefined);
  } else store.selection = cellAt(next.row, next.col);
  if (scrollTarget)
    void nextTick(() => {
      scrollSelection(stored(next));
    });
}

function moveToEdge(key: "Home" | "End", extendRange: boolean, wholeTable: boolean): void {
  const from = extendRange ? selectionCorner() : selectedPlace.value;
  if (!from) return;
  if (wholeTable && key === "End") {
    navigateTo(
      usedRangeDestination(shownRows.value, props.table.colCount, isNonEmpty),
      extendRange,
    );
    return;
  }
  const row = wholeTable ? 0 : from.row;
  const col = key === "Home" ? 0 : props.table.colCount - 1;
  navigateTo({ row, col }, extendRange, !wholeTable);
}

function toggleFormat(property: "bold" | "italic"): void {
  const selectedRange = range.value;
  if (!selectedRange || !selected.value || !store.canEdit) return;
  const rows = view.value;
  const entireColumn = selectedRange.entireColumn === true;
  let allFormatted = true;
  const firstRow = entireColumn ? 0 : selectedRange.startRow;
  const lastRow = entireColumn ? props.table.rowCount - 1 : selectedRange.endRow;
  for (let row = firstRow; row <= lastRow; row++) {
    const stored = entireColumn ? row : rows.storedRow(row);
    for (let col = selectedRange.startCol; col <= selectedRange.endCol; col++) {
      if (store.formatOf(cell(stored, col))[property] !== true) allFormatted = false;
    }
  }
  void store.formatSelection(
    property === "bold" ? { bold: !allFormatted } : { italic: !allFormatted },
  );
}

function pageRows(): number {
  return Math.max(1, countVisibleRows(rowOffsets.value, viewport.value.top, viewport.value.bottom));
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

function isCheckboxTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest(
      ".cell-control--checkbox, .cell-control__checkbox-target, .cell-control__checkbox",
    ) !== null
  );
}

function onCellClick(event: MouseEvent): void {
  const checkboxClick = isCheckboxTarget(event.target);
  if (checkboxClick && (event.shiftKey || event.ctrlKey || event.metaKey)) event.preventDefault();
  if (tapOnSelected && draft.value === null && !checkboxClick) void edit();
  tapOnSelected = false;
}

function onCellDoubleClick(event: MouseEvent): void {
  if (isCheckboxTarget(event.target)) return;
  void edit();
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
  while (pendingOpeningNavigation.length) {
    const queued = pendingOpeningNavigation.shift();
    if (!queued) break;
    if (sessions.active) await cellField.value?.commitKey(queued.key, queued.backwards);
    else {
      store.prepareCellMove(queued.key, queued.backwards)();
      focusGrid();
    }
  }
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

function scrollSelection(target: CellAddress | null = selected.value): void {
  if (!target) return;
  if (virtual.value && grid.value) {
    const row = placeOf(target.row);
    const col = target.col;
    const marker = document.createElement("div");
    Object.assign(marker.style, {
      position: "absolute",
      pointerEvents: "none",
      scrollMarginTop: "195px",
      top: `${String(headerHeight.value + (rowOffsets.value[row] ?? 0))}px`,
      left: `${String(52 + (colOffsets.value[col] ?? 0))}px`,
      width: `${String(lineSize("col", col))}px`,
      height: `${String(lineSize("row", row))}px`,
    });
    grid.value.append(marker);
    marker.scrollIntoView({ block: "nearest", inline: "nearest" });
    marker.remove();
    updateViewport();
    return;
  }
  grid.value
    ?.querySelector(`[data-cell="${formatAddress(target)}"]`)
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
  // While editing, keys belong to the editor input. An input control in a cell
  // also keeps its own keys, such as the arrows that change a choice.
  const inControl =
    event.target instanceof Element &&
    event.target.closest('input, select, textarea, [contenteditable="true"], [role="textbox"]') !==
      null;
  if (draft.value !== null) {
    if (document.activeElement !== grid.value || inControl) return;
    const { key } = event;
    const unmodified = !event.ctrlKey && !event.altKey && !event.metaKey;
    const character = key.length === 1 && unmodified;
    const navigation = unmodified && (key === "Enter" || key === "Tab");
    if (sessions.active?.saving) {
      if (character || navigation) {
        event.preventDefault();
        cellField.value?.deferKey(key, event.shiftKey);
      }
      return;
    }
    if (character) {
      if (sessions.typeCharacter(key)) event.preventDefault();
    } else if (navigation) {
      event.preventDefault();
      if (cellField.value) void cellField.value.commitKey(key, event.shiftKey);
      else pendingOpeningNavigation.push({ key, backwards: event.shiftKey });
    }
    return;
  }
  if (!selected.value || inControl) return;
  const { key } = event;
  const command = event.ctrlKey || event.metaKey;
  const plain = !command && !event.altKey;
  if (command && !event.altKey && MOVES[key]) {
    const step = MOVES[key];
    const from = event.shiftKey ? selectionCorner() : selectedPlace.value;
    if (!from) return;
    const target = dataRegionDestination(
      from,
      { row: step[0], col: step[1] },
      displayedRows.value,
      props.table.colCount,
      isNonEmpty,
    );
    navigateTo(target, event.shiftKey, step[0] === 0);
  } else if (command && !event.altKey && key === "Home") moveToEdge(key, event.shiftKey, true);
  else if (command && !event.altKey && key === "End") moveToEdge(key, event.shiftKey, true);
  else if (plain && key === "Home") moveToEdge(key, event.shiftKey, false);
  else if (plain && key === "End") moveToEdge(key, event.shiftKey, false);
  else if (plain && (key === "PageUp" || key === "PageDown")) {
    const from = event.shiftKey ? selectionCorner() : selectedPlace.value;
    if (!from) return;
    navigateTo(
      { ...from, row: from.row + (key === "PageDown" ? pageRows() : -pageRows()) },
      event.shiftKey,
    );
  } else if (command && !event.altKey && !event.shiftKey && key.toLowerCase() === "b") {
    if (!store.canEdit) return;
    toggleFormat("bold");
  } else if (command && !event.altKey && !event.shiftKey && key.toLowerCase() === "i") {
    if (!store.canEdit) return;
    toggleFormat("italic");
  } else {
    if (key === " ") {
      const id = selected.value;
      const value = store.valueOf(id);
      const checkboxColumn = columnAt(id.col)?.type === "checkbox";
      const checkboxControl = isControl(value) && value.control === "checkbox";
      if (checkboxColumn || checkboxControl) {
        event.preventDefault();
        if (
          event.repeat ||
          event.shiftKey ||
          event.ctrlKey ||
          event.altKey ||
          event.metaKey ||
          store.selectionEnd !== null ||
          !store.canEdit
        )
          return;
        if (checkboxColumn) {
          if (value === null || typeof value === "boolean")
            void store.setCell(id, value === true ? "FALSE" : "TRUE");
          return;
        }
        if (checkboxControl) void store.input(id, value.value !== true);
        return;
      }
    }
    const step = MOVES[key];
    if (key === "Enter" && event.altKey && !command && focusSpillResizeAction())
      event.preventDefault();
    else if (step && !command && event.shiftKey) extend(...step);
    else if (step && !command) move(...step);
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
  }
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
    :data-pick-table="table.id"
    @pointerdown.capture="picking.start"
    @mousedown.capture="picking.start"
    @click.capture="picking.click"
    @dblclick.capture="picking.click"
    @keydown="onGridKeydown"
    @scroll.passive="updateViewport"
    @focusin="trackFocus"
    @focusout="focused = null"
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
          <template v-for="(col, index) in renderedCols" :key="table.colIds[col - 1]">
            <th
              v-if="col > (index ? renderedCols[index - 1]! : 0) + 1"
              class="grid__spacer"
              :colspan="col - (index ? renderedCols[index - 1]! : 0) - 1"
            ></th>
            <th
              scope="col"
              :class="{
                'grid__column--named': columnAt(col - 1),
                'grid__header--selected': isLineSelected('col', col - 1),
                'grid__column--frozen': col - 1 < frozenColumns,
              }"
              :style="frozenColumnStyle(col - 1)"
              :data-column="columnAt(col - 1)?.name"
              data-pick-kind="col"
              :data-pick-index="col - 1"
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
          </template>
          <th
            v-if="(renderedCols.at(-1) ?? 0) < table.colCount"
            class="grid__spacer"
            :colspan="table.colCount - (renderedCols.at(-1) ?? 0)"
          ></th>
        </tr>
      </thead>
      <tbody>
        <template
          v-for="(row, index) in renderedRows"
          :key="table.rows[storedRow(row - 1)]?.id ?? 'new'"
        >
          <tr v-if="gap(renderedRows, index, rowOffsets) > 0" aria-hidden="true">
            <td
              class="grid__spacer"
              :colspan="table.colCount + 1"
              :style="{ height: `${gap(renderedRows, index, rowOffsets)}px` }"
            ></td>
          </tr>
          <tr role="row" :style="{ '--row-height': `${lineSize('row', row - 1)}px` }">
            <th
              scope="row"
              data-pick-kind="row"
              :data-pick-index="row - 1"
              :class="{
                'grid__header--selected': isLineSelected('row', row - 1),
                'grid__header--frozen-row': row - 1 < frozenRows,
              }"
              :style="frozenRowStyle(row - 1)"
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
            <template v-for="(col, colIndex) in renderedCols" :key="table.colIds[col - 1]">
              <td
                v-if="col > (colIndex ? renderedCols[colIndex - 1]! : 0) + 1"
                class="grid__spacer"
                :colspan="col - (colIndex ? renderedCols[colIndex - 1]! : 0) - 1"
              ></td>
              <td
                role="gridcell"
                data-pick-kind="cells"
                :data-pick-row="row - 1"
                :data-pick-col="col - 1"
                :data-cell="formatAddress({ row: storedRow(row - 1), col: col - 1 })"
                :aria-selected="isSelected(row - 1, col - 1)"
                :class="{
                  'grid__cell--selected': isSelected(row - 1, col - 1),
                  'grid__cell--in-range': inRange(row - 1, col - 1),
                  'grid__cell--fill-preview': inFillPreview(row - 1, col - 1),
                  'grid__cell--filled': store.filledBy(cellAt(row - 1, col - 1)) !== undefined,
                  'grid__cell--computed': columnAt(col - 1)?.type === 'formula',
                  'grid__cell--frozen-row': row - 1 < frozenRows,
                  'grid__cell--frozen-column': col - 1 < frozenColumns,
                }"
                :style="[
                  cellStyle(store.formatOf(cellAt(row - 1, col - 1))),
                  { boxShadow: outlines.get(`${row - 1}:${col - 1}`)?.boxShadow },
                  frozenCellStyle(row - 1, col - 1),
                ]"
                :data-reference-color="outlines.get(`${row - 1}:${col - 1}`)?.color"
                @pointerdown="onCellPointerdown($event, row - 1, col - 1)"
                @mousedown="onCellMousedown($event, row - 1, col - 1)"
                @click="onCellClick"
                @mouseenter="onCellMouseenter(row - 1, col - 1)"
                @contextmenu="onCellContextMenu($event, row - 1, col - 1)"
                @dblclick="onCellDoubleClick"
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
                  :wrap-lines="wrappedLinesForRow(row - 1)"
                  @toggle="store.setCell(cellAt(row - 1, col - 1), $event ? 'TRUE' : 'FALSE')"
                  @pick="store.setCell(cellAt(row - 1, col - 1), literalInput($event))"
                  @run="run(row - 1, col - 1)"
                  @choose="store.input(cellAt(row - 1, col - 1), $event)"
                  @edit="store.input(cellAt(row - 1, col - 1), $event)"
                  @resize-table="resizeForSpill"
                  @confirmation="setPendingConfirmation(cellAt(row - 1, col - 1), $event)"
                  @trace="emit('trace', $event)"
                />
                <span
                  v-if="store.canEdit && draft === null && isHandleCell(row - 1, col - 1)"
                  class="grid__fill-handle"
                  title="Drag to fill"
                  @mousedown.stop.prevent="startFill"
                ></span>
              </td>
            </template>
            <td
              v-if="(renderedCols.at(-1) ?? 0) < table.colCount"
              class="grid__spacer"
              :colspan="table.colCount - (renderedCols.at(-1) ?? 0)"
            ></td>
          </tr>
        </template>
        <tr v-if="(renderedRows.at(-1) ?? 0) < displayedRows" aria-hidden="true">
          <td
            class="grid__spacer"
            :colspan="table.colCount + 1"
            :style="{
              height: `${rowOffsets[displayedRows]! - rowOffsets[renderedRows.at(-1) ?? 0]!}px`,
            }"
          ></td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
