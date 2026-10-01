<script setup lang="ts">
import {
  formatValue,
  isAction,
  isButton,
  isControl,
  isDate,
  isError,
  isLambda,
  type CellValue,
  type Scalar,
} from "@spreadsheet-app/engine";
import { computed } from "vue";

const props = defineProps<{
  value: CellValue;
  /** Whether this cell's button is waiting for the server. */
  running: boolean;
  /** Whether the viewer may run buttons. */
  canRun: boolean;
}>();
const emit = defineEmits<{ run: []; choose: [value: Scalar] }>();

const text = computed(() => formatValue(props.value));
const kind = computed(() => {
  const { value } = props;
  if (isButton(value)) return "button";
  if (isControl(value)) return value.control;
  if (isAction(value)) return "action";
  if (isLambda(value)) return "function";
  if (isError(value)) return "error";
  if (isDate(value)) return "date";
  return typeof value === "string" || value === null ? "text" : typeof value;
});
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
  <span v-else class="cell-value" :class="`cell-value--${kind}`" :title="hint">{{ text }}</span>
</template>
