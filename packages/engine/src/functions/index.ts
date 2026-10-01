import { actionFunctions } from "./actions";
import { arrayFunctions } from "./arrays";
import { conditionalFunctions } from "./conditional";
import { controlFunctions } from "./controls";
import { dateFunctions } from "./dates";
import { informationFunctions } from "./information";
import { logicFunctions } from "./logic";
import { lookupFunctions } from "./lookup";
import { mathFunctions } from "./math";
import { nameFunctions } from "./names";
import type { FunctionRegistry } from "./registry";
import { textFunctions } from "./text";

export const defaultFunctions: FunctionRegistry = new Map(
  Object.entries({
    ...mathFunctions,
    ...conditionalFunctions,
    ...logicFunctions,
    ...informationFunctions,
    ...lookupFunctions,
    ...nameFunctions,
    ...arrayFunctions,
    ...textFunctions,
    ...dateFunctions,
    ...controlFunctions,
    ...actionFunctions,
  }),
);
