<script setup lang="ts">
import {
  columnLabel,
  formatAddress,
  type ColumnType,
  type ErrorTraceFrame,
} from "@spreadsheet-app/engine";
import { GRID_SIZE, LIMITS } from "@spreadsheet-app/shared";
import { computed, nextTick, onBeforeUnmount, ref } from "vue";
import { parseCsv, toCsv } from "../files/csv";
import { download, fileName } from "../files/download";
import type { TableRecord } from "../api/client";
import { useFormulaSessionStore } from "../formula/session";
import { undoNotice } from "../notice";
import { useDialog } from "../useDialog";
import { useWorkbookStore } from "../stores/workbook";
import { countMisfits, type ChoiceSettings } from "../columnTypes";
import ContextMenu from "./ContextMenu.vue";
import ChoicesPanel from "./ChoicesPanel.vue";
import ConditionalFormatsPanel from "./ConditionalFormatsPanel.vue";
import EditableName from "./EditableName.vue";
import ErrorWarning from "./ErrorWarning.vue";
import FreezeSettings from "./FreezeSettings.vue";
import GridView from "./GridView.vue";
import ColumnFormulaPopover from "./ColumnFormulaPopover.vue";
import NamesPanel from "./NamesPanel.vue";
import ResizeTable from "./ResizeTable.vue";
import ResizeLines from "./ResizeLines.vue";
import TableDisplayBar from "./TableDisplayBar.vue";
import type { MenuItem, MenuScope } from "./menu";
import { useActiveSidePane } from "../sidePane";

const props = defineProps<{ table: TableRecord }>();
const emit = defineEmits<{
  trace: [trace: ErrorTraceFrame[]];
  actions: [event: MouseEvent];
}>();
const store = useWorkbookStore();
const sessions = useFormulaSessionStore();
const dialog = useDialog();
const activeSidePane = useActiveSidePane();
let mounted = true;
onBeforeUnmount(() => {
  mounted = false;
});
const namesPaneId: `names:${string}` = `names:${props.table.id}`;
const conditionalFormatsPaneId: `conditional-formats:${string}` = `conditional-formats:${props.table.id}`;

/** The selected cell when it is in this table. Row and column actions apply to it. */
const selected = computed(() =>
  store.selection?.tableId === props.table.id ? store.selection : null,
);
/** The rows the table shows, which are what a selection of rows names. */
const view = computed(() => store.rowView(props.table.id));
const colsFull = computed(() => props.table.colCount >= LIMITS.tableCols);
const allSelectedCellsWrap = computed(() => {
  const range = selected.value ? store.selectedRange : null;
  if (!range) return false;
  const firstRow = range.entireColumn ? 0 : range.startRow;
  const lastRow = range.entireColumn ? props.table.rowCount - 1 : range.endRow;
  for (let row = firstRow; row <= lastRow; row += 1) {
    const storedRow = range.entireColumn ? row : view.value.storedRow(row);
    for (let col = range.startCol; col <= range.endCol; col += 1) {
      if (store.formatOf({ tableId: props.table.id, row: storedRow, col }).wrap !== true) {
        return false;
      }
    }
  }
  return true;
});

function toggleWrap(): void {
  void store.formatSelection({ wrap: !allSelectedCellsWrap.value });
}

async function remove(): Promise<void> {
  if (
    await dialog.confirm({
      title: "Delete table",
      message: `Delete ${props.table.name} and everything in it?`,
      confirmLabel: "Delete table",
      danger: true,
    })
  ) {
    await store.deleteTable(props.table.id);
  }
}

function exportCsv(): void {
  download(fileName(props.table.name, "csv"), toCsv(store.shownRows(props.table)), "text/csv");
}

/** Reads a chosen CSV file into the table, starting at its first cell. */
async function importCsv(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const [file] = input.files ?? [];
  // Cleared so that choosing the same file again is a change the input reports.
  input.value = "";
  if (!file) return;
  const rows = parseCsv(await file.text());
  const replaces = store.shownRows(props.table).length > 0;
  if (
    replaces &&
    !(await dialog.confirm({
      title: "Replace table contents",
      message: `Replace the contents of ${props.table.name} with ${file.name}?`,
      confirmLabel: "Replace",
      danger: true,
    }))
  ) {
    return;
  }
  await store.importRows(props.table.id, rows);
}

