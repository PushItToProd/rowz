import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import type { Notice } from "../notice";
import NoticeMessage from "./NoticeMessage.vue";

let wrapper: VueWrapper | undefined;

afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  vi.useRealTimers();
});

it("dismisses errors after eight seconds", async () => {
  vi.useFakeTimers();
  wrapper = mount(NoticeMessage, {
    props: { notice: { kind: "error", text: "Offline" } },
  });

  await vi.advanceTimersByTimeAsync(7999);
  expect(wrapper.emitted("dismiss")).toBeUndefined();
  await vi.advanceTimersByTimeAsync(1);
  expect(wrapper.emitted("dismiss")).toHaveLength(1);
});

it("restarts the timer when the same message is shown again", async () => {
  vi.useFakeTimers();
  const notice: Notice = { kind: "error", text: "A folder named Work already exists" };
  wrapper = mount(NoticeMessage, { props: { notice } });

  await vi.advanceTimersByTimeAsync(7000);
  await wrapper.setProps({ notice: { ...notice } });
  await vi.advanceTimersByTimeAsync(7999);
  expect(wrapper.emitted("dismiss")).toBeUndefined();
  await vi.advanceTimersByTimeAsync(1);
  expect(wrapper.emitted("dismiss")).toHaveLength(1);
});

it("dismisses on Escape and keeps success notices brief", async () => {
  vi.useFakeTimers();
  wrapper = mount(NoticeMessage, {
    props: { notice: { kind: "success", text: "Saved" } },
  });

  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  expect(wrapper.emitted("dismiss")).toHaveLength(1);
  wrapper.unmount();

  wrapper = mount(NoticeMessage, {
    props: { notice: { kind: "success", text: "Saved" } },
  });
  await vi.advanceTimersByTimeAsync(3999);
  await flushPromises();
  expect(wrapper.emitted("dismiss")).toBeUndefined();
  await vi.advanceTimersByTimeAsync(1);
  expect(wrapper.emitted("dismiss")).toHaveLength(1);
});

it("keeps notices with action links until dismissed", async () => {
  vi.useFakeTimers();
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/s/:spreadsheetId", name: "editor", component: { template: "<div />" } }],
  });
  await router.push({ name: "editor", params: { spreadsheetId: "copy" } });
  wrapper = mount(NoticeMessage, {
    props: {
      notice: {
        kind: "success",
        text: "Copy saved. You are now editing “Budget (copy)”.",
        action: {
          label: "Back to original",
          to: { name: "editor", params: { spreadsheetId: "original" } },
        },
      },
    },
    global: { plugins: [router] },
  });

  await vi.advanceTimersByTimeAsync(60_000);
  expect(wrapper.emitted("dismiss")).toBeUndefined();
  expect(wrapper.get(".notice__action").text()).toBe("Back to original");

  await wrapper.get('[aria-label="Dismiss"]').trigger("click");
  expect(wrapper.emitted("dismiss")).toHaveLength(1);
});

it("runs and briefly shows an action button", async () => {
  vi.useFakeTimers();
  const run = vi.fn();
  wrapper = mount(NoticeMessage, {
    props: {
      notice: { kind: "success", text: "Deleted row 3", action: { label: "Undo", run } },
    },
  });

  expect(wrapper.get(".notice__action").text()).toBe("Undo");
  await wrapper.get(".notice__action").trigger("click");
  expect(run).toHaveBeenCalledOnce();
  expect(wrapper.emitted("dismiss")).toHaveLength(1);

  await wrapper.setProps({
    notice: { kind: "success", text: "Deleted row 3", action: { label: "Undo", run } },
  });
  await vi.advanceTimersByTimeAsync(4000);
  expect(wrapper.emitted("dismiss")).toHaveLength(2);
});
