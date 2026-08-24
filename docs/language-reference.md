# Meta-BASIC language reference

This document describes the implemented source language. Target-specific rendering is documented in [targets.md](targets.md).

Meta-BASIC is case-insensitive for keywords and symbol lookup. Identifiers may contain ASCII letters, digits, and underscores, must begin with a letter or underscore, and may end in `$` to denote a string variable or `%` to denote an integer numeric variable.

## Program structure

Blank lines are allowed. An apostrophe starts a comment that continues to the end of the source line.

```basic
' Wait for confirmation
start:
    goto start
```

Labels use `name:` and may be referenced by `goto` or `gosub`. Duplicate and undefined labels are compile-time errors.

## Constants

Constants are evaluated during compilation and emit no BASIC statements:

```basic
const warningRow = TEXT_ROWS - 2
const initialCountdown = 5 * 12
const borderLine$ = string$("*", TEXT_COLUMNS)
```

A constant may reference an earlier constant. Names are case-insensitive. Duplicate constants, unknown references, invalid operations, and compile-time division by zero are rejected.

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
3. `*` and `/`
4. `+` and `-`
5. `=`, `<>`, `<`, `<=`, `>`, and `>=`
6. `AND`
7. `OR`

Binary operators are left-associative. `^` renders to the native target exponentiation operator; target-specific numeric precision and domain quirks remain visible. Spectrum BASIC rejects negative bases for exponentiation at runtime, so avoid expressions such as `(-x) ^ 2` in portable programs for now. Comparison chaining such as `a < b < c` is rejected; write `a < b AND b < c`.

Meta-BASIC treats zero as false and every nonzero numeric value as true. Target lowering preserves these logical semantics despite differences between the original BASIC implementations.

## Built-in functions

| Function | Kind | Purpose |
| --- | --- | --- |
| `string$(text$, count)` | Compile time | Repeat a string |
| `space$(count)` | Compile time | Produce spaces |
| `mid$(text$, start, length)` | Runtime | Extract a string section |
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
| `key_code()` | Runtime | Poll the keyboard without waiting |
| `device_available(device)` | Runtime | Best-effort availability check for `PRINTER`, `TEXT_PRINTER`, `SHARED_DRIVE`, or `RS232` |

`CHR$`, `CODE`, and `ASC` are portable source spellings, but character-code meanings remain target-specific outside ordinary printable text. Spectrum lowers `CODE` and `ASC` to native `CODE`; Atari and C64 lower both to `ASC`.

`STR$` and `VAL` are portable source spellings for number/string conversion. Spectrum lowers them to `STR$ expression` and `VAL expression`; Atari and C64 lower them to `STR$(expression)` and `VAL(expression)`. For portable programs, use `VAL` with plain numeric strings rather than relying on Spectrum's ability to evaluate a string as a BASIC expression.

Math functions lower to the target BASIC function of the same name. Trigonometric functions use each target dialect's native angle unit and numeric behaviour.

Random numbers use:

```basic
randomize 1983
value = rnd()
```

`randomize` accepts an optional numeric seed. Atari BASIC ignores the seed because its native `RND` facility does not use the same explicit seed model.

`STRING$` and `SPACE$` require constant arguments, and their result is limited to 255 characters. `KEY_CODE()` is currently supported only as the complete right-hand side of a numeric assignment:

```basic
key = key_code()
```

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

## Output

`PRINT` accepts semicolon-separated expressions. A trailing semicolon suppresses the newline:

```basic
print "SECONDS: "; countdown
print "WAIT";
```

Portable positioned output uses zero-based `row, column` coordinates:

```basic
print_at 10, 5; "WARNING"
print_at warningRow, 0; "SECONDS: "; countdown
```

The semicolon after the column is required. Constant coordinates are checked against the selected target's screen dimensions; dynamic coordinates are not range-checked yet.

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

`SHARED_DRIVE` is intended for emulator host-folder workflows. It is currently implemented for Atari/Altirra only and lowers to the translated H: host-device file `H6:MCP.TXT`.

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

test AdditionWorks()
    local Result
    Result = Add(2, 3)
    assert_eq 5, Result
end test
```

`TEST Name()` takes no parameters and returns no value. It may declare `LOCAL` variables, use normal statements, and call normal `FUNCTION`s. Ordinary global variables are not reset automatically between tests.

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

Assertions count successes and failures, continue after failure, and failed tests do not prevent later tests from running. The generated summary prints test, pass, fail, assertion, and failure counts.

When launched through the helper scripts, `--printer-output` mirrors the test runner's own progress and summary output to a configured device in addition to the screen. Select the device with `--test-output-device printer`, `--test-output-device text-printer`, `--test-output-device shared-drive`, or `--test-output-device rs232`. If no device is passed to a launch script, each target chooses its configured default. Normal program `PRINT` output remains captured or suppressed according to test-mode assertion behavior; the mirrored output is the runner log, not arbitrary output from the code under test.

`ASSERT_PRINT` compares against the most recent logical non-positioned `PRINT` output captured in test mode. Semicolon-separated print items are concatenated into one captured value, so `print "A"; "B"` captures `AB`.
For portable output assertions, prefer string output; numeric formatting still follows the target BASIC conversion rules.

`ASSERT_PRINTAT row, column, text$` compares against the most recent logical `PRINT_AT` output captured in test mode. It checks the portable zero-based row, column, and semicolon-concatenated text. It does not inspect emulator screen memory.

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
```

`border_color` is a compatibility spelling for `screen_border_color`; `text_color` is a compatibility spelling for `screen_text_color`.

Cell colours may have no effect on targets without the corresponding per-cell feature. This is deliberate rather than an attempt to simulate the feature with a large runtime.

## Current omissions

The language does not yet implement variable declarations beyond `DIM` and function/test locals, procedures, imports/modules, variable-length string arrays, labelled `RESTORE`, general function calls beyond documented built-ins and Meta-BASIC functions, or `PRINT` comma/apostrophe separators.