type Axis = "row" | "col";

/**
 * Rows or columns that sit next to each other: `count` of them from `first`.
 * Rows are places in what the table shows, which are its stored rows unless
 * the table is sorted or filtered.
 */
interface Lines {
  axis: Axis;
  first: number;
  count: number;
}

/** The stored rows or columns the lines name. Places past the last row are rows the table does not have. */
function indexesOf({ axis, first, count }: Lines): number[] {
  return Array.from({ length: count }, (_, offset) =>
    axis === "row" ? view.value.storedRow(first + offset) : first + offset,
  ).filter((index) => index < (axis === "row" ? props.table.rowCount : props.table.colCount));
}

/** "row 3", "rows 3-6", "3 rows", "column C", or "columns C-E". */
function describeLines(lines: Lines): string {
  const { axis } = lines;
  const indexes = indexesOf(lines).toSorted((a, b) => a - b);
  const label = (index: number): string =>
    axis === "row" ? String(index + 1) : columnLabel(index);
  const noun = axis === "row" ? "row" : "column";
  const [first = 0] = indexes;
  const last = indexes.at(-1) ?? first;
  if (indexes.length === 1) return `${noun} ${label(first)}`;
  // Rows of a sorted table need not sit next to each other.
  if (last - first + 1 !== indexes.length) return `${String(indexes.length)} ${noun}s`;
  return `${noun}s ${label(first)}-${label(last)}`;
}

/** Inserts `count` rows or columns, the first of them at `index`. */
function insert(axis: Axis, index: number, count = 1): void {
  void store.editTable(props.table.id, { axis, kind: "insert", index, count });
}

/** Deletes rows or columns and offers the matching undo step. */
async function removeLines(lines: Lines): Promise<void> {
  const description = describeLines(lines);
  if (await store.deleteLines(props.table.id, lines.axis, indexesOf(lines))) {
    store.notice = undoNotice(`Deleted ${description}`, () => void store.undo());
  }
}

/** Whether the form that sets the table's size is open. */
const resizing = ref(false);
const freezeSettingsOpen = ref(false);

function openFreezeSettings(): void {
  resizing.value = false;
  freezeSettingsOpen.value = !freezeSettingsOpen.value;
}

async function saveFreezeSettings(settings: {
  freezeRows: number;
  freezeColumns: number;
}): Promise<void> {
  if (await store.updateTable(props.table.id, settings)) freezeSettingsOpen.value = false;
}

/** Whether the rows and columns past a size hold anything. */
function holdsContentPast(rowCount: number, colCount: number): boolean {
  const { id } = props.table;
  for (let row = 0; row < props.table.rowCount; row += 1) {
    for (let col = row < rowCount ? colCount : 0; col < props.table.colCount; col += 1) {
      if (store.inputOf({ tableId: id, row, col }) !== "") return true;
    }
  }
  return false;
}

/** Sets the table's size, asking first when a smaller one would discard content. */
async function resize({
  rowCount,
  colCount,
}: {
  rowCount: number;
  colCount: number;
}): Promise<void> {
  const { id, name } = props.table;
  const size = `${String(colCount)} ${colCount === 1 ? "column" : "columns"} and ${String(rowCount)} ${rowCount === 1 ? "row" : "rows"}`;
  const asked = `Resizing ${name} to ${size} deletes content beyond the new size. Resize it?`;
  if (
    holdsContentPast(rowCount, colCount) &&
    !(await dialog.confirm({
      title: "Resize table",
      message: asked,
      confirmLabel: "Resize",
      danger: true,
    }))
  )
    return;
  resizing.value = false;
  if (rowCount === props.table.rowCount && colCount === props.table.colCount) return;
  void store.updateTable(id, { rowCount, colCount });
}

/** Whether the panel of the table's conditional formats is open. */
const conditionalOpen = activeSidePane.isOpen(conditionalFormatsPaneId);

