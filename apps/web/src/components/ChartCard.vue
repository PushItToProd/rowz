<script setup lang="ts">
import { isChart, isError, isRange, type CellValue, type ChartType } from "@spreadsheet-app/engine";
import { LIMITS } from "@spreadsheet-app/shared";
import { computed, ref, watch } from "vue";
import type { ViewRecord } from "../api/client";
import { useWorkbookStore } from "../stores/workbook";
import ChartView from "./ChartView.vue";
import EditableName from "./EditableName.vue";
import ErrorWarning from "./ErrorWarning.vue";

const props = defineProps<{ view: ViewRecord }>();
const store = useWorkbookStore();

const TYPES: readonly { value: ChartType; label: string }[] = [
  { value: "bar", label: "Bar" },
  { value: "line", label: "Line" },
  { value: "pie", label: "Pie" },
  { value: "scatter", label: "Scatter" },
];

const editing = ref(false);
let editRevision = store.revision;
const draft = ref(props.view.source);
// Follow changes made elsewhere, such as a table rename rewriting the range.
watch(
  () => props.view.source,
  (source) => {
    if (!editing.value) draft.value = source;
  },
);

async function saveSource(): Promise<void> {
  if (draft.value === props.view.source) return;
  if (!(await store.updateView(props.view.id, { source: draft.value }, editRevision))) {
    editing.value = true;
    editRevision = store.revision;
  }
}

function finishSource(): void {
  void saveSource();
  editing.value = false;
}

function setType(event: Event): void {
  const chartType = (event.target as HTMLSelectElement).value as ChartType;
  void store.updateView(props.view.id, { chartType });
}

function remove(): void {
  if (window.confirm(`Delete ${props.view.name}?`)) void store.deleteView(props.view.id);
}

/** The data to draw, or why there is none. */
const data = computed((): { rows: CellValue[][] } | { problem: string } => {
  if (props.view.source.trim() === "") {
    return { problem: "Enter the cells to chart, such as 'Table 1'!A1:B10." };
  }
  const value = store.evaluateOnPage(props.view.pageId, props.view.source);
  if (isError(value)) {
    const reason = value.message === undefined ? "" : `: ${value.message}`;
    return { problem: `${value.code}${reason}` };
  }
  if (isRange(value)) return { rows: value.rows };
  // A chart function in the data box supplies the data. The kind chosen here still decides the drawing.
  return { rows: isChart(value) ? value.rows : [[value]] };
});
</script>

<template>
  <section class="view-card" :data-view="view.name">
    <header class="view-card__header">
      <h2>
        <ErrorWarning
          v-if="store.errorBlocks.has(view.id)"
          :label="`${view.name} contains errors`"
        />
        <EditableName
          :value="view.name"
          label="Chart name"
          :disabled="!store.canEdit"
          @rename="store.updateView(view.id, { name: $event })"
        />
      </h2>
      <div v-if="store.canEdit" class="view-card__actions">
        <select aria-label="Chart type" :value="view.chartType ?? 'bar'" @change="setType">
          <option v-for="type in TYPES" :key="type.value" :value="type.value">
            {{ type.label }}
          </option>
        </select>
        <button type="button" class="danger" @click="remove">Delete chart</button>
      </div>
    </header>

    <label v-if="store.canEdit" class="view-card__source">
      Data
      <input
        v-model="draft"
        aria-label="Chart data"
        placeholder="'Table 1'!A1:B10"
        :maxlength="LIMITS.viewSourceLength"
        @keydown.enter="saveSource"
        @focus="
          editing = true;
          editRevision = store.revision;
        "
        @blur="finishSource"
      />
    </label>

    <p v-if="'problem' in data" class="view-card__problem">{{ data.problem }}</p>
    <ChartView v-else :chart="view.chartType ?? 'bar'" :rows="data.rows" title="" />
  </section>
</template>
