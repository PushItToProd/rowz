<script setup lang="ts">
import {
  formatValue,
  isAction,
  isButton,
  isChart,
  isControl,
  isDate,
  isError,
  isFunction,
  isMarkdown,
  type CellFormat,
  type CellValue,
  type ErrorTraceFrame,
  type Scalar,
} from "@spreadsheet-app/engine";
import { LIMITS } from "@spreadsheet-app/shared";
import { computed, nextTick, ref, watch } from "vue";
import { formattedText, textStyle } from "../formatStyle";
import { markdown } from "../markdown";
import CellError from "./CellError.vue";
import ConfirmDialog from "./ConfirmDialog.vue";

const props = defineProps<{
  value: CellValue;
  /** A table size that resolves a table-dimension spill, when it fits the shared limits. */
  spillResizeTo?: { rowCount: number; colCount: number };
  /** Whether this cell's button is waiting for the server. */
  running: boolean;
  /** Whether the viewer may run buttons. */
  canRun: boolean;
  /** Whether the cell is in a checkbox column, where TRUE, FALSE, and empty show as a checkbox. */
  checkbox?: boolean;
  /** How the cell is shown: bold, color, a number format, and so on. */
  format?: CellFormat;
  /** The choices of a dropdown column. A cell in one shows a dropdown. */
  choices?: readonly string[];
}>();
const emit = defineEmits<{
  run: [];
  choose: [value: Scalar];
  edit: [value: string | number];
  toggle: [checked: boolean];
  pick: [text: string];
  resizeTable: [size: { rowCount: number; colCount: number }];
  trace: [trace: ErrorTraceFrame[]];
  confirmation: [open: boolean];
}>();

const confirmation = ref<string | null>(null);
const returnFocus = ref<HTMLElement>();

/** Whether the cell shows a dropdown column's choices: it holds a plain value, not an error or a control. */
const picking = computed(
  () =>
    props.choices !== undefined &&
    ["text", "number", "boolean", "date"].includes(kind.value) &&
    !isButton(props.value),
);
/** What the cell holds, which a dropdown column shows as the selected choice. */
const held = computed(() => formatValue(props.value));
/** A value that is not one of the choices stays, and is marked. */
const outside = computed(() => held.value !== "" && !props.choices?.includes(held.value));

