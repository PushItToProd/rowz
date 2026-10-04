<script setup lang="ts">
import { MAX_SORT_KEYS } from "@spreadsheet-app/shared";
import { LIMITS } from "@spreadsheet-app/shared";
import type { SortKey } from "@spreadsheet-app/engine";
import { computed, nextTick } from "vue";
import type { TableRecord } from "../api/client";
import { useFormulaSessionStore } from "../formula/session";
import { useWorkbookStore } from "../stores/workbook";
import SessionFormulaField from "./SessionFormulaField.vue";

const props = defineProps<{ table: TableRecord }>();
const store = useWorkbookStore();
const sessions = useFormulaSessionStore();
const targetLabel = computed(
  () =>
    `${store.pages.find((page) => page.id === props.table.pageId)?.name ?? "Page"} · ${props.table.name} · Filter`,
);

const columns = computed(() => props.table.columns ?? []);
const sort = computed(() => props.table.display.sort);
const filter = computed(() => props.table.display.filter ?? "");
const view = computed(() => store.rowView(props.table.id));

/** The column of a sort key, or `undefined` once the column is gone. */
function nameOf(colId: string): string | undefined {
  return columns.value[props.table.colIds.indexOf(colId)]?.name;
}

/** The sort keys whose columns still exist. */
const keys = computed(() => sort.value.filter(({ colId }) => nameOf(colId) !== undefined));
const unused = computed(() =>
  props.table.colIds.filter((colId) => !sort.value.some((key) => key.colId === colId)),
);

/** Whether the bar has anything to show to someone who cannot edit. */
const active = computed(() => keys.value.length > 0 || filter.value !== "");

/** Read the saved filter after submitting, so sort changes cannot restore an older draft. */
async function setSort(next: SortKey[]): Promise<boolean> {
  if (!(await sessions.submit(store.submitFormulaDraft))) {
    await nextTick();
    sessions.focus();
    return false;
  }
  const table = store.tables.find((table) => table.id === props.table.id);
  return table ? store.setTableDisplay(table.id, { ...table.display, sort: next }) : false;
}

function addKey(): void {
  const colId = unused.value[0];
  if (colId) void setSort([...sort.value, { colId, descending: false }]);
}

async function changeKey(index: number, changes: Partial<SortKey>, event: Event): Promise<void> {
  const saved = await setSort(
    sort.value.map((key, position) => (position === index ? { ...key, ...changes } : key)),
  );
  if (!saved && event.target instanceof HTMLSelectElement) {
    const key = sort.value[index];
    event.target.value =
      changes.colId !== undefined
        ? (key?.colId ?? "")
        : key?.descending
          ? "descending"
          : "ascending";
  }
}

function removeKey(index: number): void {
  void setSort(sort.value.filter((_, position) => position !== index));
}

async function clearFilter(): Promise<void> {
  if (!(await sessions.submit(store.submitFormulaDraft))) {
    await nextTick();
    sessions.focus();
    return;
  }
  const table = store.tables.find((table) => table.id === props.table.id);
  if (table) await store.setTableDisplay(table.id, { sort: table.display.sort });
}
</script>

<template>
  <div
    v-if="store.canEdit || active"
    class="table-display"
    role="group"
    :aria-label="`Sort and filter ${table.name}`"
  >
    <span class="table-display__group">
      <span class="table-display__label">Filter</span>
      <SessionFormulaField
        class="table-display__filter"
        :target="{ kind: 'filter', tableId: table.id }"
        :context="{ pageId: table.pageId, tableId: table.id }"
        :value="filter"
        label="Table filter"
        :target-label="targetLabel"
        placeholder="=[Column] > 100"
        :readonly="!store.canEdit"
        :max-length="LIMITS.inputLength"
      />
      <button v-if="filter !== '' && store.canEdit" type="button" @click="clearFilter">
        Clear filter
      </button>
    </span>

    <span class="table-display__group">
      <span class="table-display__label">Sort</span>
      <span v-for="(key, index) in keys" :key="key.colId" class="table-display__key" role="group">
        <select
          :value="key.colId"
          :aria-label="`Sort column ${index + 1}`"
          :disabled="!store.canEdit"
          @change="changeKey(index, { colId: ($event.target as HTMLSelectElement).value }, $event)"
        >
          <option v-for="colId in [key.colId, ...unused]" :key="colId" :value="colId">
            {{ nameOf(colId) }}
          </option>
        </select>
        <select
          :value="key.descending ? 'descending' : 'ascending'"
          :aria-label="`Sort direction ${index + 1}`"
          :disabled="!store.canEdit"
          @change="
            changeKey(
              index,
              {
                descending: ($event.target as HTMLSelectElement).value === 'descending',
              },
              $event,
            )
          "
        >
          <option value="ascending">Ascending</option>
          <option value="descending">Descending</option>
        </select>
        <button
          v-if="store.canEdit"
          type="button"
          class="danger"
          :aria-label="`Remove sort by ${nameOf(key.colId)}`"
          @click="removeKey(index)"
        >
          ×
        </button>
      </span>
      <span v-if="keys.length === 0" class="table-display__none">Stored order</span>
      <button
        v-if="store.canEdit"
        type="button"
        :disabled="unused.length === 0 || sort.length >= MAX_SORT_KEYS"
        @click="addKey"
      >
        Add sort
      </button>
    </span>

    <span v-if="view.filterError" class="table-display__error" role="alert">
      The filter gives an error: {{ view.filterError }}
    </span>
    <span v-if="view.hidden > 0" class="table-display__hidden">
      {{ view.hidden }} {{ view.hidden === 1 ? "row" : "rows" }} hidden
    </span>
  </div>
</template>
