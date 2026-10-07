import { mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dateFromParts, type CellValue, type ChartType } from "@spreadsheet-app/engine";
import { init } from "echarts/core";
import ChartView from "./ChartView.vue";

const ROWS: CellValue[][] = [
  ["Month", "North", "South"],
  ["Jan", 10, 4],
  ["Feb", 20, 8],
  ["Mar", 15, null],
];
let wrappers: VueWrapper[] = [];
let resized: ResizeObserverCallback;
const observe = vi.fn();
const disconnect = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: ResizeObserverCallback) {
        resized = callback;
      }
      observe = observe;
      disconnect = disconnect;
    },
  );
});
afterEach(() => {
  wrappers.forEach((wrapper) => {
    wrapper.unmount();
  });
  wrappers = [];
});

function render(chart: ChartType, rows: CellValue[][] = ROWS, title = "") {
  const wrapper = mount(ChartView, { props: { chart, rows, title } });
  wrappers.push(wrapper);
  return wrapper;
}
function instance() {
  return vi.mocked(init).mock.results.at(-1)!.value as {
    setOption: ReturnType<typeof vi.fn>;
    resize: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
  };
}
function option() {
  return instance().setOption.mock.calls.at(-1)![0] as {
    series: {
      type: string;
      name?: string;
      data: unknown[];
      connectNulls?: boolean;
      barMaxWidth?: number;
      barMinWidth?: number;
    }[];
    color: string[];
    useUTC?: boolean;
    grid?: { containLabel: boolean };
    tooltip?: { formatter?: (params: unknown) => string };
    xAxis?: {
      type: string;
      data?: string[];
      axisLabel: { fontSize: number; formatter: (value: number) => string };
    };
    yAxis?: { scale: boolean };
  };
}

