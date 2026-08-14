# Meta-BASIC Agent Instructions

## Project purpose

Meta-BASIC is a small, modern source language that transpiles into readable BASIC for classic home computers. Its first targets are the ZX Spectrum and Atari 8-bit family. Commodore BASIC V2 and other dialects may follow.

The project should preserve the character of each target machine. It is not intended to hide every hardware difference behind one universal API. Shared language features should cover program structure and genuinely portable operations; machine-specific capabilities may later be exposed through explicit target namespaces or libraries.

Generated BASIC is a development artifact, not merely an opaque intermediate file. Prefer output that a human familiar with the target dialect can read, compare with the source, load in an emulator, and debug.

## Working principles

- Keep the compiler core independent of VS Code. A future extension will call the same library and CLI.
- Prefer a small functional core: parse source into immutable data, transform it, then render a target dialect.
- Maintain an explicit pipeline: source text, tokens, syntax tree, semantic analysis, lowering, line numbering, and target rendering.
- Keep filesystem access, argument handling, and process exit behavior in a thin CLI shell.
- Use explicit TypeScript types and discriminated unions for syntax-tree nodes.
- Keep target-independent syntax and semantics out of Spectrum-specific rendering code.
- Add tests for observable language behavior before broadening the syntax.
- Produce actionable diagnostics containing the source filename and line number. Add columns when useful.
- Reject unsupported or ambiguous syntax. Do not silently emit questionable BASIC.
- Preserve existing repository content and conventions. Do not replace files created by the user unless required for this milestone.
- Do not commit, push, publish packages, create releases, or change repository settings unless the user explicitly asks.

## Runtime and tooling

- Target Node.js 24 LTS or later.
- Use TypeScript in strict mode.
- Use ECMAScript modules.
- Use npm unless the repository already establishes another package manager.
- Use `tsx` for direct development execution.
- Use Vitest for automated tests.
- Compile distributable JavaScript with `tsc` and run it with Node.
- Avoid new production dependencies for this milestone. A handwritten tokenizer and parser are sufficient for the deliberately small grammar.

If the repository already contains compatible tooling, adapt to it rather than replacing it.

## Completed milestone: first vertical slice

The first milestone established a command-line transpiler that reads one Meta-BASIC file and emits readable numbered ZX Spectrum BASIC. It supports labels, `PRINT` string literals, `GOTO`, multiline `IF/ELSE`, nested conditions, comments, deterministic line numbering, diagnostics, and CLI output.

Preserve that behavior and its tests while implementing the second milestone.

## Current milestone: tokens and expressions

Evolve the prototype from line-oriented regular-expression matching into a small source-to-source compiler with:

1. A tokenizer with source locations.
2. Centralized keyword recognition.
3. Parser dispatch based on tokens rather than a growing chain of statement regexes.
4. A typed expression syntax tree with operator precedence.
5. Compile-time constants.
6. Numeric assignments.
7. Expression rendering for ZX Spectrum BASIC.

This milestone deliberately improves the architecture before procedures, local variables, multiple files, or additional targets make the current approach expensive to replace.

### Required source syntax

The following example must compile:

```basic
const screenRows = 24
const warningRow = screenRows - 2
const initialCountdown = 5 * 12

start:
    print "WARNING"
    print "SECONDS: "; initialCountdown

    let urgency = sensorCount * 2 + alertLevel

    if confirmed and urgency >= 4 then
        print "ATTACK CONFIRMED"
    else
        print "AWAITING SECOND SOURCE AT ROW "; warningRow
    end if

    goto start
```

Continue to support:

- Blank lines
- Labels written as `name:`
- `goto label`
- Multiline `if expression then ... else ... end if`
- Nested `if` statements
- Comments beginning with an apostrophe; a comment continues to the end of the source line

Add:

- Constants written as `const name = expression`
- Numeric assignments written as `let name = expression`
- `PRINT` containing one or more expressions separated by semicolons
- Expressions in `IF`, `CONST`, `LET`, and `PRINT`

Keywords and symbol lookup are case-insensitive. Preserve the source spelling of identifiers where practical and preserve string contents exactly. Identifiers may contain ASCII letters, digits, and underscores, but must begin with a letter or underscore. String variables and `$` suffixes remain out of scope; string literals are supported for output.

### Tokenizer

Replace statement recognition based on independent whole-line regular expressions with a tokenizer. A small regular expression may still be used internally for scanning a token category, but parsing decisions must operate on tokens.

