import {
  formatValue,
  isError,
  isFunction,
  isLambda,
  isRange,
  type Evaluated,
} from "@spreadsheet-app/engine";

/** How a name's value is shown in one line: a range by its size, a function by its name or parameters. */
export function shown(value: Evaluated | undefined): { text: string; error?: string } {
  if (value === undefined) return { text: "" };
  if (isError(value)) return { text: value.code, error: value.message ?? value.code };
  if (isRange(value)) {
    const cols = value.rows[0]?.length ?? 0;
    return { text: `${String(value.rows.length)} × ${String(cols)} values` };
  }
  if (isFunction(value)) {
    return {
      text: isLambda(value) ? `function (${value.params.join(", ")})` : `function ${value.name}`,
    };
  }
  return { text: formatValue(value) };
}
