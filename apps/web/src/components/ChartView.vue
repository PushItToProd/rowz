<script setup lang="ts">
import {
  chartData,
  DAY_MS,
  dateFromMs,
  dateParts,
  Failure,
  formatDate,
  formatValue,
  type CellValue,
  type ChartType,
} from "@spreadsheet-app/engine";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { init, use, type EChartsType, type EChartsCoreOption } from "echarts/core";
import type { TooltipComponentFormatterCallbackParams } from "echarts";
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
const timeAxis = computed(() => props.chart !== "pie" && data.value.xIsDate);
const axisKind = computed(() =>
  props.chart === "pie"
    ? "none"
    : timeAxis.value
      ? "time"
      : props.chart === "scatter"
        ? "value"
        : "category",
);
const timePrecision = computed(() => {
  let includeTime = false;
  let includeSeconds = false;
  if (timeAxis.value) {
    for (const serial of data.value.x) {
      if (serial === null) continue;
      const parts = dateParts(dateFromMs(Math.round(serial * DAY_MS)));
      includeTime ||= !Number.isInteger(serial);
      includeSeconds ||= parts.second !== 0;
    }
  }
  return { includeTime, includeSeconds };
});

function isoDateLabel(timestamp: number): string {
  try {
    const date = dateFromMs(timestamp);
    const label = formatDate(date).slice(0, 10);
    if (!timePrecision.value.includeTime) return label;
    const parts = dateParts(date);
    const pad = (value: number): string => String(value).padStart(2, "0");
    const time = `${pad(parts.hour)}:${pad(parts.minute)}${timePrecision.value.includeSeconds ? `:${pad(parts.second)}` : ""}`;
    return `${label}T${time}`;
  } catch (cause) {
    if (cause instanceof Failure) return "";
    throw cause;
  }
}

function dateTooltip(params: TooltipComponentFormatterCallbackParams): string {
  const item = Array.isArray(params) ? params[0] : params;
  if (!item || !Array.isArray(item.value) || typeof item.value[0] !== "number") return "";
  const label = isoDateLabel(item.value[0]);
  const value = item.value[1];
  const series = item.seriesName ?? "";
  return `${series}\n${label}${typeof value === "number" ? `: ${formatValue(value)}` : ""}`;
}

function timedSeriesData(
  values: readonly (number | null)[],
): { name: string; value: [number, number | null] }[] {
  const points = values.flatMap((value, index) => {
    const serial = data.value.x[index];
    if (serial === null || serial === undefined || (props.chart === "scatter" && value === null))
      return [];
    const timestamp = Math.round(serial * DAY_MS);
    return [
      {
        index,
        timestamp,
        point: {
          name: isoDateLabel(timestamp),
          value: [timestamp, value] as [number, number | null],
        },
      },
    ];
  });
  if (props.chart === "line") {
    points.sort((left, right) => left.timestamp - right.timestamp || left.index - right.index);
  }
  return points.map(({ point }) => point);
}

const option = computed((): EChartsCoreOption => {
  const common = {
    animation: false,
    color: COLORS,
    textStyle: { fontSize: 12 },
    useUTC: true,
    tooltip: {
      trigger: "item",
      renderMode: "richText",
      ...(timeAxis.value ? { formatter: dateTooltip } : {}),
    },
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
    xAxis: timeAxis.value
      ? {
          type: "time",
          scale: true,
          axisLabel: {
            fontSize: 12,
            hideOverlap: true,
            formatter: isoDateLabel,
          },
        }
      : props.chart === "scatter"
        ? {
            type: "value",
            scale: true,
            axisLabel: {
              fontSize: 12,
              hideOverlap: true,
              formatter: (value: number) => formatValue(value),
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
      ...(timeAxis.value && props.chart === "bar" ? { barMaxWidth: 24, barMinWidth: 1 } : {}),
      data: timeAxis.value
        ? timedSeriesData(series.values)
        : props.chart === "scatter"
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
      :data-axis-kind="axisKind"
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
