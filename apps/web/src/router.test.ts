import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory } from "vue-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAppRouter } from "./router";
import { takeQueuedListNotice } from "./notice";
import { useWorkbookStore } from "./stores/workbook";
import { useSessionStore } from "./stores/session";
import { useFormulaSessionStore } from "./formula/session";
import { appDialog, mountDialogHost, respondToDialog } from "./testing";
import type { VueWrapper } from "@vue/test-utils";

let dialogHost: VueWrapper;

beforeEach(() => {
  setActivePinia(createPinia());
  useSessionStore().user = { id: "u", name: "User", email: "user@example.com" };
  takeQueuedListNotice();
  dialogHost = mountDialogHost();
});

afterEach(() => {
  dialogHost.unmount();
  takeQueuedListNotice();
});

it.each(["/nonsense", "/" + "x".repeat(100)])(
  "redirects unknown path %s to the document list with a text notice",
  async (path) => {
    const router = createAppRouter(createMemoryHistory());
    await router.push(path);

    expect(router.currentRoute.value.name).toBe("spreadsheets");
    expect(router.currentRoute.value.fullPath).toBe("/");
    expect(takeQueuedListNotice()).toEqual({
      kind: "error",
      text: "There is no page at " + path.slice(0, 80) + ".",
    });
  },
);

it("routes the requested spreadsheet URL to the editor", () => {
  const router = createAppRouter(createMemoryHistory());
  expect(router.resolve("/spreadsheets/document-id").name).toBe("editor-document");
});

it("routes page and target fragments through the canonical editor route", () => {
  const router = createAppRouter(createMemoryHistory());
  const page = router.resolve("/s/document-id/p/page-id");
  const cell = router.resolve("/s/document-id/p/page-id#cell=table-id.row-id.col-id");
  const block = router.resolve("/s/document-id/p/page-id#block=block-id");

  expect(page.name).toBe("editor");
  expect(page.params).toEqual({ spreadsheetId: "document-id", pageId: "page-id" });
  expect(cell.name).toBe("editor");
  expect(cell.hash).toBe("#cell=table-id.row-id.col-id");
  expect(block.name).toBe("editor");
  expect(block.hash).toBe("#block=block-id");
});

