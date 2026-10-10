import { defaultFunctions, errorDocs } from "@spreadsheet-app/engine";
import { mount, RouterLinkStub, type VueWrapper } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { APP_NAME } from "../appName";
import HelpView from "./HelpView.vue";
import { HELP_PAGES } from "./help/pages";

function render(topic = "functions"): VueWrapper {
  return mount(HelpView, { props: { topic }, global: { stubs: { RouterLink: RouterLinkStub } } });
}

describe("HelpView", () => {
  it("lists every function the engine has, each with its syntax", () => {
    const wrapper = render();
    const listed = wrapper.findAll("[data-function]").map((row) => row.attributes("data-function"));
    expect(listed.sort()).toEqual([...defaultFunctions.keys()].sort());
    expect(wrapper.get('[data-function="ROUND"]').text()).toContain("ROUND(number, [digits])");
  });

  it("titles the browser tab", () => {
    render();
    expect(document.title).toBe(`Function reference · Help | ${APP_NAME}`);
  });

  it("shows the result the engine computes for an example", () => {
    const wrapper = render();
    expect(wrapper.get('[data-function="SUM"]').text()).toContain("=SUM(A1:A3, 10)gives 16");
    expect(wrapper.get('[data-function="IFERROR"]').text()).toContain("gives no result");
    expect(wrapper.get('[data-function="BUTTON"]').text()).toContain(
      "gives a button labeled “Reset”",
    );
    expect(wrapper.text()).toContain("A1 = 1, A2 = 2, A3 = 3");
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
    expect(render("presentation").get("#text-views").text()).toContain(
      "{% for name, amount in Sales!A2:B9 %}",
    );
    expect(render("presentation").get("#text-views pre").text()).toContain("{{ total }}");
    expect(render("presentation").get("#text-views").text()).toContain(
      "A formula that gives BUTTON shows a clickable button",
    );
    expect(render("presentation").get("#text-views").text()).toContain("TEXTBOX or NUMBERBOX");
    expect(render("actions").get("#controls").text()).toContain("Enter or by leaving the input");
  });

  it("explains every error code", () => {
    const wrapper = render("documents");
    for (const [code, explanation] of Object.entries(errorDocs)) {
      expect(wrapper.get(`[data-error="${code}"]`).text()).toBe(code + explanation);
    }
  });

  it("shows only the sections for the selected topic", async () => {
    const wrapper = render("editing");
    for (const page of HELP_PAGES) {
      await wrapper.setProps({ topic: page.id });
      expect(wrapper.findAll("section").map((section) => section.attributes("id"))).toEqual(
        page.sections,
      );
      const current = wrapper.get('.help__contents [aria-current="page"]');
      expect(current.text()).toBe(page.title);
      expect(wrapper.findAll(".help__contents a")).toHaveLength(HELP_PAGES.length);
    }
  });

  it("links to the preceding and following topics", () => {
    expect(render("editing").get(".help__pagination").text()).toBe("Pages and tables →");
    expect(render("tables").get(".help__pagination").text()).toContain("← Editing cells");
    expect(render("documents").get(".help__pagination").text()).toBe("← Formats, charts, and text");
  });
});
