<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import type { TableRecord } from "../api/client";

const props = defineProps<{ table: TableRecord }>();
const emit = defineEmits<{
  close: [];
  save: [settings: { freezeRows: number; freezeColumns: number }];
}>();

const form = ref<HTMLFormElement>();
const first = ref<HTMLInputElement>();
const freezeRows = ref(props.table.display.freezeRows ?? 0);
const freezeColumns = ref(props.table.display.freezeColumns ?? 0);
const maxRows = computed(() => (props.table.columns ? 1 : props.table.rowCount));
const valid = computed(
  () =>
    Number.isInteger(freezeRows.value) &&
    freezeRows.value >= 0 &&
    freezeRows.value <= maxRows.value &&
    Number.isInteger(freezeColumns.value) &&
    freezeColumns.value >= 0 &&
    freezeColumns.value <= props.table.colCount,
);

function submit(): void {
  if (!valid.value) return;
  emit("save", { freezeRows: freezeRows.value, freezeColumns: freezeColumns.value });
}

function onOutside(event: Event): void {
  if (event.target instanceof Node && form.value?.contains(event.target)) return;
  emit("close");
}

onMounted(() => {
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
    class="freeze-settings"
    role="dialog"
    :aria-label="`Freeze ${table.name}`"
    @submit.prevent="submit"
    @keydown.esc.stop="emit('close')"
  >
    <label>
      Freeze first rows
      <input
        ref="first"
        v-model.number="freezeRows"
        type="number"
        min="0"
        :max="maxRows"
        required
      />
    </label>
    <label>
      Freeze first columns
      <input v-model.number="freezeColumns" type="number" min="0" :max="table.colCount" required />
    </label>
    <button type="submit" class="primary" :disabled="!valid">Apply</button>
    <button type="button" @click="emit('close')">Cancel</button>
  </form>
</template>
