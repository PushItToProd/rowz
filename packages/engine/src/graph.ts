import { cellKey, rangeContains, type CellId, type CellRange } from "./address";

export interface EvaluationOrder<K> {
  /** Every node reachable from the root, each after the nodes it depends on. */
  order: K[];
  /** Nodes that depend on themselves, directly or through other nodes. */
  cyclic: Set<K>;
}

interface Frame<K> {
  node: K;
  dependencies: readonly K[];
  next: number;
  selfLoop: boolean;
}

/**
 * Orders the nodes reachable from `root` so dependencies come first, and
 * reports which nodes are on a cycle.
 *
 * This is Tarjan's strongly connected components algorithm with an explicit
 * stack. Recursion would overflow on a long chain such as a running total down
 * a column. Marking whole components, not only the path that first closes a
 * loop, makes the set of cyclic cells independent of which cell is asked for
 * first.
 */
export function evaluationOrder<K>(
  root: K,
  dependenciesOf: (node: K) => readonly K[],
): EvaluationOrder<K> {
  const indexOf = new Map<K, number>();
  const lowLink = new Map<K, number>();
  const component: K[] = [];
  const inComponentStack = new Set<K>();
  const frames: Frame<K>[] = [];
  const order: K[] = [];
  const cyclic = new Set<K>();

  const open = (node: K): void => {
    indexOf.set(node, indexOf.size);
    lowLink.set(node, indexOf.size - 1);
    component.push(node);
    inComponentStack.add(node);
    frames.push({ node, dependencies: dependenciesOf(node), next: 0, selfLoop: false });
  };
  const lower = (node: K, candidate: number): void => {
    lowLink.set(node, Math.min(lowLink.get(node) ?? candidate, candidate));
  };

  open(root);
  for (let frame = frames.at(-1); frame; frame = frames.at(-1)) {
    const dependency = frame.dependencies[frame.next];
    if (frame.next < frame.dependencies.length && dependency !== undefined) {
      frame.next += 1;
      if (dependency === frame.node) frame.selfLoop = true;
      const seenAt = indexOf.get(dependency);
      if (seenAt === undefined) open(dependency);
      else if (inComponentStack.has(dependency)) lower(frame.node, seenAt);
      continue;
    }

    frames.pop();
    const { node } = frame;
    const low = lowLink.get(node) ?? 0;
    const parent = frames.at(-1);
    if (parent) lower(parent.node, low);
    if (low !== indexOf.get(node)) continue;

    // `node` is the root of a component: everything above it on the stack belongs to it.
    const members = component.splice(component.lastIndexOf(node));
    for (const member of members) inComponentStack.delete(member);
    if (members.length > 1 || frame.selfLoop) {
      for (const member of members) cyclic.add(member);
    }
    order.push(...members);
  }

  return { order, cyclic };
}

interface RangeReader {
  range: CellRange;
  dependent: CellId;
}

/** The readers of one cell or one group of ranges, keyed so that one can be removed without scanning the rest. */
type Readers<T> = Map<string, Map<string, T>>;

/**
 * A range of at most this many columns is filed under each of its columns. A
 * wider one, or one open to the right, goes in a list per table that every
 * lookup in the table scans.
 */
const FILED_COLUMNS = 32;

function isSingleCell(range: CellRange): boolean {
  return range.startRow === range.endRow && range.startCol === range.endCol;
}

function firstCell(range: CellRange): CellId {
  return { tableId: range.tableId, row: range.startRow, col: range.startCol };
}

function columnKey(tableId: string, col: number): string {
  return `${tableId}:${String(col)}`;
}

/**
 * Records which ranges each formula cell reads, and answers which cells must
 * be recalculated when a cell changes.
 *
 * A table can hold 100,000 formulas, and they may all read the same cell or
 * range. Adding or removing one reader therefore touches no other reader, and
 * a lookup scans only the ranges that cross the cell's column, plus the wide
 * ones: scanning every range of the table for each cell visited made one edit
 * take time in proportion to the square of the number of formulas.
 */
export class DependencyIndex {
  /** Readers of single cells, by the cell read. */
  private readonly cellReaders: Readers<CellId> = new Map();
  /** Readers of ranges a few columns wide, by table and column. A reference to a whole column is one entry. */
  private readonly columnReaders: Readers<RangeReader> = new Map();
  /** Readers of wider ranges, by table. */
  private readonly wideReaders: Readers<RangeReader> = new Map();
  private readonly precedents = new Map<string, readonly CellRange[]>();

  set(dependent: CellId, precedents: readonly CellRange[]): void {
    this.remove(dependent);
    if (precedents.length === 0) return;
    const key = cellKey(dependent);
    this.precedents.set(key, precedents);
    for (const [n, range] of precedents.entries()) {
      if (isSingleCell(range)) {
        add(this.cellReaders, cellKey(firstCell(range)), key, dependent);
        continue;
      }
      for (const [readers, group] of this.groupsOf(range)) {
        add(readers, group, `${key}#${String(n)}`, { range, dependent });
      }
    }
  }

  remove(dependent: CellId): void {
    const key = cellKey(dependent);
    for (const [n, range] of (this.precedents.get(key) ?? []).entries()) {
      if (isSingleCell(range)) {
        drop(this.cellReaders, cellKey(firstCell(range)), key);
        continue;
      }
      for (const [readers, group] of this.groupsOf(range)) {
        drop(readers, group, `${key}#${String(n)}`);
      }
    }
    this.precedents.delete(key);
  }

  clear(): void {
    this.cellReaders.clear();
    this.columnReaders.clear();
    this.wideReaders.clear();
    this.precedents.clear();
  }

  /** Every cell whose value can change when `cell` changes, not including `cell`. */
  transitiveDependents(cell: CellId): CellId[] {
    const found = new Map<string, CellId>();
    const queue = [cell];
    const find = (key: string, dependent: CellId): void => {
      if (found.has(key)) return;
      found.set(key, dependent);
      queue.push(dependent);
    };
    for (let current = queue.pop(); current; current = queue.pop()) {
      for (const [key, dependent] of this.cellReaders.get(cellKey(current)) ?? []) {
        find(key, dependent);
      }
      const { tableId, col } = current;
      for (const group of [
        this.columnReaders.get(columnKey(tableId, col)),
        this.wideReaders.get(tableId),
      ]) {
        for (const { range, dependent } of group?.values() ?? []) {
          if (rangeContains(range, current)) find(cellKey(dependent), dependent);
        }
      }
    }
    found.delete(cellKey(cell));
    return [...found.values()];
  }

  /** Where a range of more than one cell is filed: under each of its columns, or with the wide ranges of its table. */
  private groupsOf(range: CellRange): [Readers<RangeReader>, string][] {
    if (range.endCol - range.startCol >= FILED_COLUMNS) return [[this.wideReaders, range.tableId]];
    const groups: [Readers<RangeReader>, string][] = [];
    for (let col = range.startCol; col <= range.endCol; col += 1) {
      groups.push([this.columnReaders, columnKey(range.tableId, col)]);
    }
    return groups;
  }
}

function add<T>(readers: Readers<T>, group: string, key: string, reader: T): void {
  const held = readers.get(group);
  if (held) held.set(key, reader);
  else readers.set(group, new Map([[key, reader]]));
}

function drop<T>(readers: Readers<T>, group: string, key: string): void {
  const held = readers.get(group);
  if (!held) return;
  held.delete(key);
  if (held.size === 0) readers.delete(group);
}
