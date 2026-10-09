import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter, type Router } from "vue-router";
import type { DocumentListItem, FolderRecord, ListedSpreadsheetItem } from "../api/client";
import type { DocumentSearchResponse } from "@spreadsheet-app/shared";
import { api } from "../api/client";
import { DOCUMENT_TEMPLATES } from "../files/templates";
import { queueListNotice, takeQueuedListNotice } from "../notice";
import { appDialog, mountDialogHost, respondToDialog, type MockedApi } from "../testing";
import { bodyFindAll, bodyGet, bodyHas } from "../testing/teleported";
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

async function waitForGallery(view: VueWrapper) {
  const gallery = view.get('[role="dialog"][aria-labelledby="samples-gallery-title"]');
  await vi.waitFor(
    () => {
      expect(gallery.findAll(".list__gallery-card")).toHaveLength(16);
    },
    { timeout: 5000 },
  );
  return gallery;
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  takeQueuedListNotice();
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  dialogHost?.unmount();
  dialogHost = undefined;
  router = undefined;
  takeQueuedListNotice();
  vi.useRealTimers();
});

it("keeps a queued route error through the initial document list refresh", async () => {
  const text = "That document was not found, or you do not have access to it.";
  queueListNotice({ kind: "error", text });

  const view = await render();

  expect(view.get('[role="alert"]').text()).toContain(text);
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

it("numbers direct template copies when the name is already in the document list", async () => {
  server.listSpreadsheets.mockResolvedValue(
    listed(
      [],
      [
        { ...document(null), id: "first", name: "To-do list" },
        { ...document(null), id: "second", name: "To-do list (2)" },
      ],
    ),
  );
  server.importSpreadsheet.mockResolvedValue({
    id: "numbered-template",
    name: "To-do list (3)",
    updatedAt: "2026-10-06T12:00:00.000Z",
  });
  const view = await render();

  await view.get('button[aria-controls="document-templates"]').trigger("click");
  await view.get('button[aria-label="Create To-do list from template"]').trigger("click");
  await flushPromises();

  expect(server.importSpreadsheet.mock.calls[0]?.[0]?.name).toBe("To-do list (3)");
  expect(router?.currentRoute.value.params.spreadsheetId).toBe("numbered-template");
});

it("renders the templates and samples gallery from the empty state", async () => {
  server.listSpreadsheets.mockResolvedValue(listed([], []));
  const view = await render();

  const browse = view
    .findAll("button")
    .find((button) => button.text() === "Browse samples and templates");
  expect(browse).toBeDefined();
  await browse!.trigger("click");
  const gallery = await waitForGallery(view);
  expect(gallery.get("h2").text()).toBe("Samples and templates");
  const invoice = gallery
    .findAll(".list__gallery-card")
    .find((card) => card.text().includes("Invoice"));
  const sample = gallery
    .findAll(".list__gallery-card")
    .find((card) => card.text().includes("Gran Turismo 7 grind comparison"));
  expect(invoice?.get(".list__gallery-category").text()).toBe("Templates");
  expect(sample?.get(".list__gallery-category").text()).toBe("Samples");
  expect(sample?.text()).toContain("Scripts");
  expect(sample?.text()).toContain("Data tables");
  expect(sample?.text()).toContain("Use this");
  expect(sample?.get("button").attributes("aria-label")).toBe(
    "Use Gran Turismo 7 grind comparison",
  );
});

it("keeps focus in the gallery while an example import disables its button", async () => {
  let completeImport!: () => void;
  server.listSpreadsheets.mockResolvedValue(listed([], []));
  server.importSpreadsheet.mockImplementation(
    () =>
      new Promise((resolve) => {
        completeImport = () => {
          resolve({
            id: "focused-import",
            name: "Gran Turismo 7 grind comparison",
            updatedAt: "2026-10-06T12:00:00.000Z",
          });
        };
      }),
  );
  const view = await render();

  await view
    .findAll("button")
    .find((button) => button.text() === "Browse samples and templates")!
    .trigger("click");
  const gallery = await waitForGallery(view);
  const card = gallery
    .findAll(".list__gallery-card")
    .find((item) => item.text().includes("Gran Turismo 7 grind comparison"));
  expect(card).toBeDefined();
  const useButton = card!.get("button");

  await useButton.trigger("click");
  await flushPromises();

  const closeButton = gallery.get('button[aria-label="Close samples and templates"]');
  expect(useButton.attributes("disabled")).toBeDefined();
  expect(globalThis.document.activeElement).toBe(closeButton.element);
  const dialogElement = globalThis.document.querySelector<HTMLElement>('[role="dialog"]');
  expect(dialogElement).not.toBeNull();
  dialogElement!.focus();
  await gallery.trigger("keydown", { key: "Tab" });
  expect(globalThis.document.activeElement).toBe(closeButton.element);

  completeImport();
  await flushPromises();
});

it("copies a selected sample with the next available name and opens it", async () => {
  const created = {
    id: "sample-document",
    name: "Gran Turismo 7 grind comparison (3)",
    updatedAt: "2026-10-06T12:00:00.000Z",
  };
  server.listSpreadsheets.mockResolvedValue(
    listed(
      [],
      [
        { ...document(null), id: "first", name: "Gran Turismo 7 grind comparison" },
        { ...document(null), id: "second", name: "Gran Turismo 7 grind comparison (2)" },
      ],
    ),
  );
  server.importSpreadsheet.mockResolvedValue(created);
  const view = await render();

  await view
    .findAll("button")
    .find((button) => button.text() === "Browse samples and templates")!
    .trigger("click");
  const gallery = await waitForGallery(view);
  const card = gallery
    .findAll(".list__gallery-card")
    .find((item) => item.text().includes("Gran Turismo 7 grind comparison"));
  expect(card).toBeDefined();
  await card!.get("button").trigger("click");
  await flushPromises();

  expect(server.importSpreadsheet).toHaveBeenCalledOnce();
  const imported = server.importSpreadsheet.mock.calls[0]?.[0];
  expect(imported?.name).toBe("Gran Turismo 7 grind comparison (3)");
  expect(imported?.pages[0]?.blocks.some((block) => block.type === "text")).toBe(true);
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
  expect(workGroup.findAll(".list__items a").map((link) => link.text())).toEqual(["Plan"]);
  await workGroup.find(".list__group-toggle").trigger("click");
  await flushPromises();
  expect(workGroup.find(".list__group-toggle").attributes("aria-expanded")).toBe("false");
  expect(workGroup.get("ul").isVisible()).toBe(false);

  const unfiled = view.findAll(".list__group")[1]!;
  expect(unfiled.text()).toContain("Loose notes");
});

it("debounces document search, safely highlights matches, and clears back to the list", async () => {
  server.listSpreadsheets.mockResolvedValue(listed([], [document(null)]));
  const results: DocumentSearchResponse = [
    {
      spreadsheetId: "d1",
      name: "Plan <img>",
      matches: [
        {
          kind: "cell",
          pageName: "Operations",
          blockName: "Table 1",
          address: "A1",
          snippet: "<img src=x>needle & safe",
          matchStart: 11,
          matchEnd: 17,
        },
      ],
    },
  ];
  server.searchDocuments.mockResolvedValue(results);
  const view = await render();
  vi.useFakeTimers();

  const input = view.get('[aria-label="Search documents"]');
  await input.setValue("needle");
  expect(server.searchDocuments).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(249);
  expect(server.searchDocuments).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  await flushPromises();

  expect(server.searchDocuments).toHaveBeenCalledExactlyOnceWith("needle");
  expect(view.get(".list__search-result").text()).toContain("Operations › Table 1 › A1");
  expect(view.get(".list__search-result mark").text()).toBe("needle");
  expect(view.find("img").exists()).toBe(false);
  expect(view.findAll(".list__group")).toHaveLength(0);

  await view.get('button[aria-label="Clear search"]').trigger("click");
  await flushPromises();
  expect((input.element as HTMLInputElement).value).toBe("");
  expect(view.findAll(".list__group")).toHaveLength(1);
});

it("shows empty and error states for document search", async () => {
  server.listSpreadsheets.mockResolvedValue(listed([], [document(null)]));
  server.searchDocuments.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error("offline"));
  const view = await render();
  vi.useFakeTimers();

  const input = view.get('[aria-label="Search documents"]');
  await input.setValue("absent");
  await vi.advanceTimersByTimeAsync(250);
  await flushPromises();
  expect(view.text()).toContain("No documents match");

  await input.setValue("offline");
  await vi.advanceTimersByTimeAsync(250);
  await flushPromises();
  expect(view.get('[role="alert"]').text()).toContain("Search failed: offline");
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
  const menu = bodyGet('[role="menu"][aria-label="Actions for Plan"]');
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
  expect(bodyHas('[role="menu"]')).toBe(false);

  await view.get('button[aria-label="Actions for Plan"]').trigger("click", {
    clientX: 40,
    clientY: 60,
  });
  await flushPromises();
  await bodyGet('[role="menuitem"]:nth-child(1)').trigger("click");
  await flushPromises();
  const input = view.get('[aria-label="Document name for Plan"]');
  expect(globalThis.document.activeElement).toBe(input.element);
  await input.setValue(" Forecast ");
  await input.trigger("keydown", { key: "Enter" });
  await flushPromises();

  expect(server.renameSpreadsheet).toHaveBeenCalledExactlyOnceWith("d1", "Forecast");
  const link = view.get(".list__items a");
  expect(link.text()).toBe("Forecast");
  expect(globalThis.document.activeElement).toBe(link.element);
});

it("opens an owned document on one click on its name, without starting a rename", async () => {
  server.listSpreadsheets.mockReset().mockResolvedValue(listed([], [document(null)]));
  const view = await render();

  const links = view.findAll(".list__items a");
  expect(links.map((link) => link.text())).toEqual(["Plan"]);
  await links[0]!.trigger("click", { button: 0 });
  await flushPromises();

  expect(view.find('[aria-label="Document name for Plan"]').exists()).toBe(false);
  expect(router!.currentRoute.value.params.spreadsheetId).toBe("d1");
});

it("cancels an empty document name and explains why", async () => {
  // Clear a pending one-time response if the previous rename test stopped early.
  server.listSpreadsheets.mockReset().mockResolvedValue(listed([], [document(null)]));
  const view = await render();

  await view.get(".list__items > li").get('button[aria-haspopup="menu"]').trigger("click", {
    clientX: 40,
    clientY: 60,
  });
  await flushPromises();
  await bodyGet('[role="menuitem"]').trigger("click");
  await flushPromises();

  const input = view.get('[aria-label="Document name for Plan"]');
  await input.setValue("   ");
  await input.trigger("keydown", { key: "Enter" });
  expect(server.renameSpreadsheet).not.toHaveBeenCalled();
  expect(view.find('[aria-label="Document name for Plan"]').exists()).toBe(false);
  expect(view.get('[role="alert"] > span').text()).toBe("Enter a document name.");
});

it("drops an open document-name draft when a list refresh brings a newer name", async () => {
  const updated = { ...document(null), name: "Remote rename" };
  let completeCopy!: () => void;
  server.listSpreadsheets
    .mockResolvedValueOnce(listed([], [document(null)]))
    .mockResolvedValueOnce(listed([], [updated, { ...document(null), id: "d2", name: "Copy" }]));
  server.copySpreadsheet.mockImplementation(
    () =>
      new Promise((resolve) => {
        completeCopy = () => {
          resolve({ id: "d2", name: "Copy", updatedAt: "2026-10-04T12:00:00.000Z" });
        };
      }),
  );
  const view = await render();

  await view.get('button[aria-label="Actions for Plan"]').trigger("click", {
    clientX: 40,
    clientY: 60,
  });
  await flushPromises();
  const duplicate = bodyFindAll('[role="menuitem"]').find((item) => item.text() === "Duplicate");
  expect(duplicate).toBeDefined();
  await duplicate!.trigger("click");
  await flushPromises();
  expect(server.copySpreadsheet).toHaveBeenCalledExactlyOnceWith("d1");

  await view.get('button[aria-label="Actions for Plan"]').trigger("click", {
    clientX: 40,
    clientY: 60,
  });
  await flushPromises();
  await bodyGet('[role="menuitem"]:nth-child(1)').trigger("click");
  await flushPromises();
  const input = view.get<HTMLInputElement>('[aria-label="Document name for Plan"]');
  await input.setValue("Stale draft");
  completeCopy();
  await flushPromises();

  expect(server.listSpreadsheets).toHaveBeenCalledTimes(2);
  expect(view.find('[aria-label="Document name for Plan"]').exists()).toBe(false);
  const remoteName = view
    .findAll(".list__items > li")
    .find((item) => item.text().includes("Remote rename"))!
    .get("a");
  expect(remoteName.text()).toBe("Remote rename");
  expect(globalThis.document.activeElement).toBe(remoteName.element);
  expect(server.renameSpreadsheet).not.toHaveBeenCalled();
});

it("shows only Duplicate for a shared document", async () => {
  server.listSpreadsheets.mockResolvedValue(listed([], [{ ...document(null), role: "viewer" }]));
  const view = await render();

  await view.get('button[aria-label="Actions for Plan"]').trigger("click", {
    clientX: 40,
    clientY: 60,
  });
  await flushPromises();
  expect(bodyFindAll('[role="menuitem"]').map((item) => item.text())).toEqual(["Duplicate"]);
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
  await bodyGet('[role="menuitem"][class*="danger"]').trigger("click");
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
  await bodyGet('[role="menuitem"]').trigger("click");
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
  const moveToWork = bodyFindAll('.context-menu [role="menuitem"]').find(
    (item) => item.text() === "Move to Work",
  );
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
