import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter, type Router } from "vue-router";
import type { DocumentListItem, FolderRecord, ListedSpreadsheetItem } from "../api/client";
import { api } from "../api/client";
import { DOCUMENT_TEMPLATES } from "../files/templates";
import { appDialog, mountDialogHost, respondToDialog, type MockedApi } from "../testing";
import SpreadsheetListView from "./SpreadsheetListView.vue";

vi.mock("../api/client", async () => {
  const testing = await import("../testing");
  return { api: testing.mockApi(), setJournaledHandler: testing.setJournaledHandler };
});

const server = api as unknown as MockedApi;
let wrapper: VueWrapper | undefined;
let dialogHost: VueWrapper | undefined;
let router: Router | undefined;

function listed(folders: FolderRecord[], documents: ListedSpreadsheetItem[]): DocumentListItem {
  return { folders, documents };
}

function document(folderId: string | null): ListedSpreadsheetItem {
  return {
    id: "d1",
    name: "Plan",
    updatedAt: "2026-10-04T12:00:00.000Z",
    role: "owner",
    hasErrors: false,
    folderId,
  };
}

async function render(): Promise<VueWrapper> {
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", name: "spreadsheets", component: { template: "<div />" } },
      { path: "/help", name: "help", component: { template: "<div />" } },
      { path: "/s/:spreadsheetId", name: "editor", component: { template: "<div />" } },
      { path: "/login", name: "login", component: { template: "<div />" } },
    ],
  });
  await router.push("/");
  const mounted = mount(SpreadsheetListView, {
    attachTo: globalThis.document.body,
    global: { plugins: [router] },
  });
  wrapper = mounted;
  await flushPromises();
  return mounted;
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  dialogHost?.unmount();
  dialogHost = undefined;
  router = undefined;
  vi.useRealTimers();
});

it("imports and opens a selected document template", async () => {
  const created = {
    id: "template-document",
    name: "To-do list",
    updatedAt: "2026-10-06T12:00:00.000Z",
  };
  server.listSpreadsheets.mockResolvedValue(listed([], []));
  server.importSpreadsheet.mockResolvedValue(created);
  const view = await render();

  await view.get('button[aria-controls="document-templates"]').trigger("click");
  const templates = view.get('[role="group"][aria-label="Document templates"]');
  expect(templates.text()).toContain("Invoice");
  expect(templates.text()).toContain("Track line items, tax, and the balance due.");
  expect(templates.text()).toContain("Inventory");

  await templates.get('button[aria-label="Create To-do list from template"]').trigger("click");
  await flushPromises();

  const todo = DOCUMENT_TEMPLATES.find(({ name }) => name === "To-do list");
  expect(todo).toBeDefined();
  expect(server.importSpreadsheet).toHaveBeenCalledWith(todo!.document);
  expect(router?.currentRoute.value.name).toBe("editor");
  expect(router?.currentRoute.value.params.spreadsheetId).toBe(created.id);
});

it("shows folders as collapsible groups with their documents", async () => {
  server.listSpreadsheets.mockResolvedValue(
    listed(
      [{ id: "f1", name: "Work" }],
      [
        { ...document("f1"), id: "d1" },
        { ...document(null), id: "d2", name: "Loose notes" },
      ],
    ),
  );
  const view = await render();

  const workGroup = view.findAll(".list__group")[0]!;
  expect(workGroup.find(".list__group-toggle").attributes("aria-expanded")).toBe("true");
  expect(workGroup.find("a").text()).toBe("Plan");
  await workGroup.find(".list__group-toggle").trigger("click");
  await flushPromises();
  expect(workGroup.find(".list__group-toggle").attributes("aria-expanded")).toBe("false");
  expect(workGroup.get("ul").isVisible()).toBe(false);

  const unfiled = view.findAll(".list__group")[1]!;
  expect(unfiled.text()).toContain("Loose notes");
});

