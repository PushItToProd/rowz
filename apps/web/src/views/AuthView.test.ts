import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter, type Router } from "vue-router";
import { useSessionStore } from "../stores/session";
import AuthView from "./AuthView.vue";

let wrapper: VueWrapper | undefined;
let router: Router | undefined;

async function render(): Promise<VueWrapper> {
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/login", name: "login", component: { template: "<div />" } },
      { path: "/signup", name: "signup", component: { template: "<div />" } },
      { path: "/help", name: "help", component: { template: "<div />" } },
    ],
  });
  await router.push("/login");
  wrapper = mount(AuthView, {
    props: { mode: "login" },
    global: { plugins: [router] },
  });
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  setActivePinia(createPinia());
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  router = undefined;
});

describe("AuthView", () => {
  it("replaces a sign-in error with in-app validation after an empty attempt", async () => {
    const signIn = vi
      .spyOn(useSessionStore(), "signIn")
      .mockRejectedValueOnce(new Error("Invalid email or password"));
    const view = await render();
    const form = view.get("form");

    await view.get('input[name="email"]').setValue("ada@example.com");
    await view.get('input[name="password"]').setValue("wrong password");
    await form.trigger("submit");
    await flushPromises();
    expect(view.get('[role="alert"]').text()).toBe("Invalid email or password");

    await view.get('input[name="email"]').setValue("");
    await form.trigger("submit");

    expect(form.attributes("novalidate")).toBeDefined();
    expect(view.get('[role="alert"]').text()).toBe("Enter your email address.");
    expect(view.get('[role="alert"]').text()).not.toContain("Invalid email or password");
    expect(signIn).toHaveBeenCalledExactlyOnceWith("ada@example.com", "wrong password");
  });
});
