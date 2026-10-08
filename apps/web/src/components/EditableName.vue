<script setup lang="ts">
import { LIMITS } from "@spreadsheet-app/shared";
import { computed, nextTick, ref, watch } from "vue";

const props = withDefaults(
  defineProps<{
    value: string;
    /** What the name belongs to, for screen readers: "Table name". */
    label: string;
    disabled?: boolean;
    /** Whether a primary click starts editing. A caller can leave clicks for selection or navigation. */
    clickToEdit?: boolean;
    /**
     * Where the name leads, which makes it a link. Enter then follows the link,
     * and F2 renames.
     */
    href?: string;
    /** Whether committing an empty name keeps the editor open or cancels it and emits `empty`. */
    emptyBehavior?: "keep" | "discard";
  }>(),
  { clickToEdit: true, href: undefined, emptyBehavior: "keep" },
);
const emit = defineEmits<{ rename: [name: string]; empty: [] }>();

const draft = ref<string | null>(null);
const input = ref<HTMLInputElement>();
const shown = ref<HTMLElement>();
let clickCanEdit: boolean | null = null;

watch(
  () => props.value,
  (value, previous) => {
    if (value !== previous && draft.value !== null) {
      draft.value = null;
      void nextTick(() => shown.value?.focus());
    }
  },
);

const description = computed(() => {
  if (props.disabled) return undefined;
  if (props.href !== undefined) {
    return props.clickToEdit
      ? "Click or press F2 to rename. Press Enter to open."
      : "Click or press Enter to open. Press F2 to rename.";
  }
  return props.clickToEdit
    ? "Click or press Enter or F2 to rename."
    : "Click to select. Press Enter or F2 to rename.";
});

async function start(): Promise<void> {
  if (props.disabled) return;
  draft.value = props.value;
  await nextTick();
  input.value?.focus();
  input.value?.select();
}

defineExpose({ start });

function commit(keepEmptyDraft = false): void {
  const name = draft.value?.trim();
  if (name === undefined) return;
  if (name === "") {
    if (props.emptyBehavior === "discard") {
      draft.value = null;
      emit("empty");
    } else if (!keepEmptyDraft) draft.value = null;
    return;
  }
  draft.value = null;
  if (name !== props.value) emit("rename", name);
}

function onBlur(): void {
  commit();
}

/** Finishes a keyboard edit; Enter leaves an empty draft open for correction. */
async function finish(keep: boolean): Promise<void> {
  if (keep) commit(true);
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

function onClick(event: MouseEvent): void {
  if (event.detail === 0) {
    clickCanEdit = null;
    return;
  }
  const canEdit = clickCanEdit ?? props.clickToEdit;
  clickCanEdit = null;
  if (
    event.button !== 0 ||
    event.shiftKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    !canEdit ||
    props.disabled
  )
    return;
  event.preventDefault();
  void start();
}

function rememberClickTrigger(): void {
  clickCanEdit = props.clickToEdit;
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
    @blur="onBlur"
  />
  <span v-else class="editable-name-shell">
    <component
      :is="href === undefined ? 'span' : 'a'"
      ref="shown"
      class="editable-name"
      :class="{ 'editable-name--locked': disabled }"
      :href="href"
      :role="href === undefined && !disabled ? 'button' : undefined"
      :tabindex="href === undefined && !disabled ? 0 : undefined"
      :aria-description="description"
      :data-click-to-edit="clickToEdit ? '' : undefined"
      @mousedown.left.capture="rememberClickTrigger"
      @click="onClick"
      @keydown="onKeydown"
    >
      {{ value }}
    </component>
  </span>
</template>