/** Whether the panel of the table's names is open, and the formula a new name starts with. */
const formulaFor = computed(() =>
  sessions.columnPopover?.tableId === props.table.id ? sessions.columnPopover.colId : undefined,
);
const namesOpen = activeSidePane.isOpen(namesPaneId);
const nameSuggestion = ref<string>();

/** Opens the names panel with a new name for the selected range. */
function nameRange(): void {
  const range = store.selectedRange;
  if (!range) return;
  const start = formatAddress({ row: range.startRow, col: range.startCol });
  const end = formatAddress({ row: range.endRow, col: range.endCol });
  nameSuggestion.value = start === end ? start : `${start}:${end}`;
  activeSidePane.open(namesPaneId);
}

/** Where the menu that offers the two ways to name columns is open, if it is. */
const namingAt = ref<{ x: number; y: number } | null>(null);

function openNaming(event: MouseEvent): void {
  const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
  namingAt.value = { x: box.left, y: box.bottom + 4 };
}

const namingItems: MenuItem[] = [
  {
    label: "Use the first row as the names",
    run: () => {
      void store.nameColumns(props.table.id, true);
    },
  },
  {
    label: "Name them Column 1, Column 2, …",
    run: () => {
      void store.nameColumns(props.table.id, false);
    },
  },
];

async function dropColumns(): Promise<void> {
  const computed = (props.table.columns ?? []).some((column) => column.type === "formula");
  const warning = computed ? " Its formula columns will become empty." : "";
  if (
    await dialog.confirm({
      title: "Remove column names",
      message: `Remove the column names of ${props.table.name}?${warning}`,
      confirmLabel: "Remove names",
      danger: true,
    })
  ) {
    void store.dropColumns(props.table.id);
  }
}

const COLUMN_TYPES: readonly { type: ColumnType; label: string }[] = [
  { type: "any", label: "Anything" },
  { type: "text", label: "Text" },
  { type: "number", label: "Number" },
  { type: "date", label: "Date" },
  { type: "checkbox", label: "Checkbox" },
];

/** The column whose choices are being edited, while the panel for them is open. */
const choosingFor = ref<number | null>(null);

interface ColumnChanges {
  type: ColumnType;
  choices?: string[];
  choicesFrom?: { tableId: string; colId: string };
}

/** Explains which inputs the engine will reject when a type change is applied. */
function typeMisfitMessage(
  count: number,
  total: number,
  name: string,
  type: ColumnType,
): string | null {
  const column = `'${name.replaceAll("'", "''")}'`;
  let detail: string;
  switch (type) {
    case "number":
      detail = "are not numbers and will show #VALUE! as Number";
      break;
    case "date":
      detail = "are not dates and will show #VALUE! as Date";
      break;
    case "checkbox":
      detail = "are not TRUE or FALSE and will show #VALUE! as Checkbox";
      break;
    case "any":
      detail = "are malformed formulas and will show #ERROR! as Anything";
      break;
    case "choice":
      detail = "are malformed formulas and will show #ERROR! as a dropdown";
      break;
    default:
      return null;
  }
  return `${String(count)} of ${String(total)} cells in ${column} ${detail}. Change the type anyway?`;
}

/** Saves a column type after confirming when the engine will reject stored inputs. */
async function changeColumnType(colId: string, changes: ColumnChanges): Promise<boolean> {
  const tableId = props.table.id;
  const current = store.tables.find((table) => table.id === tableId);
  const col = current?.colIds.indexOf(colId) ?? -1;
  const column = current?.columns?.[col];
  if (!current || col < 0 || !column) return false;

  if (column.type !== changes.type && changes.type !== "formula") {
    const inputs = current.rows.map((_row, row) => store.inputOf({ tableId, row, col }));
    const misfits = countMisfits(changes.type, inputs);
    if (misfits > 0) {
      const message = typeMisfitMessage(misfits, inputs.length, column.name, changes.type);
      if (message) {
        const confirmed = await dialog.confirm({
          title: "Change column type",
          message,
          confirmLabel: "Change type",
        });
        if (!confirmed || !mounted) return false;
        const latest = store.tables.find((table) => table.id === tableId);
        const latestCol = latest?.colIds.indexOf(colId) ?? -1;
        if (!latest || latestCol < 0 || latest.columns?.[latestCol]?.type !== column.type) {
          return false;
        }
        return store.updateColumn(tableId, latestCol, changes);
      }
    }
  }

  if (!mounted) return false;
  const latest = store.tables.find((table) => table.id === tableId);
  const latestCol = latest?.colIds.indexOf(colId) ?? -1;
  if (!latest || latestCol < 0) return false;
  return store.updateColumn(tableId, latestCol, changes);
}

