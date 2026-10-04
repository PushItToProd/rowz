import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory } from "vue-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAppRouter } from "./router";
import { useSessionStore } from "./stores/session";
import { useFormulaSessionStore } from "./formula/session";

beforeEach(() => {
  setActivePinia(createPinia());
  useSessionStore().user = { id: "u", name: "User", email: "user@example.com" };
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
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    try {
      await router.push("/s/s1/p/p2");
      expect(confirm).not.toHaveBeenCalled();
      expect(sessions.active!.state).toBe(state);
      await router.push("/");
      expect(router.currentRoute.value.fullPath).toBe("/s/s1/p/p2");
      expect(sessions.active!.state).toBe(state);
      confirm.mockReturnValue(true);
      await router.push("/s/s2/p/p3");
      expect(router.currentRoute.value.fullPath).toBe("/s/s2/p/p3");
      expect(sessions.active).toBeUndefined();
      expect(save).not.toHaveBeenCalled();
    } finally {
      confirm.mockRestore();
    }
  });
});
