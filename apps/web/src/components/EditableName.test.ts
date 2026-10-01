import { mount, type VueWrapper } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import EditableName from "./EditableName.vue";

function render(props: { disabled?: boolean; href?: string } = {}): VueWrapper {
  return mount(EditableName, {
    props: { value: "Table 1", label: "Table name", ...props },
    attachTo: document.body,
  });
}

async function startEditing(wrapper: VueWrapper) {
  await wrapper.get("span").trigger("dblclick");
  return wrapper.get<HTMLInputElement>("input");
}

describe("EditableName", () => {
  it("shows the name until it is double-clicked, then an input holding it", async () => {
    const wrapper = render();
    expect(wrapper.get("span").text()).toBe("Table 1");
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

  it.each(["Table 1", "", "   "])("emits nothing when the name is left as %j", async (name) => {
    const wrapper = render();
    const input = await startEditing(wrapper);
    await input.setValue(name);
    await input.trigger("keydown", { key: "Enter" });
    expect(wrapper.emitted("rename")).toBeUndefined();
  });

  it("discards the draft on Escape", async () => {
    const wrapper = render();
    const input = await startEditing(wrapper);
    await input.setValue("Sales");
    await input.trigger("keydown", { key: "Escape" });
    expect(wrapper.emitted("rename")).toBeUndefined();
    expect(wrapper.get("span").text()).toBe("Table 1");
  });

  it("cannot be edited when disabled", async () => {
    const wrapper = render({ disabled: true });
    await wrapper.get("span").trigger("dblclick");
    await wrapper.get("span").trigger("keydown", { key: "Enter" });
    expect(wrapper.find("input").exists()).toBe(false);
    expect(wrapper.get("span").attributes("title")).toBeUndefined();
    expect(wrapper.get("span").attributes("tabindex")).toBeUndefined();
  });

  it.each(["Enter", "F2"])("can be reached with the keyboard and renamed with %s", async (key) => {
    const wrapper = render();
    expect(wrapper.get("span").attributes()).toMatchObject({ tabindex: "0", role: "button" });
    await wrapper.get("span").trigger("keydown", { key });
    const input = wrapper.get<HTMLInputElement>("input");
    expect(document.activeElement).toBe(input.element);

    await input.setValue("Sales");
    await input.trigger("keydown", { key: "Enter" });
    expect(wrapper.emitted("rename")).toEqual([["Sales"]]);
    // The keyboard is back on the name, not lost to the page.
    expect(document.activeElement).toBe(wrapper.get("span").element);
  });

  it("puts the keyboard back on the name after Escape", async () => {
    const wrapper = render();
    await wrapper.get("span").trigger("keydown", { key: "Enter" });
    await wrapper.get("input").trigger("keydown", { key: "Escape" });
    expect(wrapper.emitted("rename")).toBeUndefined();
    expect(document.activeElement).toBe(wrapper.get("span").element);
  });

  it("is a link when it leads somewhere: Enter is left to the link, and F2 renames", async () => {
    const wrapper = render({ href: "/s/1/p/2" });
    const link = wrapper.get("a");
    expect(link.attributes("href")).toBe("/s/1/p/2");
    expect(link.attributes("role")).toBeUndefined();

    await link.trigger("keydown", { key: "Enter" });
    expect(wrapper.find("input").exists()).toBe(false);
    await link.trigger("keydown", { key: "F2" });
    expect(wrapper.find("input").exists()).toBe(true);
  });
});
