import { spreadsheetFile, type SpreadsheetFile } from "@spreadsheet-app/shared";

export { toSpreadsheetFile } from "@spreadsheet-app/shared";

/** Reads the text of a file as a spreadsheet. Throws an error whose message says what is wrong with it. */
export function readSpreadsheetFile(text: string): SpreadsheetFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("The file is not a spreadsheet exported from this app");
  }
  const result = spreadsheetFile.safeParse(parsed);
  if (result.success) return result.data;
  const [issue] = result.error.issues;
  const where = issue?.path.join(".") ?? "";
  throw new Error(
    `The file is not a spreadsheet this app can read${where === "" ? "" : ` (${where}: ${issue?.message ?? ""})`}`,
  );
}