describe("ChartView", () => {
  it.each(["bar", "line"] as const)("passes %s series and missing values to ECharts", (chart) => {
    const wrapper = render(chart);
    expect(init).toHaveBeenCalledWith(wrapper.get(".chart__canvas").element, undefined, {
      renderer: "svg",
    });
    expect(option().series).toMatchObject([
      { type: chart, name: "North", data: [10, 20, 15], connectNulls: false },
      { type: chart, name: "South", data: [4, 8, null], connectNulls: false },
    ]);
    expect(option().xAxis).toMatchObject({
      type: "category",
      data: ["Jan", "Feb", "Mar"],
      axisLabel: { fontSize: 12 },
    });
    expect(option().grid?.containLabel).toBe(true);
    expect(option().yAxis?.scale).toBe(chart !== "bar");
    expect(option().color.slice(0, 2)).toEqual(["#2f5bea", "#e8833a"]);
    expect(wrapper.findAll("[data-chart-value]")).toHaveLength(5);
    expect(wrapper.get(".chart__legend").text()).toContain("North");
    expect(wrapper.get(".chart__legend").text()).toContain("South");
  });
  it("draws only positive values of the first pie series and preserves row colors and percentages", () => {
    const wrapper = render("pie", [
      ["apples", 1, 9],
      ["zero", 0, 9],
      ["negative", -2, 9],
      ["pears", 3, 9],
    ]);
    expect(option().series[0]).toMatchObject({
      type: "pie",
      data: [
        { name: "apples", value: 1, itemStyle: { color: "#2f5bea" } },
        { name: "pears", value: 3, itemStyle: { color: "#c0362c" } },
      ],
    });
    expect(wrapper.get(".chart__legend").text()).toContain("apples 25%");
    expect(wrapper.get(".chart__legend").text()).toContain("pears 75%");
    expect(wrapper.findAll("[data-chart-value]")).toHaveLength(2);
  });
  it("places scatter points by numeric coordinates and skips missing coordinates", () => {
    render("scatter", [
      [1, 5],
      ["not a number", 6],
      [3, 7],
      [4, null],
    ]);
    expect(option().series[0]?.data).toEqual([
      { name: "1", value: [1, 5] },
      { name: "3", value: [3, 7] },
    ]);
    expect(option().xAxis?.type).toBe("value");
  });
  it.each(["bar", "line", "scatter"] as const)(
    "uses UTC timestamps and a time axis for %s charts with date X values",
    (chart) => {
      const wrapper = render(chart, [
        [dateFromParts(2020, 3, 1), 30],
        [dateFromParts(2018, 8, 22), 10],
        [dateFromParts(2019, 3, 4), 20],
        [dateFromParts(2019, 3, 4), 21],
      ]);
      const plotted = option();
      expect(wrapper.get(".chart__canvas").attributes("data-axis-kind")).toBe("time");
      expect(plotted.useUTC).toBe(true);
      expect(plotted.xAxis).toMatchObject({ type: "time", scale: true });
      expect(plotted.xAxis?.data).toBeUndefined();
      const point = (year: number, month: number, day: number, value: number) => ({
        name: `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
        value: [dateFromParts(year, month, day).ms, value],
      });
      expect(plotted.series[0]?.data).toEqual(
        chart === "line"
          ? [
              point(2018, 8, 22, 10),
              point(2019, 3, 4, 20),
              point(2019, 3, 4, 21),
              point(2020, 3, 1, 30),
            ]
          : [
              point(2020, 3, 1, 30),
              point(2018, 8, 22, 10),
              point(2019, 3, 4, 20),
              point(2019, 3, 4, 21),
            ],
      );
      if (chart === "bar") {
        expect(plotted.series[0]).toMatchObject({ barMaxWidth: 24, barMinWidth: 1 });
        expect(plotted.series[0]).not.toHaveProperty("barWidth");
      }
      expect(
        plotted.tooltip?.formatter?.({
          seriesName: "Sales",
          value: [dateFromParts(2018, 8, 22).ms, 10],
        }),
      ).toBe("Sales\n2018-08-22: 10");
    },
  );
  it.each([
    [dateFromParts(2026, 1, 1, 8, 30), "2026-01-01T08:30", "2026-01-02T08:45"],
    [dateFromParts(2026, 1, 1, 8, 30, 15), "2026-01-01T08:30:15", "2026-01-02T08:45:00"],
  ])("shows the time of day in date-axis labels and tooltips", (date, expected, secondLabel) => {
    render("line", [
      [date, 5],
      [dateFromParts(2026, 1, 2, 8, 45), 6],
    ]);
    const plotted = option();
    const point = plotted.series[0]!.data[0] as { value: number[] };
    const secondPoint = plotted.series[0]!.data[1] as { value: number[] };
    expect(plotted.xAxis?.axisLabel.formatter(point.value[0]!)).toBe(expected);
    expect(plotted.xAxis?.axisLabel.formatter(secondPoint.value[0]!)).toBe(secondLabel);
    expect(plotted.tooltip?.formatter?.({ seriesName: "Sales", value: [date.ms, 5] })).toBe(
      `Sales\n${expected}: 5`,
    );
    expect(
      plotted.tooltip?.formatter?.({ seriesName: "Sales", value: [secondPoint.value[0], 6] }),
    ).toBe(`Sales\n${secondLabel}: 6`);
  });
  it.each(["bar", "line"] as const)(
    "keeps non-date and mixed X values categorical for %s",
    (chart) => {
      for (const rows of [
        [
          ["Jan", 10],
          ["Feb", 20],
        ],
        [
          [dateFromParts(2026, 1, 1), 10],
          ["later", 20],
        ],
      ] as CellValue[][][]) {
        const wrapper = render(chart, rows);
        expect(option().xAxis).toMatchObject({ type: "category" });
        expect(wrapper.get(".chart__canvas").attributes("data-axis-kind")).toBe("category");
        wrapper.unmount();
        wrappers = wrappers.filter((item) => item !== wrapper);
      }
    },
  );
  it("ignores blank date coordinates while preserving the accessible data summary", () => {
    const wrapper = render("line", [
      [dateFromParts(2026, 1, 1), 5],
      [null, 8],
      ["", 9],
      [dateFromParts(2026, 1, 3), 10],
    ]);
    expect(wrapper.get(".chart__canvas").attributes("data-axis-kind")).toBe("time");
    expect(option().series[0]?.data).toEqual([
      { name: "2026-01-01", value: [dateFromParts(2026, 1, 1).ms, 5] },
      { name: "2026-01-03", value: [dateFromParts(2026, 1, 3).ms, 10] },
    ]);
    expect(wrapper.findAll("[data-chart-value]").map((entry) => entry.text())).toEqual([
      "2026-01-01: 5",
      ": 8",
      ": 9",
      "2026-01-03: 10",
    ]);
  });
  it.each([0, 9999])(
    "formats time-axis ticks at year %s and suppresses out-of-range dates",
    (year) => {
      render("scatter", [
        [dateFromParts(year, 1, 1), 1],
        [dateFromParts(year, 1, 2), 2],
      ]);
      const point = option().series[0]!.data[0] as { value: number[] };
      const formatter = option().xAxis!.axisLabel.formatter;
      expect(option().xAxis?.type).toBe("time");
      expect(formatter(point.value[0]!)).toBe(String(year).padStart(4, "0") + "-01-01");
      expect(
        formatter(year === 0 ? point.value[0]! - 86_400_000 : point.value[0]! + 366 * 86_400_000),
      ).toBe("");
    },
  );
  it.each([
    ["bar", [["only", "text"]], "No numbers to chart yet."],
    [
      "pie",
      [
        ["zero", 0],
        ["negative", -1],
      ],
      "No numbers to chart yet.",
    ],
    ["scatter", ROWS, "A scatter chart needs numbers or dates in its first column."],
  ] as const)("keeps the %s empty-data message", (chart, rows, message) => {
    const wrapper = render(
      chart,
      rows.map((row) => [...row]),
    );
    expect(wrapper.get(".chart__empty").text()).toBe(message);
    expect(init).not.toHaveBeenCalled();
  });
  it("has no legend for a single series and describes its drawing and data", () => {
    const wrapper = render(
      "bar",
      [
        ["a", 1],
        ["b", 2],
      ],
      "Sales",
    );
    expect(wrapper.find(".chart__legend").exists()).toBe(false);
    expect(wrapper.get("figcaption").text()).toBe("Sales");
    expect(wrapper.get('[role="img"]').attributes("aria-label")).toBe("Sales");
    expect(wrapper.get(".chart__summary").attributes("aria-label")).toBe("Values plotted in Sales");
    expect(wrapper.findAll("[data-chart-value]").map((entry) => entry.text())).toEqual([
      "a: 1",
      "b: 2",
    ]);
  });
  it("replaces options on data and type changes, resizes, and releases resources", async () => {
    const wrapper = render("bar");
    const chart = instance();
    expect(observe).toHaveBeenCalledWith(wrapper.get(".chart__canvas").element);
    await wrapper.setProps({ rows: [["a", 9]] });
    expect(option().series[0]?.data).toEqual([9]);
    await wrapper.setProps({ chart: "pie" });
    expect(option().series[0]?.type).toBe("pie");
    expect(chart.setOption.mock.calls.at(-1)![1]).toEqual({ notMerge: true });
    expect(init).toHaveBeenCalledTimes(1);
    resized([], {} as ResizeObserver);
    expect(chart.resize).toHaveBeenCalledOnce();
    wrapper.unmount();
    wrappers = [];
    expect(chart.dispose).toHaveBeenCalledOnce();
    expect(disconnect).toHaveBeenCalledOnce();
  });
  it("disposes on invalid data and recreates when valid data returns", async () => {
    const wrapper = render("bar");
    const chart = instance();
    await wrapper.setProps({ rows: [] });
    expect(chart.dispose).toHaveBeenCalledOnce();
    await wrapper.setProps({ rows: ROWS });
    expect(init).toHaveBeenCalledTimes(2);
    expect(wrapper.get(".chart__canvas").isVisible()).toBe(true);
    resized([], {} as ResizeObserver);
    expect(instance().resize).toHaveBeenCalledOnce();
  });
});
