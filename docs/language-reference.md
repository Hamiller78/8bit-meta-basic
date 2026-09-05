# Meta-BASIC language reference

This document describes the implemented source language. Target-specific rendering is documented in [targets.md](targets.md).

Meta-BASIC is case-insensitive for keywords and symbol lookup. Identifiers may contain ASCII letters, digits, and underscores, must begin with a letter or underscore, and may end in `$` to denote a string variable or `%` to denote an integer numeric variable.

## Program structure

Blank lines are allowed. An apostrophe starts a comment that continues to the end of the source line.

```basic
' Wait for confirmation
start:
    goto start ' Keep polling
```

Source comments have no runtime effect. When source-comment emission is enabled, for example by the `debug` build profile or the direct `--source-comments` flag, full-line comments and trailing comments are emitted as generated `REM` lines. Otherwise they are discarded.

Labels use `name:` and may be referenced by `goto` or `gosub`. Duplicate and undefined labels are compile-time errors.

## Module dependencies: USES

Each `.mbas` file is a module. Declare access to another module with a module-level `USES` statement:

```basic
uses "text.mbas"
uses "../shared/clock.mbas"

DrawText()
```

The quoted path is relative to the file containing `USES`, not to the build configuration. The referenced file must already be part of the build configuration or the source files selected by `--project`. `USES` does not load files, insert source text, emit BASIC, or change configured execution or initializer order. Use one declaration per dependency. Empty paths, duplicate declarations (including normalized path aliases), missing build inputs, and declarations inside blocks are errors.

A module may access another module's functions, constants, enum members, global variables, arrays, struct types and values, labels, and device handles only with a direct `USES` declaration. This applies to writes as well as reads, including test assertions and `GLOBALS` fixtures. Built-in functions and target environment constants need no declaration. Parameters and `LOCAL` variables retain their existing function/test scope.

Dependencies are not transitive: if A uses B and B uses C, A must also declare `USES` for C to access C's symbols. Circular dependencies are rejected even when the modules do not call each other: A using itself, A using B using A, and longer cycles are all compilation errors. Diagnostics identify the source location and the dependency cycle. The existing prohibition on recursive function calls remains in force.

`USES` introduces access checking, not namespaces or exports. Existing global name uniqueness rules remain; symbols are still used without qualification. A scalar's module-level initialization determines ownership before assignments inside functions or tests. When an importing module also assigns that scalar, the dependency's initializer remains its owner. Otherwise, the first unscoped assignment in build order establishes ownership; a read-only implicit scalar belongs to its first referencing module. Initialize shared state in its owning module and use `LOCAL` for unrelated scratch variables that happen to share a name.

Existing multi-file programs must add these declarations. Tests normally use paths such as `uses "../source/math.mbas"`; source modules should not depend on their tests.

## Constants

Constants are evaluated during compilation and emit no BASIC statements:

```basic
const warningRow = TEXT_ROWS - 2
const initialCountdown = 5 * 12
const borderLine$ = string$("*", TEXT_COLUMNS)
```

A constant may reference an earlier constant. Names are case-insensitive. Duplicate constants, unknown references, invalid operations, and compile-time division by zero are rejected.

Top-level constants, enums, and struct type definitions are collected across the whole compilation unit before executable statements are analyzed. With the required `USES` declaration, startup code in an earlier file can use an enum member or struct type declared in a later file. Constant declarations themselves still evaluate in source/build order, so a constant expression may only refer to constants that have already been declared.

Enums are compile-time collections of integer constants:

```basic
enum ThreatState
    ThreatIdle
    ThreatTracking = 4
    ThreatLocked
end enum
```

Members without explicit values count upward from the previous value, starting at `0`. In the example, `ThreatIdle` is `0`, `ThreatTracking` is `4`, and `ThreatLocked` is `5`. Enum members currently become ordinary compile-time constants in the surrounding scope; the enum name is documentation, not a namespace.

Every target supplies these environment constants:

| Constant | Spectrum | Atari 800XL | C64 |
| --- | ---: | ---: | ---: |
| `TEXT_ROWS` | 22 | 24 | 25 |
| `TEXT_COLUMNS` | 32 | 40 | 40 |
| `JIFFIES_PER_SECOND` | 50 | 50 | 50 |

