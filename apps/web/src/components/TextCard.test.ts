import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, type ViewRecord } from "../api/client";
import { useWorkbookStore } from "../stores/workbook";
import { at, snapshotWith, type MockedApi } from "../testing";
import TextCard from "./TextCard.vue";

vi.mock("../api/client", async () => {
  const testing = await import("../testing");
  return { api: testing.mockApi(), setJournaledHandler: testing.setJournaledHandler };
});
const server = api as unknown as MockedApi;

const TEXT: ViewRecord = {
  id: "v1",
  pageId: "p1",
  kind: "text",
  name: "Text 1",
  position: 1,
  source: "",
  chartType: null,
};
const CELLS = { A1: "apples", B1: "3", A2: "pears", B2: "5" };

let wrapper: VueWrapper;
const confirm = vi.spyOn(window, "confirm");

async function render(source: string, role = "owner"): Promise<void> {
  server.getSnapshot.mockResolvedValue({
    ...snapshotWith(CELLS, role),
    views: [{ ...TEXT, source }],
  });
  const store = useWorkbookStore();
  await store.load("s1");
  wrapper = mount(
    {
      components: { TextCard },
      setup: () => ({ store }),
      template: `<TextCard v-if="store.views[0]" :view="store.views[0]" />`,
    },
    { attachTo: document.body },
  );
}

function button(name: string) {
  const found = wrapper.findAll("button").find((candidate) => candidate.text() === name);
  if (!found) throw new Error(`No button named ${name}`);
  return found;
}

const shown = () => wrapper.get(".text-view");

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  confirm.mockReturnValue(true);
  server.updateView.mockImplementation((_id, changes) => Promise.resolve({ ...TEXT, ...changes }));
});
afterEach(() => {
  wrapper.unmount();
});

