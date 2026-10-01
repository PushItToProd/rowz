<script setup lang="ts">
import { LIMITS } from "@spreadsheet-app/shared";
import { nextTick, ref } from "vue";

const props = defineProps<{
  value: string;
  /** What the name belongs to, for screen readers: "Table name". */
  label: string;
  disabled?: boolean;
}>();
const emit = defineEmits<{ rename: [name: string] }>();

const draft = ref<string | null>(null);
const input = ref<HTMLInputElement>();

async function start(): Promise<void> {
  if (props.disabled) return;
  draft.value = props.value;
  await nextTick();
  input.value?.focus();
  input.value?.select();
}

function commit(): void {
  const name = draft.value?.trim();
  draft.value = null;
  if (name !== undefined && name !== "" && name !== props.value) emit("rename", name);
}
</script>

<template>
  <input
    v-if="draft !== null"
    ref="input"
    v-model="draft"
    class="editable-name editable-name--editing"
    :aria-label="label"
    :maxlength="LIMITS.nameLength"
    @keydown.enter="commit"
    @keydown.esc="draft = null"
    @blur="commit"
  />
  <span
    v-else
    class="editable-name"
    :class="{ 'editable-name--locked': disabled }"
    :title="disabled ? undefined : 'Double-click to rename'"
    @dblclick="start"
  >
    {{ value }}
  </span>
</template>