The compiler also supplies target key constants, portable game-control constants, and portable colour constants. Their target mappings are described in [targets.md](targets.md).

All targets also provide compile-time numeric constants `PI` and `E`.

## Variables and assignment

Assignment does not use `LET` in Meta-BASIC source:

```basic
urgency = sensorCount * 2 + alertLevel
countdown% = 60
tickerText$ = "DEFENCE NETWORK ONLINE"
```

Variables ending in `$` are strings. Variables ending in `%` are integer numeric variables. Other runtime variables are regular numeric variables. Constants and environment constants cannot be assigned to.

Integer variable assignment accepts any numeric expression and stores `INT(expression)`. This means non-integer constants are allowed:

```basic
counter% = 3.7
```

Spectrum and Atari lower integer variables to ordinary numeric variables plus explicit `INT(...)` assignment coercion. C64 lowers them to native `%` integer variables and still emits explicit `INT(...)` coercion for consistent Meta-BASIC semantics. Integer variables are not supported as `FOR` loop variables yet.

Current string support includes assignment, concatenation, output, `MID$`, `LEFT$`, `RIGHT$`, `LEN`, `CHR$`, `CODE`, `ASC`, `STR$`, and `VAL`. Keep string values within the portable 255-character limit.

## Arrays

Arrays are declared with `DIM`. Dimensions are element counts, and Meta-BASIC array indexes start at zero:

```basic
dim values(3)
dim counters%(3)

values(0) = 1.5
values(2) = values(0) + 2
counters%(2) = values(2)
print values(0); counters%(2)
```

`dim values(3)` creates valid indexes `0`, `1`, and `2`. Constant indexes are checked at compile time; dynamic indexes are not range-checked yet. Dimensions must be positive compile-time integers. Integer arrays ending in `%` coerce assigned values with `INT(...)`, matching integer variable assignments.

String arrays are fixed-width:

```basic
dim messages$(3, 12)

messages$(0) = "READY"
messages$(2) = "STANDBY"
print messages$(0); messages$(2)
```

Use `STRUCT` blocks to define small record-like storage shapes:

```basic
struct TelegraphText
    textQueueRow
    textQueueColumn
    textQueue$(39)
end struct

dim textQueue AS TelegraphText(100)
dim newElement AS TelegraphText

textQueue(0).textQueueRow = 4
newElement.textQueue$ = "READY"
```

Struct definitions are compile-time-only type definitions. A numeric field is written as a bare field name. A fixed-width string field is written with one width argument, such as `text$(39)`. Struct arrays lower to one backing array per field, so a `TelegraphText(100)` queue becomes parallel native arrays behind the scenes. Scalar struct values lower to one backing scalar per field. Access fields with `value.field` or `array(index).field`.

Whole-struct assignment copies every field from a scalar struct value of the same type:

```basic
dim queue AS TelegraphText(100)
dim nextText AS TelegraphText
dim copyText AS TelegraphText

queue(0) = nextText
copyText = nextText
```

The right-hand side must be a scalar struct value, not an expression or struct array element.

`insert_element(array, index, value)` inserts into a one-dimensional native array or struct array. Existing elements from `index` upward are moved one slot higher, and the last element is lost. For struct arrays, `value` must currently be a scalar struct value of the same type. `remove_element(array, index)` moves elements from `index + 1` downward and overwrites the element at `index`; the final slot is left as whatever value remains there.

Functions can accept scalar struct parameters with `parameter AS StructName`. Struct parameters are copied field-by-field before the function call, so assigning to `parameter.field` inside the function does not write back to the caller's struct value. Struct arrays cannot be passed as function parameters yet. Struct definitions cannot be nested.

`dim messages$(3, 12)` creates three string slots with a maximum width of 12 characters. String array use still supplies only the element index; the width is part of the storage declaration. String literal assignments longer than the fixed width are rejected at compile time.

## Expressions

Supported primary expressions are:

- Numeric and string literals
- Identifiers
- Array reads such as `values(0)` and `messages$(0)`
- `TRUE` and `FALSE`
- Parenthesized expressions
- Supported function calls