At minimum, tokenize:

- Identifiers
- Keywords
- Numeric literals
- String literals
- Operators
- Parentheses
- Colon
- Semicolon
- Newline
- End of file

Every token must retain its filename, line, and column. Comments may be discarded by the tokenizer, but newlines must remain available to the parser because statements are line-oriented.

Define keywords in one centralized, case-insensitive set. Do not add one lexer branch or regular expression for every keyword. The initial keyword set includes:

```text
AND CONST ELSE END FALSE GOTO IF LET NOT OR PRINT THEN TRUE
```

The parser may use a `Map` or equivalent dispatch table from leading statement keyword to its parser. Block delimiters such as `ELSE` and `END IF` remain the responsibility of the enclosing block parser.

Keywords inside string literals or comments must never be interpreted as syntax.

### Expression grammar

Build expressions as discriminated-union AST nodes. Do not retain expressions as unvalidated text.

Support:

- Numeric literals, including a decimal fraction
- String literals
- Identifiers
- Parenthesized expressions
- Unary `-`
- Unary `NOT`
- Arithmetic `+`, `-`, `*`, `/`
- Comparisons `=`, `<>`, `<`, `<=`, `>`, `>=`
- Logical `AND`, `OR`
- Boolean literals `TRUE` and `FALSE`

Use this precedence from highest to lowest:

1. Parentheses and primary expressions
2. Unary `-`, `NOT`
3. `*`, `/`
4. `+`, `-`
5. `=`, `<>`, `<`, `<=`, `>`, `>=`
6. `AND`
7. `OR`

All binary operators are left-associative. Comparison chaining such as `a < b < c` is not supported and must produce a diagnostic suggesting `a < b AND b < c`.

A handwritten Pratt parser or precedence-based recursive-descent parser is appropriate. Do not introduce a parser-generator dependency.

### Constants

`CONST` declarations are compile-time only and emit no BASIC line:

```basic
const screenRows = 24
const warningRow = screenRows - 2
```

Requirements:

- A constant expression may reference an earlier constant.
- Constant references are case-insensitive.
- Reject duplicate constant names, including names differing only by case.
- Reject references to unknown constants while evaluating a constant declaration.
- Reject circular references if forward constant references are deliberately supported. Supporting forward references is optional for this milestone.
- Evaluate arithmetic, comparison, logical, unary, parenthesized, numeric, string, and boolean constant expressions where meaningful.
- Report invalid combinations such as subtracting strings.
- `TRUE` lowers to numeric `1`; `FALSE` lowers to numeric `0` for Spectrum output.
- Substitute constants into runtime expressions and fold subexpressions made entirely from constants.
- Division by zero in a constant expression is a compile-time diagnostic.

String concatenation with `+` may be supported if it is straightforward and tested. No other implicit string/number conversions are required.

### Assignments

Support numeric assignment:

```basic
let urgency = sensorCount * 2 + alertLevel
```

Render it as Spectrum BASIC `LET`. Constants cannot be assigned to. A name already declared as a constant must produce a clear diagnostic when used as an assignment target.

Do not add variable declarations or a full type system. Variables first encountered in expressions or assignment targets are runtime numeric variables for this milestone.

### PRINT expressions

Support semicolon-separated `PRINT` items:

```basic
print "SECONDS: "; countdown
```

The generated Spectrum statement must preserve the semicolon-separated form. A trailing semicolon remains significant and suppresses the newline:

```basic
print "WAIT";
```

Commas, apostrophe print separators, `PRINT AT`, colour controls, and streams remain out of scope.

An `ELSE` block remains optional. Every opened `IF` must have a matching `END IF`.

### Spectrum output semantics

- Generate line numbers beginning at 10 in increments of 10.
- Render keywords in uppercase.
- Render a source label as a readable `REM` line and resolve jumps to that line number.
- Reject duplicate labels.
- Reject references to undefined labels.
- Lower multiline `IF/ELSE` into Spectrum-compatible `IF ... THEN GO TO`, unconditional `GO TO`, and generated internal labels.
- Generated internal labels must never collide with user labels.
- Do not depend on a native Spectrum `ELSE` construct.
- Keep one BASIC statement per generated line for this milestone.
- Prefer deterministic output: identical input and options must produce byte-for-byte identical BASIC.
- Render expressions from the AST with only the parentheses needed to preserve meaning. Extra harmless parentheses are acceptable initially if output remains readable and deterministic.
- Use Spectrum spellings for supported operators: `NOT`, `AND`, `OR`, `=`, and `<>`.
- Emit numeric constants using a deterministic culture-independent format with `.` as decimal separator.

