import { reactive } from "vue";

const STORAGE_PREFIX = "rowz:block-collapse:";
const collapsedBySpreadsheet = reactive(new Map<string, Set<string>>());

function storageKey(spreadsheetId: string): string {
  return `${STORAGE_PREFIX}${encodeURIComponent(spreadsheetId)}`;
}

function stateFor(spreadsheetId: string): Set<string> {
  let state = collapsedBySpreadsheet.get(spreadsheetId);
  if (!state) {
    state = new Set<string>();
    collapsedBySpreadsheet.set(spreadsheetId, state);
  }
  return state;
}

function persist(spreadsheetId: string): void {
  try {
    globalThis.localStorage.setItem(
      storageKey(spreadsheetId),
      JSON.stringify([...stateFor(spreadsheetId)]),
    );
  } catch {
    // Storage may be unavailable or full. Collapse still works until the page closes.
  }
}

/** Loads one viewer's collapsed block IDs and drops IDs absent from this document. */
export function loadCollapsedBlocks(spreadsheetId: string, knownBlockIds: Iterable<string>): void {
  const known = new Set(knownBlockIds);
  let saved: unknown;
  try {
    const value = globalThis.localStorage.getItem(storageKey(spreadsheetId));
    saved = value === null ? [] : JSON.parse(value);
  } catch {
    saved = [];
  }

  const collapsed = new Set(
    Array.isArray(saved)
      ? saved.filter((id): id is string => typeof id === "string" && known.has(id))
      : [],
  );
  collapsedBySpreadsheet.set(spreadsheetId, collapsed);
  persist(spreadsheetId);
}

export function isBlockCollapsed(spreadsheetId: string, blockId: string): boolean {
  return collapsedBySpreadsheet.get(spreadsheetId)?.has(blockId) ?? false;
}

export function setBlockCollapsed(
  spreadsheetId: string,
  blockId: string,
  collapsed: boolean,
): void {
  const state = stateFor(spreadsheetId);
  if (collapsed) state.add(blockId);
  else state.delete(blockId);
  persist(spreadsheetId);
}

export function toggleBlockCollapsed(spreadsheetId: string, blockId: string): void {
  setBlockCollapsed(spreadsheetId, blockId, !isBlockCollapsed(spreadsheetId, blockId));
}

export function setBlocksCollapsed(
  spreadsheetId: string,
  blockIds: Iterable<string>,
  collapsed: boolean,
): void {
  const state = stateFor(spreadsheetId);
  for (const blockId of blockIds) {
    if (collapsed) state.add(blockId);
    else state.delete(blockId);
  }
  persist(spreadsheetId);
}
