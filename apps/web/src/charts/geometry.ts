/** Pure geometry for drawing charts as SVG. No DOM, so it is tested on numbers alone. */

export interface Point {
  x: number;
  y: number;
}

export interface Scale {
  min: number;
  max: number;
  /** Round values from `min` to `max`, for gridlines and axis labels. */
  ticks: number[];
}

/**
 * A scale that covers the values with round numbers at its ends and ticks.
 * With `fromZero` it includes zero even when the values are all on one side
 * of it, which bars need because a bar's length is read from zero.
 */
export function niceScale(values: readonly number[], fromZero = true, tickCount = 5): Scale {
  const anchor = fromZero || values.length === 0 ? [0] : [];
  const low = Math.min(...anchor, ...values);
  const high = Math.max(...anchor, ...values);
  if (low === high) return niceScale([low - 1, low + 1], fromZero && low === 0, tickCount);

  // The step is 1, 2, or 5 times a power of ten: whichever gives about `tickCount` ticks.
  const rough = (high - low) / tickCount;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = ([1, 2, 5, 10].find((factor) => factor * magnitude >= rough) ?? 10) * magnitude;
  const first = Math.floor(clean(low / step));
  const last = Math.ceil(clean(high / step));
  // Multiplying by the index avoids the drift that adding the step repeatedly builds up.
  const ticks = Array.from({ length: last - first + 1 }, (_, index) =>
    clean((first + index) * step),
  );
  return { min: ticks[0] ?? 0, max: ticks.at(-1) ?? 1, ticks };
}

/** Removes the noise binary fractions leave, such as 0.30000000000000004. */
function clean(value: number): number {
  return Number(value.toPrecision(12));
}

/** Maps a value from one interval onto another. */
export function linear(
  [fromMin, fromMax]: readonly [number, number],
  [toMin, toMax]: readonly [number, number],
): (value: number) => number {
  const span = fromMax - fromMin;
  return (value) => (span === 0 ? toMin : toMin + ((value - fromMin) / span) * (toMax - toMin));
}

/**
 * SVG path data for a line through points, with a break wherever a point is
 * missing. Each unbroken run is one path.
 */
export function linePaths(points: readonly (Point | null)[]): string[] {
  const paths: string[] = [];
  let run: Point[] = [];
  const end = (): void => {
    if (run.length > 0) {
      paths.push(
        run.map(({ x, y }, index) => `${index === 0 ? "M" : "L"}${fmt(x)},${fmt(y)}`).join(" "),
      );
    }
    run = [];
  };
  for (const point of points) {
    if (point) run.push(point);
    else end();
  }
  end();
  return paths;
}

export interface Slice {
  /** Which value the slice is for. */
  index: number;
  value: number;
  /** The slice's share of the whole, from 0 to 1. */
  fraction: number;
  /** Where the slice starts and ends, as fractions of a full turn clockwise from the top. */
  start: number;
  end: number;
}

/** Divides a pie among the positive values. Others get no slice. */
export function pieSlices(values: readonly (number | null)[]): Slice[] {
  const positive = values.flatMap((value, index) =>
    value !== null && value > 0 ? [{ index, value }] : [],
  );
  const total = positive.reduce((sum, { value }) => sum + value, 0);
  let start = 0;
  return positive.map(({ index, value }) => {
    const fraction = value / total;
    const slice = { index, value, fraction, start, end: start + fraction };
    start = slice.end;
    return slice;
  });
}

const TURN = 2 * Math.PI;

function onCircle(center: Point, radius: number, turn: number): Point {
  // A turn of 0 points up, and turns go clockwise.
  return {
    x: center.x + radius * Math.sin(turn * TURN),
    y: center.y - radius * Math.cos(turn * TURN),
  };
}

/** SVG path data for a pie slice. A slice that is the whole pie is drawn as a circle. */
export function slicePath(center: Point, radius: number, { start, end }: Slice): string {
  if (end - start >= 1) {
    const top = onCircle(center, radius, 0);
    const bottom = onCircle(center, radius, 0.5);
    const arc = `A${fmt(radius)},${fmt(radius)} 0 1 1`;
    return `M${fmt(top.x)},${fmt(top.y)} ${arc} ${fmt(bottom.x)},${fmt(bottom.y)} ${arc} ${fmt(top.x)},${fmt(top.y)} Z`;
  }
  const from = onCircle(center, radius, start);
  const to = onCircle(center, radius, end);
  const large = end - start > 0.5 ? 1 : 0;
  return [
    `M${fmt(center.x)},${fmt(center.y)}`,
    `L${fmt(from.x)},${fmt(from.y)}`,
    `A${fmt(radius)},${fmt(radius)} 0 ${String(large)} 1 ${fmt(to.x)},${fmt(to.y)}`,
    "Z",
  ].join(" ");
}

/** A coordinate rounded for SVG: more digits than this cannot be seen and bloat the markup. */
function fmt(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/** Which of `count` labels to show so that at most `room` are drawn, keeping them evenly spread. */
export function visibleLabels(count: number, room: number): boolean[] {
  const every = Math.max(1, Math.ceil(count / Math.max(room, 1)));
  return Array.from({ length: count }, (_, index) => index % every === 0);
}
