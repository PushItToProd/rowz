import { actionFunctions } from "./actions";
import { arrayFunctions } from "./arrays";
import { chartFunctions } from "./charts";
import { conditionalFunctions } from "./conditional";
import { controlFunctions } from "./controls";
import { dateFunctions } from "./dates";
import { financialFunctions } from "./financial";
import { informationFunctions } from "./information";
import { logicFunctions } from "./logic";
import { lookupFunctions } from "./lookup";
import { mathFunctions } from "./math";
import { nameFunctions } from "./names";
import { queryFunctions } from "./query";
import type { FunctionRegistry } from "./registry";
import { statisticsFunctions } from "./statistics";
import { textFunctions } from "./text";

export const defaultFunctions: FunctionRegistry = new Map(
  Object.entries({
    ...mathFunctions,
    ...statisticsFunctions,
    ...financialFunctions,
    ...conditionalFunctions,
    ...logicFunctions,
    ...informationFunctions,
    ...lookupFunctions,
    ...nameFunctions,
    ...arrayFunctions,
    ...queryFunctions,
    ...textFunctions,
    ...dateFunctions,
    ...chartFunctions,
    ...controlFunctions,
    ...actionFunctions,
  }),
);