Supported operators, from highest to lowest precedence:

1. `^`
2. Unary `-` and `NOT`
3. `*`, `/`, and `MOD`
4. `+` and `-`
5. `=`, `<>`, `<`, `<=`, `>`, and `>=`
6. `AND`
7. `OR`

Binary operators are left-associative. `MOD` lowers portably to `A - INT(A / B) * B`; for now, avoid side-effecting operands such as `RND()` because the naive runtime rendering may evaluate operands more than once. `^` renders to the native target exponentiation operator; target-specific numeric precision and domain quirks remain visible. Spectrum BASIC rejects negative bases for exponentiation at runtime, so avoid expressions such as `(-x) ^ 2` in portable programs for now. Comparison chaining such as `a < b < c` is rejected; write `a < b AND b < c`.

Meta-BASIC treats zero as false and every nonzero numeric value as true. Target lowering preserves these logical semantics despite differences between the original BASIC implementations.

## Built-in functions

| Function | Kind | Purpose |
| --- | --- | --- |
| `string$(text$, count)` | Compile time | Repeat a string |
| `space$(count)` | Compile time | Produce spaces |
| `mid$(text$, start, length)` | Runtime | Extract a string section |
| `mid$(text$, start)` | Runtime | Extract from a position through the end of the string |
| `left$(text$, length)` | Runtime | Extract the left part of a string |
| `right$(text$, length)` | Runtime | Extract the right part of a string |
| `len(text$)` | Runtime | Return string length |
| `chr$(code)` | Runtime | Convert a numeric character code to a one-character string |
| `code(text$)` | Runtime | Convert the first character of a string to a numeric code |
| `asc(text$)` | Runtime | Alias-style source spelling for `code(text$)` |
| `str$(x)` | Runtime | Convert a number to a string |
| `val(text$)` | Runtime | Convert a numeric string to a number |
| `abs(x)` | Runtime | Return absolute value |
| `atn(x)` | Runtime | Return arctangent |
| `cos(x)` | Runtime | Return cosine |
| `exp(x)` | Runtime | Return `e` raised to a power |
| `int(x)` | Runtime | Return integer part using target BASIC semantics |
| `sgn(x)` | Runtime | Return sign |
| `sin(x)` | Runtime | Return sine |
| `sqr(x)` | Runtime | Return square root |
| `rnd()` | Runtime | Return the next pseudo-random number in the target's native `0 <= x < 1` range |
| `jiffies()` | Runtime | Read the target's running tick counter |
| `free_memory()` | Runtime | Return the target's current free BASIC memory in bytes |
| `key_code()` | Runtime | Poll the keyboard without waiting |
| `key_pressed()` | Runtime | Check whether a key is waiting without blocking |
| `get_joystick(control)` | Runtime | Read a joystick axis or fire button without blocking |
| `device_available(device)` | Runtime | Best-effort availability check for `PRINTER`, `TEXT_PRINTER`, `SHARED_DRIVE`, or `RS232` |

`CHR$`, `CODE`, and `ASC` are portable source spellings, but character-code meanings remain target-specific outside ordinary printable text. Spectrum lowers `CODE` and `ASC` to native `CODE`; Atari and C64 lower both to `ASC`.

`STR$` and `VAL` are portable source spellings for number/string conversion. Spectrum lowers them to `STR$ expression` and `VAL expression`; Atari and C64 lower them to `STR$(expression)` and `VAL(expression)`. For portable programs, use `VAL` with plain numeric strings rather than relying on Spectrum's ability to evaluate a string as a BASIC expression.

Math functions lower to the target BASIC function of the same name. Trigonometric functions use each target dialect's native angle unit and numeric behaviour.

`FREE_MEMORY()` lowers to each target's native or customary BASIC free-memory check. C64 output corrects the signed `FRE(0)` result, Atari uses native `FRE(0)`, and Spectrum uses the 48K ROM free-memory routine.

Random numbers use:

```basic
randomize 1983
value = rnd()
```

`randomize` accepts an optional numeric seed. Atari BASIC ignores the seed because its native `RND` facility does not use the same explicit seed model.

