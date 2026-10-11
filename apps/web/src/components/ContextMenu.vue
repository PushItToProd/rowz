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
// Only the editor provides a guard, which saves an open formula draft before an item runs.
// The default says a menu outside the editor, such as one on the document list, needs none.
const controlGuard = inject(contextMenuClickGuardKey, undefined);

const menu = ref<HTMLElement>();
/** The menu of further choices that is open beside this one, and the item it belongs to. */
const nested = ref<HTMLElement>();
const opened = ref<{ item: MenuItem; left: number; top: number; placed: boolean } | null>(null);
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

/** The items that can be chosen in the menu that has focus. */
function buttons(): HTMLButtonElement[] {
  const within = nested.value?.contains(document.activeElement) ? nested.value : menu.value;
  return [...(within?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
}

function contains(target: EventTarget | null): boolean {
  return (
    target instanceof Node &&
    [menu.value, nested.value].some((element) => element?.contains(target))
  );
}

/** The button of the item whose submenu is open. */
function openedButton(): HTMLButtonElement | undefined {
  return menu.value?.querySelector<HTMLButtonElement>('button[aria-expanded="true"]') ?? undefined;
}

function closeSubmenu(returnFocus = false): void {
  if (!opened.value) return;
  const button = openedButton();
  opened.value = null;
  if (returnFocus) button?.focus({ preventScroll: true });
}

/** Opens an item's submenu beside the item, on the side that has room for it. */
async function openSubmenu(
  item: MenuItem,
  button: HTMLElement,
  focusFirst: boolean,
): Promise<void> {
  if (opened.value?.item.label !== item.label)
    opened.value = { item, left: 0, top: 0, placed: false };
  await nextTick();
  placeSubmenu(item, button, focusFirst);
}

function placeSubmenu(item: MenuItem, button: HTMLElement, focusFirst: boolean): void {
  const element = nested.value;
  const state = opened.value;
  // Another item may have been chosen, or the menu closed, while this one waited to be drawn.
  if (!element || state?.item.label !== item.label) return;
  const viewport = viewportBounds();
  element.style.maxHeight = `${Math.max(0, viewport.height - 8).toString()}px`;
  element.style.maxWidth = `${Math.max(0, viewport.width - 8).toString()}px`;
  const anchor = button.getBoundingClientRect();
  const box = element.getBoundingClientRect();
  const right = viewport.left + viewport.width - 4;
  const bottom = viewport.top + viewport.height - 4;
  const beside = anchor.right + 2;
  const left = beside + box.width <= right ? beside : anchor.left - box.width - 2;
  state.left = Math.max(viewport.left + 4, Math.min(left, right - box.width));
  // The first item sits level with the item that opened the menu.
  state.top = Math.max(viewport.top + 4, Math.min(anchor.top - 5, bottom - box.height));
  state.placed = true;
  if (focusFirst)
    element.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({
      preventScroll: true,
    });
}

/**
 * A mouse over an item opens its submenu, and over another item closes the one
 * that is open. This follows movement, since a menu can open with an item
 * already under the pointer, which the pointer then never enters.
 */
function onItemHover(event: PointerEvent, item: MenuItem): void {
  if (event.pointerType !== "mouse" || item.disabled) return;
  if (!item.submenu) closeSubmenu();
  else if (opened.value?.item.label !== item.label && event.currentTarget instanceof HTMLElement)
    void openSubmenu(item, event.currentTarget, false);
}

function viewportBounds(): ViewportBounds {
  return {
    left: window.visualViewport?.offsetLeft ?? 0,
    top: window.visualViewport?.offsetTop ?? 0,
    width: window.visualViewport?.width ?? window.innerWidth,
    height: window.visualViewport?.height ?? window.innerHeight,
  };
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
  // The submenu was placed against where its item was.
  closeSubmenu();
  const viewport = viewportBounds();
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

function choose(item: MenuItem, event?: MouseEvent): void {
  if (item.submenu) {
    if (event?.currentTarget instanceof HTMLElement)
      void openSubmenu(item, event.currentTarget, true);
    return;
  }
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
  } else if (event.key === "Escape" || event.key === "ArrowLeft") {
    // In a submenu, both go back to the menu it opened from.
    if (nested.value?.contains(document.activeElement)) closeSubmenu(true);
    else if (event.key === "Escape") close();
    else return;
  } else if (event.key === "ArrowRight") {
    const focused = document.activeElement;
    if (!(focused instanceof HTMLButtonElement) || focused.getAttribute("aria-haspopup") !== "menu")
      return;
    focused.click();
  } else if (event.key === "ArrowDown") focusItem(1);
  else if (event.key === "ArrowUp") focusItem(-1);
  else if (event.key === "Home") buttons().at(0)?.focus();
  else if (event.key === "End") buttons().at(-1)?.focus();
  else return;
  event.preventDefault();
  // The grid under the menu also listens for these keys.
  event.stopPropagation();
}

function onOutside(event: Event): void {
  if (contains(event.target)) return;
  close();
}

function onScrollIntent(event: Event): void {
  if (contains(event.target)) return;
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
      @scroll="closeSubmenu()"
    >
      <button
        v-for="item in items"
        :key="item.label"
        type="button"
        role="menuitem"
        tabindex="-1"
        :data-formula-field="item.keepDraft ? '' : undefined"
        :class="{
          danger: item.danger,
          'context-menu__item--separated': item.separated,
          'context-menu__item--submenu': item.submenu,
        }"
        :disabled="item.disabled"
        :aria-haspopup="item.submenu ? 'menu' : undefined"
        :aria-expanded="item.submenu ? opened?.item.label === item.label : undefined"
        @click="choose(item, $event)"
        @pointermove="onItemHover($event, item)"
      >
        {{ item.label }}
      </button>
      <slot name="content" />
    </div>
    <div
      v-if="opened"
      ref="nested"
      class="context-menu"
      role="menu"
      tabindex="-1"
      :aria-label="opened.item.label"
      :style="{
        left: `${opened.left}px`,
        top: `${opened.top}px`,
        visibility: opened.placed ? 'visible' : 'hidden',
      }"
      @keydown="onKeydown"
      @click.capture="beforeMenuAction"
      @contextmenu.prevent
    >
      <button
        v-for="item in opened.item.submenu"
        :key="item.label"
        type="button"
        role="menuitem"
        tabindex="-1"
        :class="{ danger: item.danger }"
        :disabled="item.disabled"
        @click="choose(item)"
      >
        {{ item.label }}
      </button>
    </div>
  </Teleport>
</template>
