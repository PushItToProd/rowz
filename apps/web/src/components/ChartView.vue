<script setup lang="ts">
import { chartData, formatValue, type CellValue, type ChartType } from "@spreadsheet-app/engine";
import { computed } from "vue";
import {
  linePaths,
  linear,
  niceScale,
  pieSlices,
  slicePath,
  visibleLabels,
  type Point,
} from "../charts/geometry";

const props = defineProps<{
  chart: ChartType;
  /** The data: a first column of labels, then a column per series. */
  rows: readonly (readonly CellValue[])[];
  title: string;
}>();

// The drawing is laid out in these units and scales to the width it is given.
const WIDTH = 640;
const HEIGHT = 320;
const PLOT = { left: 56, right: WIDTH - 16, top: 12, bottom: HEIGHT - 40 };
const PIE = { x: WIDTH / 2, y: HEIGHT / 2, radius: HEIGHT / 2 - 16 };
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
const MAX_AXIS_LABELS = 10;
const LABEL_LENGTH = 12;
const DAY_MS = 86_400_000;

const data = computed(() => chartData(props.rows));
const color = (index: number): string => COLORS[index % COLORS.length] ?? "#000";
const plotted = computed(() =>
  data.value.series.flatMap((series) => series.values.filter((value) => value !== null)),
);

const yScale = computed(() => niceScale(plotted.value, props.chart === "bar"));
const toY = computed(() => linear([yScale.value.min, yScale.value.max], [PLOT.bottom, PLOT.top]));

/** Scatter charts place points by the number in the first column. The others space labels evenly. */
const xScale = computed(() =>
  niceScale(
    data.value.x.filter((value) => value !== null),
    false,
  ),
);
const band = computed(() => (PLOT.right - PLOT.left) / Math.max(data.value.labels.length, 1));
function toX(index: number): number | null {
  if (props.chart !== "scatter") return PLOT.left + band.value * (index + 0.5);
  const value = data.value.x[index] ?? null;
  return value === null
    ? null
    : linear([xScale.value.min, xScale.value.max], [PLOT.left, PLOT.right])(value);
}

function short(label: string): string {
  return label.length > LABEL_LENGTH ? `${label.slice(0, LABEL_LENGTH - 1)}…` : label;
}

const xLabels = computed(() => {
  if (props.chart === "scatter") {
    const position = linear([xScale.value.min, xScale.value.max], [PLOT.left, PLOT.right]);
    return xScale.value.ticks.map((tick) => ({
      x: position(tick),
      // A scatter over dates counts days along its axis, and labels the ticks as dates.
      text: data.value.xIsDate
        ? formatValue({ kind: "date", ms: Math.round(tick) * DAY_MS })
        : formatValue(tick),
    }));
  }
  const shown = visibleLabels(data.value.labels.length, MAX_AXIS_LABELS);
  return data.value.labels.flatMap((label, index) =>
    shown[index] ? [{ x: PLOT.left + band.value * (index + 0.5), text: short(label) }] : [],
  );
});

const bars = computed(() => {
  const groupWidth = band.value * 0.8;
  const width = groupWidth / data.value.series.length;
  const zero = toY.value(Math.max(yScale.value.min, Math.min(0, yScale.value.max)));
  return data.value.series.flatMap((series, seriesIndex) =>
    series.values.flatMap((value, index) => {
      if (value === null) return [];
      const y = toY.value(value);
      return [
        {
          key: `${String(seriesIndex)}:${String(index)}`,
          x: PLOT.left + band.value * index + band.value * 0.1 + width * seriesIndex,
          y: Math.min(y, zero),
          width,
          height: Math.abs(y - zero),
          fill: color(seriesIndex),
          label: `${data.value.labels[index] ?? ""}: ${formatValue(value)}`,
        },
      ];
    }),
  );
});

/** The points of each series, with a gap where a value or its position is missing. */
const points = computed(() =>
  data.value.series.map((series, seriesIndex) => ({
    fill: color(seriesIndex),
    points: series.values.map((value, index): (Point & { label: string }) | null => {
      const x = toX(index);
      return value === null || x === null
        ? null
        : {
            x,
            y: toY.value(value),
            label: `${data.value.labels[index] ?? ""}: ${formatValue(value)}`,
          };
    }),
  })),
);

