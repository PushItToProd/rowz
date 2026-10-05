import { createWorkbook, type ActionValue, type CellValue } from "@spreadsheet-app/engine";
import { mount, type VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import { describe, expect, it } from "vitest";
import CellView from "./CellView.vue";

const action: ActionValue = {
  kind: "action",
  name: "SEND_EMAIL",
  args: [],
  origin: { tableId: "t1", row: 0, col: 0 },
};

function render(
  value: CellValue,
  props: {
    running?: boolean;
    canRun?: boolean;
    spillResizeTo?: { rowCount: number; colCount: number };
  } = {},
): VueWrapper {
  return mount(CellView, { props: { value, running: false, canRun: true, ...props } });
}

function renderInGrid(
  value: CellValue,
  props: { spillResizeTo?: { rowCount: number; colCount: number } } = {},
): { wrapper: VueWrapper; grid: HTMLDivElement } {
  const grid = document.createElement("div");
  grid.className = "grid";
  grid.tabIndex = -1;
  document.body.append(grid);
  const wrapper = mount(CellView, {
    props: { value, running: false, canRun: true, ...props },
    attachTo: grid,
  });
  return { wrapper, grid };
}

describe("CellView", () => {
  it.each<[CellValue, string, string]>([
    [42, "42", "cell-value--number"],
    [0.1 + 0.2, "0.3", "cell-value--number"],
    ["hello", "hello", "cell-value--text"],
    [null, "", "cell-value--text"],
    [true, "TRUE", "cell-value--boolean"],
    [action, "SEND_EMAIL", "cell-value--action"],
  ])("shows %j as %j", (value, text, className) => {
    const span = render(value).get("span");
    expect(span.text()).toBe(text);
    expect(span.classes()).toContain(className);
  });

  it("shows a function by its parameters, with a hint on how to call it", () => {
    const lambda = createWorkbook({
      pages: [{ id: "p", name: "Page" }],
      tables: [{ id: "t", pageId: "p", name: "Table" }],
      cells: [{ tableId: "t", row: 0, col: 0, input: "=LAMBDA(price, qty, price * qty)" }],
    }).getValue({ tableId: "t", row: 0, col: 0 });
    const span = render(lambda).get("span");
    expect(span.text()).toBe("LAMBDA(price, qty)");
    expect(span.attributes("title")).toContain("=A1(5)");
  });

  it("shows a checkbox with its label and emits the new state when changed", async () => {
    const wrapper = render({
      kind: "control",
      control: "checkbox",
      target: { tableId: "t1", row: 0, col: 0 },
      value: true,
      options: [],
      label: "Done",
    });
    const box = wrapper.get<HTMLInputElement>("input");
    expect(wrapper.text()).toBe("Done");
    expect(box.element.checked).toBe(true);
    await box.setValue(false);
    expect(wrapper.emitted("choose")).toEqual([[false]]);
  });

  it("shows a dropdown with no choice selected when the cell holds none of the choices", () => {
    const wrapper = render({
      kind: "control",
      control: "dropdown",
      target: { tableId: "t1", row: 0, col: 0 },
      value: "something else",
      options: ["a", 2, true],
      label: "",
    });
    const select = wrapper.get<HTMLSelectElement>("select");
    expect(select.findAll("option").map((option) => option.text())).toEqual(["", "a", "2", "TRUE"]);
    expect(select.element.value).toBe("-1");
  });

  it("emits a dropdown choice with its original type", async () => {
    const wrapper = render({
      kind: "control",
      control: "dropdown",
      target: { tableId: "t1", row: 0, col: 0 },
      value: null,
      options: ["a", 2],
      label: "",
    });
    await wrapper.get("select").setValue("1");
    expect(wrapper.emitted("choose")).toEqual([[2]]);
  });

  it.each([
    ["textbox", "Name", "current text", "text"],
    ["numberbox", "Count", "12.5", "number"],
  ] as const)("shows and commits a %s", async (control, label, value, type) => {
    const wrapper = render({
      kind: "control",
      control,
      target: { tableId: "t1", row: 0, col: 0 },
      value: control === "numberbox" ? 12.5 : "current text",
      options: [],
      label,
    });
    const input = wrapper.get<HTMLInputElement>("input");
    expect(input.element.type).toBe(type);
    expect(input.element.value).toBe(value);
    expect(input.attributes("aria-label")).toBe(label);
    await input.setValue(control === "numberbox" ? "3.25" : "edited text");
    expect(wrapper.emitted("edit")).toBeUndefined();
    await input.trigger("keydown", { key: "Enter" });
    expect(wrapper.emitted("edit")).toEqual([[control === "numberbox" ? 3.25 : "edited text"]]);
    await input.trigger("blur");
    expect(wrapper.emitted("edit")).toHaveLength(1);
  });

  it("shows Markdown with its formatting, on one line", () => {
    const wrapper = render({
      kind: "markdown",
      text: "**bold** and [a link](https://example.com)\n\n# not a heading",
    });
    expect(wrapper.get("strong").text()).toBe("bold");
    expect(wrapper.get("a").attributes()).toMatchObject({
      href: "https://example.com",
      target: "_blank",
      rel: "noopener noreferrer",
    });
    expect(wrapper.find("h1").exists()).toBe(false);
    expect(wrapper.find("p").exists()).toBe(false);
  });

  it("shows HTML in Markdown as text, and makes no link out of a javascript: address", () => {
    const wrapper = render({
      kind: "markdown",
      text: "<img src=x onerror=alert(1)> [x](javascript:alert(1))",
    });
    expect(wrapper.find("img").exists()).toBe(false);
    expect(wrapper.find("a").exists()).toBe(false);
    expect(wrapper.text()).toContain("<img src=x onerror=alert(1)>");
  });

  it("names a chart, and says where it can be shown", () => {
    const wrapper = render({ kind: "chart", chart: "bar", rows: [["a", 1]], title: "" });
    expect(wrapper.text()).toBe("bar chart");
    expect(wrapper.get("span").attributes("title")).toContain("text view");
  });

  it("shows an error explanation in a popover on hover and keyboard focus", async () => {
    const wrapper = render({ kind: "error", code: "#DIV/0!", message: "Division by zero" });
    const span = wrapper.get("span");
    expect(span.text()).toBe("#DIV/0!");
    expect(span.classes()).toContain("cell-value--error");
    expect(span.attributes("title")).toBeUndefined();
    await span.trigger("mouseenter");
    expect(document.querySelector('[role="tooltip"]')?.textContent).toContain("Division by zero");
    await span.trigger("keydown", { key: "Escape" });
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
    await span.trigger("focus");
    expect(document.querySelector('[role="tooltip"]')).not.toBeNull();
    window.dispatchEvent(new Event("scroll"));
    await wrapper.vm.$nextTick();
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
    wrapper.unmount();
  });

  it("shows and emits the requested table size for a table-dimension spill", async () => {
    const size = { rowCount: 12, colCount: 26 };
    const wrapper = render(
      {
        kind: "error",
        code: "#SPILL!",
        message: "The table is too small.",
        spill: {
          tableId: "t1",
          reason: "table-size",
          requiredRowCount: 12,
          requiredColumnCount: 26,
        },
      },
      { spillResizeTo: size },
    );
    await wrapper.get("span").trigger("mouseenter");
    const trigger = wrapper.get<HTMLElement>(".cell-value--error");
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    const button = document.querySelector<HTMLButtonElement>(".cell-error-popover__action");
    const descriptionId = trigger.attributes("aria-describedby");
    const description = document.getElementById(descriptionId ?? "");
    expect(trigger.attributes("aria-haspopup")).toBe("dialog");
    expect(trigger.attributes("aria-controls")).toBe(dialog?.id);
    expect(descriptionId).not.toBe(dialog?.id);
    expect(description?.tagName).toBe("P");
    expect(description?.textContent).toContain("The table is too small.");
    expect(dialog?.textContent).toContain("The table is too small.");
    expect(button?.textContent).toContain("Resize table to fit");
    button?.click();
    expect(wrapper.emitted("resizeTable")).toEqual([[size]]);
    wrapper.unmount();
  });

  it("returns focus to the grid when Escape closes the error popover from its trigger", async () => {
    const { wrapper, grid } = renderInGrid(
      {
        kind: "error",
        code: "#SPILL!",
        message: "The table is too small.",
        spill: {
          tableId: "t1",
          reason: "table-size",
          requiredRowCount: 12,
          requiredColumnCount: 26,
        },
      },
      { spillResizeTo: { rowCount: 12, colCount: 26 } },
    );
    const trigger = wrapper.get<HTMLElement>(".cell-value--error");
    try {
      trigger.element.focus();
      await nextTick();
      expect(document.activeElement).toBe(trigger.element);
      expect(document.querySelector('[role="dialog"]')).not.toBeNull();

      await trigger.trigger("keydown", { key: "Escape" });

      expect(document.querySelector('[role="dialog"]')).toBeNull();
      expect(document.activeElement).toBe(grid);
    } finally {
      wrapper.unmount();
      grid.remove();
    }
  });

  it("returns focus to the grid when an error unmounts while its popover button is focused", async () => {
    const { wrapper, grid } = renderInGrid(
      {
        kind: "error",
        code: "#SPILL!",
        message: "The table is too small.",
        spill: {
          tableId: "t1",
          reason: "table-size",
          requiredRowCount: 12,
          requiredColumnCount: 26,
        },
      },
      { spillResizeTo: { rowCount: 12, colCount: 26 } },
    );
    await wrapper.get(".cell-value--error").trigger("mouseenter");
    const button = document.querySelector<HTMLButtonElement>(".cell-error-popover__action");
    if (!button) throw new Error("Expected the spill resize button");
    try {
      button.focus();
      expect(document.activeElement).toBe(button);

      await wrapper.setProps({ value: 42 });

      expect(document.querySelector(".cell-error-popover__action")).toBeNull();
      expect(document.activeElement).toBe(grid);
    } finally {
      wrapper.unmount();
      grid.remove();
    }
  });

  it("shows a button with its label and emits run when clicked", async () => {
    const wrapper = render({ kind: "button", label: "Send", action });
    const button = wrapper.get("button");
    expect(button.text()).toBe("Send");
    await button.trigger("click");
    expect(wrapper.emitted("run")).toHaveLength(1);
  });

  it("disables a button that is running and says so", async () => {
    const wrapper = render({ kind: "button", label: "Send", action }, { running: true });
    const button = wrapper.get("button");
    expect(button.text()).toBe("Running…");
    expect(button.attributes("disabled")).toBeDefined();
    await button.trigger("click");
    expect(wrapper.emitted("run")).toBeUndefined();
  });

  it("disables a button the viewer may not run", () => {
    const button = render({ kind: "button", label: "Send", action }, { canRun: false }).get(
      "button",
    );
    expect(button.attributes("disabled")).toBeDefined();
    expect(button.text()).toBe("Send");
  });

  describe("in a dropdown column", () => {
    const choices = ["Trial", "Sprint"];

    it("shows a dropdown of the choices with the cell's value selected, and emits the pick", async () => {
      const wrapper = mount(CellView, {
        props: { value: "Sprint", running: false, canRun: true, choices },
      });
      const select = wrapper.get<HTMLSelectElement>("select");
      expect(select.element.value).toBe("Sprint");
      expect([...select.element.options].map((option) => option.text)).toEqual([
        "",
        "Trial",
        "Sprint",
      ]);
      await select.setValue("Trial");
      expect(wrapper.emitted("pick")).toEqual([["Trial"]]);
      await select.setValue("");
      expect(wrapper.emitted("pick")?.[1]).toEqual([""]);
    });

    it("keeps a value outside the list as an extra option, marked with a warning", () => {
      const wrapper = mount(CellView, {
        props: { value: "Rally", running: false, canRun: true, choices },
      });
      const select = wrapper.get<HTMLSelectElement>("select");
      expect(select.element.value).toBe("Rally");
      expect(select.classes()).toContain("cell-control--outside");
      expect(select.attributes("title")).toContain("not one of the choices");
    });

    it("selects nothing for an empty cell, and does not warn", () => {
      const wrapper = mount(CellView, {
        props: { value: null, running: false, canRun: true, choices },
      });
      expect(wrapper.get<HTMLSelectElement>("select").element.value).toBe("");
      expect(wrapper.get("select").classes()).not.toContain("cell-control--outside");
    });

    it("shows an error as an error, and a viewer's dropdown is disabled", () => {
      const error = mount(CellView, {
        props: {
          value: { kind: "error", code: "#VALUE!", message: "bad" },
          running: false,
          canRun: true,
          choices,
        },
      });
      expect(error.find("select").exists()).toBe(false);
      const viewer = mount(CellView, {
        props: { value: "Trial", running: false, canRun: false, choices },
      });
      expect(viewer.get("select").attributes("disabled")).toBeDefined();
    });
  });
});