/** Saves choice settings through the same type-change confirmation path. */
async function saveChoices(settings: ChoiceSettings): Promise<boolean> {
  const col = choosingFor.value;
  const colId = col === null ? undefined : props.table.colIds[col];
  if (!colId) return false;
  return changeColumnType(colId, { type: "choice", ...settings });
}

/** The menu items that set what a named column holds. */
function columnItems(col: number): MenuItem[] {
  const column = props.table.columns?.[col];
  if (!column) return [];
  const { id } = props.table;
  const colId = props.table.colIds[col];
  const sortBy = (descending: boolean): void => {
    if (!colId) return;
    const { filter } = props.table.display;
    void store.setTableDisplay(
      id,
      { sort: [{ colId, descending }], ...(filter === undefined ? {} : { filter }) },
      store.revision,
    );
  };
  const sorted = props.table.display.sort.some((key) => key.colId === colId);
  return [
    {
      label: "Sort ascending",
      run: () => {
        sortBy(false);
      },
    },
    {
      label: "Sort descending",
      run: () => {
        sortBy(true);
      },
    },
    {
      label: "Clear sort",
      disabled: props.table.display.sort.length === 0 && !sorted,
      run: () => {
        const { filter } = props.table.display;
        void store.setTableDisplay(
          id,
          { sort: [], ...(filter === undefined ? {} : { filter }) },
          store.revision,
        );
      },
    },
    ...COLUMN_TYPES.map(({ type, label }) => ({
      label: `${column.type === type ? "✓ " : ""}Column holds: ${label}`,
      run: () => {
        if (colId) void changeColumnType(colId, { type });
      },
    })),
    {
      label: `${column.type === "choice" ? "✓ " : ""}Column holds: A choice…`,
      run: () => {
        choosingFor.value = col;
      },
    },
    {
      label: `${column.type === "formula" ? "✓ " : ""}Column holds: A formula…`,
      keepDraft:
        sessions.active?.target.kind === "column" &&
        sessions.active.target.tableId === id &&
        sessions.active.target.colId === props.table.colIds[col],
      run: () => {
        const colId = props.table.colIds[col];
        if (!colId) return;
        const holdsInputs =
          column.type !== "formula" &&
          props.table.rows.some((_row, row) => store.inputOf({ tableId: id, row, col }) !== "");
        void (async () => {
          if (
            holdsInputs &&
            !(await dialog.confirm({
              title: "Convert column to formula",
              message: `Make ${props.table.name}[${column.name}] a formula column and remove its stored inputs?`,
              confirmLabel: "Convert",
              danger: true,
            }))
          ) {
            return;
          }
          if (!mounted) return;
          sessions.columnPopover = { tableId: id, colId };
        })();
      },
    },
  ];
}

/** Where the menu of row, column, and cell actions is open, if it is, and what it acts on. */
const menuAt = ref<{ x: number; y: number; scope: MenuScope } | null>(null);

/** Where a growth menu is open, and whether it adds rows or columns. */
const growMenu = ref<{ x: number; y: number; axis: Axis } | null>(null);
const growCount = ref("");
const growError = ref<string | null>(null);
const growCustomOpen = ref(false);
const growCountInput = ref<HTMLInputElement>();

/** The rows or columns still available under the shared spreadsheet limits. */
function growthAvailable(axis: Axis): number {
  if (axis === "col") return Math.max(0, LIMITS.tableCols - props.table.colCount);
  const spreadsheetRows = store.tables.reduce((total, table) => total + table.rowCount, 0);
  return Math.max(
    0,
    Math.min(LIMITS.tableRows - props.table.rowCount, LIMITS.spreadsheetRows - spreadsheetRows),
  );
}

