import { graphemes, isAscii } from "./functions/graphemes";

/** A syntax, size, or execution limit error in the regular expression engine. */
export class RegexError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RegexError";
  }
}

const MAX_PATTERN_LENGTH = 256;
const MAX_PROGRAM_LENGTH = 1024;
const MAX_STEPS = 2_000_000;

type BuiltinClass = "digit" | "word" | "space";

type CharacterTest =
  | { kind: "literal"; value: string }
  | { kind: "range"; first: string; last: string }
  | { kind: "any" }
  | { kind: "builtin"; name: BuiltinClass; negated: boolean }
  | { kind: "class"; terms: CharacterTest[]; negated: boolean };

type Assertion = "start" | "end" | "word-boundary";

type Node =
  | { kind: "empty" }
  | { kind: "character"; test: CharacterTest }
  | { kind: "assertion"; assertion: Assertion }
  | { kind: "sequence"; children: Node[] }
  | { kind: "choice"; children: Node[] }
  | { kind: "group"; index: number | undefined; child: Node }
  | {
      kind: "repeat";
      child: Node;
      min: number;
      max: number | undefined;
      greedy: boolean;
    };

function mergeLiteralNodes(nodes: Node[]): Node[] {
  const merged: Node[] = [];
  let literal = "";
  const flush = () => {
    for (const value of graphemes(literal)) {
      merged.push({ kind: "character", test: { kind: "literal", value } });
    }
    literal = "";
  };

  for (const node of nodes) {
    if (node.kind === "character" && node.test.kind === "literal") {
      literal += node.test.value;
    } else {
      flush();
      merged.push(node);
    }
  }
  flush();
  return merged;
}

function mergeLiteralTests(terms: CharacterTest[]): CharacterTest[] {
  const merged: CharacterTest[] = [];
  let literal = "";
  const flush = () => {
    for (const value of graphemes(literal)) merged.push({ kind: "literal", value });
    literal = "";
  };

  for (const term of terms) {
    if (term.kind === "literal") {
      literal += term.value;
    } else {
      flush();
      merged.push(term);
    }
  }
  flush();
  return merged;
}

class Parser {
  private position = 0;
  captureCount = 0;
  private readonly characters: string[];

  constructor(pattern: string) {
    this.characters = graphemes(pattern);
    if (this.characters.length > MAX_PATTERN_LENGTH) {
      throw new RegexError(
        "The regular expression cannot exceed " + String(MAX_PATTERN_LENGTH) + " characters",
      );
    }
  }

  parse(): Node {
    const result = this.parseChoice();
    if (this.position !== this.characters.length) {
      const character = this.current();
      if (character === ")") throw new RegexError("The regular expression has an unmatched )");
      throw new RegexError(`Unexpected ${JSON.stringify(character)} in the regular expression`);
    }
    return result;
  }

  private current(): string | undefined {
    return this.characters[this.position];
  }

  private parseChoice(): Node {
    const children = [this.parseSequence()];
    while (this.current() === "|") {
      this.position += 1;
      children.push(this.parseSequence());
    }
    return children.length === 1
      ? (children[0] ?? { kind: "empty" })
      : { kind: "choice", children };
  }

  private parseSequence(): Node {
    const children: Node[] = [];
    while (
      this.position < this.characters.length &&
      this.current() !== ")" &&
      this.current() !== "|"
    ) {
      children.push(this.parseQuantified());
    }
    if (children.length === 0) return { kind: "empty" };
    const merged = mergeLiteralNodes(children);
    return merged.length === 1
      ? (merged[0] ?? { kind: "empty" })
      : { kind: "sequence", children: merged };
  }

