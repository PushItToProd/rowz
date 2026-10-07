import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, type MemberRecord } from "../api/client";
import { appDialog, mountDialogHost, respondToDialog, type MockedApi } from "../testing";
import SharePanel from "./SharePanel.vue";

vi.mock("../api/client", async () => {
  const testing = await import("../testing");
  return { api: testing.mockApi(), setJournaledHandler: testing.setJournaledHandler };
});
const server = api as unknown as MockedApi;

const OWNER: MemberRecord = {
  userId: "u1",
  name: "Ada",
  email: "ada@example.com",
  role: "owner",
  shared: false,
};
const GUEST: MemberRecord = {
  userId: "u2",
  name: "Bo",
  email: "bo@example.com",
  role: "editor",
  shared: true,
};

let wrapper: VueWrapper;
let dialogHost: VueWrapper;

async function render(props: { owner?: boolean; userId?: string } = {}): Promise<void> {
  wrapper = mount(SharePanel, {
    props: { spreadsheetId: "s1", owner: true, userId: "u1", ...props },
    attachTo: document.body,
  });
  await flushPromises();
}

const row = (email: string) => wrapper.get(`[data-member="${email}"]`);

beforeEach(() => {
  vi.clearAllMocks();
  dialogHost = mountDialogHost();
  server.listMembers.mockResolvedValue([OWNER, GUEST]);
});
afterEach(() => {
  wrapper.unmount();
  dialogHost.unmount();
});

describe("SharePanel", () => {
  it("lists everyone who can open the spreadsheet, with what each can do", async () => {
    await render();
    expect(server.listMembers).toHaveBeenCalledExactlyOnceWith("s1");
    expect(row("ada@example.com").text()).toContain("Ada");
    expect(row("ada@example.com").get(".share__role").text()).toBe("Owner");
    expect(row("ada@example.com").find("button").exists()).toBe(false);
    expect(row("bo@example.com").get<HTMLSelectElement>("select").element.value).toBe("editor");
  });

  it("shares with an email as the chosen role, and clears the box", async () => {
    await render();
    const added = {
      ...GUEST,
      userId: "u3",
      name: "Cy",
      email: "cy@example.com",
      role: "viewer" as const,
    };
    server.share.mockResolvedValue([OWNER, GUEST, added]);
    await wrapper.get('input[type="email"]').setValue(" cy@example.com ");
    await wrapper.get('[aria-label="What they can do"]').setValue("viewer");
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(server.share).toHaveBeenCalledExactlyOnceWith("s1", "cy@example.com", "viewer");
    expect(row("cy@example.com").text()).toContain("Cy");
    expect(wrapper.get<HTMLInputElement>('input[type="email"]').element.value).toBe("");
  });

  it("shows why sharing failed, and keeps what was typed", async () => {
    await render();
    server.share.mockRejectedValue(new Error("No account uses zed@example.com"));
    await wrapper.get('input[type="email"]').setValue("zed@example.com");
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toBe("No account uses zed@example.com");
    expect(wrapper.get<HTMLInputElement>('input[type="email"]').element.value).toBe(
      "zed@example.com",
    );
  });

  it("changes what a guest can do", async () => {
    await render();
    server.share.mockResolvedValue([OWNER, { ...GUEST, role: "viewer" }]);
    await row("bo@example.com").get("select").setValue("viewer");
    await flushPromises();
    expect(server.share).toHaveBeenCalledExactlyOnceWith("s1", "bo@example.com", "viewer");
    expect(row("bo@example.com").get<HTMLSelectElement>("select").element.value).toBe("viewer");
  });

  it("stops sharing with a guest after confirming", async () => {
    await render();
    await row("bo@example.com").get("button").trigger("click");
    expect(appDialog()?.textContent).toContain("Stop sharing with Bo?");
    await respondToDialog("cancel");
    expect(server.unshare).not.toHaveBeenCalled();

    server.listMembers.mockResolvedValue([OWNER]);
    await row("bo@example.com").get("button").trigger("click");
    await respondToDialog("confirm");
    await flushPromises();
    expect(server.unshare).toHaveBeenCalledExactlyOnceWith("s1", "u2");
    expect(wrapper.find('[data-member="bo@example.com"]').exists()).toBe(false);
  });

  it("gives a guest the list, no way to share, and a way to leave", async () => {
    await render({ owner: false, userId: "u2" });
    expect(wrapper.find("form").exists()).toBe(false);
    expect(wrapper.text()).toContain("Only the owner can share this document.");
    expect(row("bo@example.com").find("select").exists()).toBe(false);
    expect(row("bo@example.com").get(".share__role").text()).toBe("Can edit");

    await row("bo@example.com").get("button").trigger("click");
    await respondToDialog("confirm");
    await flushPromises();
    expect(server.unshare).toHaveBeenCalledExactlyOnceWith("s1", "u2");
    expect(wrapper.emitted("left")).toHaveLength(1);
  });

  it("gives a guest no way to remove another guest", async () => {
    server.listMembers.mockResolvedValue([
      OWNER,
      GUEST,
      { ...GUEST, userId: "u3", email: "cy@example.com" },
    ]);
    await render({ owner: false, userId: "u2" });
    expect(row("cy@example.com").find("button").exists()).toBe(false);
  });

  it("closes on its button and on Escape", async () => {
    await render();
    await wrapper.get('[aria-label="Close sharing"]').trigger("click");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(wrapper.emitted("close")).toHaveLength(2);
  });
});
