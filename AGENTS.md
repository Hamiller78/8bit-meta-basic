# Meta-BASIC Agent Instructions

These instructions describe the current project state and replace any earlier AGENTS.md guidance.

## Project purpose

Meta-BASIC is a small, modern source language that transpiles into readable BASIC for classic home computers. The current implemented targets are:

- ZX Spectrum BASIC
- Atari 800XL Atari BASIC
- Commodore 64 BASIC V2

The project should preserve the character of each target machine. It is not intended to hide every hardware difference behind one universal API. Shared language features should cover program structure and genuinely portable operations; machine-specific capabilities may later be exposed through explicit target namespaces or libraries.

Generated BASIC is a development artifact, not merely an opaque intermediate file. Prefer output that a human familiar with the target dialect can read, compare with the source, load in an emulator, and debug.

## Working principles

- Keep the compiler core independent of VS Code. A future extension will call the same library and CLI.
- Prefer a small functional core: parse source into immutable data, transform it, then render a target dialect.
- Maintain the explicit pipeline: source text, tokens, syntax tree, semantic analysis, shared lowering, target lowering, line numbering, and target rendering.
- Keep filesystem access, argument handling, and process exit behavior in a thin CLI shell.
- Use explicit TypeScript types and discriminated unions for syntax-tree nodes.
- Keep target-independent syntax and semantics out of target-specific rendering code.
- Add tests for observable language behavior before broadening the syntax.
- Produce actionable diagnostics containing the source filename and line number. Add columns when useful.
- Reject unsupported or ambiguous syntax. Do not silently emit questionable BASIC.
- Preserve existing repository content and conventions. Do not replace files created by the user unless required.
- Do not commit, push, publish packages, create releases, or change repository settings unless the user explicitly asks.

## Runtime and tooling

- Target Node.js 24 LTS or later.
- Use TypeScript in strict mode.
- Use ECMAScript modules.
- Use npm unless the repository already establishes another package manager.
- Use `tsx` for direct development execution.
- Use Vitest for automated tests.
- Compile distributable JavaScript with `tsc` and run it with Node.
- Avoid new production dependencies unless there is a clear need. The current tokenizer and parser are handwritten.

If the repository already contains compatible tooling, adapt to it rather than replacing it.

## Current implemented language

The implemented Meta-BASIC syntax supports:

```basic
const warningRow = TEXT_ROWS - 2
const initialCountdown = 5 * 12

sensorCount = 1
alertLevel = 2
confirmed = 1

start:
    border_color BLUE
    cls BLUE
    print "WARNING"
    print "SECONDS: "; initialCountdown

    urgency = sensorCount * 2 + alertLevel

    if confirmed and urgency >= 4 then
        print_at warningRow, 5; "ATTACK CONFIRMED"
    else
        print "AWAITING SECOND SOURCE AT ROW "; warningRow
    end if

    goto start
```

Supported constructs:

- Blank lines
- Comments beginning with an apostrophe; comments continue to the end of the source line
- Labels written as `name:`
- `goto label`
- Multiline `if expression then ... else ... end if`
- Nested `if` statements
- Optional `else` blocks
- Target-provided environment constants `TEXT_ROWS` and `TEXT_COLUMNS`
- Portable colour constants `BLACK`, `BLUE`, `RED`, `MAGENTA`, `GREEN`, `CYAN`, `YELLOW`, and `WHITE`
- Constants written as `const name = expression`
- Numeric assignments written canonically as `name = expression`
- `print` containing one or more expressions separated by semicolons
- `print_at row, column;` followed by one or more expressions separated by semicolons
- `cls` and `cls colour`
- `border_color colour`
- Expressions in `IF`, `CONST`, assignments, and `PRINT`

Important source-language rule:

- `LET` is **not** Meta-BASIC source syntax. Assignment is `name = expression`.
- Spectrum BASIC output still renders assignments with `LET` because that is target syntax.

Keywords and symbol lookup are case-insensitive. Preserve the source spelling of identifiers where practical for readable output, but target renderers may adjust casing or names. Preserve string contents exactly. Identifiers may contain ASCII letters, digits, and underscores, but must begin with a letter or underscore. String variables and `$` suffixes are out of scope; string literals are supported for output.

## Tokenizer and parser

The parser must make syntactic decisions from tokens, not independent whole-line statement regular expressions.

The tokenizer currently handles:

