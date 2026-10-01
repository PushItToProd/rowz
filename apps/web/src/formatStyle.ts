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

/** The styles a format gives the cell itself. */
export function cellStyle(format: CellFormat): Record<string, string> {
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