it("opens an accessible actions menu and renames an owned document inline", async () => {
  const renamed = { ...document(null), name: "Forecast" };
  server.listSpreadsheets
    .mockResolvedValueOnce(listed([], [document(null)]))
    .mockResolvedValueOnce(listed([], [renamed]));
  server.renameSpreadsheet.mockResolvedValue(undefined);
  const view = await render();

  await view.get('button[aria-label="Actions for Plan"]').trigger("click", {
    clientX: 40,
    clientY: 60,
  });
  await flushPromises();
  const menu = view.get('[role="menu"][aria-label="Actions for Plan"]');
  expect(menu.findAll('[role="menuitem"]').map((item) => item.text())).toEqual([
    "Rename",
    "Duplicate",
    "Delete",
  ]);
  expect(globalThis.document.activeElement?.textContent.trim()).toBe("Rename");
  await menu.trigger("keydown", { key: "ArrowDown" });
  expect(globalThis.document.activeElement?.textContent.trim()).toBe("Duplicate");
  await menu.trigger("keydown", { key: "Escape" });
  await flushPromises();
  expect(view.find('[role="menu"]').exists()).toBe(false);

  await view.get('button[aria-label="Actions for Plan"]').trigger("click", {
    clientX: 40,
    clientY: 60,
  });
  await flushPromises();
  await view.get('[role="menuitem"]:nth-child(1)').trigger("click");
  await flushPromises();
  const input = view.get('[aria-label="Document name for Plan"]');
  expect(globalThis.document.activeElement).toBe(input.element);
  await input.setValue(" Forecast ");
  await view.get('form[aria-label="Rename document Plan"]').trigger("submit");
  await flushPromises();

  expect(server.renameSpreadsheet).toHaveBeenCalledExactlyOnceWith("d1", "Forecast");
  expect(view.get('a[href="/s/d1"]').text()).toBe("Forecast");
});

it("refuses an empty document name and cancels inline rename with Escape", async () => {
  server.listSpreadsheets.mockResolvedValue(listed([], [document(null)]));
  const view = await render();

  await view.get('button[aria-label="Actions for Plan"]').trigger("click", {
    clientX: 40,
    clientY: 60,
  });
  await flushPromises();
  await view.get('[role="menuitem"]').trigger("click");
  await flushPromises();

  const input = view.get('[aria-label="Document name for Plan"]');
  await input.setValue("   ");
  await view.get('form[aria-label="Rename document Plan"]').trigger("submit");
  await flushPromises();
  expect(server.renameSpreadsheet).not.toHaveBeenCalled();
  expect(view.find('form[aria-label="Rename document Plan"]').exists()).toBe(true);

  await input.setValue("Unsaved name");
  await input.trigger("keydown", { key: "Escape" });
  expect(view.find('form[aria-label="Rename document Plan"]').exists()).toBe(false);
  expect(view.get('a[href="/s/d1"]').text()).toBe("Plan");
});

it("shows only Duplicate for a shared document", async () => {
  server.listSpreadsheets.mockResolvedValue(listed([], [{ ...document(null), role: "viewer" }]));
  const view = await render();

  await view.get('button[aria-label="Actions for Plan"]').trigger("click", {
    clientX: 40,
    clientY: 60,
  });
  await flushPromises();
  expect(view.findAll('[role="menuitem"]').map((item) => item.text())).toEqual(["Duplicate"]);
  expect(view.find('button[aria-label="Delete document Plan"]').exists()).toBe(false);
});

it("confirms before deleting an owned document", async () => {
  dialogHost = mountDialogHost();
  server.listSpreadsheets
    .mockResolvedValueOnce(listed([], [document(null)]))
    .mockResolvedValueOnce(listed([], []));
  server.deleteSpreadsheet.mockResolvedValue(undefined);
  const view = await render();

  await view.get('button[aria-label="Actions for Plan"]').trigger("click", {
    clientX: 40,
    clientY: 60,
  });
  await flushPromises();
  await view.get('[role="menuitem"][class*="danger"]').trigger("click");
  await flushPromises();

  expect(appDialog()?.getAttribute("role")).toBe("alertdialog");
  expect(appDialog()?.textContent).toContain("Delete Plan? This cannot be undone.");
  expect(server.deleteSpreadsheet).not.toHaveBeenCalled();
  await respondToDialog("confirm");
  await flushPromises();

  expect(server.deleteSpreadsheet).toHaveBeenCalledExactlyOnceWith("d1");
  expect(view.find('a[href="/s/d1"]').exists()).toBe(false);
});

it("duplicates a readable document in the list and shows a success notice", async () => {
  const copy = {
    id: "d2",
    name: "Plan (copy)",
    updatedAt: "2026-10-04T12:00:00.000Z",
  };
  server.listSpreadsheets
    .mockResolvedValueOnce(listed([], [{ ...document(null), role: "viewer" }]))
    .mockResolvedValueOnce(
      listed(
        [],
        [
          { ...document(null), role: "viewer" },
          { ...document(null), ...copy },
        ],
      ),
    );
  server.copySpreadsheet.mockResolvedValue(copy);
  const view = await render();

  await view.get('button[aria-label="Actions for Plan"]').trigger("click", {
    clientX: 40,
    clientY: 60,
  });
  await flushPromises();
  await view.get('[role="menuitem"]').trigger("click");
  await flushPromises();

  expect(server.copySpreadsheet).toHaveBeenCalledExactlyOnceWith("d1");
  expect(view.text()).toContain("Plan (copy)");
  expect(view.get('.notice[role="status"] > span').text()).toBe('Created "Plan (copy)"');
  expect(router?.currentRoute.value.name).toBe("spreadsheets");
});

