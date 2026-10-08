<script setup lang="ts">
import { inject, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import type { MenuItem } from "./menu";
import { registerContextMenu } from "./contextMenuState";
import { contextMenuPosition, type ViewportBounds } from "./contextMenuPosition";
import { contextMenuClickGuardKey } from "./contextMenuControl";

const props = defineProps<{
  /** Where the menu opens, in visual viewport coordinates. */
  x: number;
  y: number;
  label: string;
  items: readonly MenuItem[];
  /** Focus target to use when the element that opened the menu was removed. */
  restoreFocusTarget?: () => HTMLElement | null;
}>();
const emit = defineEmits<{ close: [] }>();
const controlGuard = inject(contextMenuClickGuardKey);

const menu = ref<HTMLElement>();
const position = ref({ left: props.x, top: props.y });
const positioned = ref(false);
/** What had focus before the menu opened, which gets it back when the menu closes. */
let opener: Element | null = null;
let lifecycle = 0;
let resizeObserver: ResizeObserver | undefined;
let unregister: (() => void) | undefined;
let closed = false;
let focusRestoreAfter: Promise<unknown> | undefined;
let restoreFocusAfterAction = true;

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
  const element = menu.value;
  if (!element) return;
  const viewport: ViewportBounds = {
    left: window.visualViewport?.offsetLeft ?? 0,
    top: window.visualViewport?.offsetTop ?? 0,
    width: window.visualViewport?.width ?? window.innerWidth,
    height: window.visualViewport?.height ?? window.innerHeight,
  };
  const availableWidth = Math.max(0, viewport.width - 8);
  const availableHeight = Math.max(0, viewport.height - 8);
  element.style.minWidth = `${Math.min(190, availableWidth).toString()}px`;
  element.style.maxWidth = `${availableWidth.toString()}px`;
  element.style.maxHeight = `${availableHeight.toString()}px`;
  const box = element.getBoundingClientRect();
  position.value = contextMenuPosition(props.x, props.y, box.width, box.height, viewport);
}

function close(): void {
  if (closed) return;
  closed = true;
  emit("close");
}

function choose(item: MenuItem): void {
  if (!item.keepOpen) {
    restoreFocusAfterAction = item.restoreFocus !== false;
    close();
  }
  const result = item.run();
  if (!item.keepOpen && result instanceof Promise) {
    focusRestoreAfter = result;
  }
}

function restoreFocus(): void {
  const target =
    opener instanceof HTMLElement && opener.isConnected ? opener : props.restoreFocusTarget?.();
  target?.focus({ preventScroll: true });
}

function restoreFocusWhenReady(): void {
  if (!focusRestoreAfter) {
    if (restoreFocusAfterAction) restoreFocus();
    return;
  }
  const afterAction = async (): Promise<void> => {
    await nextTick();
    if (restoreFocusAfterAction) restoreFocus();
  };
  void focusRestoreAfter.then(afterAction, afterAction);
}

function beforeMenuAction(event: MouseEvent): void {
  controlGuard?.(event);
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

function onScrollIntent(event: Event): void {
  if (event.target instanceof Node && menu.value?.contains(event.target)) return;
  close();
}

onMounted(async () => {
  unregister = registerContextMenu(close);
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
  // Listen after positioning and focus, so setup events do not dismiss the menu.
  document.addEventListener("mousedown", onOutside, true);
  window.addEventListener("wheel", onScrollIntent, { capture: true, passive: true });
  window.addEventListener("touchmove", onScrollIntent, { capture: true, passive: true });
  window.addEventListener("resize", close);
  window.addEventListener("blur", close);
  window.visualViewport?.addEventListener("scroll", reposition);
  window.visualViewport?.addEventListener("resize", reposition);
});

onBeforeUnmount(() => {
  lifecycle += 1;
  resizeObserver?.disconnect();
  unregister?.();
  document.removeEventListener("mousedown", onOutside, true);
  window.removeEventListener("wheel", onScrollIntent, true);
  window.removeEventListener("touchmove", onScrollIntent, true);
  window.removeEventListener("resize", close);
  window.removeEventListener("blur", close);
  window.visualViewport?.removeEventListener("scroll", reposition);
  window.visualViewport?.removeEventListener("resize", reposition);
  restoreFocusWhenReady();
});
</script>

<template>
  <Teleport to="body">
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
      @click.capture="beforeMenuAction"
      @contextmenu.prevent
    >
      <button
        v-for="item in items"
        :key="item.label"
        type="button"
        role="menuitem"
        tabindex="-1"
        :data-formula-field="item.keepDraft ? '' : undefined"
        :class="{ danger: item.danger, 'context-menu__item--separated': item.separated }"
        :disabled="item.disabled"
        @click="choose(item)"
      >
        {{ item.label }}
      </button>
      <slot name="content" />
    </div>
  </Teleport>
</template>
