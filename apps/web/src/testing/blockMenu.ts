import { DOMWrapper, flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import type { Component } from "vue";
import ContextMenu from "../components/ContextMenu.vue";
import type { MenuItem } from "../components/menu";

/** Opens the shared block menu from a card's ellipsis in an isolated card test. */
export async function openBlockActionMenu(
  wrapper: VueWrapper,
  blockName: string,
  cardComponent?: Component,
): Promise<{ menu: DOMWrapper<Element>; close: () => void }> {
  const card = cardComponent ? wrapper.findComponent(cardComponent) : wrapper;
  await card.get(`button[aria-label="Block actions for ${blockName}"]`).trigger("click");
  const event = card.emitted("actions")?.at(-1);
  const items = event?.[1];
  if (!Array.isArray(items)) throw new Error("The block did not emit its menu actions");

  const menu = mount(ContextMenu, {
    props: { x: 0, y: 0, label: `Actions for ${blockName}`, items: items as MenuItem[] },
    attachTo: document.body,
  });
  await flushPromises();
  const element = [...document.body.querySelectorAll<HTMLElement>('[role="menu"]')].find(
    (candidate) => candidate.getAttribute("aria-label") === `Actions for ${blockName}`,
  );
  if (!element) {
    menu.unmount();
    throw new Error(`The block menu for ${blockName} did not open`);
  }
  return {
    menu: new DOMWrapper(element),
    close: () => {
      menu.unmount();
    },
  };
}

/** Chooses one block action from the shared menu in an isolated card test. */
export async function chooseBlockAction(
  wrapper: VueWrapper,
  blockName: string,
  label: string,
  cardComponent?: Component,
): Promise<void> {
  const opened = await openBlockActionMenu(wrapper, blockName, cardComponent);
  try {
    const item = opened.menu
      .findAll('[role="menuitem"]')
      .find((candidate) => candidate.text() === label);
    if (!item) throw new Error(`No block menu item named ${label}`);
    await item.trigger("click");
    await flushPromises();
  } finally {
    opened.close();
  }
}
