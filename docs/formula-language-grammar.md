# Formula language grammar

This specification describes the strict formula expression parser in [`tokenizer.ts`](../packages/engine/src/tokenizer.ts) and [`parser.ts`](../packages/engine/src/parser.ts). It covers syntax only. The parser does not resolve names, check whether a function exists, or validate a reference against a workbook.

`parseFormula(text)` accepts an expression body without a leading `=`. A cell input beginning with `=` and at least one following character is parsed as a formula after the workbook removes that first character. The lone cell input `=` is not classified as a formula. Page formulas and named formulas also strip a first `=` at their workbook entry points. A direct call to `parseFormula("=1")` fails. After parsing an expression, the parser requires the next token to be end-of-input.

## Lexical grammar

The tokenizer discards JavaScript `\s` whitespace between tokens. Whitespace inside a quoted string or quoted name is part of its value. Whitespace around calls, commas, range colons, and `!` qualifiers is accepted. A table name and its structured column token must touch: `Sales[Price]` is valid, while `Sales [Price]` is not.

The notation below describes token forms; the prose after it records tokenizer checks that EBNF does not express.

```ebnf
Digit             = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" ;
Digits            = Digit, { Digit } ;
Number            = Digits, [ ".", { Digit } ], [ Exponent ]
                  | ".", Digit, { Digit }, [ Exponent ] ;
Exponent          = ( "e" | "E" ), [ "+" | "-" ], Digits ;

String            = DQUOTE, { NonDQuote | DQUOTE, DQUOTE }, DQUOTE ;
QuotedName        = APOSTROPHE, { NonApostrophe | APOSTROPHE, APOSTROPHE }, APOSTROPHE ;

Identifier        = IdentifierStart, { IdentifierContinue } ;
IdentifierStart   = "$" | Letter | "_" ;
IdentifierContinue = "$" | Letter | Digit | "_" | "." ;
Letter            = "A" … "Z" | "a" … "z" ;

ColumnToken       = "[", ColumnText, "]" ;
ColumnText        = ? nonempty text before the first "]", with no "[" and outer whitespace trimmed ? ;
NonDQuote         = ? any character other than DQUOTE ? ;
NonApostrophe     = ? any character other than APOSTROPHE ? ;
ErrorLiteral      = "#DIV/0!" | "#VALUE!" | "#REF!" | "#NAME?" | "#N/A"
                  | "#SPILL!" | "#CYCLE!" | "#ASSERT!" | "#ERROR!" ;
Operator          = "<>" | "!=" | "<=" | ">=" | "+" | "-" | "*" | "/"
                  | "^" | "&" | "=" | "<" | ">" ;
Punctuation       = "(" | ")" | "," | ":" | "!" ;
DQUOTE            = '"' ;
APOSTROPHE        = "'" ;
```

Token details:

- The number pattern accepts integers, `3.14`, `.5`, `5.`, and decimal or integer exponents such as `1.5E-2` and `2e+2`. A sign is a separate unary operator, not part of a number token. The tokenizer rejects a number whose JavaScript numeric value is not finite, such as `1e999`.
- A double-quoted string escapes a double quote by doubling it: `"say ""hi"""` has the value `say "hi"`. Backslashes have no escape meaning. A string may be empty.
- A single-quoted name escapes an apostrophe by doubling it: `'Joe''s Table'` has the value `Joe's Table`. Single quotes do not delimit text strings; a quoted name by itself is a name expression.
- The tokenizer accepts an empty quoted name `''`; the parser creates an empty name that later name resolution may reject.
- Identifiers preserve their spelling in tokens. They can start with `$`, a letter, or `_`; later characters can also include digits and periods. The parser interprets some identifier tokens as cell addresses, booleans, function names, or references depending on context.
- A column token ends at the first `]`. The tokenizer trims whitespace from its contents, rejects an empty name and any nested `[`, and provides no escape for `]`. The closing `]` is required in strict parsing.
- Error literals are recognized by exact spelling from the list shown. A `#` that does not start one of those literals is an unexpected character.
- There is no date literal token. Dates come from cell values or formula functions; an unquoted word is an identifier.
- Two-character operators are checked before one-character operators. `!=` and `<>` are both inequality operators.
- The strict tokenizer rejects all other characters. It has no comment syntax. In particular, `//` is not a comment, and `??` is not an operator; `?` is rejected unless it is part of a recognized error token. The editor's `tokenizeForEditing` path tolerates unfinished quotes, brackets, and invalid characters to support editing, but those inputs are not valid formulas.