`STRING$` and `SPACE$` require constant arguments, and their result is limited to 255 characters. `KEY_PRESSED()` returns true when a key is available. `KEY_CODE()` is currently supported only as the complete right-hand side of a numeric assignment:

```basic
key = key_code()
```

In test mode, tests can replace the runtime values returned by the timer and keyboard helpers:

```basic
test FakesRuntimeInputs()
    set_jiffies(123)
    set_key_code(KEY_SPACE)
    set_key_pressed(1)

    assert_eq 123, jiffies()
    assert_eq KEY_SPACE, key_code()
    assert_true key_pressed()

    set_key_pressed(0)
    assert_false key_pressed()
end test
```

`SET_JIFFIES`, `SET_KEY_CODE`, and `SET_KEY_PRESSED` are valid only inside `TEST` blocks. The generated runner resets all three fake values to `0` before every test.

## Joystick input

```basic
x = get_joystick(JOY_X)
y = get_joystick(JOY_Y)
fire = get_joystick(JOY_FIRE1)
```

The read-only selectors `JOY_X` (0), `JOY_Y` (1), and `JOY_FIRE1` (2) must be known at compile time. Constant aliases are allowed; runtime selector variables and unknown selector values are rejected. Use underscores, not hyphens, in selector names.

| Selector | Negative | Neutral | Positive |
| --- | --- | --- | --- |
| `JOY_X` | -1: left | 0 | 1: right |
| `JOY_Y` | -1: up | 0 | 1: down |
| `JOY_FIRE1` | Not applicable | 0: released | 1: pressed |

Diagonal movement and fire together are supported. Simultaneous opposing directions cancel to zero. Each call polls independently; separate calls are not an atomic snapshot. The function may appear in numeric expressions, conditions, and function return values, not just assignments.

| Target | Input source |
| --- | --- |
| C64 | Joystick port 2, via `PEEK(56320)` and native bit masks |
| Atari 800XL | First joystick, via `STICK(0)` and `STRIG(0)` |
| Spectrum | Q/A for up/down, O/P for left/right, Space for fire, via direct keyboard-matrix `IN` reads |

Spectrum does not require a joystick interface and does not consume buffered keyboard input. Only the three selectors above are currently supported; additional buttons are reserved for future extensions. Existing `GAME_*` constants remain keyboard key codes, not joystick selectors.

In test mode, all `GET_JOYSTICK` calls, including calls in ordinary functions, read independent fake controls instead of hardware:

```basic
test MoveLeftAndFire()
    set_joystick(JOY_X, -1)
    set_joystick(JOY_FIRE1, 1)
    assert_eq -1, get_joystick(JOY_X)
    assert_eq 0, get_joystick(JOY_Y)
    assert_eq 1, get_joystick(JOY_FIRE1)
end test
```

`SET_JOYSTICK(control, value)` is a statement allowed only directly inside a `TEST` block. Its selector must be constant, and its value must be numeric. Supply normalized values from the table above; the fake stores the supplied value without conversion. Setting one control leaves the other controls unchanged. All three reset to zero before every test, independently of the keyboard fakes. Normal builds emit no joystick fake storage or resets.

## Data streams

`DATA`, `READ`, and bare `RESTORE` provide the classic BASIC data stream:

```basic
data 10, "READY"
data 20, "ALERT"

read itemCode, message$
print itemCode; " "; message$

restore
read itemCode, message$
```

`DATA` values must be compile-time numeric, string, or boolean values after constant folding. Runtime expressions and function calls are rejected. `READ` targets are scalar variables only. Array elements are not supported as `READ` targets yet. `RESTORE` currently has no argument and rewinds to the beginning of the data stream on all targets. Labelled or line-targeted restore is intentionally not implemented yet because C64 BASIC V2 cannot do that natively.

## User-defined functions

Functions may have parameters, local variables, side effects, and return values:

```basic
function AddBonus(Score, Bonus)
    local Result
    Result = Score + Bonus
    return Result
end function

Total = AddBonus(CurrentScore, 10)
```

Scalar struct parameters use `AS` in the parameter list:

```basic
function ShiftedRow(item AS TelegraphText, offset)
    local result
    result = item.row + offset
    item.row = 99
    return result
end function
```

