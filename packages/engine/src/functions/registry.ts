import type { CellId, CellRange } from "../address";
import type { Node, Reference } from "../ast";
import type { Effect } from "../effects";
import type { Evaluated } from "../values";

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
  call(args: readonly Argument[]): Evaluated;
}

export interface PlanContext {
  /** The cell whose formula contains the action. */
  origin: CellId;
  /** Evaluates an argument against current cell values. */
  evaluate(node: Node): Evaluated;
  /** Finds the cells a reference points at, or `undefined` if its table does not exist. */
  resolve(reference: Reference): CellRange | undefined;
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

export type FunctionDefinition = PureFunction | ActionFunction;
export type FunctionRegistry = ReadonlyMap<string, FunctionDefinition>;
