/** Saves text as a file on the user's disk, through the browser's download. */
export function download(filename: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/** A file name made from a spreadsheet or table name, without the characters file systems refuse. */
export function fileName(name: string, extension: string): string {
  // eslint-disable-next-line no-control-regex -- control characters are among those refused
  const safe = name.replaceAll(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim();
  return `${safe === "" ? "untitled" : safe}.${extension}`;
}
