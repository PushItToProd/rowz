import type { Node } from "./ast";
import type { FunctionRegistry } from "./functions/registry";

/** A use of a name the document defines: written alone, or with the table or script that holds it. */
export type NameUse = { name: string } | { page?: string; holder: string; name: string };

/**
 * Lists the words in a formula that can mean a name the document defines.
 * A word that `LET` or `LAMBDA` bound around it is left out, and so is the
 * name of a built-in function. `bound` holds names bound outside the formula,
 * in lower case, as a text view's `let` and `for` bind them.
 *
 * Arguments of action functions are left out, as `referencesOf` leaves them
 * out: they are evaluated when the action runs.
 */
export function namesOf(
  node: Node,
  functions: FunctionRegistry,
  bound: ReadonlySet<string> = new Set(),
): NameUse[] {
  const within = (nodes: readonly Node[], names = bound): NameUse[] =>
    nodes.flatMap((child) => namesOf(child, functions, names));
  const free = (name: string): boolean => !bound.has(name.toLowerCase());

  switch (node.type) {
    case "name":
      return free(node.name) ? [{ name: node.name }] : [];
    case "qualified":
      return [node];
    case "unary":
      return within([node.operand]);
    case "binary":
      return within([node.left, node.right]);
    case "apply":
      return within([node.target, ...node.args]);
    case "call": {
      if (!free(node.name)) return within(node.args);
      const definition = functions.get(node.name);
      if (definition?.kind === "action") return [];
      // These two follow how LET and LAMBDA bind names in `functions/names.ts`.
      if (node.name === "LET") return letNames(node.args, functions, bound);
      if (node.name === "LAMBDA") {
        const parameters = node.args.slice(0, -1).flatMap(binding);
        return within(node.args.slice(-1), new Set([...bound, ...parameters]));
      }
      return [...(definition ? [] : [{ name: node.name }]), ...within(node.args)];
    }
    default:
      return [];
  }
}

function binding(node: Node): string[] {
  return node.type === "name" ? [node.name.toLowerCase()] : [];
}

/** Each value of a `LET` can use the names before it, and the result can use them all. */
function letNames(
  args: readonly Node[],
  functions: FunctionRegistry,
  outer: ReadonlySet<string>,
): NameUse[] {
  const bound = new Set(outer);
  const uses: NameUse[] = [];
  for (let index = 0; index + 1 < args.length; index += 2) {
    const [name, value] = [args[index], args[index + 1]];
    if (value) uses.push(...namesOf(value, functions, new Set(bound)));
    if (name) for (const word of binding(name)) bound.add(word);
  }
  const result = args.length % 2 === 1 ? args.at(-1) : undefined;
  if (result) uses.push(...namesOf(result, functions, bound));
  return uses;
}
