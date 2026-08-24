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
const borderLine$ = string$("*", TEXT_COLUMNS)

sensorCount = 1
alertLevel = 2
confirmed = 1
tickerText$ = "DEFENCE NETWORK ONLINE"

    border_color BLUE
    cls BLUE

start:
    print borderLine$
    print "WARNING"
    print tickerText$
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
- `gosub label`
- `return`
- `end`
- `for name = start to limit` / `next name`, with optional `step`
- `while expression` / `wend`
- `repeat` / `until expression`
- Multiline `if expression then ... else ... end if`
- Nested `if` statements
- Optional `else` blocks
- Target-provided environment constants `TEXT_ROWS`, `TEXT_COLUMNS`, and `JIFFIES_PER_SECOND`
- Portable colour constants `BLACK`, `BLUE`, `RED`, `MAGENTA`, `GREEN`, `CYAN`, `YELLOW`, and `WHITE`
- Constants written as `const name = expression`
- `data` statements containing compile-time numeric, string, or boolean values
- `read` statements targeting scalar variables
- Bare `restore` to rewind the data stream
- Compile-time string fill helpers `string$(char$, count)` and `space$(count)`
- Runtime string slicing with `mid$(text$, start, length)`, `left$(text$, length)`, and `right$(text$, length)`
- Runtime string/number conversion with `str$(number)` and `val(text$)`
- Runtime numeric math helpers `abs(x)`, `atn(x)`, `cos(x)`, `exp(x)`, `int(x)`, `sgn(x)`, `sin(x)`, and `sqr(x)`
- Runtime random number helper `rnd()`
- Random number seeding with `randomize` and `randomize seed`
- Runtime jiffy timer reading with `jiffies()`
- Non-blocking keyboard polling with `key_code()`
- Numeric, integer, and fixed-width string arrays declared with `DIM` and indexed from zero
- Numeric assignments written canonically as `name = expression`
- Integer numeric assignments written canonically as `name% = expression`
- String assignments written canonically as `name$ = expression`
- Numeric and string array assignments written canonically as `name(index) = expression`
- `print` containing one or more expressions separated by semicolons
- `print_at row, column;` followed by one or more expressions separated by semicolons
- `open_device handle, PRINTER`, `open_device handle, TEXT_PRINTER`, and `open_device handle, RS232`
- `print_device handle;` followed by one or more expressions separated by semicolons
- `close_device handle`
- Runtime device availability checks with `device_available(PRINTER)`, `device_available(TEXT_PRINTER)`, and `device_available(RS232)`
- Test-mode `TEST name()` / `END TEST` blocks
- Test-mode assertions `ASSERT_TRUE`, `ASSERT_FALSE`, `ASSERT_EQ`, `ASSERT_NE`, `ASSERT_PRINT`, `ASSERT_PRINTAT`, and portable colour assertions
- `cls` and `cls colour`
- `border_color colour`
- `text_color colour`
- `screen_border_color colour`
- `screen_background_color colour`
- `screen_text_color colour`
- `cell_text_color colour`
- `cell_background_color colour`
- `randomize` and `randomize seed`
- Expressions in `IF`, `CONST`, assignments, `FOR`, `PRINT`, and `DATA`

Important source-language rule:

- `LET` is **not** Meta-BASIC source syntax. Assignment is `name = expression`.
- Spectrum BASIC output still renders assignments with `LET` because that is target syntax.

Keywords and symbol lookup are case-insensitive. Preserve the source spelling of identifiers where practical for readable output, but target renderers may adjust casing or names. Preserve string contents exactly. Identifiers may contain ASCII letters, digits, and underscores, may end with `$` for string variables, and must otherwise begin with a letter or underscore. String literals and string variables are supported for assignment and output. `STRING$` and `SPACE$` are compile-time-only string fill helpers. `MID$`, `LEFT$`, and `RIGHT$` are supported as portable runtime string-slicing helpers. `LEN` is supported as a portable runtime string-length helper. `CHR$`, `CODE`, and `ASC` are supported as portable runtime character-code helpers. `STR$` and `VAL` are supported as portable runtime string/number conversion helpers. `RND` is supported as a portable runtime random-number helper. `JIFFIES` is supported as a portable runtime timer helper. `KEY_CODE` is supported as a portable non-blocking keyboard polling helper. `DEVICE_AVAILABLE` is supported as a portable best-effort device availability helper for `PRINTER`, `TEXT_PRINTER`, and `RS232`.

