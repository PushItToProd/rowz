import { inputFitsColumnType, type ColumnType } from "@spreadsheet-app/engine";

export type ChoiceSettings =
  { choices: string[] } | { choicesFrom: { tableId: string; colId: string } };

/** Counts stored inputs that the engine cannot read under the requested column type. */
export function countMisfits(columnType: ColumnType, inputs: readonly string[]): number {
  if (columnType === "formula") return 0;
  return inputs.filter((input) => !inputFitsColumnType(input, columnType)).length;
}
