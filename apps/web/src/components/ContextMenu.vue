<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import type { MenuItem } from "./menu";

const props = defineProps<{
  /** Where the menu opens, in viewport coordinates. */
  x: number;
  y: number;
  label: string;
  items: readonly MenuItem[];
}>();
const emit = defineEmits<{ close: [] }>();

const menu = ref<HTMLElement>();
const position = ref({ left: props.x, top: props.y });
/** What had focus before the menu opened, which gets it back when the menu closes. */
let opener: Element | null = null;

function buttons(): HTMLButtonElement[] {
  return [...(menu.value?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
}

function focusItem(step: number): void {
  const enabled = buttons();
  const current = enabled.indexOf(document.activeElement as HTMLButtonElement);
  const next = current === -1 ? (step > 0 ? 0 : -1) : current + step;
  enabled.at(next % enabled.length)?.focus();
}

function close(): void {
  emit("close");
}

function choose(item: MenuItem): void {
  close();
  item.run();
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape" || event.key === "Tab") close();
  else if (event.key === "ArrowDown") focusItem(1);
  else if (event.key === "ArrowUp") focusItem(-1);
  else if (event.key === "Home") buttons().at(0)?.focus();
  else if (event.key === "End") buttons().at(-1)?.focus();
  else return;
  event.preventDefault();
  // The grid under the menu also listens for these keys.
  event.stopPropagation();
}

function onOutside(event: Event): void {
  if (event.target instanceof Node && menu.value?.contains(event.target)) return;
  close();
}

onMounted(async () => {
  opener = document.activeElement;
  // Capture, so a click that lands on something which stops the event still closes the menu.
  document.addEventListener("mousedown", onOutside, true);
  window.addEventListener("scroll", close, true);
  window.addEventListener("resize", close);
  window.addEventListener("blur", close);
  await nextTick();
  const box = menu.value?.getBoundingClientRect();
  if (box) {
    // Keep the whole menu on screen when it opens near the right or bottom edge.
    position.value = {
      left: Math.max(0, Math.min(props.x, window.innerWidth - box.width - 4)),
      top: Math.max(0, Math.min(props.y, window.innerHeight - box.height - 4)),
    };
  }
  buttons().at(0)?.focus({ preventScroll: true });
});

onBeforeUnmount(() => {
  document.removeEventListener("mousedown", onOutside, true);
  window.removeEventListener("scroll", close, true);
  window.removeEventListener("resize", close);
  window.removeEventListener("blur", close);
  if (opener instanceof HTMLElement) opener.focus({ preventScroll: true });
});
</script>

<template>
  <div
    ref="menu"
    class="context-menu"
    role="menu"
    :aria-label="label"
    :style="{ left: `${position.left}px`, top: `${position.top}px` }"
    @keydown="onKeydown"
    @contextmenu.prevent
  >
    <button
      v-for="item in items"
      :key="item.label"
      type="button"
      role="menuitem"
      :class="{ danger: item.danger, 'context-menu__item--separated': item.separated }"
      :disabled="item.disabled"
      @click="choose(item)"
    >
      {{ item.label }}
    </button>
  </div>
</template>
