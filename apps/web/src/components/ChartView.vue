<script setup lang="ts">
import {
  chartData,
  dateFromMs,
  Failure,
  formatValue,
  type CellValue,
  type ChartType,
} from "@spreadsheet-app/engine";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { init, use, type EChartsType, type EChartsCoreOption } from "echarts/core";
import { BarChart, LineChart, PieChart, ScatterChart } from "echarts/charts";
import { GridComponent, TooltipComponent } from "echarts/components";
import { SVGRenderer } from "echarts/renderers";

use([BarChart, LineChart, PieChart, ScatterChart, GridComponent, TooltipComponent, SVGRenderer]);

const props = defineProps<{
  chart: ChartType;
  rows: readonly (readonly CellValue[])[];
  title: string;
}>();

const COLORS = [
  "#2f5bea",
  "#e8833a",
  "#2a9d6f",
  "#c0362c",
  "#8e5bd0",
  "#d4a72c",
  "#3aa6c9",
  "#7a8494",
];
const color = (index: number): string => COLORS[index % COLORS.length] ?? "#000";
const data = computed(() => chartData(props.rows));
const slices = computed(() =>
  (data.value.series[0]?.values ?? []).flatMap((value, index) =>
    value !== null && value > 0 ? [{ value, index, label: data.value.labels[index] ?? "" }] : [],
  ),
);
const total = computed(() => slices.value.reduce((sum, slice) => sum + slice.value, 0));
const percent = (value: number): string => String(Math.round((value / total.value) * 100)) + "%";
const entries = computed(() => {
  if (props.chart === "pie")
    return slices.value.map((slice) => ({
      series: data.value.series[0]?.name ?? "",
      text: slice.label + ": " + formatValue(slice.value) + " (" + percent(slice.value) + ")",
    }));
  return data.value.series.flatMap((series) =>
    series.values.flatMap((value, index) =>
      value === null || (props.chart === "scatter" && data.value.x[index] === null)
        ? []
        : [
            {
              series: series.name,
              text: (data.value.labels[index] ?? "") + ": " + formatValue(value),
            },
          ],
    ),
  );
});
const empty = computed(() => {
  if (props.chart === "pie") return slices.value.length ? null : "No numbers to chart yet.";
  if (!data.value.series.some((series) => series.values.some((value) => value !== null)))
    return "No numbers to chart yet.";
  return entries.value.length
    ? null
    : "A scatter chart needs numbers or dates in its first column.";
});
const legend = computed(() =>
  props.chart === "pie"
    ? slices.value.map((slice) => ({
        fill: color(slice.index),
        text: slice.label + " " + percent(slice.value),
      }))
    : data.value.series.length < 2
      ? []
      : data.value.series.map((series, index) => ({ fill: color(index), text: series.name })),
);
const description = computed(() => props.title || props.chart + " chart");

function dateTickLabel(tick: number): string {
  try {
    return formatValue(dateFromMs(Math.round(tick) * 86_400_000));
  } catch (cause) {
    if (cause instanceof Failure) return "";
    throw cause;
  }
}

const option = computed((): EChartsCoreOption => {
  const common = {
    animation: false,
    color: COLORS,
    textStyle: { fontSize: 12 },
    tooltip: { trigger: "item", renderMode: "richText" },
  };
  if (props.chart === "pie")
    return {
      ...common,
      series: [
        {
          type: "pie",
          radius: "85%",
          label: { show: false },
          data: slices.value.map((slice) => ({
            name: slice.label,
            value: slice.value,
            itemStyle: { color: color(slice.index) },
          })),
        },
      ],
    };
  return {
    ...common,
    grid: { left: 12, right: 16, top: 16, bottom: 12, containLabel: true },
    xAxis:
      props.chart === "scatter"
        ? {
            type: "value",
            scale: true,
            axisLabel: {
              fontSize: 12,
              hideOverlap: true,
              formatter: data.value.xIsDate ? dateTickLabel : (value: number) => formatValue(value),
            },
          }
        : {
            type: "category",
            data: data.value.labels,
            boundaryGap: props.chart === "bar",
            axisLabel: { fontSize: 12, hideOverlap: true, width: 90, overflow: "truncate" },
          },
    yAxis: {
      type: "value",
      scale: props.chart !== "bar",
      axisLabel: { fontSize: 12, formatter: (value: number) => formatValue(value) },
    },
    series: data.value.series.map((series, index) => ({
      name: series.name,
      type: props.chart,
      itemStyle: { color: color(index) },
      lineStyle: { color: color(index) },
      connectNulls: false,
      symbolSize: props.chart === "line" ? 6 : 9,
      data:
        props.chart === "scatter"
          ? series.values.flatMap((value, index) => {
              const x = data.value.x[index];
              return value === null || x === null || x === undefined
                ? []
                : [{ name: data.value.labels[index], value: [x, value] }];
            })
          : series.values,
    })),
  };
});

const host = ref<HTMLDivElement>();
let instance: EChartsType | undefined;
let observer: ResizeObserver | undefined;
function draw(): void {
  if (!host.value || empty.value !== null) {
    instance?.dispose();
    instance = undefined;
    return;
  }
  instance ??= init(host.value, undefined, { renderer: "svg" });
  // Replacing options prevents old axes and series surviving a chart type change.
  instance.setOption(option.value, { notMerge: true });
}
onMounted(() => {
  draw();
  observer = new ResizeObserver(() => instance?.resize());
  if (host.value) observer.observe(host.value);
});
watch([option, empty], draw, { flush: "post" });
onBeforeUnmount(() => {
  observer?.disconnect();
  instance?.dispose();
  instance = undefined;
});
</script>

<template>
  <figure class="chart" :data-chart="chart">
    <figcaption v-if="title !== ''" class="chart__title">{{ title }}</figcaption>
    <p v-if="empty !== null" class="chart__empty">{{ empty }}</p>
    <div
      v-show="empty === null"
      ref="host"
      class="chart__canvas"
      role="img"
      :aria-label="description"
    ></div>
    <ul
      v-if="empty === null"
      class="chart__summary"
      :aria-label="'Values plotted in ' + description"
    >
      <li
        v-for="(entry, index) in entries"
        :key="index"
        data-chart-value
        :data-series="entry.series"
        :aria-label="entry.series + ': ' + entry.text"
      >
        {{ entry.text }}
      </li>
    </ul>
    <ul v-if="empty === null && legend.length > 0" class="chart__legend">
      <li v-for="(entry, index) in legend" :key="index">
        <span class="chart__swatch" :style="{ background: entry.fill }"></span>{{ entry.text }}
      </li>
    </ul>
  </figure>
</template>