const rowsFull = computed(() => growthAvailable("row") === 0);
const growLimit = computed(() => (growMenu.value ? growthAvailable(growMenu.value.axis) : 0));
const growNoun = computed(() => (growMenu.value?.axis === "row" ? "rows" : "columns"));

function openGrowMenu(event: MouseEvent, axis: Axis): void {
  if (!store.canEdit) return;
  event.preventDefault();
  growCount.value = "";
  growError.value = null;
  growCustomOpen.value = false;
  growMenu.value = { x: event.clientX, y: event.clientY, axis };
}

function closeGrowMenu(): void {
  growMenu.value = null;
  growCustomOpen.value = false;
  growError.value = null;
}

function addGrowth(axis: Axis, count: number): void {
  const index = axis === "row" ? props.table.rowCount : props.table.colCount;
  void store.editTable(props.table.id, { axis, kind: "insert", index, count });
}

function openCustomGrowth(): void {
  growCount.value = "";
  growError.value = null;
  growCustomOpen.value = true;
  void nextTick(() => growCountInput.value?.focus({ preventScroll: true }));
}

function addCustomGrowth(): void {
  const axis = growMenu.value?.axis;
  if (!axis) return;
  if (!/^\d+$/.test(growCount.value)) {
    growError.value = "Enter a positive whole number.";
    return;
  }
  const requested = BigInt(growCount.value);
  if (requested <= 0n) {
    growError.value = "Enter a positive whole number.";
    return;
  }
  const available = BigInt(growthAvailable(axis));
  const count = Number(requested > available ? available : requested);
  if (count < 1) {
    growError.value = `No more ${axis === "row" ? "rows" : "columns"} can be added.`;
    return;
  }
  // Keep the value in the field aligned with the amount that will fit.
  growCount.value = String(count);
  closeGrowMenu();
  addGrowth(axis, count);
}

const growItems = computed((): MenuItem[] => {
  const axis = growMenu.value?.axis;
  if (!axis) return [];
  const noun = axis === "row" ? "rows" : "columns";
  const available = growthAvailable(axis);
  return [
    ...[5, 10, 15].map((count) => ({
      label: `Add ${String(count)} ${noun}`,
      disabled: count > available,
      run: () => {
        addGrowth(axis, count);
      },
    })),
    {
      label: "Add custom number…",
      disabled: available === 0,
      keepOpen: true,
      separated: true,
      run: openCustomGrowth,
    },
  ];
});

const resizingLines = ref<{ axis: "row" | "col"; ids: string[]; initial: number } | null>(null);

function openLineResize({ axis, first, count }: Lines): void {
  const ids = Array.from({ length: count }, (_, offset) =>
    axis === "row"
      ? props.table.rows[view.value.storedRow(first + offset)]?.id
      : props.table.colIds[first + offset],
  ).filter((id): id is string => id !== undefined);
  if (!ids.length) return;
  const sizes = axis === "row" ? props.table.gridSizes.rows : props.table.gridSizes.columns;
  const firstId = ids[0];
  resizingLines.value = {
    axis,
    ids,
    initial: (firstId === undefined ? undefined : sizes[firstId]) ?? GRID_SIZE[axis].default,
  };
}

function applyLineResize(size: number | null): void {
  const target = resizingLines.value;
  if (!target) return;
  void store.resizeLines(props.table.id, target.axis, target.ids, size);
  resizingLines.value = null;
  store.focusGrid();
}

