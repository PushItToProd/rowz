import { formatReference, type Node } from "../ast";
import { evaluate } from "../evaluate";
import type { Evaluated } from "../values";
import { fail } from "./arguments";
import type { FunctionDefinition } from "./registry";

/** Reads an argument that must be a name to bind. */
function nameOf(node: Node | undefined, form: string): string {
  if (node?.type === "name") return node.name;
  if (node?.type === "reference") {
    return fail(
      "#ERROR!",
      `${formatReference(node.reference)} is a cell address and cannot be used as a name`,
    );
  }
  return fail("#ERROR!", `${form} needs a name here`);
}

export const nameFunctions: Record<string, FunctionDefinition> = {
  /**
   * `LET(name, value, ..., result)` gives names to values and evaluates the
   * result with them. Each value can use the names before it.
   */
  LET: {
    kind: "special",
    minArgs: 3,
    maxArgs: Infinity,
    evaluate(args, context): Evaluated {
      if (args.length % 2 === 0)
        fail("#ERROR!", "LET takes names and values in pairs, then a result");
      const names = new Map(context.names);
      const body = args.at(-1);
      for (let index = 0; index + 1 < args.length; index += 2) {
        const name = nameOf(args[index], "LET").toLowerCase();
        const value = args[index + 1];
        // An error bound to a name surfaces only where the name is used.
        if (value) names.set(name, evaluate(value, { ...context, names: new Map(names) }));
      }
      return body ? evaluate(body, { ...context, names }) : null;
    },
  },

  /**
   * `LAMBDA(parameter, ..., body)` makes a function. Call it right away, bind
   * it with `LET`, or leave it in a cell and call the cell: `=A1(5)`.
   */
  LAMBDA: {
    kind: "special",
    minArgs: 1,
    maxArgs: Infinity,
    evaluate(args, context): Evaluated {
      const body = args.at(-1);
      const params = args.slice(0, -1).map((arg) => nameOf(arg, "LAMBDA"));
      const unique = new Set(params.map((param) => param.toLowerCase()));
      if (unique.size !== params.length) fail("#ERROR!", "LAMBDA has two parameters with one name");
      return body ? { kind: "lambda", params, body, context } : null;
    },
  },
};
