import { defaultFunctions, errorDocs } from "@spreadsheet-app/engine";
import { mount, RouterLinkStub, type VueWrapper } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import HelpView from "./HelpView.vue";

function render(): VueWrapper {
  return mount(HelpView, { global: { stubs: { RouterLink: RouterLinkStub } } });
}

describe("HelpView", () => {
  it("lists every function the engine has, each with its syntax", () => {
    const wrapper = render();
    const listed = wrapper.findAll("[data-function]").map((row) => row.attributes("data-function"));
    expect(listed.sort()).toEqual([...defaultFunctions.keys()].sort());
    expect(wrapper.get('[data-function="ROUND"]').text()).toContain("ROUND(number, [digits])");
  });

  it("shows the result the engine computes for an example", () => {
    const wrapper = render();
    expect(wrapper.get('[data-function="SUM"]').text()).toContain("=SUM(A1:A3, 10)gives 16");
    expect(wrapper.get('[data-function="IFERROR"]').text()).toContain("gives no result");
    expect(wrapper.get('[data-function="BUTTON"]').text()).toContain(
      "gives a button labeled “Add one”",
    );
    expect(wrapper.text()).toContain("A1 holds 1, A2 holds 2, A3 holds 3");
    expect(wrapper.get('[data-function="CHECKBOX"]').text()).toContain(
      "gives a checkbox labeled “Done”",
    );
    expect(wrapper.get('[data-function="DROPDOWN"]').text()).toContain(
      "gives a list offering apple, banana, cherry",
    );
    expect(wrapper.get('[data-function="FILTER"]').text()).toContain(
      "gives banana, cherry down a column",
    );
    expect(wrapper.get('[data-function="TRANSPOSE"]').text()).toContain(
      "gives 1, 2, 3 across a row",
    );
    expect(wrapper.get('[data-function="SEQUENCE"]').text()).toContain(
      "gives 2 rows: 1, 2, 3 / 4, 5, 6",
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
    expect(targets).toHaveLength(15);
    for (const target of targets)
      expect(wrapper.find(`section${target ?? ""}`).exists()).toBe(true);
  });
});
