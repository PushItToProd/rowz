import {
  formatDateAs,
  FormatError,
  formatNumberAs,
  isDate,
  type CellFormat,
  type CellValue,
  type FormatColor,
} from "@spreadsheet-app/engine";

/** What each named color looks like as text, dark enough to read on white. */
const TEXT_COLORS: Record<FormatColor, string> = {
  red: "#c0362c",
  orange: "#b85c00",
  yellow: "#8a6d00",
  green: "#1f7a4d",
  blue: "#2f5bea",
  purple: "#7a3fc4",
  gray: "#667085",
};

/** What each named color looks like as a background, light enough to read dark text on. */
const FILL_COLORS: Record<FormatColor, string> = {
  red: "#fde2df",
  orange: "#ffe8cc",
  yellow: "#fff3b8",
  green: "#d9f2e3",
  blue: "#dde6ff",
  purple: "#ecdffb",
  gray: "#e9ecf1",
};

/** The styles a format gives the text of a cell. */
export function textStyle(format: CellFormat): Record<string, string> {
  return {
    ...(format.bold ? { fontWeight: "700" } : {}),
    ...(format.italic ? { fontStyle: "italic" } : {}),
    ...(format.align ? { textAlign: format.align } : {}),
    ...(format.color ? { color: TEXT_COLORS[format.color] } : {}),
  };
}

/** What each named color looks like at the strong end of a color scale: dark enough to tell from the light end, light enough to read text on. */
const SCALE_COLORS: Record<FormatColor, string> = {
  red: "#f28b82",
  orange: "#fbbc73",
  yellow: "#fde68a",
  green: "#81c995",
  blue: "#8ab4f8",
  purple: "#c58af9",
  gray: "#bdc1c6",
};

const PLAIN_BACKGROUND = "#ffffff";

function channels(hex: string): [number, number, number] {
  return [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16)) as [
    number,
    number,
    number,
  ];
}

/** The color a given way from `from` to `to`, as CSS. */
function blend(from: string, to: string, at: number): string {
  const [a, b] = [channels(from), channels(to)];
  const mixed = a.map((channel, index) => Math.round(channel + ((b[index] ?? 0) - channel) * at));
  return `rgb(${mixed.join(", ")})`;
}

/**
 * The styles a format gives the cell itself. A color scale shades from its
 * low color, or from the cell's own fill where it has none, to its high color.
 */
export function cellStyle(format: CellFormat): Record<string, string> {
  const { shade } = format;
  if (shade) {
    const own = format.fill ? FILL_COLORS[format.fill] : PLAIN_BACKGROUND;
    const low = shade.low ? SCALE_COLORS[shade.low] : own;
    return { background: blend(low, SCALE_COLORS[shade.high], Math.min(1, Math.max(0, shade.at))) };
  }
  return format.fill ? { background: FILL_COLORS[format.fill] } : {};
}

/**
 * A number or date written in the cell's number format, or `undefined` when
 * the format does not apply: the value is neither, there is no format, or the
 * format is one for the other kind of value.
 */
export function formattedText(value: CellValue, format: CellFormat): string | undefined {
  const pattern = format.numberFormat;
  if (pattern === undefined) return undefined;
  try {
    if (typeof value === "number") return formatNumberAs(value, pattern);
    if (isDate(value)) return formatDateAs(value, pattern);
  } catch (cause) {
    if (!(cause instanceof FormatError)) throw cause;
  }
  return undefined;
}
