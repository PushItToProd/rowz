import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import type { CellValue, ChartType } from "@spreadsheet-app/engine";
import ChartView from "./ChartView.vue";

const ROWS: CellValue[][] = [
  ["Month", "North", "South"],
  ["Jan", 10, 4],
  ["Feb", 20, 8],
  ["Mar", 15, null],
];

function render(chart: ChartType, rows: CellValue[][] = ROWS, title = "") {
  return mount(ChartView, { props: { chart, rows, title } });
}

describe("ChartView", () => {
  it("draws a bar for every number, and names the series in a legend", () => {
    const wrapper = render("bar");
    expect(wrapper.findAll(".chart__bar")).toHaveLength(5);
    expect(wrapper.get(".chart__legend").text()).toContain("North");
    expect(wrapper.get(".chart__legend").text()).toContain("South");
    expect(wrapper.get("svg").text()).toContain("Jan");
    expect(wrapper.get(".chart__bar title").text()).toBe("Jan: 10");
  });

  it("draws a line for each series and a point for each number", () => {
    const wrapper = render("line");
    expect(wrapper.findAll(".chart__line")).toHaveLength(2);
    expect(wrapper.findAll(".chart__point")).toHaveLength(5);
  });

  it("draws a slice for each row of the first series, with its share in the legend", () => {
    const wrapper = render("pie", [
      ["apples", 1],
      ["pears", 3],
    ]);
    expect(wrapper.findAll(".chart__slice")).toHaveLength(2);
    expect(wrapper.get(".chart__legend").text()).toContain("apples 25%");
    expect(wrapper.get(".chart__legend").text()).toContain("pears 75%");
  });

  it("places scatter points by the numbers in the first column, skipping rows without one", () => {
    const wrapper = render("scatter", [
      [1, 5],
      ["not a number", 6],
      [3, 7],
    ]);
    expect(wrapper.findAll(".chart__point")).toHaveLength(2);
    expect(wrapper.findAll(".chart__line")).toHaveLength(0);
  });

  it("says what a scatter chart needs when its first column holds no numbers", () => {
    const wrapper = render("scatter");
    expect(wrapper.find("svg").exists()).toBe(false);
    expect(wrapper.text()).toBe("A scatter chart needs numbers or dates in its first column.");
  });

  it("has no legend for a single series", () => {
    const wrapper = render("bar", [
      ["a", 1],
      ["b", 2],
    ]);
    expect(wrapper.find(".chart__legend").exists()).toBe(false);
  });

  it("says so when there is nothing to draw", () => {
    const wrapper = render("bar", [["only", "text"]]);
    expect(wrapper.find("svg").exists()).toBe(false);
    expect(wrapper.text()).toBe("No numbers to chart yet.");
  });

  it("shows its title and uses it to describe the drawing", () => {
    const wrapper = render("line", ROWS, "Sales");
    expect(wrapper.get("figcaption").text()).toBe("Sales");
    expect(wrapper.get("svg").attributes("aria-label")).toBe("Sales");
    expect(render("line").get("svg").attributes("aria-label")).toBe("line chart");
  });
});
