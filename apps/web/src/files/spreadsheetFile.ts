import { FILE_LIMITS, spreadsheetFile, type SpreadsheetFile } from "@spreadsheet-app/shared";

export { toSpreadsheetFile } from "@spreadsheet-app/shared";

/**
 * Whether a file is small enough to import. The server holds a spreadsheet to
 * the pages, blocks, and cells a file may have as it is built. It does not
 * limit the text in all the cells together, so a file can outgrow the largest
 * request the server reads.
 */
export function fitsImport(file: SpreadsheetFile): boolean {
  return new Blob([JSON.stringify(file)]).size <= FILE_LIMITS.bytes;
}

/** Reads the text of a file as a spreadsheet. Throws an error whose message says what is wrong with it. */
export function readSpreadsheetFile(text: string): SpreadsheetFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("The file is not a document exported from this app");
  }
  const result = spreadsheetFile.safeParse(parsed);
  if (result.success) return result.data;
  const [issue] = result.error.issues;
  const where = issue?.path.join(".") ?? "";
  throw new Error(
    `The file is not a document this app can read${where === "" ? "" : ` (${where}: ${issue?.message ?? ""})`}`,
  );
}
