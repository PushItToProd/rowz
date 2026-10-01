import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { defineComponent, nextTick, ref } from "vue";
import { APP_NAME } from "./appName";
import { pageTitle, usePageTitle } from "./pageTitle";

describe("pageTitle", () => {
  it("puts the app's name after the page's title", () => {
    expect(pageTitle("My budget")).toBe(`My budget | ${APP_NAME}`);
  });

  it("is the app's name alone for a page with no title yet", () => {
    expect(pageTitle(undefined)).toBe(APP_NAME);
    expect(pageTitle("")).toBe(APP_NAME);
  });
});

describe("usePageTitle", () => {
  it("sets the tab's title and follows the title as it changes", async () => {
    const name = ref<string | undefined>(undefined);
    mount(
      defineComponent({
        setup() {
          usePageTitle(name);
          return () => null;
        },
      }),
    );
    expect(document.title).toBe(APP_NAME);
    name.value = "My budget";
    await nextTick();
    expect(document.title).toBe(`My budget | ${APP_NAME}`);
  });
});
