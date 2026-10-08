<script setup lang="ts">
import { isChart, isError, isRange, type CellValue, type ChartType } from "@spreadsheet-app/engine";
import { LIMITS } from "@spreadsheet-app/shared";
import { computed, ref } from "vue";
import type { ViewRecord } from "../api/client";
import { useWorkbookStore } from "../stores/workbook";
import ChartView from "./ChartView.vue";
import SessionFormulaField from "./SessionFormulaField.vue";
import { sameEditingTarget, useFormulaSessionStore } from "../formula/session";
import { useDialog } from "../useDialog";
import EditableName from "./EditableName.vue";
import ErrorWarning from "./ErrorWarning.vue";
import type { MenuItem } from "./menu";

const props = withDefaults(defineProps<{ view: ViewRecord; collapsed?: boolean }>(), {
  collapsed: false,
});
const emit = defineEmits<{
  actions: [event: MouseEvent, items: MenuItem[]];
  "toggle-collapse": [];
}>();
const store = useWorkbookStore();
const dialog = useDialog();

const TYPES: readonly { value: ChartType; label: string }[] = [
  { value: "bar", label: "Bar" },
  { value: "line", label: "Line" },
  { value: "pie", label: "Pie" },
  { value: "scatter", label: "Scatter" },
];

const sessions = useFormulaSessionStore();
const sourceEditing = computed(
  () =>
    sessions.active &&
    sameEditingTarget(sessions.active.target, { kind: "chart", viewId: props.view.id }),
);
async function ready(): Promise<boolean> {
  const saved = await sessions.submit(store.submitFormulaDraft);
  if (!saved) sessions.focus();
  return saved;
}
async function setType(chartType: ChartType): Promise<void> {
  if (!(await ready())) {
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

const sourceField = ref<InstanceType<typeof SessionFormulaField>>();
async function editSource(): Promise<void> {
  await sourceField.value?.begin();
}

const blockMenuActions = computed((): MenuItem[] => {
  if (!store.canEdit) return [];
  const chartType = props.view.chartType ?? "bar";
  return [
    { label: "Edit", restoreFocus: false, run: editSource },
    ...TYPES.map((type) => ({
      label: `${type.value === chartType ? "✓ " : ""}Chart type: ${type.label}`,
      disabled: type.value === chartType,
      run: () => setType(type.value),
    })),
    { label: "Delete chart", danger: true, run: remove },
  ];
});

function getBlockMenuActions(): MenuItem[] {
  return blockMenuActions.value;
}

defineExpose({ getBlockMenuActions });

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
  <section
    class="view-card"
    :data-view="view.name"
    data-view-kind="chart"
    :data-source-editing="sourceEditing ? '' : undefined"
  >
    <header class="view-card__header" :class="{ 'view-card__header--collapsed': collapsed }">
      <div class="block-card__title">
        <button
          type="button"
          class="block-collapse"
          :aria-expanded="!collapsed"
          :aria-label="`${collapsed ? 'Expand' : 'Collapse'} ${view.name}`"
          @click.stop="emit('toggle-collapse')"
        >
          <span aria-hidden="true">{{ collapsed ? "›" : "⌄" }}</span>
        </button>
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
      </div>
      <div class="block-card__menu">
        <button
          type="button"
          class="view-card__menu-trigger"
          aria-haspopup="menu"
          :aria-label="`Block actions for ${view.name}`"
          @click.stop="emit('actions', $event, getBlockMenuActions())"
        >
          ⋮
        </button>
      </div>
    </header>

    <div v-show="!collapsed" class="block-card__body" :inert="collapsed">
      <label v-if="store.canEdit" class="view-card__source">
        Data
        <SessionFormulaField
          ref="sourceField"
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
    </div>
  </section>
</template>
