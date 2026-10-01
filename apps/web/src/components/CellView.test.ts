import type { ActionValue, CellValue } from "@spreadsheet-app/engine";
import { mount, type VueWrapper } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import CellView from "./CellView.vue";

const action: ActionValue = {
  kind: "action",
  name: "SEND_EMAIL",
  args: [],
  origin: { tableId: "t1", row: 0, col: 0 },
};

function render(value: CellValue, props: { running?: boolean; canRun?: boolean } = {}): VueWrapper {
  return mount(CellView, { props: { value, running: false, canRun: true, ...props } });
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

  it("shows an error code with its explanation as a tooltip", () => {
    const span = render({ kind: "error", code: "#DIV/0!", message: "Division by zero" }).get(
      "span",
    );
    expect(span.text()).toBe("#DIV/0!");
    expect(span.classes()).toContain("cell-value--error");
    expect(span.attributes("title")).toBe("Division by zero");
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
});