  private parseQuantified(): Node {
    const child = this.parseAtom();
    const quantifier = this.current();
    if (quantifier !== "*" && quantifier !== "+" && quantifier !== "?" && quantifier !== "{") {
      return child;
    }

    let min: number;
    let max: number | undefined;
    if (quantifier === "*") {
      min = 0;
      max = undefined;
      this.position += 1;
    } else if (quantifier === "+") {
      min = 1;
      max = undefined;
      this.position += 1;
    } else if (quantifier === "?") {
      min = 0;
      max = 1;
      this.position += 1;
    } else {
      [min, max] = this.parseBraceQuantifier();
    }

    const greedy = this.current() !== "?";
    if (!greedy) this.position += 1;
    if (
      this.current() === "*" ||
      this.current() === "+" ||
      this.current() === "?" ||
      this.current() === "{"
    ) {
      throw new RegexError("A regular expression item cannot have multiple quantifiers");
    }
    if (child.kind === "assertion") {
      throw new RegexError("Anchors and word boundaries cannot be repeated");
    }
    return { kind: "repeat", child, min, max, greedy };
  }

  private parseBraceQuantifier(): [number, number | undefined] {
    this.position += 1;
    const minimum = this.readDecimal();
    if (minimum === undefined) throw new RegexError("A { quantifier needs a number");
    if (this.current() === "}") {
      this.position += 1;
      return [minimum, minimum];
    }
    if (this.current() !== ",") throw new RegexError("A { quantifier must end with }");
    this.position += 1;
    const maximum = this.readDecimal();
    if (this.current() !== "}") throw new RegexError("A { quantifier must end with }");
    this.position += 1;
    if (maximum !== undefined && maximum < minimum) {
      throw new RegexError("The upper repeat count is smaller than the lower repeat count");
    }
    return [minimum, maximum];
  }

  private readDecimal(): number | undefined {
    const start = this.position;
    while (isDigit(this.current())) this.position += 1;
    if (this.position === start) return undefined;
    const value = Number(this.characters.slice(start, this.position).join(""));
    if (!Number.isSafeInteger(value)) throw new RegexError("A repeat count is too large");
    return value;
  }

  private parseAtom(): Node {
    const character = this.current();
    if (character === undefined) throw new RegexError("The regular expression ends unexpectedly");
    this.position += 1;
    if (character === "(") {
      let index: number | undefined;
      if (this.current() === "?") {
        this.position += 1;
        if (this.current() === ":") {
          this.position += 1;
        } else if (this.current() === "=" || this.current() === "!") {
          throw new RegexError("Lookaround assertions are not supported");
        } else if (this.current() === "<") {
          throw new RegexError("Lookbehind and named capture groups are not supported");
        } else {
          throw new RegexError("Only (?:...) is supported as a group modifier");
        }
      } else {
        this.captureCount += 1;
        index = this.captureCount;
      }
      const child = this.parseChoice();
      if (this.current() !== ")") throw new RegexError("The regular expression has an unclosed (");
      this.position += 1;
      return { kind: "group", index, child };
    }
    if (character === "[") return { kind: "character", test: this.parseCharacterClass() };
    if (character === ".") return { kind: "character", test: { kind: "any" } };
    if (character === "^") return { kind: "assertion", assertion: "start" };
    if (character === "$") return { kind: "assertion", assertion: "end" };
    if (character === "\\") {
      const escaped = this.parseEscape(false);
      return typeof escaped === "string"
        ? { kind: "character", test: { kind: "literal", value: escaped } }
        : escaped.kind === "assertion"
          ? { kind: "assertion", assertion: escaped.assertion }
          : { kind: "character", test: escaped.test };
    }
    if (character === "*" || character === "+" || character === "?") {
      throw new RegexError("A quantifier has no preceding regular expression item");
    }
    if (character === "{")
      throw new RegexError("A { quantifier has no preceding regular expression item");
    if (character === "}") throw new RegexError("The regular expression has an unmatched }");
    return { kind: "character", test: { kind: "literal", value: character } };
  }