The exact lowering strategy is an implementation decision, but the visible behavior must be covered by golden-output tests.

### CLI

Support this development command:

```text
npm run dev -- examples/warning.mbas --target spectrum
```

Default to writing generated BASIC to standard output. Also support:

```text
--output path/to/program.bas
```

Accept `-o` as its short form. Return a nonzero exit code for invalid arguments, file errors, syntax errors, or generation errors. Write diagnostics to standard error.

Only `spectrum` is a valid target in this milestone. Do not accept a target and silently substitute another.

### Suggested structure

Use this structure unless existing repository conventions suggest a better equivalent:

```text
src/
  ast.ts
  diagnostics.ts
  lexer.ts
  parser.ts
  lowering.ts
  line-numbering.ts
  compiler.ts
  cli.ts
  targets/
    spectrum.ts
test/
  parser.test.ts
  spectrum.test.ts
examples/
  warning.mbas
```

Keep target-independent parsing and lowering separate from Spectrum rendering. It must be possible to add an Atari backend later without putting target checks throughout the parser.

This is a suggested separation, not a requirement to create empty or one-function files. Prefer cohesive modules over ceremonial architecture.

### Required tests

Preserve all first-milestone tests and add, at minimum:

- Token locations for representative tokens
- Keywords inside strings and comments
- Case-insensitive centralized keyword recognition
- Every supported primary, unary, binary, comparison, and logical expression form
- Operator precedence and left associativity
- Parentheses overriding precedence
- Rejection of comparison chaining
- Missing operand and unmatched-parenthesis diagnostics
- Constant declaration and substitution
- Constants referencing earlier constants
- Duplicate and unknown constant diagnostics
- Assignment to a constant diagnostic
- Constant folding and division-by-zero diagnostic
- `TRUE` and `FALSE` lowering
- Numeric `LET` output
- `PRINT` with multiple items and with a trailing semicolon
- Exact output for the updated warning example
- Existing CLI behavior after the parser replacement

Prefer focused unit tests plus a small number of CLI integration tests. Test precedence boundaries and representative combinations; do not attempt an exhaustive Cartesian product of every operator and operand form.

### Package scripts

Provide equivalent scripts for:

```text
npm run dev -- <arguments>
npm run build
npm test
npm run test:watch
npm start -- <arguments>
```

`npm start` must execute the compiled JavaScript, not `tsx`.

### Documentation

Add or update the README with:

- The project’s purpose
- Its experimental status
- Node.js 24 LTS prerequisite
- Installation and build commands
- The supported milestone syntax
- One source-to-Spectrum example
- An explicit limitations section

Do not claim support for machines or constructs that are only planned.

## Explicitly out of scope for this milestone

Do not implement any of the following unless the user expands the task:

- Atari, Commodore, CPC, or other backends
- Variable declarations, local variables, procedures, or functions
- Multiple source files, imports, or linking
- A type system beyond the limited constant-expression checks described above
- String variables
- Arrays
- Functions or function calls in expressions
- Exponentiation
- Optimization or minification
- BASIC tokenization or TAP generation
- Calling `bas2tap`
- Assembly routines, PRG packaging, or native runtime libraries
- Source maps
- A VS Code extension, syntax highlighting, or language server
- A parser-generator framework
- CI workflows, npm publication, or releases

Record attractive future ideas in a short roadmap section rather than implementing them.

## Definition of done

The milestone is complete when all of the following hold:

- `npm install` succeeds on Node.js 24 LTS.
- `npm test` passes.
- `npm run build` completes without TypeScript errors.
- `npm run dev -- examples/warning.mbas --target spectrum` prints valid, readable numbered Spectrum BASIC.
- `npm start -- examples/warning.mbas --target spectrum` produces the same output after building.
- Diagnostics for malformed source identify the filename and source line.
- The README accurately describes the implemented behavior and limitations.
- The parser makes syntactic decisions from tokens rather than whole-line statement regexes.
- Expressions are represented as typed AST nodes and rendered from that tree.
- Constants are evaluated at compile time and emit no BASIC statements.
- The final report lists changed files, verification commands, and any remaining limitations.

Once these conditions hold, stop. Do not proceed into the next milestone automatically.
