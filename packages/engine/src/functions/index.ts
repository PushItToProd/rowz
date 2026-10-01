import { actionFunctions } from "./actions";
import { conditionalFunctions } from "./conditional";
import { informationFunctions } from "./information";
import { logicFunctions } from "./logic";
import { lookupFunctions } from "./lookup";
import { mathFunctions } from "./math";
import type { FunctionRegistry } from "./registry";
import { textFunctions } from "./text";

export const defaultFunctions: FunctionRegistry = new Map(
  Object.entries({
    ...mathFunctions,
    ...conditionalFunctions,
    ...logicFunctions,
    ...informationFunctions,
    ...lookupFunctions,
    ...textFunctions,
    ...actionFunctions,
  }),
);
