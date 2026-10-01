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

function isSingleCell(range: CellRange): boolean {
  return range.startRow === range.endRow && range.startCol === range.endCol;
}

function firstCell(range: CellRange): CellId {
  return { tableId: range.tableId, row: range.startRow, col: range.startCol };
}

/**
 * Records which ranges each formula cell reads, and answers which cells must
 * be recalculated when a cell changes.
 */
export class DependencyIndex {
  // Single-cell references are looked up by the cell they read. Larger ranges
  // are kept in a list per table and scanned, so a reference to a whole column
  // costs one entry instead of one per cell.
  private readonly cellReaders = new Map<string, CellId[]>();
  private readonly rangeReaders = new Map<string, RangeReader[]>();
  private readonly precedents = new Map<string, readonly CellRange[]>();

  set(dependent: CellId, precedents: readonly CellRange[]): void {
    this.remove(dependent);
    if (precedents.length === 0) return;
    this.precedents.set(cellKey(dependent), precedents);
    for (const range of precedents) {
      if (isSingleCell(range)) {
        const key = cellKey(firstCell(range));
        this.cellReaders.set(key, [...(this.cellReaders.get(key) ?? []), dependent]);
      } else {
        const readers = this.rangeReaders.get(range.tableId) ?? [];
        this.rangeReaders.set(range.tableId, [...readers, { range, dependent }]);
      }
    }
  }

  remove(dependent: CellId): void {
    const key = cellKey(dependent);
    const isOther = (reader: CellId): boolean => cellKey(reader) !== key;
    for (const range of this.precedents.get(key) ?? []) {
      if (isSingleCell(range)) {
        const read = cellKey(firstCell(range));
        this.cellReaders.set(read, (this.cellReaders.get(read) ?? []).filter(isOther));
      } else {
        const readers = this.rangeReaders.get(range.tableId) ?? [];
        this.rangeReaders.set(
          range.tableId,
          readers.filter((reader) => isOther(reader.dependent)),
        );
      }
    }
    this.precedents.delete(key);
  }

  clear(): void {
    this.cellReaders.clear();
    this.rangeReaders.clear();
    this.precedents.clear();
  }

  /** Every cell whose value can change when `cell` changes, not including `cell`. */
  transitiveDependents(cell: CellId): CellId[] {
    const found = new Map<string, CellId>();
    const queue = [cell];
    for (let current = queue.pop(); current; current = queue.pop()) {
      for (const dependent of this.readersOf(current)) {
        const key = cellKey(dependent);
        if (found.has(key)) continue;
        found.set(key, dependent);
        queue.push(dependent);
      }
    }
    found.delete(cellKey(cell));
    return [...found.values()];
  }

  private readersOf(cell: CellId): CellId[] {
    const throughRanges = (this.rangeReaders.get(cell.tableId) ?? [])
      .filter(({ range }) => rangeContains(range, cell))
      .map(({ dependent }) => dependent);
    return [...(this.cellReaders.get(cellKey(cell)) ?? []), ...throughRanges];
  }
}