`DATA`, `READ`, and bare `RESTORE` are supported as the portable intersection of the three targets. `DATA` values must fold to compile-time numeric, string, or boolean literals. `READ` targets are scalar variables only. `RESTORE` currently takes no label or line argument because C64 BASIC V2 cannot reposition the data pointer natively.

Test-mode syntax is valid only when `testMode` is enabled. Normal builds reject `TEST` and `ASSERT_*` constructs and emit no test runner, counters, output capture, or assertion support. In test mode, the compiler generates a runner instead of normal program startup, discovers all tests in source/build-configuration order, runs them via generated `GOSUB`s, prints a final summary, and terminates. `TEST name()` blocks take no parameters, return no value, may declare `LOCAL` variables, may contain normal statements, and may call normal `FUNCTION`s. `ASSERT_PRINT` compares against the most recent logical non-positioned `PRINT` output; semicolon-separated print items are concatenated into one captured value, for example `PRINT "A"; "B"` captures `AB`. For portable output assertions, prefer string output because numeric formatting still follows the target BASIC conversion rules. `ASSERT_PRINTAT row, column, text$` compares against the most recent logical `PRINT_AT` output's portable zero-based row, column, and semicolon-concatenated text. Colour assertions are `ASSERT_SCREEN_BORDER_COLOR`, `ASSERT_SCREEN_BACKGROUND_COLOR`, `ASSERT_SCREEN_TEXT_COLOR`, `ASSERT_CELL_TEXT_COLOR`, and `ASSERT_CELL_BACKGROUND_COLOR`; `CLS colour` updates the captured screen background colour.

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

Built-in function names such as `STRING$`, `SPACE$`, `MID$`, `LEFT$`, `RIGHT$`, `LEN`, `CHR$`, `CODE`, `ASC`, `STR$`, `VAL`, `ABS`, `ATN`, `COS`, `EXP`, `INT`, `SGN`, `SIN`, `SQR`, `RND`, `JIFFIES`, `KEY_CODE`, and `DEVICE_AVAILABLE` are not lexer keywords. Tokenize them as identifiers followed by `(`, parse them as function-call expressions, and let semantic analysis decide whether the function is supported and whether its arguments are valid. Keep supported Meta-BASIC function names centralized in `src/functions.ts`; do not scatter hard-coded function-name checks across the parser, semantic analysis, or target renderers. Target renderers should use the shared helper in `src/targets/function-rendering.ts` to map supported functions to each dialect's final BASIC spelling.

## Expression grammar

Expressions are represented as discriminated-union AST nodes. Do not retain expressions as unvalidated text.

Supported expression forms:

- Numeric literals, including decimal fractions
- String literals
- Identifiers
- Compile-time function calls `STRING$(char$, count)` and `SPACE$(count)`
- Runtime string function calls `MID$(text$, start, length)`, `LEFT$(text$, length)`, `RIGHT$(text$, length)`, and `LEN(text$)`
- Runtime character-code function calls `CHR$(code)`, `CODE(text$)`, and `ASC(text$)`
- Runtime string/number conversion function calls `STR$(number)` and `VAL(text$)`
- Runtime numeric function calls `ABS(x)`, `ATN(x)`, `COS(x)`, `EXP(x)`, `INT(x)`, `SGN(x)`, `SIN(x)`, and `SQR(x)`
- Runtime random number function call `RND()`
- Runtime timer function call `JIFFIES()`
- Runtime keyboard function call `KEY_CODE()`
- Runtime device availability call `DEVICE_AVAILABLE(PRINTER)`, `DEVICE_AVAILABLE(TEXT_PRINTER)`, or `DEVICE_AVAILABLE(RS232)`
- Array reads such as `VALUES(0)` and `MESSAGES$(0)`
- Parenthesized expressions
- Unary `-`
- Unary `NOT`
- Arithmetic `+`, `-`, `*`, `/`, `^`
- Comparisons `=`, `<>`, `<`, `<=`, `>`, `>=`
- Logical `AND`, `OR`
- Boolean literals `TRUE` and `FALSE`

Precedence from highest to lowest:

1. Parentheses and primary expressions
2. `^`
3. Unary `-`, `NOT`
4. `*`, `/`
5. `+`, `-`
6. `=`, `<>`, `<`, `<=`, `>`, `>=`
7. `AND`
8. `OR`

Binary operators are left-associative. `^` is implemented naively for now and renders to the native target exponentiation operator; target-specific precedence quirks may still need additional lowering after emulator testing. Comparison chaining such as `a < b < c` is rejected with a diagnostic suggesting separate comparisons joined with `AND`.

## Constants and semantic analysis