  private parseCharacterClass(): CharacterTest {
    const negated = this.current() === "^";
    if (negated) this.position += 1;
    const terms: CharacterTest[] = [];
    while (this.position < this.characters.length && this.current() !== "]") {
      const first = this.parseClassAtom();
      if (this.current() === "-" && this.characters[this.position + 1] !== "]") {
        this.position += 1;
        const last = this.parseClassAtom();
        if (first.kind !== "literal" || last.kind !== "literal") {
          throw new RegexError("Character class ranges need literal endpoints");
        }
        if ((first.value.codePointAt(0) ?? 0) > (last.value.codePointAt(0) ?? 0)) {
          throw new RegexError("A character class range is in descending order");
        }
        terms.push({ kind: "range", first: first.value, last: last.value });
      } else {
        terms.push(first);
      }
    }
    if (this.current() !== "]") throw new RegexError("The regular expression has an unclosed [");
    this.position += 1;
    if (terms.length === 0) throw new RegexError("An empty character class is not supported");
    return { kind: "class", terms: mergeLiteralTests(terms), negated };
  }

  private parseClassAtom(): CharacterTest {
    const character = this.current();
    if (character === undefined) throw new RegexError("The regular expression has an unclosed [");
    this.position += 1;
    if (character !== "\\") return { kind: "literal", value: character };
    const escaped = this.parseEscape(true);
    if (typeof escaped === "string") return { kind: "literal", value: escaped };
    if (escaped.kind === "assertion")
      throw new RegexError("Word boundaries cannot appear inside a character class");
    return escaped.test;
  }

  private parseEscape(
    inClass: boolean,
  ): string | { kind: "assertion"; assertion: Assertion } | { kind: "test"; test: CharacterTest } {
    const character = this.current();
    if (character === undefined)
      throw new RegexError("The regular expression ends with an unfinished escape");
    this.position += 1;
    if (character === "d" || character === "D") {
      return { kind: "test", test: { kind: "builtin", name: "digit", negated: character === "D" } };
    }
    if (character === "w" || character === "W") {
      return { kind: "test", test: { kind: "builtin", name: "word", negated: character === "W" } };
    }
    if (character === "s" || character === "S") {
      return { kind: "test", test: { kind: "builtin", name: "space", negated: character === "S" } };
    }
    if (character === "b") {
      return inClass ? "\b" : { kind: "assertion", assertion: "word-boundary" };
    }
    if (character === "n") return "\n";
    if (character === "r") return "\r";
    if (character === "t") return "\t";
    if (character === "f") return "\f";
    if (character === "v") return "\v";
    if (character === "0") {
      if (isDigit(this.current())) throw new RegexError("Octal escapes are not supported");
      return "\0";
    }
    if (character === "x") return this.readHexEscape(2);
    if (character === "u") return this.readHexEscape(4);
    if (isDigit(character)) throw new RegexError("Backreferences are not supported");
    if (isAsciiLetter(character))
      throw new RegexError(`The escape \\${character} is not supported`);
    return character;
  }

  private readHexEscape(length: number): string {
    const digits = this.characters.slice(this.position, this.position + length).join("");
    let valid = digits.length === length;
    for (const digit of digits) {
      if (!isHexDigit(digit)) valid = false;
    }
    if (!valid) {
      throw new RegexError("A hexadecimal escape has the wrong number of digits");
    }
    this.position += length;
    return String.fromCharCode(Number.parseInt(digits, 16));
  }
}

interface Patch {
  instruction: number;
  field: "out" | "first" | "second";
}

interface Fragment {
  start: number;
  exits: Patch[];
}

type Instruction =
  | { op: "character"; test: CharacterTest; out?: number }
  | { op: "split"; first?: number; second?: number }
  | { op: "jump"; out?: number }
  | { op: "save"; slot: number; out?: number }
  | { op: "assert"; assertion: Assertion; out?: number }
  | { op: "match" };

class Compiler {
  private readonly instructions: Instruction[] = [];

  compile(root: Node, captureCount: number): RegexProgram {
    const body = this.compileNode(root);
    const match = this.emit({ op: "match" });
    this.patch(body.exits, match);
    return { instructions: this.instructions, start: body.start, captureCount };
  }

  private emit(instruction: Instruction): number {
    if (this.instructions.length >= MAX_PROGRAM_LENGTH) {
      throw new RegexError(
        "The regular expression is too complex (limit " +
          String(MAX_PROGRAM_LENGTH) +
          " instructions)",
      );
    }
    this.instructions.push(instruction);
    return this.instructions.length - 1;
  }

