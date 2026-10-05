import { createRouter, createWebHistory, type Router, type RouterHistory } from "vue-router";
import { useWorkbookStore } from "./stores/workbook";
import { useSessionStore } from "./stores/session";
import { useFormulaSessionStore } from "./formula/session";
import AuthView from "./views/AuthView.vue";
import EditorView from "./views/EditorView.vue";
import HelpView from "./views/HelpView.vue";
import SpreadsheetListView from "./views/SpreadsheetListView.vue";

export function createAppRouter(history: RouterHistory = createWebHistory()): Router {
  const router = createRouter({
    history,
    routes: [
      { path: "/login", name: "login", component: AuthView, props: { mode: "login" } },
      { path: "/signup", name: "signup", component: AuthView, props: { mode: "signup" } },
      { path: "/", name: "spreadsheets", component: SpreadsheetListView },
      { path: "/s/:spreadsheetId/p/:pageId?", name: "editor", component: EditorView, props: true },
      { path: "/help", name: "help", component: HelpView },
      { path: "/:unknown(.*)*", redirect: "/" },
    ],
    // Links within the help page point at its sections.
    scrollBehavior: (to) => (to.hash ? { el: to.hash } : { top: 0 }),
  });

  /** Pages for people who are signed out. A signed-in user is sent to their spreadsheets. */
  const SIGNED_OUT_ONLY = new Set(["login", "signup"]);
  /** Pages anyone can open. */
  const OPEN = new Set(["help"]);
  router.beforeEach(async (to, from) => {
    const formulas = useFormulaSessionStore();
    if (
      formulas.active &&
      from.name === "editor" &&
      (to.name !== "editor" || to.params.spreadsheetId !== from.params.spreadsheetId)
    ) {
      if (!window.confirm("Leave this document and discard the unsaved formula draft?")) {
        formulas.focus();
        return false;
      }
      if (!formulas.cancel()) return false;
    }
    if (
      formulas.active &&
      from.name === "editor" &&
      to.name === "editor" &&
      to.params.spreadsheetId === from.params.spreadsheetId &&
      to.params.pageId !== from.params.pageId &&
      formulas.active.mode === "cell" &&
      !formulas.active.state.doc.toString().startsWith("=")
    ) {
      if (!(await formulas.submit(useWorkbookStore().submitFormulaDraft))) {
        formulas.focus();
        return false;
      }
    }
    const name = typeof to.name === "string" ? to.name : "";
    if (OPEN.has(name)) return true;
    const user = await useSessionStore().load();
    if (!user && !SIGNED_OUT_ONLY.has(name)) {
      return { name: "login", query: { redirect: to.fullPath } };
    }
    if (user && SIGNED_OUT_ONLY.has(name)) return { name: "spreadsheets" };
    return true;
  });

  return router;
}
