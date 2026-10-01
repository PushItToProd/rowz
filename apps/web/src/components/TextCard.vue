<script setup lang="ts">
import { formatValue, renderTemplate } from "@spreadsheet-app/engine";
import { LIMITS } from "@spreadsheet-app/shared";
import { computed, ref, watch } from "vue";
import type { ViewRecord } from "../api/client";
import { markdown } from "../markdown";
import { useWorkbookStore } from "../stores/workbook";
import ChartView from "./ChartView.vue";
import EditableName from "./EditableName.vue";

const props = defineProps<{ view: ViewRecord }>();
const store = useWorkbookStore();

const editing = ref(false);
const draft = ref(props.view.source);
// Follow changes made elsewhere, such as a table rename rewriting an expression.
watch(
  () => props.view.source,
  (source) => {
    if (!editing.value) draft.value = source;
  },
);

function save(): void {
  if (draft.value !== props.view.source)
    void store.updateView(props.view.id, { source: draft.value });
}

function toggle(): void {
  if (editing.value) save();
  editing.value = !editing.value;
}

function remove(): void {
  if (window.confirm(`Delete ${props.view.name}?`)) void store.deleteView(props.view.id);
}

/** What the view shows. While editing, it follows what is being typed. */
const parts = computed(() =>
  renderTemplate(editing.value ? draft.value : props.view.source, (expression, names) =>
    store.evaluateOnPage(props.view.pageId, expression, names),
  ).map((part) =>
    part.type === "markdown" ? { ...part, html: markdown.render(part.text) } : part,
  ),
);
</script>

<template>
  <section class="view-card" :data-view="view.name">
    <header class="view-card__header">
      <h2>
        <EditableName
          :value="view.name"
          label="Text view name"
          :disabled="!store.canEdit"
          @rename="store.updateView(view.id, { name: $event })"
        />
      </h2>
      <div v-if="store.canEdit" class="view-card__actions">
        <button type="button" @click="toggle">{{ editing ? "Done" : "Edit" }}</button>
        <button type="button" class="danger" @click="remove">Delete text</button>
      </div>
    </header>

    <textarea
      v-if="editing"
      v-model="draft"
      class="text-view__source"
      aria-label="Text view source"
      rows="10"
      spellcheck="false"
      :maxlength="LIMITS.viewSourceLength"
      @blur="save"
    ></textarea>

    <div class="text-view">
      <template v-for="(part, index) in parts" :key="index">
        <!-- eslint-disable-next-line vue/no-v-html -- markdown-it output with raw HTML disabled -->
        <div v-if="part.type === 'markdown'" class="text-view__markdown" v-html="part.html"></div>
        <table v-else-if="part.type === 'table'" class="text-view__table">
          <tbody>
            <tr v-for="(cells, row) in part.rows" :key="row">
              <td
                v-for="(cell, col) in cells"
                :key="col"
                :class="{ 'text-view__number': typeof cell === 'number' }"
              >
                {{ formatValue(cell) }}
              </td>
            </tr>
          </tbody>
        </table>
        <ChartView
          v-else-if="part.type === 'chart'"
          :chart="part.chart.chart"
          :rows="part.chart.rows"
          :title="part.chart.title"
        />
        <p v-else class="view-card__problem" role="alert">{{ part.message }}</p>
      </template>
      <p v-if="parts.length === 0" class="view-card__problem">This view is empty.</p>
    </div>
  </section>
</template>
