<script setup lang="ts">
import { LIMITS } from "@spreadsheet-app/shared";
import { computed, nextTick, ref } from "vue";

const props = defineProps<{
  value: string;
  /** What the name belongs to, for screen readers: "Table name". */
  label: string;
  disabled?: boolean;
  /**
   * Where the name leads, which makes it a link. Enter then follows the link,
   * and F2 renames. Whoever gives it handles the click.
   */
  href?: string;
}>();
const emit = defineEmits<{ rename: [name: string] }>();

const draft = ref<string | null>(null);
const input = ref<HTMLInputElement>();
const shown = ref<HTMLElement>();

const hint = computed(() => {
  if (props.disabled) return undefined;
  return `Double-click or press ${props.href === undefined ? "Enter" : "F2"} to rename`;
});

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

/** Ends an edit made with the keyboard, and puts the keyboard back on the name. */
async function finish(keep: boolean): Promise<void> {
  if (keep) commit();
  else draft.value = null;
  await nextTick();
  shown.value?.focus();
}

function onKeydown(event: KeyboardEvent): void {
  const renames = event.key === "F2" || (event.key === "Enter" && props.href === undefined);
  if (!renames || props.disabled) return;
  // The key is spent here: a grid around the name would take Enter to mean its own cell.
  event.preventDefault();
  event.stopPropagation();
  void start();
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
    @keydown.enter.stop="finish(true)"
    @keydown.esc.stop="finish(false)"
    @blur="commit"
  />
  <component
    :is="href === undefined ? 'span' : 'a'"
    v-else
    ref="shown"
    class="editable-name"
    :class="{ 'editable-name--locked': disabled }"
    :href="href"
    :role="href === undefined && !disabled ? 'button' : undefined"
    :tabindex="href === undefined && !disabled ? 0 : undefined"
    :title="hint"
    @dblclick="start"
    @keydown="onKeydown"
  >
    {{ value }}
  </component>
</template>