  private patch(exits: Patch[], target: number): void {
    for (const exit of exits) {
      const instruction = this.instructions[exit.instruction];
      if (!instruction) throw new RegexError("The regular expression could not be compiled");
      if (exit.field === "out" && instruction.op !== "split" && instruction.op !== "match") {
        instruction.out = target;
      } else if (exit.field === "first" && instruction.op === "split") {
        instruction.first = target;
      } else if (exit.field === "second" && instruction.op === "split") {
        instruction.second = target;
      } else {
        throw new RegexError("The regular expression could not be compiled");
      }
    }
  }

  private empty(): Fragment {
    const instruction = this.emit({ op: "jump" });
    return { start: instruction, exits: [{ instruction, field: "out" }] };
  }

  private concatenate(first: Fragment, second: Fragment): Fragment {
    this.patch(first.exits, second.start);
    return { start: first.start, exits: second.exits };
  }

  private compileNode(node: Node): Fragment {
    switch (node.kind) {
      case "empty":
        return this.empty();
      case "character": {
        const instruction = this.emit({ op: "character", test: node.test });
        return { start: instruction, exits: [{ instruction, field: "out" }] };
      }
      case "assertion": {
        const instruction = this.emit({ op: "assert", assertion: node.assertion });
        return { start: instruction, exits: [{ instruction, field: "out" }] };
      }
      case "sequence": {
        let fragment = this.empty();
        for (const child of node.children)
          fragment = this.concatenate(fragment, this.compileNode(child));
        return fragment;
      }
      case "choice": {
        const children = node.children.map((child) => this.compileNode(child));
        let fragment = children.at(-1) ?? this.empty();
        for (let index = children.length - 2; index >= 0; index -= 1) {
          const preferred = children[index];
          if (!preferred) throw new RegexError("The regular expression could not be compiled");
          const split = this.emit({ op: "split", first: preferred.start, second: fragment.start });
          fragment = { start: split, exits: [...preferred.exits, ...fragment.exits] };
        }
        return fragment;
      }
      case "group": {
        const child = this.compileNode(node.child);
        if (node.index === undefined) return child;
        const open = this.emit({ op: "save", slot: (node.index - 1) * 2 });
        this.patch([{ instruction: open, field: "out" }], child.start);
        const close = this.emit({ op: "save", slot: (node.index - 1) * 2 + 1 });
        this.patch(child.exits, close);
        return { start: open, exits: [{ instruction: close, field: "out" }] };
      }
      case "repeat":
        return this.compileRepeat(node);
    }
  }

  private compileRepeat(node: Extract<Node, { kind: "repeat" }>): Fragment {
    let fragment: Fragment | undefined;
    for (let count = 0; count < node.min; count += 1) {
      const child = this.compileNode(node.child);
      fragment = fragment ? this.concatenate(fragment, child) : child;
    }
    if (node.max === undefined) {
      const loop = this.compileStar(node.child, node.greedy);
      return fragment ? this.concatenate(fragment, loop) : loop;
    }
    for (let count = node.min; count < node.max; count += 1) {
      const optional = this.compileOptional(node.child, node.greedy);
      fragment = fragment ? this.concatenate(fragment, optional) : optional;
    }
    return fragment ?? this.empty();
  }

  private compileStar(childNode: Node, greedy: boolean): Fragment {
    const child = this.compileNode(childNode);
    const split = this.emit(
      greedy ? { op: "split", first: child.start } : { op: "split", second: child.start },
    );
    this.patch(child.exits, split);
    return {
      start: split,
      exits: [{ instruction: split, field: greedy ? "second" : "first" }],
    };
  }

  private compileOptional(childNode: Node, greedy: boolean): Fragment {
    const child = this.compileNode(childNode);
    const split = this.emit(
      greedy ? { op: "split", first: child.start } : { op: "split", second: child.start },
    );
    return {
      start: split,
      exits: [...child.exits, { instruction: split, field: greedy ? "second" : "first" }],
    };
  }
}

