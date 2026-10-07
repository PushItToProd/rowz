import { wireSnapshot, changeWith } from "../testing";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConditionalRule } from "@spreadsheet-app/engine";
import { api } from "../api/client";
import { useWorkbookStore } from "../stores/workbook";
import {
  appDialog,
  at,
  mountDialogHost,
  respondToDialog,
  snapshotWith,
  TABLE,
  type MockedApi,
} from "../testing";
import ConditionalFormatsPanel from "./ConditionalFormatsPanel.vue";

vi.mock("../api/client", async () => {
  const testing = await import("../testing");
  return { api: testing.mockApi(), setJournaledHandler: testing.setJournaledHandler };
});
const server = api as unknown as MockedApi;

let wrapper: VueWrapper;
let dialogHost: VueWrapper;

const RULES: ConditionalRule[] = [
  {
    startRow: 0,
    endRow: null,
    startCol: 1,
    endCol: 1,
    kind: "criterion",
    criterion: ">100",
    format: { fill: "red", bold: true },
  },
  { startRow: 0, endRow: 3, startCol: 0, endCol: 0, kind: "scale", low: null, high: "green" },
];

async function render(
  conditionalFormats: ConditionalRule[] = [],
  role = "owner",
): Promise<ReturnType<typeof useWorkbookStore>> {
  const table = { ...TABLE, conditionalFormats };
  server.getSnapshot.mockResolvedValue(
    wireSnapshot({ ...snapshotWith({}, role), tables: [table] }),
  );
  const store = useWorkbookStore();
  await store.load("s1");
  wrapper = mount(ConditionalFormatsPanel, { props: { table }, attachTo: document.body });
  server.setConditionalFormats.mockResolvedValue(changeWith());
  return store;
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  dialogHost = mountDialogHost();
});
afterEach(() => {
  wrapper.unmount();
  dialogHost.unmount();
});

