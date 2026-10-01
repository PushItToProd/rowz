import { CLIENT_ID } from "./client";

/**
 * Watches a spreadsheet for changes made elsewhere: by another person, or by
 * this person in another tab. `onChange` is called for each one, and once
 * after the connection is restored, since changes made while it was down were
 * not heard. Returns what stops the watching.
 *
 * Where the browser has no `EventSource`, nothing is watched.
 */
export function watchSpreadsheet(spreadsheetId: string, onChange: () => void): () => void {
  if (typeof EventSource === "undefined") return () => undefined;
  // Naming this tab keeps the changes it made itself, which are already on screen, out of the stream.
  const source = new EventSource(`/api/spreadsheets/${spreadsheetId}/events?client=${CLIENT_ID}`);
  let connectedBefore = false;
  source.addEventListener("ready", () => {
    if (connectedBefore) onChange();
    connectedBefore = true;
  });
  source.addEventListener("change", () => {
    onChange();
  });
  return () => {
    source.close();
  };
}
