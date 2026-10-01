import { createPinia } from "pinia";
import { createApp } from "vue";
import { setUnauthenticatedHandler } from "./api/client";
import App from "./App.vue";
import { createAppRouter } from "./router";
import { useSessionStore } from "./stores/session";
import "./styles.css";

const pinia = createPinia();
const router = createAppRouter();

// A session can expire while the app is open. Send the user to sign in and bring them back after.
setUnauthenticatedHandler(() => {
  useSessionStore(pinia).clear();
  void router.push({ name: "login", query: { redirect: router.currentRoute.value.fullPath } });
});

createApp(App).use(pinia).use(router).mount("#app");
