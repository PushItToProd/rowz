import { createRouter, createWebHistory, type Router, type RouterHistory } from "vue-router";
import { useWorkbookStore } from "./stores/workbook";
import { useSessionStore } from "./stores/session";
import { useFormulaSessionStore } from "./formula/session";
import { useDialog } from "./useDialog";
import { queueListNotice } from "./notice";
import { parseDeepLinkFragment } from "./deepLinks";
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
      {
        path: "/spreadsheets/:spreadsheetId",
        name: "editor-document",
        component: EditorView,
        props: true,
      },
      { path: "/help", name: "help", component: HelpView },
      { path: "/:unknown(.*)*", name: "not-found", component: SpreadsheetListView },
    ],
    // Help links point at headings; editor location links use the shared reveal helper.
    scrollBehavior: (to) =>
      to.name === "editor" && to.hash && parseDeepLinkFragment(to.hash)
        ? false
        : to.hash
          ? { el: to.hash }
          : { top: 0 },
  });

  /** Pages for people who are signed out. A signed-in user is sent to their spreadsheets. */
  const SIGNED_OUT_ONLY = new Set(["login", "signup"]);
  /** Pages anyone can open. */
  const OPEN = new Set(["help"]);
  const EDITOR_ROUTES = new Set(["editor", "editor-document"]);
  let latestNavigation = 0;
  router.beforeEach(async (to, from) => {
    const navigation = ++latestNavigation;
    const isCurrentNavigation = () => navigation === latestNavigation;
    const formulas = useFormulaSessionStore();
    const dialog = useDialog();
    if (
      formulas.active &&
      EDITOR_ROUTES.has(String(from.name)) &&
      (!EDITOR_ROUTES.has(String(to.name)) || to.params.spreadsheetId !== from.params.spreadsheetId)
    ) {
      const confirmed = await dialog.confirm({
        title: "Discard unsaved formula draft",
        message: "Leave this document and discard the unsaved formula draft?",
        confirmLabel: "Leave document",
        danger: true,
      });
      if (!isCurrentNavigation()) return;
      if (!confirmed) {
        formulas.focus();
        return false;
      }
      if (!formulas.cancel()) return false;
    }
    if (
      formulas.active &&
      EDITOR_ROUTES.has(String(from.name)) &&
      EDITOR_ROUTES.has(String(to.name)) &&
      to.params.spreadsheetId === from.params.spreadsheetId &&
      to.params.pageId !== from.params.pageId &&
      formulas.active.mode === "cell" &&
      !formulas.active.state.doc.toString().startsWith("=")
    ) {
      const saved = await formulas.submit(useWorkbookStore().submitFormulaDraft);
      if (!isCurrentNavigation()) return;
      if (!saved) {
        formulas.focus();
        return false;
      }
    }
    if (to.name === "not-found") {
      queueListNotice({
        kind: "error",
        text: "There is no page at " + to.path.slice(0, 80) + ".",
      });
      return { name: "spreadsheets", replace: true };
    }
    const name = typeof to.name === "string" ? to.name : "";
    if (OPEN.has(name)) return true;
    const user = await useSessionStore().load();
    if (!isCurrentNavigation()) return;
    if (!user && !SIGNED_OUT_ONLY.has(name)) {
      return { name: "login", query: { redirect: to.fullPath } };
    }
    if (user && SIGNED_OUT_ONLY.has(name)) return { name: "spreadsheets" };
    return true;
  });

  return router;
}
