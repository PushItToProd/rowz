import { mount, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { useWorkbookStore } from "../stores/workbook";
import { at, snapshotWith, type MockedApi } from "../testing";
import FormulaBar from "./FormulaBar.vue";

vi.mock("../api/client", async () => ({ api: (await import("../testing")).mockApi() }));
const server = api as unknown as MockedApi;

async function render(
  inputs: Record<string, string> = {},
  role = "owner",
  attached = false,
): Promise<VueWrapper> {
  server.getSnapshot.mockResolvedValue(snapshotWith(inputs, role));
  await useWorkbookStore().load("s1");
  return mount(FormulaBar, attached ? { attachTo: document.body } : {});
}

function field(wrapper: VueWrapper) {
  return wrapper.get<HTMLInputElement>("input");
}

async function select(wrapper: VueWrapper, address: string): Promise<void> {
  useWorkbookStore().selection = at(address);
  await wrapper.vm.$nextTick();
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
});

describe("FormulaBar", () => {
  it("is empty and disabled with no cell selected", async () => {
    const wrapper = await render();
    expect(field(wrapper).element.value).toBe("");
    expect(field(wrapper).attributes("disabled")).toBeDefined();
    expect(wrapper.get(".formula-bar__cell").text()).toBe("");
  });

  it("shows the selected cell's table, address, and input, not its value", async () => {
    const wrapper = await render({ A1: "2", B1: "=A1*3" });
    await select(wrapper, "B1");
    expect(wrapper.get(".formula-bar__cell").text()).toBe("Table 1 · B1");
    expect(field(wrapper).element.value).toBe("=A1*3");

    await select(wrapper, "A1");
    expect(field(wrapper).element.value).toBe("2");
  });

  it("saves the typed input on Enter", async () => {
    const wrapper = await render({ A1: "2" });
    await select(wrapper, "A1");
    await field(wrapper).setValue("=1+1");
    await field(wrapper).trigger("keydown", { key: "Enter" });
    expect(server.setCells).toHaveBeenCalledExactlyOnceWith("t1", [
      { row: 0, col: 0, input: "=1+1" },
    ]);
    expect(useWorkbookStore().valueOf(at("A1"))).toBe(2);
  });

  it("saves on losing focus, and sends nothing when unchanged", async () => {
    const wrapper = await render({ A1: "2" });
    await select(wrapper, "A1");
    await field(wrapper).trigger("blur");
    expect(server.setCells).not.toHaveBeenCalled();

    await field(wrapper).setValue("3");
    await field(wrapper).trigger("blur");
    expect(server.setCells).toHaveBeenCalledOnce();
  });

  it("saves what was typed to the cell it was typed for when another cell is clicked", async () => {
    const wrapper = await render({ A1: "2", B1: "2" });
    await select(wrapper, "A1");
    await field(wrapper).trigger("focus");
    await field(wrapper).setValue("typed for A1");
    // A click on a cell selects it on mousedown, before the field loses focus.
    useWorkbookStore().selection = at("B1");
    await field(wrapper).trigger("blur");

    expect(server.setCells).toHaveBeenCalledExactlyOnceWith("t1", [
      { row: 0, col: 0, input: "typed for A1" },
    ]);
    expect(useWorkbookStore().inputOf(at("B1"))).toBe("2");
    expect(field(wrapper).element.value).toBe("2");
  });

  it("restores the stored input on Escape", async () => {
    const wrapper = await render({ A1: "2" });
    await select(wrapper, "A1");
    await field(wrapper).setValue("999");
    await field(wrapper).trigger("keydown", { key: "Escape" });
    expect(field(wrapper).element.value).toBe("2");
    expect(server.setCells).not.toHaveBeenCalled();
  });

  it("follows a change made elsewhere to the selected cell", async () => {
    const wrapper = await render({ A1: "2" });
    await select(wrapper, "A1");
    await useWorkbookStore().setCell(at("A1"), "50");
    await wrapper.vm.$nextTick();
    expect(field(wrapper).element.value).toBe("50");
  });

  it("says which formula filled a cell that an array result reached", async () => {
    const wrapper = await render({ A1: "=SEQUENCE(3)" });
    await select(wrapper, "A2");
    expect(field(wrapper).element.value).toBe("");
    expect(field(wrapper).attributes("placeholder")).toBe("Filled by the formula in A1");

    await select(wrapper, "A1");
    expect(field(wrapper).attributes("placeholder")).toContain("Select a cell");
  });

  it("suggests functions while typing and completes one with Tab", async () => {
    const wrapper = await render({ A1: "2" }, "owner", true);
    await select(wrapper, "A1");
    await field(wrapper).trigger("focus");
    await field(wrapper).setValue("=roundu");
    const labels = [...document.querySelectorAll('.formula-assist [role="option"]')].map(
      (option) => option.querySelector(".formula-assist__label")?.textContent,
    );
    expect(labels).toEqual(["ROUNDUP"]);
    await field(wrapper).setValue("=round");
    await field(wrapper).trigger("keydown", { key: "ArrowDown" });
    await field(wrapper).trigger("keydown", { key: "Tab" });
    expect(field(wrapper).element.value).toBe("=ROUNDDOWN(");
    expect(server.setCells).not.toHaveBeenCalled();

    await field(wrapper).trigger("blur");
    expect(document.querySelector(".formula-assist")).toBeNull();
    wrapper.unmount();
  });

  it("is disabled for a viewer", async () => {
    const wrapper = await render({ A1: "2" }, "viewer");
    await select(wrapper, "A1");
    expect(field(wrapper).element.value).toBe("2");
    expect(field(wrapper).attributes("disabled")).toBeDefined();
  });
});
