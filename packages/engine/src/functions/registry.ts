import type { CellId, CellRange } from "../address";
import type { Node, Reference } from "../ast";
import type { Effect } from "../effects";
import type { EvaluationContext } from "../evaluate";
import type { ColumnDefinition } from "../structure";
import type { ActionValue, Evaluated } from "../values";

/** An argument that is evaluated only when called. `IF` uses this to skip the branch not taken. */
export type Argument = () => Evaluated;

/**
 * A function computed during recalculation. It must not have side effects.
 * It reports a bad argument by throwing `Failure`, which makes the call
 * evaluate to that error.
 */
export interface PureFunction {
  kind: "pure";
  minArgs: number;
  maxArgs: number;
  /** Whether applying a function value may evaluate all arguments before the call. */
  callableAsValue: boolean;
  /** `context` is for the few functions that call a function passed to them, such as `MAP`. */
  call(args: readonly Argument[], context: EvaluationContext): Evaluated;
}

export interface PlanContext {
  /** The cell whose formula contains the action. */
  origin: CellId;
  /** Evaluates an argument against current cell values. */
  evaluate(node: Node): Evaluated;
  /** Finds the cells a reference points at, or `undefined` if its table does not exist. */
  resolve(reference: Reference): CellRange | undefined;
  /**
   * The cells an argument names, for an action that writes to them. The
   * argument is a reference, or a name whose formula is one reference. The
   * result is `undefined` for anything else. `range` is `undefined` when the
   * reference's table does not exist.
   */
  target(node: Node | undefined): { range: CellRange | undefined; single: boolean } | undefined;
  /**
   * The size of a table and its named columns. A table that has them is a
   * data table, which holds only the rows added to it. `columns` is `null`
   * for a plain grid.
   */
  tableOf(tableId: string): {
    rows: number;
    cols: number;
    columns: readonly ColumnDefinition[] | null;
  };
  /** The cells of a range that hold something a user typed. */
  inputsIn(range: CellRange): CellId[];
  /** The effects of another action, for an action that combines actions. */
  plan(action: ActionValue): Effect[];
}

/**
 * A function that describes a side effect. During recalculation a call to it
 * evaluates to an `ActionValue` and its arguments are not evaluated. `plan`
 * runs when the action is triggered and turns the arguments into effects. It
 * throws `Failure` when the action cannot run.
 */
export interface ActionFunction {
  kind: "action";
  minArgs: number;
  maxArgs: number;
  plan(args: readonly Node[], context: PlanContext): Effect[];
}

/**
 * A form that needs its arguments as written, not as values, because some of
 * them are names to bind. `LET` and `LAMBDA` are the special forms.
 */
export interface SpecialForm {
  kind: "special";
  minArgs: number;
  maxArgs: number;
  evaluate(args: readonly Node[], context: EvaluationContext): Evaluated;
}

export type FunctionDefinition = PureFunction | ActionFunction | SpecialForm;
export type FunctionRegistry = ReadonlyMap<string, FunctionDefinition>;
