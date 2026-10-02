import { CLIENT_ID, type Change } from "./client";

/**
 * Watches a spreadsheet for content changes, including this tab’s own.
 * `onChange` receives each change, and is called without content once
 * after the connection is restored, since changes made while it was down were
 * not heard. Returns what stops the watching.
 *
 * Where the browser has no `EventSource`, nothing is watched.
 */
export function watchSpreadsheet(
  spreadsheetId: string,
  onChange: (change?: Change) => void,
): () => void {
  if (typeof EventSource === "undefined") return () => undefined;
  // This tab receives its own changes too, so revisions remain contiguous.
  const source = new EventSource(`/api/spreadsheets/${spreadsheetId}/events?client=${CLIENT_ID}`);
  let connectedBefore = false;
  source.addEventListener("ready", (event) => {
    if (connectedBefore) onChange();
    else {
      // Catch changes committed between the initial snapshot and subscribing.
      try {
        const ready = JSON.parse((event as MessageEvent<string>).data) as { revision: number };
        onChange({ revision: ready.revision, changed: null });
      } catch {
        // Older servers sent an empty ready event.
      }
    }
    connectedBefore = true;
  });
  source.addEventListener("change", (event) => {
    try {
      onChange(JSON.parse((event as MessageEvent<string>).data) as Change);
    } catch {
      onChange();
    }
  });
  return () => {
    source.close();
  };
}