Use a function call in an expression when the return value matters. A user-defined function may also be called as a standalone statement when only its side effects matter:

```basic
DrawHeader()
```

The standalone form lowers to the generated `GOSUB` call and discards the return value. A function used only as a standalone side-effect helper does not need a `RETURN expression`; the generated BASIC subroutine returns at `END FUNCTION`. Built-in functions and array reads are not valid standalone statements, so `values(0)` by itself is rejected.

Small helpers can be declared as `INLINE FUNCTION`. Inline functions are expanded at every call site and do not emit a BASIC subroutine or `GOSUB` call:

```basic
inline function PrintCell(row, column, text$)
    print_at row, column, text$
end function

PrintCell(4, 0, "READY")
```

Inline functions are intentionally limited to predictable expansion. They cannot contain labels, `GOTO`, `GOSUB`, `EXIT FOR`, or `CONTINUE FOR`; they cannot assign to their parameters; and if they return a value, the `RETURN expression` must be the final statement.

## Output

`PRINT` accepts semicolon-separated expressions. A trailing semicolon suppresses the newline:

```basic
print "SECONDS: "; countdown
print "WAIT";
```

Portable positioned output uses 1-based `row, column` coordinates:

```basic
print_at 1, 1, "WARNING"
print_at warningRow, 1, "SECONDS: "; countdown
```

The comma after the column is required. Constant coordinates are checked against the selected target's screen dimensions; dynamic coordinates are not range-checked yet. Target renderers lower these human-facing coordinates to each machine's native zero-based positioning.

Device output is available for printer-like logging and emulator capture workflows:

```basic
if device_available(RS232) then
    open_device Log, RS232
    print_device Log; "TEST RESULT: "; 1
    close_device Log
end if
```

Supported device constants are `PRINTER`, `TEXT_PRINTER`, `SHARED_DRIVE`, and `RS232`. Device handles are Meta-BASIC names local to the compilation unit and are lowered to target-specific channel or stream numbers. `PRINT_DEVICE` uses the same semicolon-separated item style as `PRINT`.

`TEXT_PRINTER` is intended for plain text capture workflows. On Spectrum it lowers `PRINT_DEVICE` to native `LPRINT`, which is the path Fuse can write to a host text file through ZX Printer emulation. On Atari and C64 it currently behaves like `PRINTER`.

`SHARED_DRIVE` is intended for emulator host-folder workflows. It is implemented for Atari host-device workflows and lowers to `H6:MCP.TXT` by default for Altirra. The Atari800 launcher overrides that to `H1:MCP.TXT`.

`DEVICE_AVAILABLE` is a best-effort runtime helper; C64 RS-232 currently reports available because probing the channel can disturb the connection, while printer availability can be checked more directly on some targets.

## Test Mode

Builds may enable `testMode` through the compiler options, the CLI `--run-tests` flag, or a build configuration JSON property:

```json
{
  "testMode": true,
  "files": ["tests.mbas"]
}
```

Test-only syntax is rejected in normal builds. In test mode, the compiler generates a test runner instead of normal program startup. All `TEST` blocks are discovered automatically and executed in deterministic source order.

```basic
function Add(Left, Right)
    return Left + Right
end function

globals
    CurrentScore = 0
    PlayerName$ = "READY"
end globals

test AdditionWorks()
    local Result
    Result = Add(2, 3)
    assert_eq 5, Result
end test
```

`GLOBALS` blocks may contain assignment statements. The generated test runner replays those assignments before each test, so shared global fixture variables return to their declared initial values. This is explicit on purpose: globals outside a `GLOBALS` block are left alone.

`TEST Name()` takes no parameters and returns no value. It may declare `LOCAL` variables, use normal statements, and call normal `FUNCTION`s.

Runtime fakes for `JIFFIES()`, `KEY_CODE()`, and `KEY_PRESSED()` are reset before each test. Use `SET_JIFFIES(n)`, `SET_KEY_CODE(n)`, and `SET_KEY_PRESSED(n)` inside a test to make time and keyboard-dependent code deterministic.

Supported assertions are:

```basic
assert_true expression
assert_false expression
assert_eq expected, actual
assert_ne expected, actual
assert_print expectedText$
assert_printat row, column, expectedText$
assert_screen_border_color colour
assert_screen_background_color colour
assert_screen_text_color colour
assert_cell_text_color colour
assert_cell_background_color colour
```

Assertions count successes and failures, continue after failure, and failed tests do not prevent later tests from running. The generated summary prints test, pass, fail, assertion, failure, and free-memory counts.

When launched through the helper scripts, `--printer-output` mirrors the test runner's own progress and summary output to a configured device in addition to the screen. Select the device with `--test-output-device printer`, `--test-output-device text-printer`, `--test-output-device shared-drive`, or `--test-output-device rs232`. If no device is passed to a launch script, each target chooses its configured default. Normal program `PRINT` output remains captured or suppressed according to test-mode assertion behavior; the mirrored output is the runner log, not arbitrary output from the code under test.

`ASSERT_PRINT` compares against the most recent logical non-positioned `PRINT` output captured in test mode. Semicolon-separated print items are concatenated into one captured value, so `print "A"; "B"` captures `AB`.
For portable output assertions, prefer string output; numeric formatting still follows the target BASIC conversion rules.

`ASSERT_PRINTAT row, column, text$` compares against the most recent logical `PRINT_AT` output captured in test mode. It checks the portable 1-based row, column, and semicolon-concatenated text. It does not inspect emulator screen memory.

Colour assertions compare the latest portable colour command state captured in test mode. `CLS colour` counts as setting the screen background colour. Colour assertion values use portable colour names such as `BLUE` and `WHITE`, not target-specific numeric colour codes.

## Control flow

### Conditional blocks

```basic
if confirmed and urgency >= 4 then
    print "ATTACK CONFIRMED"
else
    print "AWAITING SECOND SOURCE"
end if
```

`ELSE` is optional, nesting is supported, and every `IF` requires `END IF`.

### Subroutines

```basic
gosub updateClock
goto continue

updateClock:
    print "TICK"
    return
```

### Loops

```basic
for row = 0 to TEXT_ROWS - 1
    print row
next row

for countdown = 10 to 0 step -1
    print countdown
next countdown
```

Use `CONTINUE FOR` to advance the current `FOR` loop early, and `EXIT FOR` to leave it:

```basic
for index = 0 to count - 1
    if values(index) = 0 then
        continue for
    end if
    if values(index) < 0 then
        exit for
    end if
    print values(index)
next index
```

`WHILE/WEND` checks the condition before every iteration:

```basic
while count < 3
    print count
    count = count + 1
wend
```

`REPEAT/UNTIL` runs the body once before checking the exit condition:

```basic
repeat
    count = count - 1
    print count
until count = 0
```

`END` terminates program execution:

```basic
print "DONE"
end
```

## Screen and colour commands

Portable colours are `BLACK`, `BLUE`, `RED`, `MAGENTA`, `GREEN`, `CYAN`, `YELLOW`, and `WHITE`.

```basic
cls
cls BLUE
screen_border_color BLUE
screen_background_color BLACK
screen_text_color WHITE
cell_text_color YELLOW
cell_background_color BLUE
suppress_scroll_prompt
program_mode
```

`border_color` is a compatibility spelling for `screen_border_color`; `text_color` is a compatibility spelling for `screen_text_color`.

Cell colours may have no effect on targets without the corresponding per-cell feature. This is deliberate rather than an attempt to simulate the feature with a large runtime.

`suppress_scroll_prompt` refreshes the ZX Spectrum scroll counter so long printed output can continue without the interactive `scroll?` prompt. It has no effect on Atari 800XL or C64.

`program_mode` performs best-effort target setup for running a finished program: Spectrum refreshes the scroll counter, Atari hides the text cursor, and C64 disables the simple RUN/STOP check. It does not make ordinary `PRINT` safe for writing past the last screen cell; avoid bottom-right cursor-advancing output when you do not want native scrolling.

## Current omissions

The language does not yet implement variable declarations beyond `DIM` and function/test locals, procedures, namespaces, exports, automatic dependency loading, separate compilation, variable-length string arrays, labelled `RESTORE`, general function calls beyond documented built-ins and Meta-BASIC functions, or `PRINT` comma/apostrophe separators.
