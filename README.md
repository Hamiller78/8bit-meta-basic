# 8bit-meta-basic

Meta-BASIC is an experimental source language that transpiles a small, structured BASIC-like syntax into readable BASIC for classic home computers. The current implementation targets ZX Spectrum BASIC only.

The generated BASIC is intended to be a useful development artifact: numbered, readable, and suitable for inspection or loading into a Spectrum emulator.

## Status

This project is an early compiler prototype. It now has a tokenizer, a typed syntax tree, a semantic pass for compile-time constants, structured-control lowering, deterministic line numbering, and ZX Spectrum BASIC rendering.

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
```

Run the compiled CLI after building:

```text
npm start -- examples/warning.mbas --target spectrum
```

Write output to a file:

```text
npm run dev -- examples/warning.mbas --target spectrum --output program.bas
npm run dev -- examples/warning.mbas --target spectrum -o program.bas
```

Control generated label comments:

```text
npm run dev -- examples/warning.mbas --target spectrum --comments 0
npm run dev -- examples/warning.mbas --target spectrum --comments 1
npm run dev -- examples/warning.mbas --target spectrum --comments 2
```

`--comments 0` emits no label comment lines, `--comments 1` emits comment lines for labels written in Meta-BASIC source, and `--comments 2` also emits generated internal labels. The default is `2`.

## Supported Syntax

The milestone language supports:

- Blank lines
- Comments beginning with an apostrophe
- Labels such as `start:`
- Compile-time constants such as `const warningRow = screenRows - 2`
- Numeric assignments such as `urgency = sensorCount * 2 + alertLevel`
- `print` with one or more semicolon-separated expressions
- `goto label`
- Multiline `if expression then ... else ... end if`
- Nested `if` statements
- Optional `else` blocks
- Case-insensitive keywords

Identifiers may contain ASCII letters, digits, and underscores, and must begin with a letter or underscore.

Expressions support numeric literals, string literals, identifiers, parentheses, unary `-`, `NOT`, arithmetic `+ - * /`, comparisons, `AND`, `OR`, and boolean literals `TRUE` and `FALSE`.

Constants are evaluated at compile time, emit no BASIC lines, and may reference earlier constants. Runtime variables are numeric for this milestone.

## Example

Source:

```basic
const screenRows = 24
const warningRow = screenRows - 2
const initialCountdown = 5 * 12

start:
    print "WARNING"
    print "SECONDS: "; initialCountdown

    urgency = sensorCount * 2 + alertLevel

    if confirmed and urgency >= 4 then
        print "ATTACK CONFIRMED"
    else
        print "AWAITING SECOND SOURCE AT ROW "; warningRow
    end if

    goto start
```

Spectrum BASIC output:

```basic
10 REM start:
20 PRINT "WARNING"
30 PRINT "SECONDS: ";60
40 LET urgency=sensorCount * 2 + alertLevel
50 IF confirmed AND urgency >= 4 THEN GO TO 70
60 GO TO 100
70 REM __mb_1:
80 PRINT "ATTACK CONFIRMED"
90 GO TO 120
100 REM __mb_3:
110 PRINT "AWAITING SECOND SOURCE AT ROW ";22
120 REM __mb_2:
130 GO TO 10
```

## Diagnostics

Invalid input returns a nonzero exit code and writes diagnostics to standard error. Diagnostics include the source filename and line number.

Examples include duplicate labels, undefined labels, duplicate constants, unknown constants in constant expressions, assignment to a constant, division by zero while folding constants, missing operands, unmatched parentheses, missing `END IF`, unexpected `ELSE`, unsupported syntax, invalid CLI options, and file errors.

## Limitations

- Only the `spectrum` target is implemented.
- Only one source file is accepted.
- There are no variable declarations, local variables, procedures, functions, imports, or linking.
- There is no type system beyond limited compile-time checks for constants and known string assignments.
- String variables, arrays, function calls, exponentiation, `PRINT AT`, commas, apostrophe print separators, colour controls, and streams are not implemented.
- Output is plain text BASIC, not tokenized Spectrum data or TAP.
- There is no optimization, minification, source map support, editor integration, or language server.

## Roadmap

- Add more source constructs after the first syntax remains well-tested.
- Introduce target-specific libraries or namespaces for machine features.
- Add further BASIC dialect backends, such as Commodore and Atari 8-bit family support.