/** The items that insert and delete the selected rows, or the selected columns. */
function lineItems(lines: Lines): MenuItem[] {
  const { axis, first, count } = lines;
  const rows = axis === "row";
  const size = rows ? props.table.rowCount : props.table.colCount;
  const full = size + count > (rows ? LIMITS.tableRows : LIMITS.tableCols);
  const noun = rows ? "row" : "column";
  const counted = count === 1 ? noun : `${String(count)} ${noun}s`;
  // Above and below mean places in the order shown, and a row is inserted at a stored place.
  const unplaced = rows && view.value.reordered;
  return [
    {
      label: `Insert ${counted} ${rows ? "above" : "left"}`,
      disabled: full || unplaced,
      run: () => {
        insert(axis, first, count);
      },
    },
    {
      label: `Insert ${counted} ${rows ? "below" : "right"}`,
      disabled: full || unplaced,
      run: () => {
        insert(axis, first + count, count);
      },
    },
    {
      label: `Delete ${describeLines(lines)}`,
      danger: true,
      // Plain grids keep one row; every table keeps one column.
      disabled: count >= size && (!rows || !props.table.columns),
      run: () => {
        void removeLines(lines);
      },
    },
  ];
}

/**
 * The actions for the selected cells. They insert as many rows or columns as
 * the selection spans, and delete the ones it spans. A menu opened from a row
 * header has no column actions, and one opened from a column header no row actions.
 */
const menuItems = computed((): MenuItem[] => {
  const range = selected.value ? store.selectedRange : null;
  const scope = menuAt.value?.scope;
  if (!range || !scope) return [];
  const rows: Lines = {
    axis: "row",
    first: range.startRow,
    count: range.endRow - range.startRow + 1,
  };
  const cols: Lines = {
    axis: "col",
    first: range.startCol,
    count: range.endCol - range.startCol + 1,
  };
  const groups: MenuItem[][] = [
    scope === "row" && !props.table.columns
      ? [
          {
            label: "Freeze up to this row",
            disabled: props.table.display.freezeRows === range.endRow + 1,
            run: () => void store.updateTable(props.table.id, { freezeRows: range.endRow + 1 }),
          },
          ...(props.table.display.freezeRows
            ? [
                {
                  label: "Unfreeze",
                  run: () => void store.updateTable(props.table.id, { freezeRows: 0 }),
                },
              ]
            : []),
        ]
      : [],
    scope === "col"
      ? [
          {
            label: "Freeze up to this column",
            disabled: props.table.display.freezeColumns === range.endCol + 1,
            run: () => void store.updateTable(props.table.id, { freezeColumns: range.endCol + 1 }),
          },
          ...(props.table.display.freezeColumns
            ? [
                {
                  label: "Unfreeze",
                  run: () => void store.updateTable(props.table.id, { freezeColumns: 0 }),
                },
              ]
            : []),
        ]
      : [],
    scope === "cells"
      ? []
      : [
          {
            label: `Resize ${scope === "row" ? "row" : "column"}`,
            run: () => {
              openLineResize(scope === "row" ? rows : cols);
            },
          },
        ],
    scope === "col" ? [] : lineItems(rows),
    scope === "row" ? [] : lineItems(cols),
    [
      {
        label: allSelectedCellsWrap.value ? "Unwrap text" : "Wrap text",
        run: toggleWrap,
      },
    ],
    // What a column holds is set one column at a time.
    scope === "row" || cols.count > 1 ? [] : columnItems(cols.first),
    scope !== "cells" || props.table.columns ? [] : [{ label: "Name this range…", run: nameRange }],
    [{ label: "Clear cells", run: () => void store.clearSelection() }],
  ];
  return groups
    .filter((group) => group.length > 0)
    .flatMap((group, index) =>
      group.map((item, position) => ({ ...item, separated: index > 0 && position === 0 })),
    );
});

/** What the open menu acts on, for its accessible name. */
const menuLabel = computed(() => {
  const range = selected.value ? store.selectedRange : null;
  if (!range) return "";
  const row = view.value.storedRow;
  const start = formatAddress({ row: row(range.startRow), col: range.startCol });
  const end = formatAddress({ row: row(range.endRow), col: range.endCol });
  return `Actions for ${start === end ? start : `${start}:${end}`}`;
});
</script>

