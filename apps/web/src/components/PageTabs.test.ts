import { wireSnapshot, changeWith } from "../testing";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter, type Router } from "vue-router";
import { api } from "../api/client";
import { useWorkbookStore } from "../stores/workbook";
import { snapshotWith, type MockedApi } from "../testing";
import PageTabs from "./PageTabs.vue";

vi.mock("../api/client", async () => {
  const testing = await import("../testing");
  return { api: testing.mockApi(), setJournaledHandler: testing.setJournaledHandler };
});
const server = api as unknown as MockedApi;
const confirm = vi.spyOn(window, "confirm");

let router: Router;

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
  return mount(PageTabs, {
    props: { spreadsheetId: "s1", activePageId: "p1" },
    global: { plugins: [router] },
    attachTo: document.body,
  });
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  confirm.mockReturnValue(false);
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

  it("deletes the open page without asking and offers undo", async () => {
    const wrapper = await render();
    await wrapper.get('button[aria-label="Delete Page 1"]').trigger("click");
    await flushPromises();

    expect(confirm).not.toHaveBeenCalled();
    expect(server.deletePage).toHaveBeenCalledExactlyOnceWith("p1");
    expect(router.currentRoute.value.params).toEqual({ spreadsheetId: "s1", pageId: "p2" });
    expect(useWorkbookStore().notice).toMatchObject({
      kind: "success",
      text: "Deleted page Page 1",
      action: { label: "Undo" },
    });
    wrapper.unmount();
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