## Syntactic grammar

The grammar operates on the tokens above. Productions use parser predicates described below to distinguish a name from a reference when both start with an identifier token.

```ebnf
FormulaBody        = Expression ;
Expression         = Comparison ;
Comparison         = Concatenation, { ComparisonOperator, Concatenation } ;
ComparisonOperator = "=" | "<>" | "!=" | "<" | ">" | "<=" | ">=" ;
Concatenation      = Addition, { "&", Addition } ;
Addition           = Multiplication, { ( "+" | "-" ), Multiplication } ;
Multiplication     = Power, { ( "*" | "/" ), Power } ;
Power              = Unary, { "^", Unary } ;
Unary              = ( "+" | "-" ), Unary | Postfix ;
Postfix            = Primary, { ArgumentList } ;
ArgumentList       = "(", [ Expression, { ",", Expression } ], ")" ;

Primary            = Number
                   | String
                   | Boolean
                   | ErrorLiteral
                   | Reference
                   | Name
                   | "(", Expression, ")" ;
Boolean            = Identifier ; (* identifier text TRUE or FALSE, case-insensitive *)
Name               = Identifier | QuotedName ;

Reference          = CellOrRange
                   | ColumnToken
                   | Name, ColumnToken
                   | Name, "!", Name, ColumnToken
                   | Name, "!", CellOrRange
                   | Name, "!", Name, "!", CellOrRange
                   | Name, "!", Name
                   | Name, "!", Name, "!", Name ;
CellOrRange        = CellAddress | Corner, ":", Corner ;
CellAddress        = ColumnLetters, RowNumber ;
Corner             = ColumnLetters | RowNumber | CellAddress ;
ColumnLetters      = [ "$" ], Letter, [ Letter, [ Letter ] ] ;
RowNumber          = [ "$" ], NonZeroDigit, { Digit } ;
NonZeroDigit       = "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" ;
```

Reference productions have these interpretations:

- `[Price]` refers to the named column in the current row. `Sales[Price]` refers to a whole column of the named table. `'Page 1'!Sales[Price]` refers to that column on another page. The table name and `[Column]` token must be adjacent.
- `A1` is a cell. `A1:B2` is a rectangular range. A range corner can name only a column or only a row: `A:C`, `2:5`, `A2:A`, `A1:4`, `$A:$C`, and `$2:$5` are accepted. Absolute `$` markers are stored per axis. A partial corner such as `A` or `$7` is a reference only as part of a range; by itself it is a name.
- `Table!A1` qualifies a cell or range with a table on the current page. `Page!Table!A1` adds a page qualifier. Names can be single-quoted where needed, and doubled apostrophes escape a quote in a name.
- `Table!Total` is a qualified name held by `Table`; `Page!Table!Total` is a qualified name held by `Table` on `Page`. A two-part form such as `Page!Total` is parsed as a name held by `Page`, not as a cross-page name. A cross-page reference uses the three-part form.
- Reference parsing is contextual. A bare identifier matching a complete cell address with one to three letters, optional absolute markers, and a positive row number is a cell reference. A bare identifier that is only a column label, such as `A`, `AB`, or `ABC`, is a name unless a range colon follows. A token that looks like a partial column or row after `!` is a qualified name unless a colon makes it a range.
- The address pattern accepts one to three ASCII letters and a row spelling that starts with `1` through `9`, followed by zero or more digits. The parser does not validate a reference against table dimensions. It converts row digits with JavaScript `Number` without a separate finite check, so an extremely long row spelling can produce an infinite row index. A row or column outside the current workbook is handled later during reference resolution.
- Whitespace is ignored between tokens, so `Sales ! A1 : B2` parses as a qualified range. Whitespace between the table name and its structured column token prevents that structured-reference parse.
- A bare identifier followed by arguments is a call by name unless it is a cell address; `SUM(1, 2)` is a named call. Parentheses after a cell reference call the value in that cell: `A1(5)`. Parentheses may follow any primary or prior call, so `(f)(1)(2)` is also syntactically valid. The parser does not check whether a name is bound to a function.
- Bare `TRUE` and `FALSE` are booleans regardless of letter case. If either identifier is followed by an argument list, the parser treats it as a call name before checking for a boolean.
- Function calls may have zero arguments. An empty formula, empty grouping parentheses, a trailing argument comma, a missing closing delimiter, or any leftover token is a syntax error.