- Identifiers
- Keywords
- Numeric literals
- String literals
- Operators
- Parentheses
- Colon
- Comma
- Semicolon
- Newline
- End of file

Every token retains filename, line, and column. Comments are discarded by the tokenizer, but newlines remain available to the parser because statements are line-oriented.

Keywords are defined in one centralized, case-insensitive set. Do not add one lexer branch or regular expression per keyword. Keywords inside string literals or comments must never be interpreted as syntax.

## Expression grammar

Expressions are represented as discriminated-union AST nodes. Do not retain expressions as unvalidated text.

Supported expression forms:

- Numeric literals, including decimal fractions
- String literals
- Identifiers
- Parenthesized expressions
- Unary `-`
- Unary `NOT`
- Arithmetic `+`, `-`, `*`, `/`
- Comparisons `=`, `<>`, `<`, `<=`, `>`, `>=`
- Logical `AND`, `OR`
- Boolean literals `TRUE` and `FALSE`

Precedence from highest to lowest:

1. Parentheses and primary expressions
2. Unary `-`, `NOT`
3. `*`, `/`
4. `+`, `-`
5. `=`, `<>`, `<`, `<=`, `>`, `>=`
6. `AND`
7. `OR`

Binary operators are left-associative. Comparison chaining such as `a < b < c` is rejected with a diagnostic suggesting separate comparisons joined with `AND`.

## Constants and semantic analysis

`CONST` declarations are compile-time only and emit no BASIC line.

Selected targets provide read-only, case-insensitive environment constants:

| Target | `TEXT_ROWS` | `TEXT_COLUMNS` |
| --- | ---: | ---: |
| ZX Spectrum | 22 | 32 |
| Atari 800XL | 24 | 40 |
| Commodore 64 | 25 | 40 |

Implemented requirements:

- A constant expression may reference an earlier constant.
- Constant references are case-insensitive.
- Duplicate constant names are rejected, including names differing only by case.
- Unknown constants in constant declarations are rejected.
- Arithmetic, comparison, logical, unary, parenthesized, numeric, string, and boolean constant expressions are evaluated where meaningful.
- Invalid combinations such as subtracting strings are rejected.
- Constants are substituted into runtime expressions and constant subexpressions are folded.
- Division by zero in a constant expression is a compile-time diagnostic.
- `TRUE` and `FALSE` lower to numeric representations while preserving Meta-BASIC logical semantics.
- User code cannot redeclare or assign to environment constants.

Forward constant references are not required. If added later, circular references must be diagnosed.

## Assignments

Meta-BASIC source assignment is:

```basic
urgency = sensorCount * 2 + alertLevel
```

Assignments produce the same target-independent assignment node regardless of backend. Render assignments as:

- Spectrum: `LET name=expression`
- Atari 800XL: `name=expression`
- C64: `NAME=expression` in readable mode, or compact generated names in low-readability mode

Constants cannot be assigned to. A name already declared as a constant must produce a clear diagnostic when used as an assignment target.

Do not add variable declarations or a full type system. Variables first encountered in expressions or assignment targets are runtime numeric variables for now.

## PRINT and positioned output

Semicolon-separated `PRINT` items are supported:

```basic
print "SECONDS: "; countdown
print "WAIT";
```

A trailing semicolon remains significant and suppresses the newline.

Portable positioned output is supported with the canonical `PRINT_AT` source spelling:

```basic
print_at 10, 5; "WARNING"
print_at warningRow, 0; "SECONDS: "; countdown
```

Rules:

- Coordinates are written in portable order `row, column` and are zero-based.
- A semicolon after the column expression is required.
- The row and column are full numeric expressions.
- Positioned output is represented explicitly in the target-independent AST.
- Target lowering may expand one positioned print into multiple BASIC statements.
- Constant coordinates are range-checked per target.
- Dynamic coordinates are not range-checked yet.

Out of scope for `PRINT`: comma separators, apostrophe print separators, streams, `INK`, `PAPER`, `COLOR`, and `SETCOLOR`.

## CLS, border colour, and portable colours

Supported portable colour constants are:

```text
BLACK BLUE RED MAGENTA GREEN CYAN YELLOW WHITE
```

These are semantic colours, not native target colour numbers. A colour argument must be known at compile time and resolve to a portable colour, so aliases such as `const alert_colour = RED` are supported.

Supported clear-screen forms:

```basic
cls
cls BLUE
border_color BLUE
```

`CLS` clears the text screen. `CLS colour` selects the portable background colour and then clears the screen. The colour form does not change the foreground/text colour or border colour.

