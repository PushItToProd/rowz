import type { ChartType } from "../values";
import { eager, grid, text } from "./arguments";
import type { FunctionDefinition } from "./registry";

/** Defines a function that describes a chart of some data. Drawing it is up to whatever shows the value. */
function chart(type: ChartType): FunctionDefinition {
  return eager(1, 2, (data, title = "") => ({
    kind: "chart",
    chart: type,
    rows: grid(data),
    title: text(title),
  }));
}

export const chartFunctions: Record<string, FunctionDefinition> = {
  PIE_CHART: chart("pie"),
  BAR_CHART: chart("bar"),
  LINE_CHART: chart("line"),
  SCATTER_CHART: chart("scatter"),
};