const text = computed(
  () => formattedText(props.value, props.format ?? {}) ?? formatValue(props.value),
);
const buttonConfirmation = computed(() =>
  isButton(props.value) ? props.value.action.confirm : undefined,
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
  if (isFunction(value)) return "function";
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

const control = computed(() => (isControl(props.value) ? props.value : undefined));
const inputControl = computed(() =>
  control.value && (control.value.control === "textbox" || control.value.control === "numberbox")
    ? control.value
    : undefined,
);
const inputText = computed(() => {
  const value = inputControl.value?.value;
  return value === null || value === undefined ? "" : formatValue(value);
});
const inputPlaceholder = computed(() => {
  const current = inputControl.value?.value;
  return inputControl.value?.control === "numberbox" && current !== null && current !== undefined
    ? formatValue(current)
    : undefined;
});
const inputDraft = ref<string | number>("");
let lastSubmitted: string | number | undefined;
watch(
  () => [inputControl.value?.control, inputControl.value?.value] as const,
  () => {
    inputDraft.value = inputText.value;
    lastSubmitted = undefined;
  },
  { immediate: true },
);
watch(inputDraft, (value, previous) => {
  if (value !== previous) lastSubmitted = undefined;
});
watch(
  () => props.running,
  (running, previous) => {
    if (!running && previous) lastSubmitted = undefined;
  },
);
/** Which dropdown choice the target cell holds, or -1 when it holds none of them. */
const chosen = computed(() => {
  const current = control.value;
  return current ? current.options.findIndex((option) => option === current.value) : -1;
});

function resizeTable(): void {
  if (props.spillResizeTo) emit("resizeTable", props.spillResizeTo);
}

function runButton(event: MouseEvent): void {
  if (!isButton(props.value)) return;
  if (props.value.action.confirm === undefined) {
    emit("run");
    return;
  }
  returnFocus.value = event.currentTarget as HTMLElement;
  confirmation.value = props.value.action.confirm;
  emit("confirmation", true);
}

async function confirmButton(): Promise<void> {
  const shouldRun = confirmation.value !== null && props.canRun;
  confirmation.value = null;
  await nextTick();
  returnFocus.value = undefined;
  emit("confirmation", false);
  if (shouldRun) emit("run");
}

async function cancelConfirmation(): Promise<void> {
  confirmation.value = null;
  await nextTick();
  returnFocus.value = undefined;
  emit("confirmation", false);
}

function onChoice(event: Event): void {
  const index = Number((event.target as HTMLSelectElement).value);
  emit("choose", control.value?.options[index] ?? null);
}

function commitInput(event: Event, reportNativeValidity = false): void {
  const input = event.target as HTMLInputElement;
  if (inputControl.value?.control === "numberbox" && input.validity.badInput) {
    if (reportNativeValidity) input.reportValidity();
    return;
  }
  if (
    !inputControl.value ||
    String(inputDraft.value) === inputText.value ||
    inputDraft.value === lastSubmitted
  )
    return;
  lastSubmitted = inputDraft.value;
  emit("edit", inputDraft.value);
}

function commitInputOnEnter(event: KeyboardEvent): void {
  event.preventDefault();
  event.stopPropagation();
  commitInput(event, true);
}
</script>

<template>
  <button
    v-if="kind === 'button'"
    type="button"
    class="cell-button"
    :disabled="running || !canRun"
    :aria-haspopup="buttonConfirmation !== undefined ? 'dialog' : undefined"
    @click="runButton"
  >
    {{ running ? "Running…" : text }}
  </button>
  <select
    v-else-if="picking"
    class="cell-control cell-control--dropdown"
    :class="{ 'cell-control--outside': outside }"
    aria-label="Choose a value"
    :value="held"
    :disabled="!canRun"
    :title="outside ? `${held} is not one of the choices` : undefined"
    @change="emit('pick', ($event.target as HTMLSelectElement).value)"
  >
    <option value=""></option>
    <option v-if="outside" :value="held">{{ held }}</option>
    <option v-for="choice in choices" :key="choice" :value="choice">{{ choice }}</option>
  </select>
  <label v-else-if="inputControl" class="cell-control cell-control--input">
    <span v-if="inputControl.label">{{ inputControl.label }}</span>
    <input
      v-model="inputDraft"
      :type="inputControl.control === 'numberbox' ? 'number' : 'text'"
      :step="inputControl.control === 'numberbox' ? 'any' : undefined"
      :maxlength="inputControl.control === 'textbox' ? LIMITS.inputLength : undefined"
      :placeholder="inputPlaceholder"
      :aria-label="
        inputControl.label || (inputControl.control === 'numberbox' ? 'Number input' : 'Text input')
      "
      :disabled="running || !canRun"
      @keydown.enter="commitInputOnEnter"
      @blur="commitInput"
    />
  </label>
  <div
    v-else-if="checkbox && (value === null || typeof value === 'boolean')"
    class="cell-control cell-control--column"
  >
    <span class="cell-control__checkbox-target">
      <input
        type="checkbox"
        class="cell-control__checkbox"
        aria-label="Checked"
        :checked="value === true"
        :disabled="!canRun"
        @change="emit('toggle', ($event.target as HTMLInputElement).checked)"
      />
      <span
        class="cell-control__checkbox-visual"
        :class="{
          'cell-control__checkbox-visual--checked': value === true,
          'cell-control__checkbox-visual--disabled': !canRun,
        }"
        aria-hidden="true"
      ></span>
    </span>
  </div>
  <label v-else-if="control && kind === 'checkbox'" class="cell-control cell-control--checkbox">
    <span class="cell-control__checkbox-target">
      <input
        type="checkbox"
        class="cell-control__checkbox"
        :aria-label="control.label || 'Checkbox'"
        :checked="control.value === true"
        :disabled="running || !canRun"
        @change="emit('choose', ($event.target as HTMLInputElement).checked)"
      />
      <span
        class="cell-control__checkbox-visual"
        :class="{
          'cell-control__checkbox-visual--checked': control.value === true,
          'cell-control__checkbox-visual--disabled': running || !canRun,
        }"
        aria-hidden="true"
      ></span>
    </span>
    <span v-if="control.label" class="cell-control__checkbox-label">
      {{ control.label }}
    </span>
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
  <CellError
    v-else-if="isError(value)"
    :error="value"
    :text-style="style"
    :resize-to="spillResizeTo"
    @resize="resizeTable"
    @trace="emit('trace', $event)"
  />
  <span v-else class="cell-value" :class="`cell-value--${kind}`" :style="style">{{ text }}</span>
  <ConfirmDialog
    v-if="confirmation !== null"
    :message="confirmation"
    :return-focus="returnFocus"
    @confirm="confirmButton"
    @cancel="cancelConfirmation"
  />
</template>
