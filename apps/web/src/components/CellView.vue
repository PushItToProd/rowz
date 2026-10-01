<script setup lang="ts">
import { formatValue, isAction, isButton, isError, type CellValue } from "@spreadsheet-app/engine";
import { computed } from "vue";

const props = defineProps<{
  value: CellValue;
  /** Whether this cell's button is waiting for the server. */
  running: boolean;
  /** Whether the viewer may run buttons. */
  canRun: boolean;
}>();
defineEmits<{ run: [] }>();

const text = computed(() => formatValue(props.value));
const kind = computed(() => {
  const { value } = props;
  if (isButton(value)) return "button";
  if (isAction(value)) return "action";
  if (isError(value)) return "error";
  return typeof value === "string" || value === null ? "text" : typeof value;
});
const hint = computed(() => (isError(props.value) ? props.value.message : undefined));
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
  <span
    v-else-if="kind === 'action'"
    class="cell-value cell-value--action"
    title="An action runs when it is inside BUTTON()"
  >
    {{ text }}
  </span>
  <span v-else class="cell-value" :class="`cell-value--${kind}`" :title="hint">{{ text }}</span>
</template>
