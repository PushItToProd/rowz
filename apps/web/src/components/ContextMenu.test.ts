import { defineComponent, h, nextTick, ref } from "vue";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bodyFindAll, bodyGet } from "../testing/teleported";
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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ContextMenu", () => {
  it("teleports the menu into the top-level body layer", async () => {
    wrapper = mount(ContextMenu, {
      props: { x: 40, y: 60, label: "Actions", items: items().all },
      attachTo: document.body,
    });
    await flushPromises();

    const menu = document.body.querySelector<HTMLElement>(".context-menu");
    expect(menu?.parentElement).toBe(document.body);
  });

  it("opens where it was asked to, as a menu of items, with the first one focused", async () => {
    render(items().all);
    await flushPromises();
    const menu = bodyGet('[role="menu"]');
    expect(menu.attributes("role")).toBe("menu");
    expect(menu.attributes("aria-label")).toBe("Actions");
    expect(menu.attributes("style")).toContain("left: 40px");
    expect(menu.attributes("style")).toContain("top: 60px");
    expect(bodyFindAll('[role="menuitem"]').map((item) => item.text())).toEqual([
      "First",
      "Off",
      "Last",
    ]);
    expect(focused()).toBe("First");
  });

  it("focuses the menu when all its items are disabled, so Escape closes it", async () => {
    render([{ label: "Unavailable", disabled: true, run: vi.fn() }]);
    await flushPromises();

    const menu = bodyGet('[role="menu"]');
    expect(menu.attributes("tabindex")).toBe("-1");
    expect(document.activeElement).toBe(menu.element);
    await menu.trigger("keydown", { key: "Escape" });
    expect(wrapper.emitted("close")).toHaveLength(1);
  });

  it("does not close during its initial positioning and focus", async () => {
    render(items().all);
    const menu = bodyGet('[role="menu"]');
    expect(menu.isVisible()).toBe(false);
    window.dispatchEvent(new Event("scroll"));
    window.dispatchEvent(new Event("resize"));
    window.dispatchEvent(new Event("blur"));
    await flushPromises();

    expect(wrapper.emitted("close")).toBeUndefined();
    expect(menu.isVisible()).toBe(true);
  });

  it("repositions when custom content makes the menu taller", async () => {
    let notifyResize: ResizeObserverCallback | undefined;
    class ResizeObserverStub {
      constructor(callback: ResizeObserverCallback) {
        notifyResize = callback;
      }
      observe = (): void => undefined;
      unobserve = (): void => undefined;
      disconnect = (): void => undefined;
    }
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);

    const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      if (this.classList.contains("context-menu")) {
        const height = this.querySelector("input") ? 60 : 30;
        return {
          x: 0,
          y: 0,
          top: 0,
          right: 100,
          bottom: height,
          left: 0,
          width: 100,
          height,
          toJSON: () => ({}),
        };
      }
      return originalGetBoundingClientRect.call(this);
    });

    const showCustom = ref(false);
    const host = defineComponent({
      setup() {
        return () =>
          h(
            ContextMenu,
            {
              x: 40,
              y: window.innerHeight - 40,
              label: "Rows",
              items: [{ label: "More…", run: vi.fn() }],
            },
            { content: () => (showCustom.value ? h("form", [h("input")]) : null) },
          );
      },
    });
    wrapper = mount(host, { attachTo: document.body });
    await flushPromises();

    const menu = bodyGet(".context-menu");
    expect(Number.parseFloat(menu.element.style.top)).toBe(window.innerHeight - 40);

    showCustom.value = true;
    await nextTick();
    notifyResize?.([], {} as ResizeObserver);
    await nextTick();

    expect(Number.parseFloat(menu.element.style.top)).toBe(window.innerHeight - 40 - 60);
  });

  it("runs the chosen item and closes", async () => {
    const { first, all } = items();
    render(all);
    await bodyGet("button[role='menuitem']").trigger("click");
    expect(first.run).toHaveBeenCalledOnce();
    expect(wrapper.emitted("close")).toHaveLength(1);
  });

  it("keeps the menu open for an item that reveals more menu content", async () => {
    const reveal = { label: "More…", keepOpen: true, run: vi.fn() };
    render([reveal]);
    await bodyGet("button[role='menuitem']").trigger("click");
    expect(reveal.run).toHaveBeenCalledOnce();
    expect(wrapper.emitted("close")).toBeUndefined();
  });

  it("does not run an item that is off", async () => {
    const { off, all } = items();
    render(all);
    expect(bodyFindAll("button[role='menuitem']")[1]!.attributes("disabled")).toBeDefined();
    await bodyFindAll("button[role='menuitem']")[1]!.trigger("click");
    expect(off.run).not.toHaveBeenCalled();
  });

  it("moves between the items that are on with the arrow keys, wrapping at the ends", async () => {
    render(items().all);
    await flushPromises();
    const menu = bodyGet('[role="menu"]');
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
    render(all);
    const menu = bodyGet('[role="menu"]');
    await menu.trigger("keydown", { key });
    expect(wrapper.emitted("close")).toHaveLength(1);
    expect(first.run).not.toHaveBeenCalled();
  });

  it("cycles Tab through enabled menu buttons and inputs when custom content is open", async () => {
    wrapper = mount(ContextMenu, {
      props: { x: 40, y: 60, label: "Actions", items: items().all },
      slots: {
        content: () => h("form", [h("input"), h("button", { type: "submit" }, "Add rows")]),
      },
      attachTo: document.body,
    });
    await flushPromises();

    const input = bodyGet("input").element;
    const addButton = bodyFindAll("button").at(-1)!.element;
    const firstButton = bodyFindAll("button")[0]!.element;
    input.focus();
    const forward = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Tab",
    });
    input.dispatchEvent(forward);
    expect(forward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(addButton);

    const wrapForward = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Tab",
    });
    addButton.dispatchEvent(wrapForward);
    expect(document.activeElement).toBe(firstButton);

    const wrapBackward = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Tab",
      shiftKey: true,
    });
    firstButton.dispatchEvent(wrapBackward);
    expect(document.activeElement).toBe(addButton);
    expect(wrapper.emitted("close")).toBeUndefined();
  });

  it("closes when the mouse is pressed outside it, and not when pressed inside", async () => {
    render(items().all);
    await flushPromises();
    bodyGet('[role="menu"]').element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(wrapper.emitted("close")).toBeUndefined();
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(wrapper.emitted("close")).toHaveLength(1);
  });

  it("closes for user scrolling and resize, but not programmatic scroll", async () => {
    render(items().all);
    await flushPromises();
    window.dispatchEvent(new Event("scroll"));
    expect(wrapper.emitted("close")).toBeUndefined();

    bodyGet('[role="menu"]').element.dispatchEvent(new Event("wheel", { bubbles: true }));
    expect(wrapper.emitted("close")).toBeUndefined();

    document.body.dispatchEvent(new Event("wheel", { bubbles: true }));
    expect(wrapper.emitted("close")).toHaveLength(1);
    window.dispatchEvent(new Event("resize"));
    expect(wrapper.emitted("close")).toHaveLength(1);
  });

  it("gives focus back to what had it when it closes", async () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    render(items().all);
    await flushPromises();
    expect(document.activeElement).not.toBe(opener);
    wrapper.unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
    // The shared afterEach unmounts again, which is harmless.
    render([]);
  });
});