describe("departure with a formula draft", () => {
  it("retains drafts on internal page navigation and asks before leaving without saving", async () => {
    const router = createAppRouter(createMemoryHistory());
    await router.push("/s/s1/p/p1");
    const sessions = useFormulaSessionStore();
    const save = vi.fn(() => Promise.resolve("saved" as const));
    await sessions.start(
      {
        target: { kind: "chart", viewId: "v1" },
        context: { pageId: "p1" },
        mode: "formula",
        text: "draft",
      },
      save,
    );
    const state = sessions.active!.state;
    await router.push("/s/s1/p/p2");
    expect(appDialog()).toBeNull();
    expect(sessions.active!.state).toBe(state);
    const deniedNavigation = router.push("/");
    await vi.waitFor(() => {
      expect(appDialog()?.textContent).toContain("Leave this document");
    });
    await respondToDialog("cancel");
    await deniedNavigation;
    expect(router.currentRoute.value.fullPath).toBe("/s/s1/p/p2");
    expect(sessions.active!.state).toBe(state);
    const allowedNavigation = router.push("/s/s2/p/p3");
    await vi.waitFor(() => {
      expect(appDialog()).not.toBeNull();
    });
    await respondToDialog("confirm");
    await allowedNavigation;
    expect(router.currentRoute.value.fullPath).toBe("/s/s2/p/p3");
    expect(sessions.active).toBeUndefined();
    expect(save).not.toHaveBeenCalled();
  });
  it("does not discard a draft when a newer page navigation supersedes the leave dialog", async () => {
    const router = createAppRouter(createMemoryHistory());
    await router.push("/s/s1/p/p1");
    await router.push("/s/s1/p/p2");
    const sessions = useFormulaSessionStore();
    await sessions.start(
      {
        target: { kind: "chart", viewId: "v1" },
        context: { pageId: "p2" },
        mode: "formula",
        text: "draft",
      },
      () => Promise.resolve("saved"),
    );
    const state = sessions.active!.state;

    const supersededNavigation = router.push("/");
    await vi.waitFor(() => {
      expect(appDialog()).not.toBeNull();
    });
    router.back();
    await vi.waitFor(() => {
      expect(router.currentRoute.value.fullPath).toBe("/s/s1/p/p1");
    });

    await respondToDialog("confirm");
    await supersededNavigation;

    expect(router.currentRoute.value.fullPath).toBe("/s/s1/p/p1");
    expect(sessions.active?.state).toBe(state);
  });
  it("does not refocus a draft when a newer page navigation supersedes its save", async () => {
    const router = createAppRouter(createMemoryHistory());
    await router.push("/s/s1/p/p1");
    const sessions = useFormulaSessionStore();
    const target = { kind: "cell" as const, tableId: "t1", rowId: "r0", colId: "c1" };
    await sessions.start(
      {
        target,
        context: { pageId: "p1", tableId: "t1" },
        mode: "cell",
        text: "1",
      },
      () => Promise.resolve("saved"),
    );
    const focus = vi.fn();
    sessions.attachField(target, focus);
    let rejectSave!: (error: Error) => void;
    const save = vi.spyOn(useWorkbookStore(), "submitFormulaDraft").mockImplementation(
      () =>
        new Promise<"saved" | "deleted">((_, reject) => {
          rejectSave = reject;
        }),
    );
    const submit = vi.spyOn(sessions, "submit");

    const supersededNavigation = router.push("/s/s1/p/p2");
    await vi.waitFor(() => {
      expect(save).toHaveBeenCalledTimes(1);
    });
    const currentNavigation = router.push("/s/s1/p/p3");
    await vi.waitFor(() => {
      expect(submit).toHaveBeenCalledTimes(2);
    });
    rejectSave(new Error("Offline"));
    await Promise.all([supersededNavigation, currentNavigation]);

    expect(router.currentRoute.value.fullPath).toBe("/s/s1/p/p1");
    expect(sessions.active).toMatchObject({ saving: false, error: "Offline" });
    expect(focus).toHaveBeenCalledTimes(1);
  });
  it.each(["1", "=", "=B2"])(
    "uses the current cell draft %j to decide whether page browsing saves",
    async (text) => {
      const router = createAppRouter(createMemoryHistory());
      await router.push("/s/s1/p/p1");
      const sessions = useFormulaSessionStore();
      await sessions.start(
        {
          target: { kind: "cell", tableId: "t1", rowId: "r0", colId: "c1" },
          context: { pageId: "p1", tableId: "t1" },
          mode: "cell",
          text: "original",
        },
        () => Promise.resolve("saved"),
      );
      sessions.updateState(
        sessions.active!.state.update({ changes: { from: 0, to: 8, insert: text } }).state,
      );
      const save = vi.spyOn(useWorkbookStore(), "submitFormulaDraft").mockResolvedValue("saved");
      await router.push("/s/s1/p/p2");
      expect(router.currentRoute.value.fullPath).toBe("/s/s1/p/p2");
      if (text.startsWith("=")) {
        expect(save).not.toHaveBeenCalled();
        expect(sessions.active?.state.doc.toString()).toBe(text);
      } else {
        expect(save).toHaveBeenCalledWith(
          { kind: "cell", tableId: "t1", rowId: "r0", colId: "c1" },
          text,
        );
        expect(sessions.active).toBeUndefined();
      }
    },
  );
  it("blocks page navigation after a literal cell save fails", async () => {
    const router = createAppRouter(createMemoryHistory());
    await router.push("/s/s1/p/p1");
    const sessions = useFormulaSessionStore();
    await sessions.start(
      {
        target: { kind: "cell", tableId: "t1", rowId: "r0", colId: "c1" },
        context: { pageId: "p1" },
        mode: "cell",
        text: "1",
      },
      () => Promise.resolve("saved"),
    );
    vi.spyOn(useWorkbookStore(), "submitFormulaDraft").mockRejectedValue(new Error("Offline"));
    await router.push("/s/s1/p/p2");
    expect(router.currentRoute.value.fullPath).toBe("/s/s1/p/p1");
    expect(sessions.active?.state.doc.toString()).toBe("1");
  });
});