<template>
  <section class="table-card" :data-table="table.name">
    <header class="table-card__header">
      <h2>
        <ErrorWarning
          v-if="store.errorBlocks.has(table.id)"
          :label="`${table.name} contains errors`"
        />
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
          data-block-action="Resize"
          aria-haspopup="dialog"
          @click="resizing = !resizing"
        >
          Resize
        </button>
        <button
          type="button"
          data-block-action="Freeze rows and columns"
          aria-haspopup="dialog"
          @click="openFreezeSettings"
        >
          Freeze
        </button>
        <button
          v-if="!table.columns"
          type="button"
          data-block-action="Names"
          data-open-names
          :aria-expanded="namesOpen"
          @click="activeSidePane.toggle(namesPaneId)"
        >
          Names{{ table.names.length > 0 ? ` (${table.names.length})` : "" }}
        </button>
        <button
          type="button"
          data-block-action="Conditional formats"
          :aria-expanded="conditionalOpen"
          @click="activeSidePane.toggle(conditionalFormatsPaneId)"
        >
          Conditional formats{{
            table.conditionalFormats.length > 0 ? ` (${table.conditionalFormats.length})` : ""
          }}
        </button>
        <button
          v-if="table.columns"
          type="button"
          data-block-action="Remove column names"
          @click="dropColumns"
        >
          Remove column names
        </button>
        <button
          v-else
          type="button"
          data-block-action="Name columns"
          aria-haspopup="menu"
          @click="openNaming"
        >
          Name columns
        </button>
        <label class="file-button" data-block-action="Import CSV">
          Import CSV
          <input type="file" accept=".csv,.tsv,.txt,text/csv" @change="importCsv" />
        </label>
        <button type="button" data-block-action="Export CSV" @click="exportCsv">Export CSV</button>
        <button type="button" data-block-action="Delete table" class="danger" @click="remove">
          Delete table
        </button>
        <button
          type="button"
          class="table-card__menu-trigger"
          aria-haspopup="menu"
          :aria-label="`Block actions for ${table.name}`"
          @click.stop="emit('actions', $event)"
        >
          ⋮
        </button>
      </div>
      <div v-else class="table-card__actions">
        <button
          v-if="!table.columns && table.names.length > 0"
          type="button"
          data-block-action="Names"
          data-open-names
          :aria-expanded="namesOpen"
          @click="activeSidePane.toggle(namesPaneId)"
        >
          Names ({{ table.names.length }})
        </button>
        <button type="button" data-block-action="Export CSV" @click="exportCsv">Export CSV</button>
        <button
          type="button"
          class="table-card__menu-trigger"
          aria-haspopup="menu"
          :aria-label="`Block actions for ${table.name}`"
          @click.stop="emit('actions', $event)"
        >
          ⋮
        </button>
      </div>
      <ResizeTable v-if="resizing" :table="table" @close="resizing = false" @resize="resize" />
      <FreezeSettings
        v-if="freezeSettingsOpen"
        :table="table"
        @close="freezeSettingsOpen = false"
        @save="saveFreezeSettings"
      />
    </header>

    <ColumnFormulaPopover
      v-if="formulaFor"
      :table="table"
      :col-id="formulaFor"
      @close="sessions.columnPopover = undefined"
    />

    <NamesPanel
      v-if="namesOpen && !table.columns"
      :table="table"
      :suggestion="nameSuggestion"
      @close="activeSidePane.close(namesPaneId)"
    />

    <ConditionalFormatsPanel
      v-if="conditionalOpen"
      :table="table"
      @close="activeSidePane.close(conditionalFormatsPaneId)"
    />

    <!-- Always present, so selecting a cell does not push the grid down. -->
    <div v-if="store.canEdit" class="table-card__lines">
      <span v-if="selected" role="group" :aria-label="`Row ${selected.row + 1}`">
        <span class="table-card__line">Row {{ selected.row + 1 }}</span>
        <button
          type="button"
          :disabled="rowsFull || view.reordered"
          :title="view.reordered ? 'Not while the table is sorted or filtered' : undefined"
          @click="insert('row', selected.row)"
        >
          Insert row above
        </button>
        <button
          type="button"
          class="danger"
          :disabled="selected.row >= table.rowCount || (!table.columns && table.rowCount <= 1)"
          @click="
            removeLines({ axis: 'row', first: view.place(selected.row) ?? selected.row, count: 1 })
          "
        >
          Delete row
        </button>
      </span>
      <span v-if="selected" role="group" :aria-label="`Column ${columnLabel(selected.col)}`">
        <span class="table-card__line">Column {{ columnLabel(selected.col) }}</span>
        <button type="button" :disabled="colsFull" @click="insert('col', selected.col)">
          Insert column left
        </button>
        <button
          type="button"
          class="danger"
          :disabled="table.colCount <= 1"
          @click="removeLines({ axis: 'col', first: selected.col, count: 1 })"
        >
          Delete column
        </button>
      </span>
    </div>

    <ChoicesPanel
      v-if="choosingFor !== null && table.columns?.[choosingFor]"
      :key="choosingFor"
      :table="table"
      :col="choosingFor"
      :save-choices="saveChoices"
      @close="choosingFor = null"
    />

    <TableDisplayBar v-if="table.columns" :table="table" />

    <!-- A strip along the right edge adds a column, and one along the bottom edge adds a row. -->
    <div class="table-card__grid">
      <GridView :table="table" @menu="menuAt = $event" @trace="emit('trace', $event)" />
      <template v-if="store.canEdit">
        <button
          type="button"
          class="table-card__grow table-card__grow--col"
          aria-label="Add column"
          title="Add column"
          :disabled="colsFull"
          @click="store.updateTable(table.id, { colCount: table.colCount + 1 })"
          @contextmenu="openGrowMenu($event, 'col')"
        >
          +
        </button>
        <button
          type="button"
          class="table-card__grow table-card__grow--row"
          aria-label="Add row"
          title="Add row"
          :disabled="rowsFull"
          @click="store.editTable(table.id, { axis: 'row', kind: 'insert', index: table.rowCount })"
          @contextmenu="openGrowMenu($event, 'row')"
        >
          +
        </button>
      </template>
    </div>
    <ResizeLines
      v-if="resizingLines && store.canEdit"
      :key="resizingLines.axis + resizingLines.ids.join(',')"
      :axis="resizingLines.axis"
      :initial="resizingLines.initial"
      @resize="applyLineResize"
      @close="
        resizingLines = null;
        store.focusGrid();
      "
    />
    <ContextMenu
      v-if="namingAt"
      :x="namingAt.x"
      :y="namingAt.y"
      label="Name columns"
      :items="namingItems"
      @close="namingAt = null"
    />
    <ContextMenu
      v-if="menuAt && selected"
      :x="menuAt.x"
      :y="menuAt.y"
      :label="menuLabel"
      :items="menuItems"
      @close="menuAt = null"
    />
    <ContextMenu
      v-if="growMenu"
      :x="growMenu.x"
      :y="growMenu.y"
      :label="`Add ${growNoun}`"
      :items="growItems"
      @close="closeGrowMenu"
    >
      <template #content>
        <form
          v-if="growCustomOpen && growMenu"
          class="context-menu__custom"
          role="group"
          :aria-label="`Add custom ${growNoun}`"
          @submit.prevent="addCustomGrowth"
        >
          <label :for="`grow-count-${table.id}`">Add custom number…</label>
          <div class="context-menu__custom-controls">
            <input
              :id="`grow-count-${table.id}`"
              ref="growCountInput"
              v-model="growCount"
              type="text"
              inputmode="numeric"
              autocomplete="off"
              maxlength="12"
              :aria-label="`Number of ${growNoun}`"
              :aria-describedby="growError ? `grow-count-error-${table.id}` : undefined"
              :disabled="growLimit === 0"
            />
            <button type="submit" role="menuitem" :disabled="growLimit === 0">
              Add {{ growNoun }}
            </button>
          </div>
          <small v-if="growLimit > 0" class="context-menu__hint">
            Up to {{ growLimit }} {{ growNoun }} can be added.
          </small>
          <small v-else class="context-menu__hint">No more {{ growNoun }} can be added.</small>
          <small
            v-if="growError"
            :id="`grow-count-error-${table.id}`"
            class="context-menu__error"
            role="alert"
          >
            {{ growError }}
          </small>
        </form>
      </template>
    </ContextMenu>
  </section>
</template>
