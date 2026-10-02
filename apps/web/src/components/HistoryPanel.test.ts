import { createPinia, setActivePinia } from "pinia";
import { changeWith } from "../testing";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, type VersionListItem } from "../api/client";
import type { MockedApi } from "../testing";
import HistoryPanel from "./HistoryPanel.vue";

vi.mock("../api/client", async () => {
  const testing = await import("../testing");
  return { api: testing.mockApi(), setJournaledHandler: testing.setJournaledHandler };
});
const server = api as unknown as MockedApi;

const VERSIONS: VersionListItem[] = [
  {
    id: "v2",
    createdAt: "2026-10-01T10:30:00Z",
    reason: "Before deleting row 3 of Sales",
    createdBy: "Ada",
  },
  { id: "v1", createdAt: "2026-10-01T09:00:00Z", reason: null, createdBy: null },
];

let wrapper: VueWrapper;
const confirm = vi.spyOn(window, "confirm");

async function render(canRestore = true): Promise<void> {
  wrapper = mount(HistoryPanel, {
    props: { spreadsheetId: "s1", canRestore },
    attachTo: document.body,
  });
  await flushPromises();
}

function button(name: string, index = 0) {
  const found = wrapper.findAll("button").filter((candidate) => candidate.text() === name)[index];
  if (!found) throw new Error(`No button named ${name}`);
  return found;
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  confirm.mockReturnValue(true);
  server.listVersions.mockResolvedValue(VERSIONS);
  server.restoreVersion.mockResolvedValue(changeWith(undefined));
});
afterEach(() => {
  wrapper.unmount();
});

describe("HistoryPanel", () => {
  it("lists the kept versions with why and by whom each was kept", async () => {
    await render();
    expect(server.listVersions).toHaveBeenCalledExactlyOnceWith("s1");
    const items = wrapper.findAll(".history__list li");
    expect(items).toHaveLength(2);
    expect(items[0]!.get(".history__reason").text()).toBe("Before deleting row 3 of Sales");
    expect(items[0]!.get(".history__who").text()).toBe("Ada");
    expect(items[1]!.get(".history__reason").text()).toBe("Kept while editing");
    expect(items[1]!.find(".history__who").exists()).toBe(false);
    expect(items[0]!.get("time").attributes("datetime")).toBe("2026-10-01T10:30:00Z");
  });

  it("says so when there are none", async () => {
    server.listVersions.mockResolvedValue([]);
    await render();
    expect(wrapper.text()).toContain("No versions have been kept yet.");
  });

  it("restores a version after confirming, and says the spreadsheet must be read again", async () => {
    await render();
    confirm.mockReturnValue(false);
    await button("Restore", 1).trigger("click");
    expect(server.restoreVersion).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    await button("Restore", 1).trigger("click");
    await flushPromises();
    expect(server.restoreVersion).toHaveBeenCalledExactlyOnceWith("s1", "v1");
    expect(wrapper.emitted("restored")).toHaveLength(1);
    // The list is read again, because restoring keeps a new version.
    expect(server.listVersions).toHaveBeenCalledTimes(2);
  });

  it("opens a copy of a version as a new spreadsheet", async () => {
    await render();
    server.copyVersion.mockResolvedValue({ id: "s2", name: "Budget (copy)", updatedAt: "" });
    await button("Open a copy").trigger("click");
    await flushPromises();
    expect(server.copyVersion).toHaveBeenCalledExactlyOnceWith("s1", "v2");
    expect(wrapper.emitted("copied")).toEqual([["s2"]]);
  });

  it("offers a viewer copies and no restore", async () => {
    await render(false);
    expect(wrapper.findAll("button").map((found) => found.text())).toEqual([
      "×",
      "Open a copy",
      "Open a copy",
    ]);
  });

  it("shows why a restore failed", async () => {
    await render();
    server.restoreVersion.mockRejectedValue(new Error("Version not found"));
    await button("Restore").trigger("click");
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toBe("Version not found");
    expect(wrapper.emitted("restored")).toBeUndefined();
  });

  it("closes on its button and on Escape", async () => {
    await render();
    await wrapper.get('[aria-label="Close history"]').trigger("click");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(wrapper.emitted("close")).toHaveLength(2);
  });
});
