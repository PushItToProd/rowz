import type { Node } from "../ast";
import { evaluate, type EvaluationContext } from "../evaluate";
import {
  AGGREGATES,
  children,
  columnName,
  columnOf,
  hasAggregate,
  isAggregate,
  parseQuery,
  QuerySyntaxError,
  type Query,
  type SelectItem,
} from "../query";
import {
  compare,
  formatValue,
  isError,
  isRange,
  isScalar,
  toBoolean,
  type CellValue,
  type Evaluated,
} from "../values";
import { array, fail, Failure, grid, integer, lazy, limitCells, text } from "./arguments";
import type { FunctionDefinition } from "./registry";

type Names = Map<string, Evaluated>;

/** A row of the data with its cells bound to their column names. */
interface Row {
  names: Names;
}

/** The rows that share a value of the GROUP BY columns. */
interface Group {
  rows: Row[];
}

/**
 * Guesses whether the first row is a header: it holds only text, and some
 * column below it holds something that is not text.
 */
function detectHeaders(cells: readonly CellValue[][]): number {
  const [first = [], ...rest] = cells;
  const isText = (cell: CellValue): boolean => typeof cell === "string";
  const labeled = first.some(isText) && first.every((cell) => cell === null || isText(cell));
  const typed = rest.some((row) => row.some((cell) => cell !== null && !isText(cell)));
  return labeled && typed ? 1 : 0;
}

/** Orders two cells for ORDER BY. Empty cells and non-values go last. */
function order(a: CellValue, b: CellValue): number {
  const sortable = (cell: CellValue): boolean => isScalar(cell) && cell !== null;
  if (!sortable(a) || !sortable(b)) return Number(sortable(b)) - Number(sortable(a));
  return isScalar(a) && isScalar(b) ? compare(a, b) : 0;
}

/** A key that is equal for two lists of cells exactly when the cells are equal, ignoring letter case. */
function keyOf(cells: readonly CellValue[]): string {
  return JSON.stringify(
    cells.map((cell) => (typeof cell === "string" ? cell.toLowerCase() : (cell ?? "\u0000"))),
  );
}

function same(a: Node, b: Node): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

class Runner {
  private readonly headers: string[];
  private readonly rows: Row[];

  constructor(
    private readonly query: Query,
    cells: readonly CellValue[][],
    headerRows: number,
    width: number,
    private readonly context: EvaluationContext,
    columnNames?: readonly string[],
  ) {
    this.headers =
      columnNames?.slice(0, width) ??
      Array.from({ length: width }, (_, col) =>
        cells
          .slice(0, headerRows)
          .map((row) => formatValue(row[col] ?? null))
          .filter((part) => part !== "")
          .join(" "),
      );
    this.rows = cells.slice(headerRows).map((row) => ({
      names: new Map(
        Array.from({ length: width }, (_, col) => [columnName(col), row[col] ?? null]),
      ),
    }));
  }

  run(hasHeaders: boolean): CellValue[][] {
    const { query } = this;
    const select: SelectItem[] =
      query.select ??
      this.headers.map((_, col) => ({
        expression: { type: "name", name: columnName(col) },
        text: `Col${String(col + 1)}`,
      }));
    const kept = query.where
      ? this.rows.filter((row) => this.test(query.where, row.names))
      : this.rows;

    const grouped =
      query.groupBy.length > 0 ||
      query.pivot.length > 0 ||
      query.having !== undefined ||
      [...select, ...query.orderBy].some((item) => hasAggregate(item.expression));
    const titled = hasHeaders || query.labels.length > 0 || select.some((item) => item.alias);

    if (!grouped) {
      const sorted = this.sorted(kept, (row, expression) => this.cell(expression, row.names));
      const shown = this.page(sorted);
      // A SELECT may name a column any number of times, so the result can be wider than the data.
      limitCells((shown.length + 1) * select.length);
      const body = shown.map((row) => select.map((item) => this.cell(item.expression, row.names)));
      return titled ? [select.map((item) => this.title(item)), ...body] : body;
    }

    for (const item of select) this.requireGrouped(item.expression, item.text);
    const groups = this.groups(kept).filter(
      (group) => !query.having || this.test(query.having, undefined, group),
    );
    const sorted = this.page(
      this.sorted(groups, (group, expression) => this.cell(expression, undefined, group)),
    );
    if (query.pivot.length > 0) return this.pivoted(select, sorted, kept);
    limitCells((sorted.length + 1) * select.length);
    const body = sorted.map((group) =>
      select.map((item) => this.cell(item.expression, undefined, group)),
    );
    return titled ? [select.map((item) => this.title(item)), ...body] : body;
  }

