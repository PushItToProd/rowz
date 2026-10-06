import { defaultFunctions, errorDocs } from "@spreadsheet-app/engine";
import { mount, RouterLinkStub, type VueWrapper } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { APP_NAME } from "../appName";
import HelpView from "./HelpView.vue";

function render(): VueWrapper {
  return mount(HelpView, { global: { stubs: { RouterLink: RouterLinkStub } } });
}

/** Lays the sections out 500 pixels apart, with the window scrolled down by `scrolled`. */
function scrollTo(wrapper: VueWrapper, scrolled: number): Promise<void> {
  wrapper.findAll("section").forEach((section, index) => {
    vi.spyOn(section.element, "getBoundingClientRect").mockReturnValue({
      top: index * 500 - scrolled,
    } as DOMRect);
  });
  window.dispatchEvent(new Event("scroll"));
  return wrapper.vm.$nextTick();
}

function reading(wrapper: VueWrapper): string[] {
  return wrapper.findAll('.help__contents [aria-current="true"]').map((link) => link.text());
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("HelpView", () => {
  it("lists every function the engine has, each with its syntax", () => {
    const wrapper = render();
    const listed = wrapper.findAll("[data-function]").map((row) => row.attributes("data-function"));
    expect(listed.sort()).toEqual([...defaultFunctions.keys()].sort());
    expect(wrapper.get('[data-function="ROUND"]').text()).toContain("ROUND(number, [digits])");
  });

  it("titles the browser tab", () => {
    render();
    expect(document.title).toBe(`Help | ${APP_NAME}`);
  });

  it("shows the result the engine computes for an example", () => {
    const wrapper = render();
    expect(wrapper.get('[data-function="SUM"]').text()).toContain("=SUM(A1:A3, 10)gives 16");
    expect(wrapper.get('[data-function="IFERROR"]').text()).toContain("gives no result");
    expect(wrapper.get('[data-function="BUTTON"]').text()).toContain(
      "gives a button labeled “Reset”",
    );
    expect(wrapper.text()).toContain("A1 holds 1, A2 holds 2, A3 holds 3");
    expect(wrapper.get('[data-function="CHECKBOX"]').text()).toContain(
      "gives a checkbox labeled “Done”",
    );
    expect(wrapper.get('[data-function="DROPDOWN"]').text()).toContain(
      "gives a list offering apple, banana, cherry",
    );
    expect(wrapper.get('[data-function="TEXTBOX"]').text()).toContain("gives a text input");
    expect(wrapper.get('[data-function="NUMBERBOX"]').text()).toContain("gives a number input");
    expect(wrapper.get('[data-function="FILTER"]').text()).toContain(
      "gives banana, cherry down a column",
    );
    expect(wrapper.get('[data-function="TRANSPOSE"]').text()).toContain(
      "gives 1, 2, 3 across a row",
    );
    expect(wrapper.get('[data-function="SEQUENCE"]').text()).toContain(
      "gives 2 rows: 10, 10.5, 11 / 11.5, 12, 12.5",
    );
  });

  it("shows parameter names in a summary as code", () => {
    const codes = render()
      .get('[data-function="IF"]')
      .findAll("td")[1]!
      .findAll("code")
      .map((code) => code.text());
    expect(codes).toEqual(["then", "else"]);
  });

  it("says a chart example gives a chart, and documents the tags of a text view", () => {
    const wrapper = render();
    expect(wrapper.get('[data-function="BAR_CHART"]').text()).toContain(
      "a bar chart titled “Fruit”",
    );
    expect(wrapper.get("#text-views").text()).toContain("{% for name, amount in Sales!A2:B9 %}");
    expect(wrapper.get("#text-views pre").text()).toContain("{{ total }}");
    expect(wrapper.get("#text-views").text()).toContain(
      "A formula that gives BUTTON shows a clickable button",
    );
    expect(wrapper.get("#text-views").text()).toContain("TEXTBOX or NUMBERBOX");
    expect(wrapper.get("#controls").text()).toContain("Enter or by leaving the input");
  });

  it("explains every error code", () => {
    const wrapper = render();
    for (const [code, explanation] of Object.entries(errorDocs)) {
      expect(wrapper.get(`[data-error="${code}"]`).text()).toBe(code + explanation);
    }
  });

  it("links each contents entry to a section on the page", () => {
    const wrapper = render();
    const targets = wrapper.findAll(".help__contents a").map((link) => link.attributes("href"));
    expect(targets).toHaveLength(20);
    for (const target of targets)
      expect(wrapper.find(`section${target ?? ""}`).exists()).toBe(true);
  });

  it("marks the section being read in the contents, and follows the scrolling", async () => {
    const wrapper = mount(HelpView, {
      global: { stubs: { RouterLink: RouterLinkStub } },
      attachTo: document.body,
    });
    expect(reading(wrapper)).toEqual(["Typing into cells"]);

    await scrollTo(wrapper, 1000);
    expect(reading(wrapper)).toEqual(["Pages and tables"]);
    // A section counts once its heading nears the top of the window.
    await scrollTo(wrapper, 1400);
    expect(reading(wrapper)).toEqual(["Tables with named columns"]);
    await scrollTo(wrapper, 0);
    expect(reading(wrapper)).toEqual(["Typing into cells"]);

    // The end of the page is the last section, which is too short to reach the top.
    vi.spyOn(document.documentElement, "scrollHeight", "get").mockReturnValue(9000);
    vi.spyOn(window, "scrollY", "get").mockReturnValue(9000 - window.innerHeight);
    await scrollTo(wrapper, 8000);
    expect(reading(wrapper)).toEqual(["Errors"]);
    wrapper.unmount();
  });
});
