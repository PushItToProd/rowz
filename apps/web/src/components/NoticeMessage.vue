<script setup lang="ts">
import { onMounted, onUnmounted, watch } from "vue";
import { RouterLink } from "vue-router";
import type { Notice } from "../notice";

const props = defineProps<{ notice: Notice }>();
const emit = defineEmits<{ dismiss: [] }>();

const SUCCESS_MS = 4000;
const ERROR_MS = 8000;

watch(
  () => props.notice,
  (notice, _previous, onCleanup) => {
    if (notice.action) return;

    const timer = window.setTimeout(
      () => {
        if (props.notice === notice) emit("dismiss");
      },
      notice.kind === "error" ? ERROR_MS : SUCCESS_MS,
    );
    onCleanup(() => {
      window.clearTimeout(timer);
    });
  },
  { immediate: true },
);

function dismissOnEscape(event: KeyboardEvent): void {
  if (event.key === "Escape") emit("dismiss");
}

onMounted(() => {
  document.addEventListener("keydown", dismissOnEscape, true);
});
onUnmounted(() => {
  document.removeEventListener("keydown", dismissOnEscape, true);
});
</script>

<template>
  <div
    class="notice notice--floating"
    :class="`notice--${notice.kind}`"
    :role="notice.kind === 'error' ? 'alert' : 'status'"
  >
    <span>{{ notice.text }}</span>
    <RouterLink v-if="notice.action" class="notice__action" :to="notice.action.to">
      {{ notice.action.label }}
    </RouterLink>
    <button type="button" aria-label="Dismiss" @click="emit('dismiss')">×</button>
  </div>
</template>
