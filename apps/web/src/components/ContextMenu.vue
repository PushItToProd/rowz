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
const positioned = ref(false);
/** What had focus before the menu opened, which gets it back when the menu closes. */
let opener: Element | null = null;
let lifecycle = 0;
let resizeObserver: ResizeObserver | undefined;

function buttons(): HTMLButtonElement[] {
  return [...(menu.value?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
}

function focusItem(step: number): void {
  const enabled = buttons();
  const current = enabled.indexOf(document.activeElement as HTMLButtonElement);
  const next = current === -1 ? (step > 0 ? 0 : -1) : current + step;
  enabled.at(next % enabled.length)?.focus();
}

function tabStops(): HTMLElement[] {
  return [
    ...(menu.value?.querySelectorAll<HTMLElement>(
      "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)",
    ) ?? []),
  ];
}

function cycleTab(event: KeyboardEvent): void {
  const enabled = tabStops();
  if (!enabled.length) return;
  const current = enabled.indexOf(document.activeElement as HTMLElement);
  const step = event.shiftKey ? -1 : 1;
  const next =
    current === -1
      ? step > 0
        ? 0
        : enabled.length - 1
      : (current + step + enabled.length) % enabled.length;
  enabled[next]?.focus();
}

function reposition(): void {
  const box = menu.value?.getBoundingClientRect();
  if (!box) return;
  position.value = {
    left: Math.max(0, Math.min(props.x, window.innerWidth - box.width - 4)),
    top: Math.max(0, Math.min(props.y, window.innerHeight - box.height - 4)),
  };
}

function close(): void {
  emit("close");
}

function choose(item: MenuItem): void {
  if (!item.keepOpen) close();
  item.run();
}

function onKeydown(event: KeyboardEvent): void {
  // Let input fields handle their arrow keys while keeping Escape and Tab
  // consistent with the rest of the menu.
  if (event.target instanceof HTMLInputElement && event.key !== "Escape" && event.key !== "Tab")
    return;
  if (event.key === "Tab") {
    if (menu.value?.querySelector("input, select, textarea")) cycleTab(event);
    else close();
  } else if (event.key === "Escape") close();
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
  const mounting = ++lifecycle;
  opener = document.activeElement;
  const element = menu.value;
  if (!element) return;
  await nextTick();
  if (mounting !== lifecycle) return;
  // Keep the whole menu on screen when it opens near the right or bottom edge.
  reposition();
  positioned.value = true;
  await nextTick();
  if (mounting !== lifecycle) return;
  const firstButton = buttons().at(0);
  if (firstButton) firstButton.focus({ preventScroll: true });
  else element.focus({ preventScroll: true });
  if (typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(reposition);
    resizeObserver.observe(element);
  }
  // Start listening after positioning and focus, so setup cannot dismiss a menu
  // that a scroll, resize, or focus change triggered while it was opening.
  document.addEventListener("mousedown", onOutside, true);
  window.addEventListener("scroll", close, true);
  window.addEventListener("resize", close);
  window.addEventListener("blur", close);
});

onBeforeUnmount(() => {
  lifecycle += 1;
  resizeObserver?.disconnect();
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
    tabindex="-1"
    :aria-label="label"
    :style="{
      left: `${position.left}px`,
      top: `${position.top}px`,
      visibility: positioned ? 'visible' : 'hidden',
    }"
    @keydown="onKeydown"
    @contextmenu.prevent
  >
    <button
      v-for="item in items"
      :key="item.label"
      type="button"
      role="menuitem"
      :data-formula-field="item.keepDraft ? '' : undefined"
      :class="{ danger: item.danger, 'context-menu__item--separated': item.separated }"
      :disabled="item.disabled"
      @click="choose(item)"
    >
      {{ item.label }}
    </button>
    <slot name="content" />
  </div>
</template>