`CONST` declarations are compile-time only and emit no BASIC line.

Selected targets provide read-only, case-insensitive environment constants:

| Target | `TEXT_ROWS` | `TEXT_COLUMNS` | `JIFFIES_PER_SECOND` |
| --- | ---: | ---: | ---: |
| ZX Spectrum | 22 | 32 | 50 |
| Atari 800XL | 24 | 40 | 50 |
| Commodore 64 | 25 | 40 | 50 |

All targets also provide read-only compile-time numeric constants `PI` and `E`.

Targets also provide read-only numeric key constants: `KEY_NONE`, `KEY_UP`, `KEY_DOWN`, `KEY_LEFT`, `KEY_RIGHT`, `KEY_SPACE`, `KEY_ENTER`, `KEY_ESCAPE`, `KEY_F1` through `KEY_F8`, `KEY_A` through `KEY_Z`, and `KEY_0` through `KEY_9`. These are target-specific key-code values, not portable ASCII promises. Unsupported target keys currently resolve to `-1`. Direction constants represent each machine's cursor/direction key codes; letter constants such as `KEY_Q`, `KEY_A`, `KEY_O`, and `KEY_P` remain available.

Portable game-control constants are also available: `GAME_UP`, `GAME_DOWN`, `GAME_LEFT`, `GAME_RIGHT`, and `GAME_FIRE`. Spectrum maps these to `Q`, `A`, `O`, `P`, and `SPACE`; C64 and Atari currently map movement to their cursor/direction keys and fire to space.

Implemented requirements:

- A constant expression may reference an earlier constant.
- Constant references are case-insensitive.
- Duplicate constant names are rejected, including names differing only by case.
- Unknown constants in constant declarations are rejected.
- Arithmetic, comparison, logical, unary, parenthesized, numeric, string, boolean, `STRING$`, and `SPACE$` constant expressions are evaluated where meaningful.
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

Do not add variable declarations or a full type system. Variables first encountered in expressions or assignment targets are runtime numeric variables unless their name ends in `$`, in which case they are runtime string variables, or `%`, in which case they are integer numeric variables. String variables currently support assignment, `PRINT` output, concatenation, `MID$`, `LEFT$`, `RIGHT$`, `LEN`, `CHR$`, `CODE`, `ASC`, `STR$`, and `VAL`. Integer variable assignment accepts numeric expressions and lowers to `INT(expression)` assignment coercion. Non-integer numeric constants are allowed. Integer variables are not supported as `FOR` loop variables yet. Keep string values within the portable C64-compatible 255-character practical limit until a more detailed string model is added.

Target string-variable lowering:

- Spectrum maps Meta-BASIC string variable names deterministically to single-letter string variables such as `A$`, `B$`, and `C$`.
- Atari 800XL emits `DIM NAME$(255)` before the first assignment to each string variable and lowers string concatenation into Atari substring assignments, using a temporary string buffer when needed to preserve Meta-BASIC expression semantics.
- C64 preserves readable string names at readability `2` where safe, and uses deterministic compact string names at lower readability levels.

Target integer-variable lowering:

- Spectrum maps Meta-BASIC integer variable names to ordinary numeric variables such as `COUNTI` and coerces assignments with `INT`.
- Atari 800XL maps Meta-BASIC integer variable names to ordinary numeric variables such as `COUNTI` and coerces assignments with `INT`.
- C64 preserves native `%` integer variables where safe, uses deterministic compact `%` names at lower readability levels, and coerces assignments with `INT`.

## Arrays

Meta-BASIC supports numeric arrays, integer numeric arrays, and fixed-width string arrays:

```basic
dim values(3)
dim counters%(3)
dim messages$(3, 12)

values(0) = 1.5
values(2) = values(0) + 2
counters%(2) = values(2)
messages$(0) = "READY"
```

Array dimensions are element counts, not native target upper bounds. Indexes are zero-based in Meta-BASIC, so `dim values(3)` supports indexes `0`, `1`, and `2`. Dimensions must be positive compile-time integers. Constant indexes are checked at compile time; dynamic indexes are not range-checked yet. Array use before `DIM` is rejected. Assignments to integer arrays are coerced with `INT(expression)`.

String arrays require exactly two declaration dimensions: element count and fixed width. Use only the element index at read/write sites: `dim messages$(3, 12)` followed by `messages$(0) = "READY"` and `print messages$(0)`. String literal assignments longer than the fixed width are rejected at compile time. Dynamic string expressions are accepted, but Atari's fixed-slice backing storage is most predictable when assignments fit the declared width.

