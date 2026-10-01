import { mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import ContextMenu from "./ContextMenu.vue";
import type { MenuItem } from "./menu";

let wrapper: VueWrapper;

function render(items: MenuItem[]): VueWrapper {
  wrapper = mount(ContextMenu, {
    props: { x: 40, y: 60, label: "Actions", items },
    attachTo: document.body,
  });
  return wrapper;
}

function items(): { first: MenuItem; off: MenuItem; last: MenuItem; all: MenuItem[] } {
  const first = { label: "First", run: vi.fn() };
  const off = { label: "Off", disabled: true, run: vi.fn() };
  const last = { label: "Last", danger: true, separated: true, run: vi.fn() };
  return { first, off, last, all: [first, off, last] };
}

const focused = (): string | undefined => document.activeElement?.textContent.trim();

afterEach(() => {
  wrapper.unmount();
});

describe("ContextMenu", () => {
  it("opens where it was asked to, as a menu of items, with the first one focused", async () => {
    const menu = render(items().all);
    await menu.vm.$nextTick();
    expect(menu.attributes("role")).toBe("menu");
    expect(menu.attributes("aria-label")).toBe("Actions");
    expect(menu.attributes("style")).toContain("left: 40px");
    expect(menu.attributes("style")).toContain("top: 60px");
    expect(menu.findAll('[role="menuitem"]').map((item) => item.text())).toEqual([
      "First",
      "Off",
      "Last",
    ]);
    expect(focused()).toBe("First");
  });

  it("runs the chosen item and closes", async () => {
    const { first, all } = items();
    const menu = render(all);
    await menu.get("button").trigger("click");
    expect(first.run).toHaveBeenCalledOnce();
    expect(menu.emitted("close")).toHaveLength(1);
  });

  it("does not run an item that is off", async () => {
    const { off, all } = items();
    const menu = render(all);
    expect(menu.findAll("button")[1]!.attributes("disabled")).toBeDefined();
    await menu.findAll("button")[1]!.trigger("click");
    expect(off.run).not.toHaveBeenCalled();
  });

  it("moves between the items that are on with the arrow keys, wrapping at the ends", async () => {
    const menu = render(items().all);
    await menu.vm.$nextTick();
    await menu.trigger("keydown", { key: "ArrowDown" });
    expect(focused()).toBe("Last");
    await menu.trigger("keydown", { key: "ArrowDown" });
    expect(focused()).toBe("First");
    await menu.trigger("keydown", { key: "ArrowUp" });
    expect(focused()).toBe("Last");
    await menu.trigger("keydown", { key: "Home" });
    expect(focused()).toBe("First");
    await menu.trigger("keydown", { key: "End" });
    expect(focused()).toBe("Last");
  });

  it.each(["Escape", "Tab"])("closes on %s without running anything", async (key) => {
    const { first, all } = items();
    const menu = render(all);
    await menu.trigger("keydown", { key });
    expect(menu.emitted("close")).toHaveLength(1);
    expect(first.run).not.toHaveBeenCalled();
  });

  it("closes when the mouse is pressed outside it, and not when pressed inside", async () => {
    const menu = render(items().all);
    await menu.vm.$nextTick();
    (menu.element as HTMLElement).dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(menu.emitted("close")).toBeUndefined();
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(menu.emitted("close")).toHaveLength(1);
  });

  it("closes when the page scrolls or the window changes size", async () => {
    const menu = render(items().all);
    await menu.vm.$nextTick();
    window.dispatchEvent(new Event("scroll"));
    window.dispatchEvent(new Event("resize"));
    expect(menu.emitted("close")).toHaveLength(2);
  });

  it("gives focus back to what had it when it closes", async () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    const menu = render(items().all);
    await menu.vm.$nextTick();
    expect(document.activeElement).not.toBe(opener);
    menu.unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
    // The shared afterEach unmounts again, which is harmless.
    render([]);
  });
});
