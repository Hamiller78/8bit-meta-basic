# 8bit-meta-basic

Meta-BASIC is an experimental source language that transpiles a small, structured BASIC-like syntax into readable BASIC for classic home computers. The current implementation targets ZX Spectrum BASIC, Atari 800XL BASIC, and Commodore 64 BASIC V2.

The generated BASIC is intended to be a useful development artifact: numbered, readable, and suitable for inspection or loading into a target-machine emulator.

## Status

This project is an early compiler prototype. It now has a tokenizer, a typed syntax tree, a semantic pass for compile-time constants, structured-control lowering, deterministic line numbering, and target-specific BASIC rendering.

## Prerequisite

- Node.js 24 LTS or later

## Install And Build

```text
npm install
npm test
npm run build
```

Run during development:

```text
npm run dev -- examples/warning.mbas --target spectrum
npm run dev -- examples/warning.mbas --target atari800xl
npm run dev -- examples/warning.mbas --target c64
```

Run the compiled CLI after building:

```text
npm start -- examples/warning.mbas --target spectrum
npm start -- examples/warning.mbas --target atari800xl
npm start -- examples/warning.mbas --target c64
```

Write output to a file:

```text
npm run dev -- examples/warning.mbas --target spectrum --output program.bas
npm run dev -- examples/warning.mbas --target spectrum -o program.bas
```

Control output readability:

```text
npm run dev -- examples/warning.mbas --target spectrum --readability 0
npm run dev -- examples/warning.mbas --target spectrum --readability 1
npm run dev -- examples/warning.mbas --target spectrum --readability 2
```

`--readability 0` emits no label comment lines and lets targets choose compact runtime variable names. `--readability 1` emits comment lines for labels written in Meta-BASIC source. `--readability 2` also emits generated internal labels and uses readable variable names where the target can do so safely. The default is `2`.

For C64 output, readability level `1` uses compact generated variable names and adds `REM Vn=ORIGINALNAME` comments at the first explicit assignment for each variable.

`--comments 0|1|2` is still accepted as a compatibility alias for the label-comment portion of this setting.

## Supported Syntax

The milestone language supports:

- Blank lines
- Comments beginning with an apostrophe
- Labels such as `start:`
- Compile-time constants such as `const warningRow = screenRows - 2`
- Numeric assignments such as `urgency = sensorCount * 2 + alertLevel`
- `print` with one or more semicolon-separated expressions
- Portable positioned output such as `print at 10, 5; "WARNING"`
- `goto label`
- Multiline `if expression then ... else ... end if`
- Nested `if` statements
- Optional `else` blocks
- Case-insensitive keywords

Identifiers may contain ASCII letters, digits, and underscores, and must begin with a letter or underscore.

Expressions support numeric literals, string literals, identifiers, parentheses, unary `-`, `NOT`, arithmetic `+ - * /`, comparisons, `AND`, `OR`, and boolean literals `TRUE` and `FALSE`.

Constants are evaluated at compile time, emit no BASIC lines, and may reference earlier constants. Runtime variables are numeric for this milestone.

Target output is readable BASIC text. Packaging into Spectrum TAP, Atari ATR, Commodore PRG, or tokenized BASIC files is not implemented yet.

## Example

Source:

```basic
const screenRows = 24
const warningRow = screenRows - 2
const initialCountdown = 5 * 12

sensorCount = 1
alertLevel = 2
confirmed = 1

start:
    print "WARNING"
    print "SECONDS: "; initialCountdown

    urgency = sensorCount * 2 + alertLevel

    if confirmed and urgency >= 4 then
        print at 10, 5; "ATTACK CONFIRMED"
    else
        print "AWAITING SECOND SOURCE AT ROW "; warningRow
    end if

    goto start
```

Spectrum BASIC output:

```basic
10 LET SENSORCOUNT=1
20 LET ALERTLEVEL=2
30 LET CONFIRMED=1
40 REM START:
50 PRINT "WARNING"
60 PRINT "SECONDS: ";60
70 LET URGENCY=SENSORCOUNT * 2 + ALERTLEVEL
80 IF ((CONFIRMED) <> 0) AND ((URGENCY >= 4) <> 0) THEN GO TO 100
90 GO TO 130
100 REM __MB_1:
110 PRINT AT 10,5;"ATTACK CONFIRMED"
120 GO TO 150
130 REM __MB_3:
140 PRINT "AWAITING SECOND SOURCE AT ROW ";22
150 REM __MB_2:
160 GO TO 40
```

## Positioned Output

The same Meta-BASIC statement:

```basic
print at 10, 5; "WARNING"
```

Spectrum BASIC:

```basic
10 PRINT AT 10,5;"WARNING"
```

Atari 800XL BASIC:

```basic
10 POSITION 5,10
20 PRINT "WARNING"
```

Commodore 64 BASIC V2:

```basic
10 POKE 214,10
20 POKE 211,5
30 SYS 58732
40 PRINT "WARNING"
```

## Diagnostics

Invalid input returns a nonzero exit code and writes diagnostics to standard error. Diagnostics include the source filename and line number.

Examples include duplicate labels, undefined labels, duplicate constants, unknown constants in constant expressions, assignment to a constant, division by zero while folding constants, missing operands, unmatched parentheses, missing `END IF`, unexpected `ELSE`, unsupported syntax, invalid CLI options, and file errors.

## Limitations

- Only the `spectrum`, `atari800xl`, and `c64` targets are implemented.
- Only one source file is accepted.
- There are no variable declarations, local variables, procedures, functions, imports, or linking.
- There is no type system beyond limited compile-time checks for constants and known string assignments.
- String variables, arrays, function calls, and exponentiation are not implemented.
- Commas and apostrophe print separators in `PRINT`, colour controls, streams, and target character-set conversion are not implemented.
- Output is plain text BASIC, not tokenized BASIC, TAP, ATR, or PRG.
- There is no optimization, minification, source map support, editor integration, or language server.

## Roadmap

- Add more source constructs after the first syntax remains well-tested.
- Introduce target-specific libraries or namespaces for machine features.
- Add further BASIC dialect backends.
