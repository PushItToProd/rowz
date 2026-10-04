import { EditorView } from "@codemirror/view";
import { undo } from "@codemirror/commands";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { expect, it, vi } from "vitest";
import { api } from "../api/client";
import { snapshotWith, wireSnapshot, type MockedApi } from "../testing";
import { useWorkbookStore } from "../stores/workbook";
import { useFormulaSessionStore } from "../formula/session";
import SessionFormulaField from "./SessionFormulaField.vue";

vi.mock("../api/client", async () => {
  const testing = await import("../testing");
  return { api: testing.mockApi(), setJournaledHandler: testing.setJournaledHandler };
});

it("transfers one editor between fields for the same target without saving or losing history", async () => {
  setActivePinia(createPinia());
  const server = api as unknown as MockedApi;
  server.getSnapshot.mockResolvedValue(wireSnapshot(snapshotWith({})));
  await useWorkbookStore().load("s1");
  const wrapper = mount(
    {
      components: { SessionFormulaField },
      template: `<SessionFormulaField v-for="label in ['First', 'Second']" :key="label"
        :target="{kind: 'chart', viewId: 'v1'}" :context="{pageId: 'p1'}"
        value="A1" :label="label" :max-length="1000" />`,
    },
    { attachTo: document.body },
  );
  try {
    (wrapper.get('input[aria-label="First"]').element as HTMLInputElement).focus();
    await flushPromises();
    const first = EditorView.findFromDOM(wrapper.get(".cm-editor").element as HTMLElement)!;
    first.dispatch({
      changes: { from: 0, to: 2, insert: "SUM(A1)" },
      selection: { anchor: 4 },
      userEvent: "input.type",
    });
    await flushPromises();
    (wrapper.get('input[aria-label="Second"]').element as HTMLInputElement).focus();
    await flushPromises();
    expect(wrapper.findAll(".cm-editor")).toHaveLength(1);
    const second = EditorView.findFromDOM(wrapper.get(".cm-editor").element as HTMLElement)!;
    expect(second).not.toBe(first);
    expect(second.state.doc.toString()).toBe("SUM(A1)");
    expect(second.state.selection.main.anchor).toBe(4);
    expect(server.updateView).not.toHaveBeenCalled();
    expect(undo(second)).toBe(true);
    await flushPromises();
    expect(useFormulaSessionStore().active?.state.doc.toString()).toBe("A1");
  } finally {
    wrapper.unmount();
  }
});
