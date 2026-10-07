import {
  formatAddress,
  quoteName,
  type ErrorTraceCallSite,
  type ErrorTraceFrame,
} from "@spreadsheet-app/engine";

function callSiteText(site: ErrorTraceCallSite): string {
  switch (site.kind) {
    case "cell":
      return `${site.tableName ? `${quoteName(site.tableName)}!` : ""}${formatAddress(site.cell)}`;
    case "script":
      return `${site.name ? `${site.name} (` : ""}${site.scriptName}, line ${String(site.line)}${site.name ? ")" : ""}`;
    case "page":
      return `${site.pageName ?? "Page"} formula`;
    case "more":
      return `… ${String(site.count)} more calls`;
  }
}

/** Returns the exact visible trace lines used by the error UI and clipboard. */
export function renderErrorTraceText(trace: readonly ErrorTraceFrame[]): string[] {
  const frame = trace[0];
  if (!frame) return [];

  const lines = [
    `Raised in ${frame.function} (${frame.location.scriptName}, line ${String(frame.location.line)})`,
  ];
  const callers: string[] = [];
  let site = frame.callSite;
  while (site) {
    callers.push(callSiteText(site));
    site = site.kind === "more" ? undefined : site.parent;
  }
  if (callers.length) lines.push(`Called from ${callers.join(" → ")}`);
  return lines;
}
