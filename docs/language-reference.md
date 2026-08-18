# Meta-BASIC language reference

This document describes the implemented source language. Target-specific rendering is documented in [targets.md](targets.md).

Meta-BASIC is case-insensitive for keywords and symbol lookup. Identifiers may contain ASCII letters, digits, and underscores, must begin with a letter or underscore, and may end in `$` to denote a string variable.

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

## Variables and assignment

Assignment does not use `LET` in Meta-BASIC source:

```basic
urgency = sensorCount * 2 + alertLevel
tickerText$ = "DEFENCE NETWORK ONLINE"
```

Variables ending in `$` are strings; other runtime variables are numeric. Constants and environment constants cannot be assigned to.

Current string support includes assignment, concatenation, output, `MID$`, `LEN`, `CHR$`, and `CODE`. Keep string values within the portable 255-character limit.

## Expressions

Supported primary expressions are:

- Numeric and string literals
- Identifiers
- `TRUE` and `FALSE`
- Parenthesized expressions
- Supported function calls

Supported operators, from highest to lowest precedence:

1. Unary `-` and `NOT`
2. `*` and `/`
3. `+` and `-`
4. `=`, `<>`, `<`, `<=`, `>`, and `>=`
5. `AND`
6. `OR`

Binary operators are left-associative. Comparison chaining such as `a < b < c` is rejected; write `a < b AND b < c`.

Meta-BASIC treats zero as false and every nonzero numeric value as true. Target lowering preserves these logical semantics despite differences between the original BASIC implementations.

## Built-in functions

| Function | Kind | Purpose |
| --- | --- | --- |
| `string$(text$, count)` | Compile time | Repeat a string |
| `space$(count)` | Compile time | Produce spaces |
| `mid$(text$, start, length)` | Runtime | Extract a string section |
| `len(text$)` | Runtime | Return string length |
| `chr$(code)` | Runtime | Convert a numeric character code to a one-character string |
| `code(text$)` | Runtime | Convert the first character of a string to a numeric code |
| `jiffies()` | Runtime | Read the target's running tick counter |
| `key_code()` | Runtime | Poll the keyboard without waiting |

`CHR$` and `CODE` are portable source spellings, but character-code meanings remain target-specific outside ordinary printable text. Spectrum lowers `CODE` to native `CODE`; Atari and C64 lower it to `ASC`.

`STRING$` and `SPACE$` require constant arguments, and their result is limited to 255 characters. `KEY_CODE()` is currently supported only as the complete right-hand side of a numeric assignment:

```basic
key = key_code()
```

## Output

`PRINT` accepts semicolon-separated expressions. A trailing semicolon suppresses the newline.

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

The language does not yet implement variable declarations, locals, procedures, user functions, imports, multiple source files, arrays, exponentiation, general function calls, or `PRINT` comma/apostrophe separators.