`BORDER_COLOR colour` changes the target machine's border colour without changing the text/background colour.

Target lowering:

- Spectrum: `CLS`, or `PAPER targetColour` followed by `CLS`.
- Atari 800XL: `PRINT CHR$(125);`, or `SETCOLOR 2,targetHue,targetLuminance` followed by `PRINT CHR$(125);`.
- C64: `PRINT CHR$(147);`, or `POKE 53281,targetColour` followed by `PRINT CHR$(147);`.
- Border colour lowers to Spectrum `BORDER targetColour`, Atari `SETCOLOR 4,targetHue,targetLuminance`, and C64 `POKE 53280,targetColour`.

Atari colour mappings are deterministic `GRAPHICS 0` approximations and may look different across PAL, NTSC, emulator, and display configurations.

## Shared output semantics

- Generate line numbers beginning at 10 in increments of 10.
- Render target keywords in uppercase.
- Reject duplicate labels.
- Reject references to undefined labels.
- Lower multiline `IF/ELSE` into target-compatible conditional jumps, unconditional jumps, and generated internal labels.
- Generated internal labels must never collide with user labels.
- Do not depend on a native target `ELSE` construct.
- Keep one BASIC statement per generated line.
- Prefer deterministic output: identical input and options must produce byte-for-byte identical BASIC.
- Render expressions from the AST.
- Emit numeric constants using a deterministic culture-independent format with `.` as decimal separator.

## Readability option

The CLI supports:

```text
--readability 0
--readability 1
--readability 2
```

Default is `2`.

Meaning:

- `0`: compact output. Do not emit label `REM` lines. Targets may use compact runtime variable names.
- `1`: emit `REM` lines for labels written in Meta-BASIC source. For C64 output, use compact generated variable names and emit `REM Vn=ORIGINALNAME` comments at the first explicit assignment for each variable.
- `2`: emit `REM` lines for source labels and generated internal labels, and use readable variable names where the target can do so safely.

`--comments 0|1|2` is still accepted as a compatibility alias for the old label-comment option, but new documentation and tests should prefer `--readability`.

## Target semantics

### Spectrum

- Target ZX Spectrum BASIC.
- Use `GO TO`.
- Render assignments as `LET NAME=expression`.
- Render identifiers and `REM` label text in uppercase for emulator-friendly Spectrum BASIC listings. Preserve string literal contents exactly.
- Render positioned output directly as `PRINT AT row,column;...`.
- Constant coordinates must satisfy row `0..21` and column `0..31`.

### Atari 800XL

- Target Atari BASIC as built into a typical Atari 800XL.
- Do not target Turbo-BASIC XL, BASIC XL, or another extended dialect.
- Use `GOTO`.
- Render assignments without `LET`.
- Render identifiers and `REM` label text in uppercase for emulator-friendly Atari BASIC listings. Preserve string literal contents exactly.
- Lower positioned output into:

```basic
POSITION column,row
PRINT ...
```

- Constant coordinates must satisfy row `0..23` and column `0..39` for `GRAPHICS 0` text mode.
- Do not emit `GRAPHICS 0` automatically.

### Commodore 64

- Target the C64 built-in Commodore BASIC V2.
- Do not target BASIC extension cartridges or injected runtime libraries.
- Use `GOTO`.
- Render assignments without `LET`.
- Render identifiers and `REM` label text in uppercase for readable C64 listings. Preserve string literal contents exactly.
- Lower positioned output into:

```basic
POKE 214,row
POKE 211,column
SYS 58732
PRINT ...
```

- Constant coordinates must satisfy row `0..24` and column `0..39`.
- Commodore BASIC V2 distinguishes variable names by only their first two significant characters. The C64 backend must use deterministic target-lowering name mapping so distinct Meta-BASIC variables never silently alias.
- At readability `2`, preserve readable uppercase names where safely possible.
- At readability `1`, allocate compact generated variable names deterministically and comment the first explicit assignment for each variable with its source name.
- At readability `0`, allocate compact generated variable names deterministically without those variable-name comments.
- Avoid generated names that conflict with BASIC keywords. Constants are substituted and require no runtime variable name.

## Logical semantics across targets

Meta-BASIC logical operators mean logical truth over numeric values, with zero false and nonzero true. Target backends must preserve that meaning even where a target BASIC implements `NOT`, `AND`, or `OR` as bitwise integer operations or represents true differently. Keep required normalization in target lowering or expression rendering, not in the parser.

