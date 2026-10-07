import { wireSnapshot, changeWith } from "../testing";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter, type Router } from "vue-router";
import { api } from "../api/client";
import { useWorkbookStore } from "../stores/workbook";
import { appDialog, mountDialogHost, snapshotWith, type MockedApi } from "../testing";
import PageTabs from "./PageTabs.vue";

vi.mock("../api/client", async () => {
  const testing = await import("../testing");
  return { api: testing.mockApi(), setJournaledHandler: testing.setJournaledHandler };
});
const server = api as unknown as MockedApi;

let router: Router;
let dialogHost: VueWrapper;
const mounted: VueWrapper[] = [];

async function render(role = "owner"): Promise<VueWrapper> {
  server.getSnapshot.mockResolvedValue(
    wireSnapshot({
      ...snapshotWith({}, role),
      pages: [
        { id: "p1", name: "Page 1", position: 0 },
        { id: "p2", name: "Page 2", position: 1 },
      ],
    }),
  );
  await useWorkbookStore().load("s1");
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", component: { template: "<div />" } },
      {
        name: "editor",
        path: "/s/:spreadsheetId/:pageId?",
        component: { template: "<div />" },
      },
    ],
  });
  const wrapper = mount(PageTabs, {
    props: { spreadsheetId: "s1", activePageId: "p1" },
    global: { plugins: [router] },
    attachTo: document.body,
  });
  mounted.push(wrapper);
  return wrapper;
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  dialogHost = mountDialogHost();
});

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
  dialogHost.unmount();
});

