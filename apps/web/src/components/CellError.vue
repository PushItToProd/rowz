<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useId, watch } from "vue";
import type { ErrorValue } from "@spreadsheet-app/engine";
import ErrorTrace from "./ErrorTrace.vue";

const props = defineProps<{
  error: ErrorValue;
  textStyle?: Record<string, string>;
  resizeTo?: { rowCount: number; colCount: number };
}>();
const emit = defineEmits<{ resize: []; trace: [trace: NonNullable<ErrorValue["trace"]>] }>();
const explanation = computed(
  () =>
    props.error.message ??
    {
      "#DIV/0!": "The formula divides by zero.",
      "#VALUE!": "A value has the wrong type or is outside the allowed range.",
      "#NUM!": "A number is outside the range accepted by a function.",
      "#REF!": "The formula refers to a cell, column, or block that cannot be found.",
      "#NAME?": "The formula uses an unknown or ambiguous name.",
      "#N/A": "No matching value was found.",
      "#SPILL!":
        "The result is too large for the table or cells in its result range already have values.",
      "#CYCLE!": "The formula depends on itself through a cycle of references.",
      "#ASSERT!": "An assertion failed.",
      "#ERROR!": "The formula could not be parsed or has invalid arguments.",
    }[props.error.code],
);
const anchor = ref<HTMLElement>();
const open = ref(false);
const id = useId();
const titleId = `${id}-title`;
const descriptionId = `${id}-description`;
const popover = ref<HTMLElement>();
const hasTrace = computed(() => !!props.error.trace?.length);
const interactive = computed(() => !!props.resizeTo || hasTrace.value);
const position = computed(() => {
  if (!open.value) return {};
  const rect = anchor.value?.getBoundingClientRect();
  if (!rect) return {};
  return {
    ...(rect.bottom > window.innerHeight / 2
      ? { bottom: `${String(window.innerHeight - rect.top + 6)}px` }
      : { top: `${String(rect.bottom + 6)}px` }),
    left: `${String(Math.max(8, Math.min(rect.left, window.innerWidth - 328)))}px`,
  };
});
function focusGrid(): void {
  anchor.value?.closest<HTMLElement>(".grid")?.focus({ preventScroll: true });
}
function close(): void {
  clearTimeout(leaveTimer);
  const focusIsInAnchor = anchor.value?.contains(document.activeElement) ?? false;
  const focusIsInPopover = popover.value?.contains(document.activeElement) ?? false;
  open.value = false;
  if (focusIsInAnchor || focusIsInPopover) focusGrid();
}
function onScroll(event: Event): void {
  if (event.target instanceof Node && popover.value?.contains(event.target)) return;
  close();
}
function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") close();
}
function onFocusout(event: FocusEvent): void {
  const next = event.relatedTarget;
  if (next instanceof Node && (popover.value?.contains(next) || anchor.value?.contains(next)))
    return;
  close();
}
watch(open, (visible, _, cleanup) => {
  if (!visible) return;
  window.addEventListener("scroll", onScroll, true);
  window.addEventListener("resize", close);
  document.addEventListener("keydown", onKeydown);
  cleanup(() => {
    window.removeEventListener("scroll", onScroll, true);
    window.removeEventListener("resize", close);
    document.removeEventListener("keydown", onKeydown);
  });
});
let leaveTimer: ReturnType<typeof setTimeout> | undefined;
function show(): void {
  clearTimeout(leaveTimer);
  open.value = true;
}
function leave(): void {
  if (
    anchor.value?.contains(document.activeElement) ||
    popover.value?.contains(document.activeElement)
  )
    return;
  leaveTimer = setTimeout(close, 150);
}
let spacePressed = false;
function onActionKeydown(event: KeyboardEvent): void {
  if (event.key === "Enter") {
    event.preventDefault();
    if (!event.repeat) emit("resize");
  } else if (event.key === " ") {
    event.preventDefault();
    if (!event.repeat) spacePressed = true;
  }
}
function onActionKeyup(event: KeyboardEvent): void {
  if (event.key !== " " || !spacePressed) return;
  event.preventDefault();
  spacePressed = false;
  emit("resize");
}
onBeforeUnmount(() => {
  clearTimeout(leaveTimer);
  if (popover.value?.contains(document.activeElement)) focusGrid();
});
</script>

<template>
  <span
    ref="anchor"
    class="cell-value cell-value--error"
    :style="textStyle"
    tabindex="0"
    :aria-haspopup="interactive ? 'dialog' : undefined"
    :aria-expanded="interactive ? open : undefined"
    :aria-controls="interactive && open ? id : undefined"
    :aria-describedby="open ? descriptionId : undefined"
    @mouseenter="show"
    @mouseleave="leave"
    @focus="show"
    @blur="onFocusout"
    @keydown.esc.stop="close"
  >
    {{ error.code }}
  </span>
  <Teleport to="body">
    <div
      v-if="open"
      :id="id"
      ref="popover"
      :role="interactive ? 'dialog' : 'tooltip'"
      :aria-labelledby="interactive ? titleId : undefined"
      class="cell-error-popover"
      :style="position"
      @mouseenter="show"
      @mouseleave="leave"
      @focusout="onFocusout"
    >
      <strong :id="titleId">{{ error.code }}</strong>
      <p :id="descriptionId">{{ explanation }}</p>
      <ErrorTrace v-if="error.trace?.length" :trace="error.trace" @go="emit('trace', $event)" />
      <button
        v-if="resizeTo"
        type="button"
        class="cell-error-popover__action"
        @click="emit('resize')"
        @keydown="onActionKeydown"
        @keyup="onActionKeyup"
        @blur="spacePressed = false"
      >
        Resize table to fit
      </button>
      <p v-if="resizeTo" class="cell-error-popover__hint">
        Alt+Enter focuses this button; Enter or Space resizes the table.
      </p>
    </div>
  </Teleport>
</template>