## CLI

Supported development commands:

```text
npm run dev -- examples/warning.mbas --target spectrum
npm run dev -- examples/warning.mbas --target atari800xl
npm run dev -- examples/warning.mbas --target c64
```

Compiled commands after `npm run build`:

```text
npm start -- examples/warning.mbas --target spectrum
npm start -- examples/warning.mbas --target atari800xl
npm start -- examples/warning.mbas --target c64
```

Default output is standard output. Also support:

```text
--output path/to/program.bas
-o path/to/program.bas
```

Valid targets are only `spectrum`, `atari800xl`, and `c64`. Do not accept a target and silently substitute another. Keep target selection typed and centralized.

Invalid arguments, file errors, syntax errors, semantic errors, and generation errors must return a nonzero exit code and write diagnostics to standard error.

## Project structure

Current structure:

```text
src/
  ast.ts
  diagnostics.ts
  lexer.ts
  parser.ts
  semantic.ts
  lowering.ts
  line-numbering.ts
  compiler.ts
  cli.ts
  symbols.ts
  targets/
    target.ts
    index.ts
    spectrum.ts
    atari800xl.ts
    c64.ts
test/
  lexer.test.ts
  parser.test.ts
  spectrum.test.ts
  atari800xl.test.ts
  c64.test.ts
examples/
  warning.mbas
```

Keep target-independent parsing and semantic analysis separate from all target rendering. Shared control-flow lowering may produce a neutral lowered representation, while target-specific lowering may expand operations such as positioned printing and normalize target quirks.

## Testing expectations

Preserve existing tests when changing behavior, updating goldens only when the behavioral change is intentional.

Coverage currently includes:

- Token locations
- Keywords inside strings and comments
- Case-insensitive centralized keyword recognition
- Expression forms, precedence, associativity, and parentheses
- Comparison chaining diagnostics
- Missing operand and unmatched-parenthesis diagnostics
- Constant declaration, substitution, folding, and diagnostics
- Assignment to constant diagnostics
- `TRUE` and `FALSE` lowering
- Numeric assignment output
- Multi-item `PRINT` and trailing semicolons
- Rejection of source `LET`
- `PRINT_AT` parsing and malformed coordinate diagnostics
- Spectrum target `PRINT AT` output
- Atari `POSITION` expansion
- C64 `POKE`/`SYS` expansion
- Coordinate range diagnostics for all targets
- Deterministic C64 variable-name mapping, including two-character collisions
- Uppercase output casing for Spectrum, Atari, and C64
- Logical truth normalization
- Exact warning example output for all targets
- CLI target selection, output files, compact readability, and invalid target rejection

## Documentation expectations

README.md should accurately describe:

- Project purpose and experimental status
- Node.js 24 LTS prerequisite
- Installation, test, build, dev, and start commands
- Supported syntax
- One source-to-Spectrum example
- The same positioned-output example rendered for Spectrum, Atari 800XL, and C64
- Readability options
- That target output is readable BASIC text
- That packaging into TAP, ATR, PRG, or tokenized BASIC is not implemented
- Explicit limitations

Do not claim support for machines or constructs that are only planned.

## Explicitly out of scope unless requested

- CPC or other additional backends
- Variable declarations, local variables, procedures, or functions
- Multiple source files, imports, or linking
- A type system beyond current limited compile-time checks
- String variables
- Arrays
- Functions or function calls in expressions
- Exponentiation
- Optimization or minification
- BASIC tokenization or TAP generation
- Calling `bas2tap`
- Calling `petcat`, creating ATR images, or invoking Atari packaging utilities
- Unicode, PETSCII, ATASCII, or Spectrum character-set conversion and validation
- Source-level `INK`, `PAPER`, `COLOR`, `SETCOLOR`, or `TEXT_COLOR`
- Assembly routines, PRG packaging, or native runtime libraries
- Source maps
- A VS Code extension, syntax highlighting, or language server
- A parser-generator framework
- CI workflows, npm publication, or releases

Record attractive future ideas in a short roadmap section rather than implementing them.

## Definition of done for changes

For ordinary implementation changes, finish with:

- `npm test`
- `npm run build`

When behavior affects CLI output or target rendering, also verify relevant `npm run dev -- ...` and `npm start -- ...` commands for the affected target or targets.

The final report should list changed files, verification commands, and any remaining limitations or known warnings.