describe("PageTabs", () => {
  it("names each page with a link the keyboard can reach, and marks the open one", async () => {
    const wrapper = await render();
    const links = wrapper.findAll("a");
    expect(links.map((link) => link.text())).toEqual(["Page 1", "Page 2"]);
    expect(links.map((link) => link.attributes("href"))).toEqual(["/s/s1/p1", "/s/s1/p2"]);
    expect(wrapper.get('[aria-current="page"]').text()).toContain("Page 1");
  });

  it("opens a page when its link is activated, as Enter on a link does", async () => {
    const wrapper = await render();
    await wrapper.findAll("a")[1]!.trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.params).toEqual({ spreadsheetId: "s1", pageId: "p2" });
  });

  it("renames a page with F2", async () => {
    server.renamePage.mockResolvedValue(changeWith({ cells: [], views: [], tables: [] }));
    const wrapper = await render();
    await wrapper.findAll("a")[1]!.trigger("keydown", { key: "F2" });
    const input = wrapper.get<HTMLInputElement>('input[aria-label="Page name"]');
    await input.setValue("Summary");
    await input.trigger("keydown", { key: "Enter" });
    expect(server.renamePage).toHaveBeenCalledExactlyOnceWith("p2", "Summary");
  });

  it("moves the open page among the tabs with the buttons on its tab", async () => {
    const wrapper = await render();
    const names = () => wrapper.findAll("a").map((link) => link.text());
    expect(wrapper.find('button[aria-label="Move Page 2 right"]').exists()).toBe(false);
    expect(
      wrapper.get('button[aria-label="Move Page 1 left"]').attributes("disabled"),
    ).toBeDefined();

    await wrapper.get('button[aria-label="Move Page 1 right"]').trigger("click");
    await flushPromises();
    expect(server.reorderPages).toHaveBeenCalledExactlyOnceWith("s1", ["p2", "p1"]);
    expect(names()).toEqual(["Page 2", "Page 1"]);
    expect(
      wrapper.get('button[aria-label="Move Page 1 right"]').attributes("disabled"),
    ).toBeDefined();
    // The click moved the page and did not open one.
    expect(router.currentRoute.value.path).toBe("/");
  });

  it("opens a page menu on right-click with disabled edge moves", async () => {
    const wrapper = await render();
    await wrapper.get('[data-page-id="p1"]').trigger("contextmenu", {
      button: 2,
      clientX: 30,
      clientY: 50,
    });
    await flushPromises();

    const menu = wrapper.get('[role="menu"]');
    expect(menu.attributes("aria-label")).toBe("Actions for Page 1");
    expect(menu.findAll('[role="menuitem"]').map((item) => item.text())).toEqual([
      "Rename",
      "Delete",
      "Move left",
      "Move right",
    ]);
    expect(menu.get('[role="menuitem"]:nth-child(3)').attributes("disabled")).toBeDefined();
    expect(menu.get('[role="menuitem"]:nth-child(4)').attributes("disabled")).toBeUndefined();

    await menu.get('[role="menuitem"]:nth-child(4)').trigger("click");
    await flushPromises();
    expect(server.reorderPages).toHaveBeenCalledExactlyOnceWith("s1", ["p2", "p1"]);
  });

  it("opens the page menu from the keyboard and Escape restores focus", async () => {
    const wrapper = await render();
    const link = wrapper.findAll("a")[1]!;
    await link.trigger("keydown", { key: "ContextMenu" });
    await flushPromises();

    const menu = wrapper.get('[role="menu"]');
    expect(menu.attributes("aria-label")).toBe("Actions for Page 2");
    expect(menu.get('[role="menuitem"]:nth-child(4)').attributes("disabled")).toBeDefined();
    await wrapper.get('[role="menu"]').trigger("keydown", { key: "Escape" });
    await flushPromises();
    expect(wrapper.find('[role="menu"]').exists()).toBe(false);
    expect(document.activeElement).toBe(wrapper.get('[data-page-id="p2"] .editable-name').element);
  });

  it("renames a page from its context menu through the existing name editor", async () => {
    server.renamePage.mockResolvedValue(changeWith({ cells: [], views: [], tables: [] }));
    const wrapper = await render();
    await wrapper.get('[data-page-id="p2"]').trigger("contextmenu", { button: 2 });
    await flushPromises();
    await wrapper.get('[role="menuitem"]:first-child').trigger("click");
    await flushPromises();

    const input = wrapper.get<HTMLInputElement>('input[aria-label="Page name"]');
    await input.setValue("Summary");
    await input.trigger("keydown", { key: "Enter" });
    expect(server.renamePage).toHaveBeenCalledExactlyOnceWith("p2", "Summary");
  });

  it("deletes the open page without asking and offers undo", async () => {
    const wrapper = await render();
    await wrapper.get('[data-page-id="p1"]').trigger("contextmenu", { button: 2 });
    await flushPromises();
    await wrapper.get('[role="menuitem"]:nth-child(2)').trigger("click");
    await flushPromises();

    expect(appDialog()).toBeNull();
    expect(server.deletePage).toHaveBeenCalledExactlyOnceWith("p1");
    expect(router.currentRoute.value.params).toEqual({ spreadsheetId: "s1", pageId: "p2" });
    expect(useWorkbookStore().notice).toMatchObject({
      kind: "success",
      text: "Deleted page Page 1",
      action: { label: "Undo" },
    });
  });

  it("gives a viewer links, and no way to rename or delete", async () => {
    const wrapper = await render("viewer");
    await wrapper.findAll("a")[0]!.trigger("keydown", { key: "F2" });
    expect(wrapper.find("input").exists()).toBe(false);
    expect(wrapper.findAll("button")).toEqual([]);
  });
});

it("marks a page with errors and removes its warning after correction", async () => {
  const wrapper = await render();
  const store = useWorkbookStore();
  await store.setCell({ tableId: "t1", row: 0, col: 0 }, "=1/0");
  await wrapper.vm.$nextTick();
  expect(wrapper.find('[aria-label="Page 1 contains errors"]').exists()).toBe(true);
  expect(wrapper.find('[aria-label="Page 2 contains errors"]').exists()).toBe(false);
  await store.setCell({ tableId: "t1", row: 0, col: 0 }, "1");
  await wrapper.vm.$nextTick();
  expect(wrapper.find('[aria-label="Page 1 contains errors"]').exists()).toBe(false);
  wrapper.unmount();
});