const slices = computed(() => {
  const [first] = data.value.series;
  return pieSlices(first?.values ?? []).map((slice) => ({
    ...slice,
    path: slicePath({ x: PIE.x, y: PIE.y }, PIE.radius, slice),
    fill: color(slice.index),
    label: data.value.labels[slice.index] ?? "",
    percent: `${String(Math.round(slice.fraction * 100))}%`,
  }));
});

/** What the swatches under the chart name: slices for a pie, series for the others. */
const legend = computed(() => {
  if (props.chart === "pie") {
    return slices.value.map((slice) => ({
      fill: slice.fill,
      text: `${slice.label} ${slice.percent}`,
    }));
  }
  if (data.value.series.length < 2) return [];
  return data.value.series.map((series, index) => ({ fill: color(index), text: series.name }));
});

/** Why there is nothing to draw, or `null` when there is something. */
const empty = computed(() => {
  const none = "No numbers to chart yet.";
  if (props.chart === "pie") return slices.value.length === 0 ? none : null;
  if (plotted.value.length === 0) return none;
  const placed = points.value.some((series) => series.points.some((point) => point !== null));
  return props.chart === "scatter" && !placed
    ? "A scatter chart needs numbers or dates in its first column."
    : null;
});
const description = computed(() => (props.title === "" ? `${props.chart} chart` : props.title));
</script>

<template>
  <figure class="chart" :data-chart="chart">
    <figcaption v-if="title !== ''" class="chart__title">{{ title }}</figcaption>
    <p v-if="empty !== null" class="chart__empty">{{ empty }}</p>
    <svg v-else :viewBox="`0 0 ${WIDTH} ${HEIGHT}`" role="img" :aria-label="description">
      <template v-if="chart === 'pie'">
        <path
          v-for="slice in slices"
          :key="slice.index"
          class="chart__slice"
          :d="slice.path"
          :fill="slice.fill"
        >
          <title>{{ slice.label }}: {{ formatValue(slice.value) }} ({{ slice.percent }})</title>
        </path>
      </template>

      <template v-else>
        <g class="chart__axis">
          <template v-for="tick in yScale.ticks" :key="tick">
            <line :x1="PLOT.left" :x2="PLOT.right" :y1="toY(tick)" :y2="toY(tick)" />
            <text :x="PLOT.left - 8" :y="toY(tick)" text-anchor="end" dominant-baseline="middle">
              {{ formatValue(tick) }}
            </text>
          </template>
          <text
            v-for="label in xLabels"
            :key="label.x"
            :x="label.x"
            :y="PLOT.bottom + 18"
            text-anchor="middle"
          >
            {{ label.text }}
          </text>
        </g>

        <template v-if="chart === 'bar'">
          <rect
            v-for="bar in bars"
            :key="bar.key"
            class="chart__bar"
            :x="bar.x"
            :y="bar.y"
            :width="bar.width"
            :height="bar.height"
            :fill="bar.fill"
          >
            <title>{{ bar.label }}</title>
          </rect>
        </template>

        <template v-else>
          <g v-for="(series, index) in points" :key="index">
            <template v-if="chart === 'line'">
              <path
                v-for="path in linePaths(series.points)"
                :key="path"
                class="chart__line"
                :d="path"
                :stroke="series.fill"
              />
            </template>
            <template v-for="(point, pointIndex) in series.points" :key="pointIndex">
              <circle
                v-if="point"
                class="chart__point"
                :cx="point.x"
                :cy="point.y"
                :r="chart === 'line' ? 3 : 4.5"
                :fill="series.fill"
              >
                <title>{{ point.label }}</title>
              </circle>
            </template>
          </g>
        </template>
      </template>
    </svg>
    <ul v-if="empty === null && legend.length > 0" class="chart__legend">
      <li v-for="entry in legend" :key="entry.text">
        <span class="chart__swatch" :style="{ background: entry.fill }"></span>{{ entry.text }}
      </li>
    </ul>
  </figure>
</template>
