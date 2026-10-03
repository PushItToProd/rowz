<script setup lang="ts">
import { MAX_SORT_KEYS } from "@spreadsheet-app/shared";
import { LIMITS } from "@spreadsheet-app/shared";
import type { SortKey } from "@spreadsheet-app/engine";
import { computed, ref, watch } from "vue";
import type { TableRecord } from "../api/client";
import { useFormulaAssist } from "../formula/useFormulaAssist";
import { useWorkbookStore } from "../stores/workbook";
import FormulaAssist from "./FormulaAssist.vue";

const props = defineProps<{ table: TableRecord }>();
const store = useWorkbookStore();

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

/** The revision the filter was started at, which the server compares with the last rewrite. */
let writtenAt = 0;

function save(next: { sort: SortKey[]; filter: string }, revision = store.revision): void {
  void store.setTableDisplay(
    props.table.id,
    next.filter === "" ? { sort: next.sort } : { sort: next.sort, filter: next.filter },
    revision,
  );
}

function setSort(next: SortKey[]): void {
  // Clicking here blurs the filter first, which saves what was typed. This write must carry it too.
  const typed = draft.value.trim();
  save({ sort: next, filter: typed }, typed === filter.value ? store.revision : writtenAt);
}

function addKey(): void {
  const colId = unused.value[0];
  if (colId) setSort([...sort.value, { colId, descending: false }]);
}

function changeKey(index: number, changes: Partial<SortKey>): void {
  setSort(sort.value.map((key, position) => (position === index ? { ...key, ...changes } : key)));
}

function removeKey(index: number): void {
  setSort(sort.value.filter((_, position) => position !== index));
}

const input = ref<HTMLInputElement>();
const focused = ref(false);
const draft = ref(filter.value);
// Follow outside changes, such as undo, unless the filter is being typed.
watch(filter, (stored) => {
  if (!focused.value) draft.value = stored;
});

const typed = computed({
  get: () => (focused.value ? draft.value : null),
  set: (text) => (draft.value = text ?? ""),
});
const assist = useFormulaAssist(
  typed,
  () => input.value,
  () => props.table.id,
);

function onFocus(): void {
  focused.value = true;
  writtenAt = store.revision;
}

function commitFilter(): void {
  const next = draft.value.trim();
  if (next === filter.value || (next === "" && filter.value === "")) return;
  save({ sort: sort.value, filter: next }, writtenAt);
}

function onBlur(): void {
  focused.value = false;
  commitFilter();
}

function onKeydown(event: KeyboardEvent): void {
  if (assist.onKeydown(event)) return;
  if (event.key === "Enter") input.value?.blur();
  else if (event.key === "Escape") {
    draft.value = filter.value;
    input.value?.blur();
  } else return;
  event.preventDefault();
}

function clearFilter(): void {
  draft.value = "";
  save({ sort: sort.value, filter: "" });
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
      <label>
        Filter
        <input
          ref="input"
          v-model="draft"
          class="table-display__filter"
          aria-label="Table filter"
          placeholder="=[Column] > 100"
          spellcheck="false"
          :disabled="!store.canEdit"
          :maxlength="LIMITS.inputLength"
          @keydown="onKeydown"
          @input="assist.track"
          @keyup="assist.track"
          @click="assist.track"
          @focus="onFocus"
          @blur="onBlur"
        />
      </label>
      <button v-if="filter !== '' && store.canEdit" type="button" @click="clearFilter">
        Clear filter
      </button>
      <FormulaAssist
        :items="assist.suggestions.value.items"
        :active="assist.active.value"
        :signature="assist.signature.value"
        :anchor="focused ? input : undefined"
        @pick="assist.accept($event)"
      />
    </span>

    <span class="table-display__group">
      <span class="table-display__label">Sort</span>
      <span v-for="(key, index) in keys" :key="key.colId" class="table-display__key" role="group">
        <select
          :value="key.colId"
          :aria-label="`Sort column ${index + 1}`"
          :disabled="!store.canEdit"
          @change="changeKey(index, { colId: ($event.target as HTMLSelectElement).value })"
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
            changeKey(index, {
              descending: ($event.target as HTMLSelectElement).value === 'descending',
            })
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