The operator grammar above gives the following precedence, from highest to lowest. Repetition at each binary level is left-associative.

| Precedence | Operators                             | Associativity                        |
| ---------- | ------------------------------------- | ------------------------------------ |
| Highest    | Calls and parenthesized expressions   | Calls apply from left to right.      |
|            | Unary `+`, unary `-`                  | Prefix; binds more tightly than `^`. |
|            | `^`                                   | Left-associative.                    |
|            | `*`, `/`                              | Left-associative.                    |
|            | `+`, `-`                              | Left-associative.                    |
|            | `&`                                   | Left-associative.                    |
| Lowest     | `=`, `<>`, `!=`, `<`, `>`, `<=`, `>=` | Left-associative.                    |

Consequences include `-2^2` parsing as `(-2)^2`, `2^3^2` parsing as `(2^3)^2`, and `1&2=3` parsing as `(1&2)=3`. Parentheses can override these rules. `:` and `!` are reference punctuation, not operators in the expression tree. `=` is equality, not assignment. `AND`, `OR`, and `NOT` are function calls, not operators. There is no `??` operator.

## Worked examples

| Formula body                 | Parse                                                                        |
| ---------------------------- | ---------------------------------------------------------------------------- |
| `1 + 2 * 3`                  | `binary("+", 1, binary("*", 2, 3))`                                          |
| `-2^2`                       | `binary("^", unary("-", 2), 2)`                                              |
| `1&2=3`                      | `binary("=", binary("&", 1, 2), 3)`                                          |
| `Sales[Price]`               | `reference({ table: "Sales", column: "Price" })`                             |
| `'Page 1'!Sales[Unit Price]` | `reference({ page: "Page 1", table: "Sales", column: "Unit Price" })`        |
| `Sales!A1:B`                 | `reference({ table: "Sales", start: A1, end: B })`; `B` leaves the row open. |
| `A1(5)`                      | `apply(reference(A1), [5])`                                                  |
| `SUM()`                      | `call("SUM", [])`                                                            |

## Related expression languages and tests

Text-view tags `{{ ... }}` parse formula expressions through the template engine. The surrounding `{% let %}`, `{% for %}`, and conditional directives form a separate template language; see [`template.ts`](../packages/engine/src/template.ts) and the text-view section of the README. The string passed to `QUERY` has its own query grammar in [`query.ts`](../packages/engine/src/query.ts), documented in the README's Queries section. Neither sub-language is specified here.

The tokenizer edge cases are covered by [`tokenizer.test.ts`](../packages/engine/src/tokenizer.test.ts). Precedence, associativity, cell/range references, qualified references, calls, and rejected syntax are covered by [`parser.test.ts`](../packages/engine/src/parser.test.ts). Structured-reference parsing, whitespace adjacency, and malformed bracket forms are covered by [`columns.test.ts`](../packages/engine/src/columns.test.ts).
