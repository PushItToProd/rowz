import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { api } from "../api/client";
import type { RunListItem } from "../api/client";
import type { MockedApi } from "../testing";
import RunsPanel from "./RunsPanel.vue";

vi.mock("../api/client", async () => {
  const testing = await import("../testing");
  return { api: testing.mockApi() };
});
const server = api as unknown as MockedApi;
let wrapper: ReturnType<typeof mount>;

const RUN: RunListItem = {
  id: "run1",
  createdAt: "2026-10-01T10:30:00.000Z",
  kind: "cell_button",
  user: { name: "Ada", email: "ada@example.com" },
  target: {
    type: "cell",
    id: "t1",
    pageName: "Page 1",
    name: "Orders",
    cell: "B2",
  },
  cellsWritten: 2,
  tablesExpanded: 0,
  rowsDeleted: 0,
  emails: 1,
  status: "failed",
  error: "The email could not be sent",
};
const LEGACY_RUN: RunListItem = {
  ...RUN,
  id: "legacy-run",
  kind: "unknown",
  target: { type: "view", id: "v1", pageName: "Page 1", name: "Summary", occurrence: 0 },
};

beforeEach(() => {
  vi.clearAllMocks();
  server.listRuns.mockResolvedValue([RUN]);
});
afterEach(() => {
  wrapper.unmount();
});

it("loads and shows the run details", async () => {
  wrapper = mount(RunsPanel, { props: { spreadsheetId: "s1" } });
  await flushPromises();

  expect(server.listRuns).toHaveBeenCalledExactlyOnceWith("s1");
  expect(wrapper.findAll(".runs__list li")).toHaveLength(1);
  expect(wrapper.text()).toContain("Ada");
  expect(wrapper.text()).toContain("ada@example.com");
  expect(wrapper.text()).toContain("Cell button");
  expect(wrapper.text()).toContain("Page 1 · Orders!B2");
  expect(wrapper.text()).toContain("2 cell writes · 1 email sent");
  expect(wrapper.text()).toContain("Failed");
  expect(wrapper.text()).toContain("The email could not be sent");
  expect(wrapper.get("time").attributes("datetime")).toBe(RUN.createdAt);
});

it("shows an empty state", async () => {
  server.listRuns.mockResolvedValue([]);
  wrapper = mount(RunsPanel, { props: { spreadsheetId: "s1" } });
  await flushPromises();

  expect(wrapper.text()).toContain("No runs have been recorded yet.");
});

it("labels historical runs whose kind was not recorded", async () => {
  server.listRuns.mockResolvedValue([LEGACY_RUN]);
  wrapper = mount(RunsPanel, { props: { spreadsheetId: "s1" } });
  await flushPromises();

  expect(wrapper.text()).toContain("Earlier run (kind not recorded)");
  expect(wrapper.text()).toContain("Page 1 · Summary · Occurrence 1");
});
