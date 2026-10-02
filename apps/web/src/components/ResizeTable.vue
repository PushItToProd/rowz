<script setup lang="ts">
import { LIMITS } from "@spreadsheet-app/shared";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import type { TableRecord } from "../api/client";

const props = defineProps<{ table: TableRecord }>();
const emit = defineEmits<{ close: []; resize: [size: { rowCount: number; colCount: number }] }>();

const form = ref<HTMLFormElement>();
const first = ref<HTMLInputElement>();
const colCount = ref(props.table.colCount);
const rowCount = ref(props.table.rowCount);

function fits(count: unknown, most: number, least = 1): count is number {
  return Number.isInteger(count) && (count as number) >= least && (count as number) <= most;
}

const valid = computed(
  () =>
    fits(colCount.value, LIMITS.tableCols) &&
    fits(rowCount.value, LIMITS.tableRows, props.table.columns ? 0 : 1),
);

function submit(): void {
  if (!valid.value) return;
  emit("resize", { rowCount: rowCount.value, colCount: colCount.value });
}

function onOutside(event: Event): void {
  if (event.target instanceof Node && form.value?.contains(event.target)) return;
  emit("close");
}

onMounted(() => {
  // Capture, so a press on something that stops the event still closes the form.
  document.addEventListener("mousedown", onOutside, true);
  first.value?.select();
});
onBeforeUnmount(() => {
  document.removeEventListener("mousedown", onOutside, true);
});
</script>

<template>
  <form
    ref="form"
    class="resize-table"
    role="dialog"
    :aria-label="`Resize ${table.name}`"
    @submit.prevent="submit"
    @keydown.esc.stop="emit('close')"
  >
    <label>
      Columns
      <input
        ref="first"
        v-model.number="colCount"
        type="number"
        min="1"
        :max="LIMITS.tableCols"
        required
      />
    </label>
    <label>
      Rows
      <input
        v-model.number="rowCount"
        type="number"
        :min="table.columns ? 0 : 1"
        :max="LIMITS.tableRows"
        required
      />
    </label>
    <button type="submit" class="primary" :disabled="!valid">Resize</button>
    <button type="button" @click="emit('close')">Cancel</button>
  </form>
</template>
