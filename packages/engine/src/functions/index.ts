import { actionFunctions } from "./actions";
import { logicFunctions } from "./logic";
import { mathFunctions } from "./math";
import type { FunctionRegistry } from "./registry";
import { textFunctions } from "./text";

export const defaultFunctions: FunctionRegistry = new Map(
  Object.entries({ ...mathFunctions, ...logicFunctions, ...textFunctions, ...actionFunctions }),
);