export interface RegexProgram {
  readonly instructions: readonly Instruction[];
  readonly start: number;
  readonly captureCount: number;
}

export interface RegexMatch {
  start: number;
  end: number;
  captures: readonly (string | undefined)[];
}

interface CaptureTag {
  previous: CaptureTag | null;
  slot: number;
  position: number;
}

interface Thread {
  pc: number;
  start: number;
  captures: CaptureTag | null;
}

interface Candidate {
  thread: Thread;
  end: number;
}

class StepBudget {
  private remaining = MAX_STEPS;

  step(): void {
    this.remaining -= 1;
    if (this.remaining < 0) {
      throw new RegexError(
        `The regular expression exceeded its ${MAX_STEPS.toLocaleString("en-US")} step limit`,
      );
    }
  }
}

export function compileRegex(pattern: string): RegexProgram {
  const parser = new Parser(pattern);
  return new Compiler().compile(parser.parse(), parser.captureCount);
}

/** Searches using a prioritized Thompson NFA, with one shared step budget per formula call. */
export class RegexRunner {
  private readonly budget = new StepBudget();
  private indexedText: string | undefined;
  private indexedCharacters: string[] | undefined;
  private indexedOffsets: number[] | undefined;

  constructor(private readonly program: RegexProgram) {}

  find(text: string, from = 0): RegexMatch | undefined {
    if (this.indexedText !== text) {
      this.indexedText = text;
      this.indexedCharacters = isAscii(text) ? undefined : graphemes(text);
      this.indexedOffsets = this.indexedCharacters
        ? this.indexedCharacters.reduce<number[]>(
            (positions, character) => {
              positions.push((positions.at(-1) ?? 0) + character.length);
              return positions;
            },
            [0],
          )
        : undefined;
    }
    let seeds: Thread[] = [];
    let fallback: Candidate | undefined;
    const firstPosition = Math.max(0, Math.min(text.length, from));
    const characters = this.indexedCharacters;
    const offsets = this.indexedOffsets;
    let characterIndex = 0;
    let position = firstPosition;
    if (offsets) {
      let low = 0;
      let high = offsets.length;
      while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if ((offsets[middle] ?? Infinity) < firstPosition) low = middle + 1;
        else high = middle;
      }
      characterIndex = Math.min(low, characters?.length ?? 0);
      position = offsets[characterIndex] ?? text.length;
    }