Target array lowering:

- Spectrum maps Meta-BASIC numeric array names to single-letter numeric array names, maps string arrays to single-letter string array names, and shifts every Meta-BASIC index by `+ 1`.
- Atari 800XL renders native numeric arrays and lowers each declared count to the native zero-based upper bound, so `dim values(3)` becomes `DIM VALUES(2)`. Fixed-width string arrays render as one backing string, so `dim messages$(3, 12)` becomes `DIM MESSAGES$(36)` and each element access renders as a substring slice.
- C64 renders native numeric and string arrays, applies deterministic variable-name mapping, preserves `%` for integer arrays where safe, and lowers each declared count to the native zero-based upper bound. For string arrays, the fixed width is used for Meta-BASIC diagnostics and is not emitted as a C64 dimension.

Target keyboard lowering:

- `KEY_CODE()` is currently supported only in direct numeric assignments such as `key = key_code()`.
- Spectrum lowers that assignment through `INKEY$`, `KEY_NONE`, and `CODE` only after a key string is present.
- C64 lowers that assignment through `GET`, `KEY_NONE`, and `ASC` only after a key string is present, reading from the C64 keyboard buffer.
- Atari lowers that assignment through `PEEK(764)`, uses Atari `KEY_NONE` (`255`) when no key is present, and emits `POKE 764,255` after consuming a key.

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

Out of scope for `PRINT`: comma separators, apostrophe newline separators, streams, `INK`, `PAPER`, `COLOR`, and `SETCOLOR`.

## Device output

Meta-BASIC supports simple device output for printer and serial logging workflows:

```basic
if device_available(PRINTER) then
    open_device Log, PRINTER
    print_device Log; "READY"
    close_device Log
end if
```

Supported device constants are `PRINTER`, `TEXT_PRINTER`, and `RS232`. Device handles are source-level names that the compiler lowers to target channel or stream numbers; they must be opened before `PRINT_DEVICE` or `CLOSE_DEVICE`, and duplicate open handles are rejected. `PRINT_DEVICE` uses the same semicolon-separated item list as `PRINT`.

Target lowering:

- Spectrum: `PRINTER` uses stream `#4` opened as `"P"`; `TEXT_PRINTER` lowers `PRINT_DEVICE` to `LPRINT` for Fuse ZX Printer text capture; `RS232` uses stream `#4` opened as `"t"` for Interface 1 style text serial output. Availability is currently best-effort.
- Atari 800XL: `PRINTER` and `TEXT_PRINTER` open `P:`; `RS232` opens `R:`. Availability is checked with `TRAP` around an `OPEN` where practical.
- C64: `PRINTER` and `TEXT_PRINTER` use device 4 and can be probed through the status channel. `RS232` uses device 2/userport RS-232. C64 RS-232 availability currently reports true because probing the RS-232 channel can disturb the connection.