it("creates, renames, and deletes folders, and moves a document between groups", async () => {
  const work = { id: "f1", name: "Projects" };
  server.listSpreadsheets
    .mockResolvedValueOnce(listed([], [document(null)]))
    .mockResolvedValueOnce(listed([work], [document(null)]))
    .mockResolvedValueOnce(listed([{ id: "f1", name: "Work" }], [document(null)]))
    .mockResolvedValueOnce(listed([{ id: "f1", name: "Work" }], [document("f1")]))
    .mockResolvedValueOnce(listed([], [document(null)]));
  server.createFolder.mockResolvedValue(work);
  server.renameFolder.mockResolvedValue({ id: "f1", name: "Work" });
  const view = await render();

  await view
    .findAll("button")
    .find((button) => button.text() === "New folder")!
    .trigger("click");
  await view.get('[aria-label="New folder name"]').setValue("Projects");
  await view.get('form[aria-label="Create folder"]').trigger("submit");
  await flushPromises();
  expect(server.createFolder).toHaveBeenCalledWith("Projects");
  expect(view.text()).toContain("Projects");

  await view.get('button[aria-label="Rename folder Projects"]').trigger("click");
  await view.get('[aria-label="Folder name for Projects"]').setValue("Work");
  await view.get('form[aria-label="Rename folder Projects"]').trigger("submit");
  await flushPromises();
  expect(server.renameFolder).toHaveBeenCalledWith("f1", "Work");

  await view.get('[aria-label="Move Plan to a folder"]').trigger("click", {
    clientX: 40,
    clientY: 60,
  });
  await flushPromises();
  const moveToWork = view
    .findAll('.context-menu [role="menuitem"]')
    .find((item) => item.text() === "Move to Work");
  expect(moveToWork).toBeDefined();
  await moveToWork!.trigger("click");
  await flushPromises();
  expect(server.moveDocument).toHaveBeenCalledWith("d1", "f1");

  await view.get('button[aria-label="Delete folder Work"]').trigger("click");
  await flushPromises();
  expect(server.deleteFolder).toHaveBeenCalledWith("f1");
  expect(view.findAll(".list__group")).toHaveLength(1);
  expect(view.get(".list__group").text()).toContain("Plan");
});

it("auto-dismisses a duplicate-folder error", async () => {
  vi.useFakeTimers();
  server.listSpreadsheets.mockResolvedValue(listed([], [document(null)]));
  server.createFolder.mockRejectedValueOnce(new Error("A folder named Projects already exists"));
  const view = await render();

  await view
    .findAll("button")
    .find((button) => button.text() === "New folder")!
    .trigger("click");
  await view.get('[aria-label="New folder name"]').setValue("Projects");
  await view.get('form[aria-label="Create folder"]').trigger("submit");
  await flushPromises();
  expect(view.get('[role="alert"]').text()).toContain("A folder named Projects already exists");
  expect(view.get('[role="alert"]').classes()).toContain("notice--floating");

  await vi.advanceTimersByTimeAsync(7999);
  expect(view.find('[role="alert"]').exists()).toBe(true);
  await vi.advanceTimersByTimeAsync(1);
  await flushPromises();
  expect(view.find('[role="alert"]').exists()).toBe(false);
});

it("clears a folder error after the next action succeeds", async () => {
  server.listSpreadsheets.mockResolvedValue(listed([], [document(null)]));
  server.createFolder
    .mockRejectedValueOnce(new Error("A folder named Projects already exists"))
    .mockResolvedValueOnce({ id: "f1", name: "Projects" });
  const view = await render();

  await view
    .findAll("button")
    .find((button) => button.text() === "New folder")!
    .trigger("click");
  await view.get('[aria-label="New folder name"]').setValue("Projects");
  await view.get('form[aria-label="Create folder"]').trigger("submit");
  await flushPromises();
  expect(view.find('[role="alert"]').exists()).toBe(true);

  await view.get('form[aria-label="Create folder"]').trigger("submit");
  await flushPromises();
  expect(view.find('[role="alert"]').exists()).toBe(false);
});
