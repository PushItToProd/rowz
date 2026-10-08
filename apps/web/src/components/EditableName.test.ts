import { mount, type VueWrapper } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { clickWithDetail } from "../testing";
import EditableName from "./EditableName.vue";

function render(
  props: { clickToEdit?: boolean; disabled?: boolean; href?: string } = {},
): VueWrapper {
  return mount(EditableName, {
    props: { value: "Table 1", label: "Table name", ...props },
    attachTo: document.body,
  });
}

function shown(wrapper: VueWrapper) {
  return wrapper.get(".editable-name");
}

async function startEditing(wrapper: VueWrapper) {
  const name = shown(wrapper);
  await name.trigger("mousedown", { button: 0 });
  await clickWithDetail(name.element);
  return wrapper.get<HTMLInputElement>("input");
}

describe("EditableName", () => {
  it("shows the name until it is clicked, then an input holding it", async () => {
    const wrapper = render();
    expect(shown(wrapper).text()).toBe("Table 1");
    expect(wrapper.find("input").exists()).toBe(false);

    const input = await startEditing(wrapper);
    expect(input.element.value).toBe("Table 1");
    expect(input.attributes("aria-label")).toBe("Table name");
    expect(document.activeElement).toBe(input.element);
  });

  it("emits the trimmed new name on Enter and returns to showing the name", async () => {
    const wrapper = render();
    const input = await startEditing(wrapper);
    await input.setValue("  Sales  ");
    await input.trigger("keydown", { key: "Enter" });
    expect(wrapper.emitted("rename")).toEqual([["Sales"]]);
    expect(wrapper.find("input").exists()).toBe(false);
  });

  it("emits once when Enter is followed by the input losing focus", async () => {
    const wrapper = render();
    const input = await startEditing(wrapper);
    await input.setValue("Sales");
    await input.trigger("blur");
    expect(wrapper.emitted("rename")).toEqual([["Sales"]]);
  });

  it.each(["", "   ", "Table 1"])(
    "discards an empty or unchanged draft on blur: %j",
    async (name) => {
      const wrapper = render();
      const input = await startEditing(wrapper);
      await input.setValue(name);
      await input.trigger("blur");

      expect(wrapper.emitted("rename")).toBeUndefined();
      expect(wrapper.find("input").exists()).toBe(false);
      expect(shown(wrapper).text()).toBe("Table 1");
    },
  );

  it.each(["Table 1", "", "   "])("emits nothing when the name is left as %j", async (name) => {
    const wrapper = render();
    const input = await startEditing(wrapper);
    await input.setValue(name);
    await input.trigger("keydown", { key: "Enter" });
    expect(wrapper.emitted("rename")).toBeUndefined();
    expect(wrapper.find("input").exists()).toBe(name.trim() === "");
    if (name.trim() === "") expect(document.activeElement).toBe(input.element);
  });

  it("discards the draft on Escape", async () => {
    const wrapper = render();
    const input = await startEditing(wrapper);
    await input.setValue("Sales");
    await input.trigger("keydown", { key: "Escape" });
    expect(wrapper.emitted("rename")).toBeUndefined();
    expect(shown(wrapper).text()).toBe("Table 1");
  });

  it("cannot be edited when disabled", async () => {
    const wrapper = render({ disabled: true });
    const name = shown(wrapper);
    await name.trigger("mousedown", { button: 0 });
    await clickWithDetail(name.element);
    await name.trigger("keydown", { key: "Enter" });
    expect(wrapper.find("input").exists()).toBe(false);
    expect(shown(wrapper).attributes("title")).toBeUndefined();
    expect(shown(wrapper).attributes("aria-description")).toBeUndefined();
    expect(shown(wrapper).attributes("tabindex")).toBeUndefined();
  });

  it("keeps the rename instructions accessible without showing a visible hint", async () => {
    const wrapper = render({ clickToEdit: false });
    const name = shown(wrapper);
    expect(name.attributes("aria-description")).toBe(
      "Click to select. Press Enter or F2 to rename.",
    );
    expect(name.attributes("title")).toBeUndefined();
    expect(wrapper.find('[role="tooltip"]').exists()).toBe(false);

    await wrapper.get(".editable-name-shell").trigger("mouseenter");
    await name.trigger("focus");
    expect(wrapper.find('[role="tooltip"]').exists()).toBe(false);
  });

  it.each(["Enter", "F2"])("can be reached with the keyboard and renamed with %s", async (key) => {
    const wrapper = render();
    expect(shown(wrapper).attributes()).toMatchObject({ tabindex: "0", role: "button" });
    await shown(wrapper).trigger("keydown", { key });
    const input = wrapper.get<HTMLInputElement>("input");
    expect(document.activeElement).toBe(input.element);

    await input.setValue("Sales");
    await input.trigger("keydown", { key: "Enter" });
    expect(wrapper.emitted("rename")).toEqual([["Sales"]]);
    // The keyboard is back on the name, not lost to the page.
    expect(document.activeElement).toBe(shown(wrapper).element);
  });

  it("puts the keyboard back on the name after Escape", async () => {
    const wrapper = render();
    await shown(wrapper).trigger("keydown", { key: "Enter" });
    await wrapper.get("input").trigger("keydown", { key: "Escape" });
    expect(wrapper.emitted("rename")).toBeUndefined();
    expect(document.activeElement).toBe(shown(wrapper).element);
  });

  it("leaves a link's Enter key to navigation and keeps F2 for renaming", async () => {
    const wrapper = render({ clickToEdit: false, href: "/s/1/p/2" });
    const link = shown(wrapper);
    expect(link.attributes("href")).toBe("/s/1/p/2");
    expect(link.attributes("role")).toBeUndefined();

    await link.trigger("keydown", { key: "Enter" });
    expect(wrapper.find("input").exists()).toBe(false);
    await link.trigger("keydown", { key: "F2" });
    expect(wrapper.find("input").exists()).toBe(true);
  });

  it("lets a primary click rename a linked name when the caller enables it", async () => {
    const wrapper = render({ href: "/s/1/p/2" });
    const input = await startEditing(wrapper);
    expect(input.element.value).toBe("Table 1");
  });

  it.each([
    ["Shift", { shiftKey: true }],
    ["Ctrl", { ctrlKey: true }],
    ["Cmd", { metaKey: true }],
    ["Alt", { altKey: true }],
  ] as const)("does not rename on a %s-click", async (_modifier, modifiers) => {
    const wrapper = render();
    const name = shown(wrapper);
    await clickWithDetail(name.element, 1, modifiers);
    expect(wrapper.find("input").exists()).toBe(false);
    expect(name.text()).toBe("Table 1");
  });
});