Test-mode launch scripts can mirror the generated test-runner log to a configured device with `--printer-output` and `--test-output-device printer|text-printer|rs232`. The flag name `--printer-output` is historical; with `--test-output-device rs232` it means "mirror test output to the selected external device".

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
text_color WHITE
screen_border_color BLUE
screen_background_color BLACK
screen_text_color WHITE
cell_text_color YELLOW
cell_background_color BLUE
```

`CLS` clears the text screen. `CLS colour` selects the portable background colour and then clears the screen. The colour form does not change the foreground/text colour or border colour.

`SCREEN_BORDER_COLOR colour` changes the target machine's border colour without changing the text/background colour. `BORDER_COLOR` is kept as a compatibility spelling.

`SCREEN_BACKGROUND_COLOR colour` changes the target machine's global screen background colour without clearing the screen.

`SCREEN_TEXT_COLOR colour` changes the target machine's global/current text colour. `TEXT_COLOR` is kept as a compatibility spelling for this global text colour operation.

`CELL_TEXT_COLOR colour` changes the following printed cell text colour where the target supports per-cell text colour. Atari 800XL `GRAPHICS 0` ignores it.

`CELL_BACKGROUND_COLOR colour` changes the following printed cell background colour where the target supports per-cell background attributes. Spectrum supports it; C64 and Atari 800XL ignore it.

Target lowering:

- Spectrum: `CLS`, or `PAPER targetColour` followed by `CLS`.
- Atari 800XL: `PRINT CHR$(125);`, or `SETCOLOR 2,targetHue,targetLuminance` followed by `PRINT CHR$(125);`.
- C64: `PRINT CHR$(147);`, or `POKE 53281,targetColour` followed by `PRINT CHR$(147);`.
- Border colour lowers to Spectrum `BORDER targetColour`, Atari `SETCOLOR 4,targetHue,targetLuminance`, and C64 `POKE 53280,targetColour`.
- Global background colour lowers to Spectrum `PAPER targetColour`, Atari `SETCOLOR 2,targetHue,targetLuminance`, and C64 `POKE 53281,targetColour`.
- Global text colour lowers to Spectrum `INK targetColour`, Atari `SETCOLOR 1,targetHue,targetLuminance`, and C64 `POKE 646,targetColour`.
- Cell text colour lowers to Spectrum `INK targetColour`, C64 `POKE 646,targetColour`, and no Atari 800XL output.
- Cell background colour lowers to Spectrum `PAPER targetColour` and no C64 or Atari 800XL output.

Atari colour mappings are deterministic `GRAPHICS 0` approximations and may look different across PAL, NTSC, emulator, and display configurations.

## Shared output semantics

- Generate line numbers beginning at 10 and prefer increments of 10.
- If increments of 10 would exceed the target's maximum line number, automatically fall back to increments of 1.
- Reject generated programs that still exceed the target's maximum line number with increment 1: Spectrum 9999, Atari 800XL 32767, and C64 63999.
- Render target keywords in uppercase.
- Reject duplicate labels.
- Reject references to undefined labels.
- Lower multiline `IF/ELSE` into target-compatible conditional jumps, unconditional jumps, and generated internal labels. When an `ELSE` block is present, emit the `ELSE` block before the `THEN` block in target BASIC so the conditional jump can branch directly to the `THEN` label and avoid an extra generated `ELSE` label/jump.
- Lower `WHILE/WEND` and `REPEAT/UNTIL` into target-compatible conditional jumps, unconditional jumps, and generated internal labels.
- Lower `END` to Spectrum `STOP`, Atari `END`, and C64 `END`.
- Lower `RND()` to Spectrum `RND`, Atari `RND(0)`, and C64 `RND(1)`. Lower `RANDOMIZE` to Spectrum `RANDOMIZE`, C64 generated assignment using `RND(0)`, and no Atari output. Lower `RANDOMIZE seed` to Spectrum `RANDOMIZE seed`, C64 generated assignment using `RND(-seed)`, and no Atari output.
- Generated internal labels must never collide with user labels.
- Do not depend on a native target `ELSE` construct.
- Keep one BASIC statement per generated line.
- Reject generated BASIC lines that exceed the target's practical editable line length: Spectrum 640 characters, Atari 800XL 120 characters, and C64 80 characters.
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
- Use `GO SUB` and `RETURN`.
- Render assignments as `LET NAME=expression`.
- Render `FOR` loop variables as single-letter numeric variables.
- Render numeric arrays as single-letter numeric arrays, string arrays as single-letter string arrays, and shift zero-based Meta-BASIC indexes to Spectrum's one-based array indexes.
- Render numeric identifiers and `REM` label text in uppercase for emulator-friendly Spectrum BASIC listings. Map string identifiers to single-letter Spectrum string variables. Preserve string literal contents exactly.
- Render positioned output directly as `PRINT AT row,column;...`.
- Constant coordinates must satisfy row `0..21` and column `0..31`.

### Atari 800XL

- Target Atari BASIC as built into a typical Atari 800XL.
- Do not target Turbo-BASIC XL, BASIC XL, or another extended dialect.
- Use `GOTO`.
- Use `GOSUB` and `RETURN`.
- Render assignments without `LET`.
- Render `FOR`/`NEXT` with explicit loop variables.
- Render identifiers and `REM` label text in uppercase for emulator-friendly Atari BASIC listings. Preserve string literal contents exactly.
- Emit `DIM NAME$(255)` before the first assignment to each Atari string variable.
- Render numeric arrays with native `DIM NAME(maxIndex)` syntax where `maxIndex` is one less than the Meta-BASIC element count.
- Render fixed-width string arrays as one backing string with substring slices for element reads and writes.
- Lower string concatenation in assignments and `PRINT` items into Atari substring assignments such as `NAME$(LEN(NAME$)+1)="more"` because Atari BASIC does not support the same `+` string concatenation form as the C64 and Spectrum outputs.
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
- Use `GOSUB` and `RETURN`.
- Render assignments without `LET`.
- Render `FOR`/`NEXT` with explicit loop variables.
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
- Compact C64 variable mapping should prefer mnemonic names based on the source name's first significant characters, falling back to generated names only when needed to avoid aliases or keywords.
- Avoid generated names that conflict with BASIC keywords or system variables such as `TI`/`TI$`. Constants are substituted and require no runtime variable name.
- Render numeric arrays with native `DIM NAME(maxIndex)` syntax where `maxIndex` is one less than the Meta-BASIC element count.
- Render fixed-width string arrays as native string arrays and omit the fixed width from C64 `DIM`.

## Logical semantics across targets

Meta-BASIC logical operators mean logical truth over numeric values, with zero false and nonzero true. Target backends must preserve that meaning even where a target BASIC implements `NOT`, `AND`, or `OR` as bitwise integer operations or represents true differently. Keep required normalization in target lowering or expression rendering, not in the parser.

## CLI

Supported development commands:

```text
npm run dev -- examples/colors.mbas --target spectrum
npm run dev -- examples/colors.mbas --target atari800xl
npm run dev -- examples/colors.mbas --target c64
npm run dev -- --config metabasic.json --target spectrum
```

The CLI also accepts a simple JSON build configuration:

```json
{
  "files": [
    "src/main.mbas",
    "src/game.mbas",
    "src/ui.mbas"
  ]
}
```

The order is significant and all listed files form one compilation unit. The first file contains startup code. Later files may define functions called by earlier files because semantic analysis runs over the combined program. Paths are resolved relative to the configuration JSON, not the current working directory. Keep JSON loading in `src/build-configuration.ts`; the compiler core should accept an internal `BuildConfiguration`/program representation and must not depend on JSON.

Target build scripts:

```text
npm run build:spectrum -- --profile debug
npm run build:atari -- --profile balanced
npm run build:c64 -- --profile release
npm run build:all-targets -- --profile release
npm run build:all-targets -- --source examples/narf.mbas --profile release
npm run build:all-targets -- --build-config examples/multifile/metabasic.json --profile release
npm run build:all-targets -- --project examples/project-demo --profile debug
npm run build:all-targets -- --project examples/project-demo --run-tests --profile debug
npm run build:all-targets -- --project examples/project-demo --run-tests --module math --profile debug
npm run build:all-targets -- --project examples/instruction-suite --run-tests --profile debug
npm run new:project -- examples/my-game
npm run new:module -- --project examples/my-game --module scoring
npm run build:directory -- --source-dir examples --profile debug
npm run build:all-profiles
npm run build:spectrum:all-profiles
npm run launch:all-targets -- --source examples/narf.mbas --restart
npm run launch:all-targets -- --build-config examples/multifile/metabasic.json --restart
npm run launch:all-targets -- --project examples/project-demo --run-tests --restart
npm run launch:all-targets -- --project examples/project-demo --run-tests --module math --restart
npm run launch:c64 -- --project examples/instruction-suite --run-tests --printer-output --test-output-device rs232 --restart
npm run launch:atari -- --source examples/narf.mbas
npm run launch:atari -- --source examples/narf.mbas --artifact atr --restart
npm run launch:c64 -- --source examples/narf.mbas
npm run launch:c64 -- --source examples/input-demo.mbas --restart
npm run launch:spectrum -- --source examples/narf.mbas
npm run launch:spectrum -- --source examples/input-demo.mbas --restart
```

Build profiles map to readability levels:

- `debug`: readability `2`
- `balanced`: readability `1`
- `release`: readability `0`

The Node ESM scripts in `scripts/` always generate `.bas` files under `build/<profile>/<target>/`. Atari 800XL builds also generate `.lst` files beside the `.bas` output and a `<source>.atr-files` staging directory containing the listing under an Atari DOS-compatible filename such as `COLORS.LST` or `NARF.LST`. These `.lst` files keep ASCII BASIC text and replace host line endings with Atari's `0x9B` listing line ending for import flows such as `ENTER "D:COLORS.LST"`; full ATASCII character-set conversion remains out of scope. Optional local conversion tools are configured through `scripts/tools.local.json`, copied from `scripts/tools.example.json`. The example config includes Spectrum `bas2tap`, AtariSIO `dir2atr`, and C64 `petcat -w2` entries with empty paths for local configuration. The Atari `dir2atr` entry uses `inputArtifact: "atariDiskDirectory"` so `{input}` points at the generated ATR staging directory. The C64 `petcat` entry uses `inputTransform: "lowercase"` because `petcat`'s text format treats lowercase ASCII as normal C64 uppercase/PETSCII text. Keep `tools.local.json` and generated `build/` output out of version control.

The build and launch scripts accept exactly one input selector: `--source file.mbas`, `--build-config metabasic.json`, or `--project folder`. A project folder contains sibling `source/` and `tests/` folders. Normal project builds compile direct `.mbas` files in `source/`, sorted by filename. Project test-mode builds compile `source/` followed by `tests/`, with `testMode` enabled. `--module name` may be combined with `--project` and `--run-tests` to compile all source modules but include only matching test files such as `tests/name-tests.mbas`, `tests/name.test.mbas`, or `tests/name.mbas`. `--run-tests` also works with `--source`, `--build-config`, `build:directory`, and all launch scripts.

`scripts/scaffold-project.mjs` backs `npm run new:project` and `npm run new:module`. It creates conventional `source/` and `tests/` folders plus starter `.mbas` files, and refuses to overwrite existing files.

`examples/instruction-suite` is a conventional project containing a portable Meta-BASIC instruction-set regression suite. It should compile in test mode for all targets. Use `--module` to run focused slices such as `--module strings` when emulator memory or debugging workflow makes the full suite inconvenient.

`scripts/launch-c64.mjs` backs `npm run launch:c64`. It builds the selected `--source`, `--build-config`, or `--project` input with the release profile by default, runs the configured C64 packaging tool, and launches the configured emulator with the generated `.prg`. The C64 emulator path and arguments live in the `c64.emulator` block of `scripts/tools.local.json`; `{artifact}` expands to the generated `.prg`. Passing `--restart` or `--kill-existing` terminates existing processes with the configured emulator executable name before launching the new program.

For C64 test-runner capture, prefer `--printer-output --test-output-device rs232`. The launch script starts `scripts/rs232-capture.mjs`, creates a dynamic localhost endpoint, expands `{rs232Endpoint}` in `c64.emulator.rs232Args`, and writes captured bytes to `build/rs232/<profile>/c64/<source-name>.txt`. VICE should show Serial 1 as `127.0.0.1:<port>` with userport RS-232 enabled and `IP232` unchecked. Do not point VICE directly at `{rs232Output}` for RS-232 capture; local file paths in that field may create empty files.

`scripts/launch-atari.mjs` backs `npm run launch:atari`. It builds the selected `--source`, `--build-config`, or `--project` input with the release profile by default, runs the configured Atari packaging tools, and launches the configured emulator. The Atari emulator path and arguments live in the `atari800xl.emulator` block of `scripts/tools.local.json`; `{artifact}` expands to the selected artifact. The default artifact is `tokenized-bas`, which uses Altirra `/runbas`. `--artifact atr`, `--artifact lst`, and `--artifact disk-directory` are available for experiments; the generated ATR is a data disk and is not bootable. Passing `--restart` or `--kill-existing` terminates existing processes with the configured emulator executable name before launching the new program.

Atari and Spectrum launch configs include `printerOutputPath`, `printerArgs`, `rs232OutputPath`, and `rs232Args`, but their exact emulator-to-host-file workflows are not verified yet. Keep the hooks documented and update `docs/running-programs.md` when a repeatable Fuse or Altirra capture path is confirmed.

`scripts/launch-spectrum.mjs` backs `npm run launch:spectrum`. It builds the selected `--source`, `--build-config`, or `--project` input with the release profile by default, runs the configured Spectrum packaging tool, and launches the configured emulator with the generated `.tap`. The Spectrum emulator path and arguments live in the `spectrum.emulator` block of `scripts/tools.local.json`; `{artifact}` expands to the generated `.tap`. Passing `--restart` or `--kill-existing` terminates existing processes with the configured emulator executable name before launching the new program.

`scripts/launch-all-targets.mjs` backs `npm run launch:all-targets`. It launches the selected `--source`, `--build-config`, or `--project` input for every target whose `emulator.path` is configured in `scripts/tools.local.json`, skipping unconfigured targets. It accepts common launch options such as `--source`, `--build-config`, `--project`, `--run-tests`, `--module`, `--profile`, `--out-dir`, `--config`, and `--restart`. Atari uses the tokenized `.BAS` artifact by default; `--atari-artifact atr` can select the ATR artifact instead.

`scripts/build-directory.mjs` backs `npm run build:directory`. It finds all `.mbas` files directly inside a selected directory, builds each selected profile and target, and optionally runs configured local conversion tools. It is intentionally non-recursive for now so a single command updates one program collection without accidentally sweeping unrelated folders.

`examples/narf.mbas` is the larger N.A.R.F. demo. Its release build should create `build/release/spectrum/narf.tap`, `build/release/atari800xl/narf.atr`, `build/release/atari800xl/narf.atr-files/NARF.LST`, and `build/release/c64/narf.prg` when local tools are configured. For emulator workflows, the generated Atari `.atr` can be mounted directly. For devices or mini consoles that create their own ATR from USB storage, copy the staged `NARF.LST` into the device-managed disk image rather than copying `narf.atr` into it.

When passing options through `npm run`, `--` separates npm's own options from script options. Direct Node commands such as `node scripts/build-target.mjs spectrum --all-profiles` do not need it.

Compiled commands after `npm run build`:

```text
npm start -- examples/colors.mbas --target spectrum
npm start -- examples/colors.mbas --target atari800xl
npm start -- examples/colors.mbas --target c64
npm start -- --config metabasic.json --target spectrum
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
  functions.ts
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
    environment.ts
    function-rendering.ts
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
  colors.mbas
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
- Compile-time `STRING$` and `SPACE$` folding with target environment constants
- Assignment to constant diagnostics
- `TRUE` and `FALSE` lowering
- Numeric assignment output
- `DATA`, scalar `READ`, and bare `RESTORE` parsing, target rendering, Atari string `DIM` support for string reads, and diagnostics for unsupported positioned restore or runtime data values
- Multi-item `PRINT` and trailing semicolons
- Rejection of source `LET`
- `GOSUB`/`RETURN` parsing, label resolution, and target spelling
- `FOR`/`NEXT` parsing, nesting diagnostics, numeric semantic checks, `STEP`, and target spelling
- `WHILE/WEND` and `REPEAT/UNTIL` parsing, delimiter diagnostics, semantic expression folding, and jump lowering
- String variable tokenization, parsing, assignment, target name mapping, Atari `DIM`, and `PRINT`
- Integer variable tokenization, assignment coercion, target name mapping, and C64 native `%` output
- Numeric, integer, and fixed-width string array parsing, declaration diagnostics, constant index range checks, target rendering, string width checks, and integer array assignment coercion
- Runtime `MID$`, `LEFT$`, and `RIGHT$` lowering to C64 string functions, Spectrum slicers, and Atari substrings
- Runtime `LEN` lowering to each target's string-length function
- Runtime `CHR$`, `CODE`, and `ASC` lowering, with Spectrum using native `CODE` for `CODE`/`ASC` and Atari/C64 using `ASC`
- Runtime `STR$` and `VAL` lowering, with Spectrum using operator-style `STR$ expression` and `VAL expression`
- Runtime numeric math function lowering for `ABS`, `ATN`, `COS`, `EXP`, `INT`, `SGN`, `SIN`, and `SQR`
- Runtime exponentiation operator rendering with `^`
- Runtime `JIFFIES` lowering to C64 `TI`, Spectrum `FRAMES`, and Atari `RTCLOK`
- Runtime `KEY_CODE` lowering plus target key constants
- Device output parsing, semantic validation, target lowering for printer/RS-232, `DEVICE_AVAILABLE`, and C64 RS-232 test-runner capture through a localhost endpoint
- `PRINT_AT` parsing and malformed coordinate diagnostics
- Spectrum target `PRINT AT` output
- Atari `POSITION` expansion
- C64 `POKE`/`SYS` expansion
- Portable global and cell colour lowering, including ignored cell colours for unsupported targets
- Coordinate range diagnostics for all targets
- Deterministic C64 variable-name mapping, including two-character collisions
- Uppercase output casing for Spectrum, Atari, and C64
- Logical truth normalization
- Target generated-line length diagnostics
- Exact colors example output for all targets
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
- That Atari builds also emit `.lst` files with Atari `0x9B` line endings and ATR staging folders
- That TAP, ATR, PRG, and tokenized BASIC artifacts are optional local-tool outputs, while `.bas` text output is always generated
- Explicit limitations

Do not claim support for machines or constructs that are only planned.

## Explicitly out of scope unless requested

- CPC or other additional backends
- Variable declarations beyond the current implicit scalar variables, arrays, and function locals
- Imports, modules, exports, namespaces, separate compilation, or linking
- A type system beyond current limited compile-time checks
- Variable-length string arrays
- Labelled or line-targeted `RESTORE`
- Runtime string functions beyond the documented built-ins
- General runtime functions or function calls beyond the currently supported helpers
- Optimization or minification
- BASIC tokenization or TAP generation
- Calling `bas2tap`
- Calling `petcat`, creating ATR images, or invoking Atari packaging utilities
- Unicode, PETSCII, ATASCII, or Spectrum character-set conversion and validation
- Source-level target-specific colour commands such as `INK`, `PAPER`, `COLOR`, or `SETCOLOR`
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
