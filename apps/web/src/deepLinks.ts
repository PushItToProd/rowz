/** A location that can be named by a link inside a spreadsheet. */
export type DeepLinkLocation =
  | { kind: "page"; spreadsheetId: string; pageId: string }
  | { kind: "block"; spreadsheetId: string; pageId: string; blockId: string }
  | {
      kind: "cell";
      spreadsheetId: string;
      pageId: string;
      tableId: string;
      rowId: string;
      colId: string;
    };

export type DeepLinkFragment =
  | { kind: "block"; blockId: string }
  | { kind: "cell"; tableId: string; rowId: string; colId: string };

export interface DeepLinkContext {
  spreadsheetId: string;
  pageId: string;
}

const ID = /^[A-Za-z0-9_-]+$/;

function checkedId(value: string): string {
  if (!ID.test(value)) throw new TypeError("A link ID must contain only letters, numbers, _ or -");
  return value;
}

export function buildPageLink(spreadsheetId: string, pageId: string): string {
  return `/s/${checkedId(spreadsheetId)}/p/${checkedId(pageId)}`;
}

export function buildBlockLink(spreadsheetId: string, pageId: string, blockId: string): string {
  return `${buildPageLink(spreadsheetId, pageId)}#block=${checkedId(blockId)}`;
}

export function buildCellLink(
  spreadsheetId: string,
  pageId: string,
  tableId: string,
  rowId: string,
  colId: string,
): string {
  return `${buildPageLink(spreadsheetId, pageId)}#cell=${checkedId(tableId)}.${checkedId(rowId)}.${checkedId(colId)}`;
}

/** Parses the only fragment forms accepted for spreadsheet locations. */
export function parseDeepLinkFragment(hash: string): DeepLinkFragment | null {
  const fragment = hash.startsWith("#") ? hash.slice(1) : hash;
  const block = /^block=([A-Za-z0-9_-]+)$/.exec(fragment);
  const blockId = block?.[1];
  if (blockId) return { kind: "block", blockId };
  const cell = /^cell=([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(fragment);
  const [tableId, rowId, colId] = cell?.slice(1) ?? [];
  if (tableId && rowId && colId) return { kind: "cell", tableId, rowId, colId };
  return null;
}

function decodeId(value: string): string | null {
  try {
    const decoded = decodeURIComponent(value);
    return ID.test(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

/** Parses a root-relative app page link or a location fragment for the current page. */
export function parseDeepLinkHref(
  href: string,
  context?: DeepLinkContext,
): DeepLinkLocation | null {
  if (href.startsWith("#")) {
    if (!context) return null;
    const fragment = parseDeepLinkFragment(href);
    if (!fragment) return null;
    return fragment.kind === "block"
      ? { kind: "block", ...context, blockId: fragment.blockId }
      : {
          kind: "cell",
          ...context,
          tableId: fragment.tableId,
          rowId: fragment.rowId,
          colId: fragment.colId,
        };
  }

  const match = /^\/s\/([^/?#]+)\/p\/([^/?#]+)(?:#([^?]*))?$/.exec(href);
  if (!match) return null;
  const encodedSpreadsheetId = match[1];
  const encodedPageId = match[2];
  if (!encodedSpreadsheetId || !encodedPageId) return null;
  const spreadsheetId = decodeId(encodedSpreadsheetId);
  const pageId = decodeId(encodedPageId);
  if (!spreadsheetId || !pageId) return null;
  if (match[3] === undefined) return { kind: "page", spreadsheetId, pageId };
  const fragment = parseDeepLinkFragment(match[3]);
  if (!fragment) return null;
  return fragment.kind === "block"
    ? { kind: "block", spreadsheetId, pageId, blockId: fragment.blockId }
    : {
        kind: "cell",
        spreadsheetId,
        pageId,
        tableId: fragment.tableId,
        rowId: fragment.rowId,
        colId: fragment.colId,
      };
}

/** Whether a Markdown href is one of the app's supported page or location links. */
export function isDeepLinkHref(href: string): boolean {
  return href.startsWith("#")
    ? parseDeepLinkFragment(href) !== null
    : parseDeepLinkHref(href) !== null;
}