  /** Spreads each aggregate of the SELECT across a column for every value of the PIVOT columns. */
  private pivoted(select: SelectItem[], groups: Group[], kept: Row[]): CellValue[][] {
    const { pivot } = this.query;
    const pivotKey = (row: Row): CellValue[] => pivot.map((node) => this.cell(node, row.names));
    const across = new Map<string, CellValue[]>();
    for (const row of kept) {
      const cells = pivotKey(row);
      if (!across.has(keyOf(cells))) across.set(keyOf(cells), cells);
    }
    const columns = [...across].sort(([, a], [, b]) => {
      for (const [index, cell] of a.entries()) {
        const result = order(cell, b[index] ?? null);
        if (result !== 0) return result;
      }
      return 0;
    });
    const fixed = select.filter((item) => !hasAggregate(item.expression));
    const spread = select.filter((item) => hasAggregate(item.expression));
    if (spread.length === 0) fail("#VALUE!", "PIVOT needs a function such as SUM in the SELECT");

    limitCells((groups.length + 1) * (fixed.length + columns.length * spread.length));
    const header = [
      ...fixed.map((item) => this.title(item)),
      ...columns.flatMap(([, cells]) => {
        const name = cells.map(formatValue).join(", ");
        return spread.map((item) => (spread.length === 1 ? name : `${name} ${this.title(item)}`));
      }),
    ];
    const body = groups.map((group) => [
      ...fixed.map((item) => this.cell(item.expression, undefined, group)),
      ...columns.flatMap(([key]) => {
        const rows = group.rows.filter((row) => keyOf(pivotKey(row)) === key);
        return spread.map((item) =>
          rows.length === 0 ? null : this.cell(item.expression, undefined, { rows }),
        );
      }),
    ]);
    return [header, ...body];
  }

  /** The rows grouped by the GROUP BY columns, in the order of those columns' values. With no GROUP BY, one group of every row. */
  private groups(rows: Row[]): Group[] {
    const { groupBy } = this.query;
    if (groupBy.length === 0) return [{ rows }];
    const found = new Map<string, { key: CellValue[]; rows: Row[] }>();
    for (const row of rows) {
      const key = groupBy.map((node) => this.cell(node, row.names));
      const id = keyOf(key);
      const group = found.get(id) ?? { key, rows: [] };
      group.rows.push(row);
      found.set(id, group);
    }
    return [...found.values()].sort((a, b) => {
      for (const [index, cell] of a.key.entries()) {
        const result = order(cell, b.key[index] ?? null);
        if (result !== 0) return result;
      }
      return 0;
    });
  }

  /** A column outside a function such as SUM has one value per group only if the rows are grouped by it. */
  private requireGrouped(node: Node, written: string): void {
    if (isAggregate(node) || this.query.groupBy.some((by) => same(by, node))) return;
    if (columnOf(node) !== undefined) {
      fail("#VALUE!", `${written} must be in GROUP BY or inside a function such as SUM`);
    }
    for (const child of children(node)) this.requireGrouped(child, written);
  }

  private sorted<T>(items: T[], value: (item: T, expression: Node) => CellValue): T[] {
    const { orderBy } = this.query;
    if (orderBy.length === 0) return items;
    const keyed = items.map((item) => ({
      item,
      keys: orderBy.map(({ expression }) => value(item, expression)),
    }));
    keyed.sort((a, b) => {
      for (const [index, { descending }] of orderBy.entries()) {
        const [left = null, right = null] = [a.keys[index], b.keys[index]];
        const sortable = (cell: CellValue): boolean => isScalar(cell) && cell !== null;
        const result = order(left, right);
        // Empty cells stay last whichever way the column is sorted.
        const flipped = descending && sortable(left) && sortable(right) ? -result : result;
        if (flipped !== 0) return flipped;
      }
      return 0;
    });
    return keyed.map(({ item }) => item);
  }

  private page<T>(items: T[]): T[] {
    const { offset, limit } = this.query;
    return items.slice(offset, limit === undefined ? undefined : offset + limit);
  }

  /** Whether a WHERE or HAVING condition holds. An error in the condition fails the whole query. */
  private test(condition: Node | undefined, names?: Names, group?: Group): boolean {
    if (!condition) return true;
    const value = this.cell(condition, names, group);
    if (isError(value)) throw new Failure(value);
    const truth = isScalar(value) ? toBoolean(value) : false;
    if (isError(truth)) throw new Failure(truth);
    return truth;
  }

