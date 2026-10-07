# Formula language rules

How functions, operators, and syntax should behave. [README.md](README.md) holds the product principles, two of which decide most questions here: prefer correct results, and treat ambiguity as an error. The implementation rules for functions are in [CLAUDE.md](../../CLAUDE.md) under "Design rules".

## An embedded language does not contradict the formula language

The aim is one expression language everywhere a formula is written; [the proposal](../../plans/formula-language-proposal.md) describes it. rowz is not there. `QUERY` takes its own query syntax as text.

Until then, an embedded language may have its own grammar, and it must not give a formula-language token a different meaning. Single quotes delimit an identifier in a formula (`'Table 1'`), so they delimit an identifier in `QUERY` text, and double quotes delimit text in both.

An expression in the formula language means the same thing in a cell, a formula column, a filter, a script, and a text view.

## Control flow is lazy, and a computation needs all of its arguments

A function is one of two kinds, and the kind decides how it treats an argument that is an error.

- **A control-flow function chooses which of its arguments to use.** `IF`, `IFS`, `SWITCH`, and `IFERROR` evaluate only what they choose. An error in a branch that is not taken does not reach the result. Without this, a guard such as `IF(B1 = 0, 0, A1 / B1)` could not be written.
- **A computation defines its result in terms of every argument.** `CLAMP(val, min, max)` means "`val` kept within `min` and `max`". If `max` is an error, the range is not defined and neither is the result, whatever `val` is: `CLAMP(10, 20, 1/0)` is `#DIV/0!`. A computation evaluates every argument, and an error in any of them is its result.

To tell them apart, ask whether the function's meaning mentions every argument. A store clerk told to sell "at least 20 and at most some amount nobody can state" has no rule to follow, even for a customer who wants 25. A clerk told "if the customer is a member, you must [incoherent screaming]; otherwise charge full price" can operate normally for any customer who is not a member.

A function is a computation unless choosing among its arguments is its purpose. `IF`, `IFS`, `SWITCH`, `IFERROR`, and `IFNA` are the control-flow functions.

The `and` and `or` operators and the `AND` and `OR` functions are control flow as well: they stop at the first operand that decides the answer, so `B1 <> 0 and A1 / B1 > 2` is a usable guard. `ALL` and `ANY` are their computation counterparts, which evaluate every argument and return an error found in any of them. Excel's and Sheets' `AND` and `OR` evaluate everything, so this is a deliberate difference.

The engine does not do this yet. The operators call `AND` and `OR`, which evaluate every argument, and `ALL` and `ANY` do not exist. [todo.md](../../todo.md) tracks the change.

The engine's `lazy` helper is also used by functions such as `MAP` and `INDEX`, which need an argument as written (a `LAMBDA`, a reference) before evaluating it. That is an implementation need and does not make them control flow.

## Equivalent output does not require equivalent evaluation

That a function can be written in terms of another describes what it returns for arguments that have values. It does not make the function inherit the other's evaluation. `CLAMP(val, min, max)` returns what `IFS(val < min, min, val > max, max, TRUE, val)` returns, and `CLAMP` is still a computation while `IFS` is control flow.

## Familiar names keep their familiar behavior

A function that exists in Excel or Sheets takes the same arguments in the same order and returns the same result, except where that result is wrong in the sense of "Prefer correct results" in the README. A deliberate difference is stated in the function's help entry.

## Functions compose

Prefer a function that accepts and returns ordinary values and arrays, so it works inside `MAP`, `FILTER`, `LET`, and a script function, to one that works only in a particular place. A built-in function name can be passed where a `LAMBDA` is expected.

## Breaking a document is acceptable for now

rowz has no production documents. A syntax or behavior change that makes the language more consistent does not need a compatibility path. Update the samples and reference documents in the same change.

## Not planned

- Reading or writing `.xlsx`. Supporting the format means reproducing how Excel behaves. A person coming from Excel exports CSV.
- Time zones.
