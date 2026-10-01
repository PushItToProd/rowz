import { createRouter, createWebHistory, type Router, type RouterHistory } from "vue-router";
import { useSessionStore } from "./stores/session";
import AuthView from "./views/AuthView.vue";
import EditorView from "./views/EditorView.vue";
import SpreadsheetListView from "./views/SpreadsheetListView.vue";

export function createAppRouter(history: RouterHistory = createWebHistory()): Router {
  const router = createRouter({
    history,
    routes: [
      { path: "/login", name: "login", component: AuthView, props: { mode: "login" } },
      { path: "/signup", name: "signup", component: AuthView, props: { mode: "signup" } },
      { path: "/", name: "spreadsheets", component: SpreadsheetListView },
      { path: "/s/:spreadsheetId/p/:pageId?", name: "editor", component: EditorView, props: true },
      { path: "/:unknown(.*)*", redirect: "/" },
    ],
  });

  const PUBLIC = new Set(["login", "signup"]);
  router.beforeEach(async (to) => {
    const user = await useSessionStore().load();
    const isPublic = typeof to.name === "string" && PUBLIC.has(to.name);
    if (!user && !isPublic) return { name: "login", query: { redirect: to.fullPath } };
    if (user && isPublic) return { name: "spreadsheets" };
    return true;
  });

  return router;
}
