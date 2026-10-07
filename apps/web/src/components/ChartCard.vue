<script setup lang="ts">
import { isChart, isError, isRange, type CellValue, type ChartType } from "@spreadsheet-app/engine";
import { LIMITS } from "@spreadsheet-app/shared";
import { computed } from "vue";
import type { ViewRecord } from "../api/client";
import { useWorkbookStore } from "../stores/workbook";
import ChartView from "./ChartView.vue";
import SessionFormulaField from "./SessionFormulaField.vue";
import { useFormulaSessionStore } from "../formula/session";
import { useDialog } from "../useDialog";
import EditableName from "./EditableName.vue";
import ErrorWarning from "./ErrorWarning.vue";

const props = defineProps<{ view: ViewRecord }>();
const store = useWorkbookStore();
const dialog = useDialog();

const TYPES: readonly { value: ChartType; label: string }[] = [
  { value: "bar", label: "Bar" },
  { value: "line", label: "Line" },
  { value: "pie", label: "Pie" },
  { value: "scatter", label: "Scatter" },
];

const sessions = useFormulaSessionStore();
async function ready(): Promise<boolean> {
  const saved = await sessions.submit(store.submitFormulaDraft);
  if (!saved) sessions.focus();
  return saved;
}
async function setType(event: Event): Promise<void> {
  const field = event.target as HTMLSelectElement;
  const chartType = field.value as ChartType;
  if (!(await ready())) {
    field.value = props.view.chartType ?? "bar";
    return;
  }
  await store.updateView(props.view.id, { chartType });
}
async function rename(name: string): Promise<void> {
  if (await ready()) await store.updateView(props.view.id, { name });
}
async function remove(): Promise<void> {
  if (!(await ready())) return;
  if (
    await dialog.confirm({
      title: "Delete chart",
      message: `Delete ${props.view.name}?`,
      confirmLabel: "Delete chart",
      danger: true,
    })
  ) {
    await store.deleteView(props.view.id);
  }
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
          @rename="rename"
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
      <SessionFormulaField
        :target="{ kind: 'chart', viewId: view.id }"
        :context="{ pageId: view.pageId }"
        :value="view.source"
        label="Chart data"
        :target-label="`${store.pages.find((page) => page.id === view.pageId)?.name ?? ''} · ${view.name} · Chart data`"
        placeholder="'Table 1'!A1:B10"
        :max-length="LIMITS.viewSourceLength"
      />
    </label>

    <p v-if="'problem' in data" class="view-card__problem">{{ data.problem }}</p>
    <ChartView v-else :chart="view.chartType ?? 'bar'" :rows="data.rows" title="" />
  </section>
</template>