describe("ConditionalFormatsPanel", () => {
  it("lists the rules with the cells each covers and what it does", async () => {
    await render(RULES);
    const items = wrapper.findAll(".conditional-panel__rules li").map((item) => item.text());
    // The rule that wins, the last one stored, is listed first.
    expect(items[0]).toContain("A1:A4");
    expect(items[0]).toContain("color scale, no color to green");
    expect(items[1]).toContain("B1:B");
    expect(items[1]).toContain("cells matching >100: fill red, bold");
  });

  it("says so when there are none, and asks for a selection before a rule can be added", async () => {
    const store = await render();
    expect(wrapper.text()).toContain("no conditional formats");
    const add = wrapper.get<HTMLButtonElement>('button[type="submit"]');
    expect(add.element.disabled).toBe(true);
    store.selection = at("B2");
    store.extendSelection(at("B3"));
    await flushPromises();
    expect(wrapper.text()).toContain("Applies to B2:B3");
    expect(add.element.disabled).toBe(false);
  });

  it("adds a criterion rule over the selection with the chosen style", async () => {
    const store = await render();
    store.selection = at("B2");
    await flushPromises();
    await wrapper.get('[aria-label="Criterion"]').setValue("<>done");
    await wrapper.get('[aria-label="Rule fill"]').setValue("yellow");
    await wrapper.get('[aria-label="Rule text color"]').setValue("blue");
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(server.setConditionalFormats).toHaveBeenCalledExactlyOnceWith("t1", [
      {
        range: { startRowId: "r1", endRowId: "r1", startColId: "c2", endColId: "c2" },
        kind: "criterion",
        criterion: "<>done",
        format: { fill: "yellow", color: "blue" },
      },
    ]);
  });

  it("adds a color scale with no low color", async () => {
    const store = await render();
    store.selection = at("A1");
    store.extendSelection(at("A4"));
    await flushPromises();
    await wrapper.get('input[value="scale"]').setValue(true);
    await wrapper.get('[aria-label="Scale high color"]').setValue("purple");
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(server.setConditionalFormats.mock.calls[0]?.[1]).toEqual([
      {
        range: { startRowId: "r0", endRowId: null, startColId: "c1", endColId: "c1" },
        kind: "scale",
        low: null,
        high: "purple",
      },
    ]);
  });

  it("refuses a criterion rule that formats nothing", async () => {
    const store = await render();
    store.selection = at("B2");
    await flushPromises();
    await wrapper.get('[aria-label="Rule fill"]').setValue("");
    expect(wrapper.get<HTMLButtonElement>('button[type="submit"]').element.disabled).toBe(true);
  });

  it("removes a rule, and gives a viewer the list without the controls", async () => {
    await render(RULES);
    await wrapper.get('button[aria-label="Remove the rule for B1:B"]').trigger("click");
    expect(appDialog()?.textContent).toContain("Remove the conditional format for B1:B?");
    await respondToDialog("confirm");
    await flushPromises();
    expect(server.setConditionalFormats.mock.calls[0]?.[1]).toMatchObject([{ kind: "scale" }]);
    wrapper.unmount();
    setActivePinia(createPinia());
    await render(RULES, "viewer");
    expect(wrapper.find("form").exists()).toBe(false);
    expect(wrapper.find(".conditional-panel__rules button").exists()).toBe(false);
  });

  it("keeps the rule when the confirmation to remove it is declined", async () => {
    await render(RULES);
    await wrapper.get('button[aria-label="Remove the rule for B1:B"]').trigger("click");
    await respondToDialog("cancel");
    await flushPromises();
    expect(server.setConditionalFormats).not.toHaveBeenCalled();
  });

  it("changes a rule in place, keeping its cells and what the form does not show", async () => {
    const rules: ConditionalRule[] = [
      { ...RULES[0]!, format: { fill: "red", bold: true, italic: true } } as ConditionalRule,
      RULES[1]!,
    ];
    await render(rules);
    await wrapper.get('button[aria-label="Edit the rule for B1:B"]').trigger("click");
    expect(wrapper.text()).toContain("Changing the rule for B1:B");
    expect(wrapper.get<HTMLInputElement>('[aria-label="Criterion"]').element.value).toBe(">100");
    expect(wrapper.get<HTMLSelectElement>('[aria-label="Rule fill"]').element.value).toBe("red");
    await wrapper.get('[aria-label="Criterion"]').setValue(">200");
    await wrapper.get('[aria-label="Rule fill"]').setValue("green");
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(server.setConditionalFormats.mock.calls[0]?.[1]).toMatchObject([
      {
        range: { startRowId: "r0", endRowId: null, startColId: "c2", endColId: "c2" },
        kind: "criterion",
        criterion: ">200",
        format: { fill: "green", bold: true, italic: true },
      },
      { kind: "scale" },
    ]);
    expect(wrapper.text()).not.toContain("Changing the rule");
  });

  it("changes a color scale, and cancels a change without saving", async () => {
    await render(RULES);
    await wrapper.get('button[aria-label="Edit the rule for A1:A4"]').trigger("click");
    expect(wrapper.get<HTMLSelectElement>('[aria-label="Scale high color"]').element.value).toBe(
      "green",
    );
    await wrapper.get('[aria-label="Scale high color"]').setValue("blue");
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(server.setConditionalFormats.mock.calls[0]?.[1]).toMatchObject([
      { kind: "criterion" },
      { kind: "scale", low: null, high: "blue" },
    ]);
    await wrapper.get('button[aria-label="Edit the rule for A1:A4"]').trigger("click");
    const cancel = wrapper.findAll("button").find((button) => button.text() === "Cancel");
    await cancel!.trigger("click");
    expect(wrapper.text()).not.toContain("Changing the rule");
    expect(server.setConditionalFormats).toHaveBeenCalledTimes(1);
  });

  it("moves a rule up or down the list, and cannot move the first up or the last down", async () => {
    await render(RULES);
    const button = (label: string) =>
      wrapper.get<HTMLButtonElement>(`button[aria-label="${label}"]`);
    expect(button("Move the rule for A1:A4 up").element.disabled).toBe(true);
    expect(button("Move the rule for B1:B down").element.disabled).toBe(true);
    await button("Move the rule for B1:B up").trigger("click");
    await flushPromises();
    expect(server.setConditionalFormats.mock.calls[0]?.[1]).toMatchObject([
      { kind: "scale" },
      { kind: "criterion" },
    ]);
    await button("Move the rule for A1:A4 down").trigger("click");
    await flushPromises();
    expect(server.setConditionalFormats.mock.calls[1]?.[1]).toMatchObject([
      { kind: "scale" },
      { kind: "criterion" },
    ]);
  });

  it("keeps the form on the rule being changed when that rule moves", async () => {
    await render(RULES);
    await wrapper.get('button[aria-label="Edit the rule for B1:B"]').trigger("click");
    await wrapper.get('button[aria-label="Move the rule for B1:B up"]').trigger("click");
    await flushPromises();
    // The mocked server returns no change, so the table is reordered here as the store would.
    await wrapper.setProps({
      table: { ...TABLE, conditionalFormats: [RULES[1]!, RULES[0]!] },
    });
    expect(wrapper.text()).toContain("Changing the rule for B1:B");
    expect(wrapper.get<HTMLInputElement>('[aria-label="Criterion"]').element.value).toBe(">100");
  });
});
