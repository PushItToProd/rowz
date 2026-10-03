<script setup lang="ts">
import { GRID_SIZE } from "@spreadsheet-app/shared";
import { computed, onMounted, ref } from "vue";

const props = defineProps<{ axis: "row" | "col"; initial: number }>();
const emit = defineEmits<{ close: []; resize: [size: number | null] }>();
const size = ref(props.initial);
const field = ref<HTMLInputElement>();
const limits = computed(() => GRID_SIZE[props.axis]);
const label = computed(() => `Resize ${props.axis === "row" ? "row" : "column"}`);
const valid = computed(
  () =>
    Number.isInteger(size.value) &&
    size.value >= limits.value.min &&
    size.value <= limits.value.max,
);
onMounted(() => {
  field.value?.focus();
  field.value?.select();
});
</script>

<template>
  <form
    class="resize-lines"
    :aria-label="label"
    @submit.prevent="valid && emit('resize', size)"
    @keydown.esc.stop.prevent="emit('close')"
  >
    <label
      >{{ label }} (px)
      <input
        ref="field"
        v-model.number="size"
        type="number"
        :min="limits.min"
        :max="limits.max"
        step="1"
        required
      />
    </label>
    <button type="submit" class="primary" :disabled="!valid">Apply</button>
    <button type="button" @click="emit('resize', null)">Reset to default</button>
    <button type="button" @click="emit('close')">Cancel</button>
  </form>
</template>
