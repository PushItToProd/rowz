import { mount, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { useWorkbookStore } from "../stores/workbook";
import { at, snapshotWith, type MockedApi } from "../testing";
import FormulaBar from "./FormulaBar.vue";

vi.mock("../api/client", async () => ({ api: (await import("../testing")).mockApi() }));
const server = api as unknown as MockedApi;

async function render(inputs: Record<string, string> = {}, role = "owner"): Promise<VueWrapper> {
  server.getSnapshot.mockResolvedValue(snapshotWith(inputs, role));
  await useWorkbookStore().load("s1");
  return mount(FormulaBar);
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

  it("is disabled for a viewer", async () => {
    const wrapper = await render({ A1: "2" }, "viewer");
    await select(wrapper, "A1");
    expect(field(wrapper).element.value).toBe("2");
    expect(field(wrapper).attributes("disabled")).toBeDefined();
  });
});