    while (position <= text.length) {
      const roots = seeds.slice();
      if (!fallback) roots.push({ pc: this.program.start, start: position, captures: null });
      const before = characters ? characters[characterIndex - 1] : text[position - 1];
      const current = characters ? characters[characterIndex] : text[position];
      const closure = this.expand(roots, text, position, before, current);
      if (closure.match) fallback = { thread: closure.match, end: position };
      if (fallback && closure.threads.length === 0) return this.result(fallback, text);
      if (position === text.length) return fallback ? this.result(fallback, text) : undefined;

      const next: Thread[] = [];
      const character = characters ? characters[characterIndex] : text.charAt(position);
      for (const thread of closure.threads) {
        this.budget.step();
        const instruction = this.instruction(thread.pc);
        if (instruction.op === "character" && character && matches(instruction.test, character)) {
          next.push({ ...thread, pc: this.target(instruction.out) });
        }
      }
      if (fallback && next.length === 0) return this.result(fallback, text);
      seeds = next;
      if (offsets) {
        characterIndex += 1;
        position = offsets[characterIndex] ?? text.length;
      } else {
        position += 1;
      }
    }
    return undefined;
  }

  private expand(
    roots: Thread[],
    text: string,
    position: number,
    before: string | undefined,
    current: string | undefined,
  ): { threads: Thread[]; match: Thread | undefined } {
    const stack = roots.reverse();
    const visited = new Set<number>();
    const threads: Thread[] = [];
    while (stack.length > 0) {
      const thread = stack.pop();
      if (!thread) continue;
      this.budget.step();
      if (visited.has(thread.pc)) continue;
      visited.add(thread.pc);
      const instruction = this.instruction(thread.pc);
      switch (instruction.op) {
        case "character":
          threads.push(thread);
          break;
        case "split":
          stack.push({ ...thread, pc: this.target(instruction.second) });
          stack.push({ ...thread, pc: this.target(instruction.first) });
          break;
        case "jump":
          stack.push({ ...thread, pc: this.target(instruction.out) });
          break;
        case "save":
          stack.push({
            ...thread,
            pc: this.target(instruction.out),
            captures: { previous: thread.captures, slot: instruction.slot, position },
          });
          break;
        case "assert":
          if (asserts(instruction.assertion, text, position, before, current)) {
            stack.push({ ...thread, pc: this.target(instruction.out) });
          }
          break;
        case "match":
          return { threads, match: thread };
      }
    }
    return { threads, match: undefined };
  }

  private result(candidate: Candidate, text: string): RegexMatch {
    const values: (number | undefined)[] = [];
    for (let slot = 0; slot < this.program.captureCount * 2; slot += 1) values.push(undefined);
    let missing = values.length;
    for (let tag = candidate.thread.captures; tag && missing > 0; tag = tag.previous) {
      this.budget.step();
      if (values[tag.slot] === undefined) {
        values[tag.slot] = tag.position;
        missing -= 1;
      }
    }
    const captures: (string | undefined)[] = [];
    for (let group = 0; group < this.program.captureCount; group += 1) {
      const start = values[group * 2];
      const end = values[group * 2 + 1];
      captures.push(start === undefined || end === undefined ? undefined : text.slice(start, end));
    }
    return {
      start: candidate.thread.start,
      end: candidate.end,
      captures,
    };
  }

  private instruction(pc: number): Instruction {
    const instruction = this.program.instructions[pc];
    if (!instruction) throw new RegexError("The regular expression program is invalid");
    return instruction;
  }

  private target(target: number | undefined): number {
    if (target === undefined) throw new RegexError("The regular expression program is incomplete");
    return target;
  }
}

function matches(test: CharacterTest, character: string): boolean {
  switch (test.kind) {
    case "literal":
      return character === test.value;
    case "range": {
      const code = character.codePointAt(0) ?? 0;
      return code >= (test.first.codePointAt(0) ?? 0) && code <= (test.last.codePointAt(0) ?? 0);
    }
    case "any":
      return (
        !character.includes("\n") &&
        !character.includes("\r") &&
        !character.includes("\u2028") &&
        !character.includes("\u2029")
      );
    case "builtin": {
      const result = builtin(test.name, character);
      return test.negated ? !result : result;
    }
    case "class": {
      const result = test.terms.some((term) => matches(term, character));
      return test.negated ? !result : result;
    }
  }
}

function builtin(name: BuiltinClass, character: string): boolean {
  const first = character.charAt(0);
  switch (name) {
    case "digit":
      return first >= "0" && first <= "9";
    case "word":
      return (
        (first >= "A" && first <= "Z") ||
        (first >= "a" && first <= "z") ||
        (first >= "0" && first <= "9") ||
        first === "_"
      );
    case "space":
      return first.trim() === "";
  }
}

function asserts(
  assertion: Assertion,
  text: string,
  position: number,
  before: string | undefined,
  current: string | undefined,
): boolean {
  switch (assertion) {
    case "start":
      return position === 0;
    case "end":
      return position === text.length;
    case "word-boundary":
      return isWordCharacter(before) !== isWordCharacter(current);
  }
}

function isWordCharacter(character: string | undefined): boolean {
  return character !== undefined && builtin("word", character);
}

function isDigit(character: string | undefined): boolean {
  return character !== undefined && character >= "0" && character <= "9";
}

function isAsciiLetter(character: string): boolean {
  return (character >= "A" && character <= "Z") || (character >= "a" && character <= "z");
}

function isHexDigit(character: string): boolean {
  return (
    isDigit(character) ||
    (character >= "a" && character <= "f") ||
    (character >= "A" && character <= "F")
  );
}