describe("TextCard", () => {
  it("shows Markdown with the values of its formulas written in", async () => {
    await render("## Fruit\n\nWe have **{{ SUM('Table 1'!B1:B2) }}** pieces.");
    expect(shown().get("h2").text()).toBe("Fruit");
    expect(shown().get("p").text()).toBe("We have 8 pieces.");
    expect(shown().get("strong").text()).toBe("8");
  });

  it("updates when a cell changes", async () => {
    await render("{{ 'Table 1'!B1 * 2 }}");
    expect(shown().text()).toBe("6");
    await useWorkbookStore().setCell(at("B1"), "10");
    await flushPromises();
    expect(shown().text()).toBe("20");
  });

  it("repeats a part for each row of a range", async () => {
    await render("{% for name, count in 'Table 1'!A1:B2 %}\n- {{ name }}: {{ count }}\n{% end %}");
    expect(
      shown()
        .findAll("li")
        .map((item) => item.text()),
    ).toEqual(["apples: 3", "pears: 5"]);
  });

  it("shows a range as a table, with numbers to the right", async () => {
    await render("{{ 'Table 1'!A1:B2 }}");
    const cells = shown().findAll(".text-view__table td");
    expect(cells.map((cell) => cell.text())).toEqual(["apples", "3", "pears", "5"]);
    expect(cells.map((cell) => cell.classes("text-view__number"))).toEqual([
      false,
      true,
      false,
      true,
    ]);
  });

  it("draws a chart a formula gives", async () => {
    await render(`{{ PIE_CHART('Table 1'!A1:B2, "Fruit") }}`);
    expect(shown().get(".chart").attributes("data-chart")).toBe("pie");
    expect(shown().findAll(".chart__slice")).toHaveLength(2);
    expect(shown().get("figcaption").text()).toBe("Fruit");
  });

  it("shows HTML in the source and in cell values as text, and does not run it", async () => {
    await render("<img src=x onerror=alert(1)> {{ 'Table 1'!C1 }}");
    await useWorkbookStore().setCell(at("C1"), "<script>alert(2)</script>");
    await flushPromises();
    expect(shown().find("img").exists()).toBe(false);
    expect(shown().find("script").exists()).toBe(false);
    expect(shown().text()).toContain("<img src=x onerror=alert(1)>");
    expect(shown().text()).toContain("<script>alert(2)</script>");
  });

  it("does not make a link out of a javascript: address", async () => {
    await render("[click](javascript:alert(1)) and [fine](https://example.com)");
    expect(
      shown()
        .findAll("a")
        .map((link) => link.attributes("href")),
    ).toEqual(["https://example.com"]);
  });

  it("formats Markdown that a formula made on purpose", async () => {
    await render(`{{ MARKDOWN("**" & 'Table 1'!A1 & "**") }} and {{ "**plain**" }}`);
    expect(
      shown()
        .findAll("strong")
        .map((found) => found.text()),
    ).toEqual(["apples"]);
    expect(shown().text()).toBe("apples and **plain**");
  });

  it("does not let a cell's text become Markdown", async () => {
    await render("{{ 'Table 1'!C1 }}");
    await useWorkbookStore().setCell(at("C1"), "[x](https://example.com) **bold**");
    await flushPromises();
    expect(shown().find("a").exists()).toBe(false);
    expect(shown().find("strong").exists()).toBe(false);
    expect(shown().text()).toBe("[x](https://example.com) **bold**");
  });

  it("names the line of a tag that is written wrong", async () => {
    await render("fine\n{% for %}");
    expect(shown().get('[role="alert"]').text()).toMatch(/^Line 2: /);
  });

  it("says so when it is empty", async () => {
    await render("   ");
    expect(shown().text()).toBe("This view is empty.");
  });

  it("previews what is typed while editing, and saves on Done", async () => {
    await render("old");
    expect(wrapper.find("textarea").exists()).toBe(false);

    await button("Edit").trigger("click");
    const editor = wrapper.get<HTMLTextAreaElement>("textarea");
    expect(editor.element.value).toBe("old");
    await editor.setValue("new {{ 1 + 1 }}");
    expect(shown().text()).toBe("new 2");
    expect(server.updateView).not.toHaveBeenCalled();

    await button("Done").trigger("click");
    await flushPromises();
    expect(server.updateView).toHaveBeenCalledWith("v1", { source: "new {{ 1 + 1 }}" });
    expect(wrapper.find("textarea").exists()).toBe(false);
    expect(shown().text()).toBe("new 2");
  });

  it("saves and stops editing when the editor loses focus", async () => {
    await render("old");
    await button("Edit").trigger("click");
    const editor = wrapper.get<HTMLTextAreaElement>("textarea");
    expect(document.activeElement).toBe(editor.element);
    await editor.setValue("new");
    editor.element.blur();
    await flushPromises();
    expect(server.updateView).toHaveBeenCalledExactlyOnceWith("v1", { source: "new" });
    expect(wrapper.find("textarea").exists()).toBe(false);
    expect(button("Edit").exists()).toBe(true);
  });

  it("goes on editing when it is the window that loses focus", async () => {
    await render("old");
    await button("Edit").trigger("click");
    await wrapper.get("textarea").setValue("new");
    // The browser sends a blur and leaves the editor as the document's active element.
    await wrapper.get("textarea").trigger("blur");
    await flushPromises();
    expect(server.updateView).toHaveBeenCalledOnce();
    expect(wrapper.find("textarea").exists()).toBe(true);
  });

  it("starts editing on a double click of the text", async () => {
    await render("old");
    await shown().trigger("dblclick");
    const editor = wrapper.get<HTMLTextAreaElement>("textarea");
    expect(editor.element.value).toBe("old");
    expect(document.activeElement).toBe(editor.element);
    expect(button("Done").exists()).toBe(true);
  });

  it("does not save when nothing changed", async () => {
    await render("same");
    await button("Edit").trigger("click");
    await button("Done").trigger("click");
    expect(server.updateView).not.toHaveBeenCalled();
  });

  it("deletes the view after confirming", async () => {
    await render("text");
    confirm.mockReturnValue(false);
    await button("Delete text").trigger("click");
    expect(server.deleteView).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    await button("Delete text").trigger("click");
    expect(server.deleteView).toHaveBeenCalledWith("v1");
  });

  it("shows a viewer the text without the means to change it", async () => {
    await render("hello", "viewer");
    expect(shown().text()).toBe("hello");
    expect(wrapper.find("button").exists()).toBe(false);
    await shown().trigger("dblclick");
    expect(wrapper.find("textarea").exists()).toBe(false);
  });
});
