<script setup lang="ts">
import {
  formatValue,
  isAction,
  isButton,
  isChart,
  isControl,
  isDate,
  isError,
  isLambda,
  isMarkdown,
  type CellFormat,
  type CellValue,
  type Scalar,
} from "@spreadsheet-app/engine";
import { computed } from "vue";
import { formattedText, textStyle } from "../formatStyle";
import { markdown } from "../markdown";

const props = defineProps<{
  value: CellValue;
  /** Whether this cell's button is waiting for the server. */
  running: boolean;
  /** Whether the viewer may run buttons. */
  canRun: boolean;
  /** Whether the cell is in a checkbox column, where TRUE, FALSE, and empty show as a checkbox. */
  checkbox?: boolean;
  /** How the cell is shown: bold, color, a number format, and so on. */
  format?: CellFormat;
}>();
const emit = defineEmits<{ run: []; choose: [value: Scalar]; toggle: [checked: boolean] }>();

const text = computed(
  () => formattedText(props.value, props.format ?? {}) ?? formatValue(props.value),
);
const style = computed(() => {
  if (!props.format) return undefined;
  const styles = textStyle(props.format);
  // An error stays in the color of errors, whatever color the cell's text is given.
  if (isError(props.value)) Reflect.deleteProperty(styles, "color");
  return styles;
});
const kind = computed(() => {
  const { value } = props;
  if (isButton(value)) return "button";
  if (isControl(value)) return value.control;
  if (isAction(value)) return "action";
  if (isLambda(value)) return "function";
  if (isChart(value)) return "chart";
  if (isMarkdown(value)) return "markdown";
  if (isError(value)) return "error";
  if (isDate(value)) return "date";
  return typeof value === "string" || value === null ? "text" : typeof value;
});
/** The HTML of a Markdown value. A cell is one line, so only formatting within a line applies. */
const formatted = computed(() =>
  isMarkdown(props.value) ? markdown.renderInline(props.value.text) : "",
);
const hint = computed(() => (isError(props.value) ? props.value.message : undefined));

const control = computed(() => (isControl(props.value) ? props.value : undefined));
/** Which dropdown choice the target cell holds, or -1 when it holds none of them. */
const chosen = computed(() => {
  const current = control.value;
  return current ? current.options.findIndex((option) => option === current.value) : -1;
});

function onChoice(event: Event): void {
  const index = Number((event.target as HTMLSelectElement).value);
  emit("choose", control.value?.options[index] ?? null);
}
</script>

<template>
  <button
    v-if="kind === 'button'"
    type="button"
    class="cell-button"
    :disabled="running || !canRun"
    @click="$emit('run')"
  >
    {{ running ? "Running…" : text }}
  </button>
  <label
    v-else-if="checkbox && (value === null || typeof value === 'boolean')"
    class="cell-control cell-control--column"
  >
    <input
      type="checkbox"
      aria-label="Checked"
      :checked="value === true"
      :disabled="!canRun"
      @change="emit('toggle', ($event.target as HTMLInputElement).checked)"
    />
  </label>
  <label v-else-if="control && kind === 'checkbox'" class="cell-control">
    <input
      type="checkbox"
      :checked="control.value === true"
      :disabled="running || !canRun"
      @change="emit('choose', ($event.target as HTMLInputElement).checked)"
    />
    {{ control.label }}
  </label>
  <select
    v-else-if="control && kind === 'dropdown'"
    class="cell-control cell-control--dropdown"
    aria-label="Choose a value"
    :value="chosen"
    :disabled="running || !canRun"
    @change="onChoice"
  >
    <option :value="-1"></option>
    <option v-for="(option, index) in control.options" :key="index" :value="index">
      {{ formatValue(option) }}
    </option>
  </select>
  <span
    v-else-if="kind === 'action'"
    class="cell-value cell-value--action"
    title="An action runs when it is inside BUTTON()"
  >
    {{ text }}
  </span>
  <span
    v-else-if="kind === 'function'"
    class="cell-value cell-value--action"
    title="A function. Call it from another cell by this cell's address, such as =A1(5)"
  >
    {{ text }}
  </span>
  <span
    v-else-if="kind === 'chart'"
    class="cell-value cell-value--action"
    title="A chart. Add a text view to the page and show it there with {{ }}"
  >
    {{ text }}
  </span>
  <!-- eslint-disable vue/no-v-html -- markdown-it output with raw HTML disabled -->
  <span
    v-else-if="kind === 'markdown'"
    class="cell-value cell-value--markdown"
    :style="style"
    v-html="formatted"
  ></span>
  <!-- eslint-enable vue/no-v-html -->
  <span v-else class="cell-value" :class="`cell-value--${kind}`" :style="style" :title="hint">{{
    text
  }}</span>
</template>