  /** The value of an expression for one row, or for a group when it combines rows. */
  private cell(expression: Node, names: Names = new Map(), group?: Group): CellValue {
    const scope = new Map(names);
    const prepared = group ? this.combine(expression, group, scope) : expression;
    const value = evaluate(prepared, { ...this.context, names: scope });
    return isRange(value) ? (value.rows[0]?.[0] ?? null) : value;
  }

  /**
   * Replaces each aggregate in an expression with a name bound to its value
   * over the group. What is left reads the group's first row, which is the
   * same in every row for the GROUP BY columns.
   */
  private combine(node: Node, group: Group, scope: Names): Node {
    for (const [name, value] of group.rows[0]?.names ?? []) {
      if (!scope.has(name)) scope.set(name, value);
    }
    if (node.type === "call") {
      if (!isAggregate(node)) {
        return { ...node, args: node.args.map((arg) => this.combine(arg, group, scope)) };
      }
      const name = `$agg${String(scope.size)}`;
      scope.set(name, this.aggregate(node.name, node.args[0], group));
      return { type: "name", name };
    }
    switch (node.type) {
      case "unary":
        return { ...node, operand: this.combine(node.operand, group, scope) };
      case "binary":
        return {
          ...node,
          left: this.combine(node.left, group, scope),
          right: this.combine(node.right, group, scope),
        };
      default:
        return node;
    }
  }

  private aggregate(name: string, argument: Node | undefined, group: Group): Evaluated {
    if (!argument) {
      return name === "COUNT" ? group.rows.length : fail("#ERROR!", `${name} needs a column`);
    }
    const values = group.rows.map((row) => [this.cell(argument, row.names)]);
    if (values.length === 0) return name === "COUNT" || name === "COUNTA" ? 0 : null;
    return evaluate(
      { type: "call", name: AGGREGATES[name] ?? name, args: [{ type: "name", name: "$values" }] },
      { ...this.context, names: new Map([["$values", array(values)]]) },
    );
  }

  /** The heading of a result column: its LABEL, its AS name, its column's header, or the item as written. */
  private title(item: SelectItem): string {
    const label = this.query.labels.find(({ expression }) => same(expression, item.expression));
    if (label) return label.label;
    if (item.alias !== undefined) return item.alias;
    const header = (node: Node | undefined): string | undefined => {
      const col = node ? columnOf(node) : undefined;
      const found = col === undefined ? "" : (this.headers[col] ?? "");
      return found === "" ? undefined : found;
    };
    const { expression } = item;
    if (expression.type === "call" && isAggregate(expression)) {
      const inner = header(expression.args[0]);
      if (inner !== undefined) return `${expression.name.toLowerCase()} ${inner}`;
    }
    return header(expression) ?? item.text;
  }
}

export const queryFunctions: Record<string, FunctionDefinition> = {
  /**
   * Runs a query with single-quoted identifiers and double-quoted strings over a range. `headers` is
   * how many rows at the top are headings. When it is left out, a first row
   * of text above other kinds of values is taken to be one.
   */
  QUERY: lazy(2, 3, ([data, source, headers], context) => {
    const input = data?.() ?? null;
    const cells = grid(input);
    const columnNames = isRange(input) ? input.columnNames : undefined;
    // A range over a table with no rows has no columns to name either.
    if (cells.length === 0) fail("#N/A", "The query matches no rows");
    const width = Math.max(0, ...cells.map((row) => row.length));
    const headerRows =
      headers !== undefined
        ? integer(headers())
        : columnNames === undefined
          ? detectHeaders(cells)
          : 0;
    if (headerRows < 0 || headerRows > cells.length) {
      fail("#VALUE!", "The number of header rows must be between 0 and the rows of the data");
    }
    const names = new Map<string, number>();
    for (let col = width - 1; col >= 0; col -= 1) {
      const header =
        columnNames?.[col] ??
        cells
          .slice(0, headerRows)
          .map((row) => formatValue(row[col] ?? null))
          .filter((part) => part !== "")
          .join(" ");
      if (header !== "") names.set(header.toLowerCase(), col);
    }
    let query: Query;
    try {
      query = parseQuery(text(source?.() ?? null), {
        count: width,
        byHeader: (name) => names.get(name.toLowerCase()),
      });
    } catch (cause) {
      if (!(cause instanceof QuerySyntaxError)) throw cause;
      return fail("#VALUE!", cause.message);
    }
    const rows = new Runner(query, cells, headerRows, width, context, columnNames).run(
      headerRows > 0 || columnNames !== undefined,
    );
    return rows.length === 0 ? fail("#N/A", "The query matches no rows") : array(rows);
  }),
};
