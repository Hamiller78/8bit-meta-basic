# 8bit-meta-basic

Meta-BASIC is an experimental source language that transpiles a small, structured BASIC-like syntax into readable BASIC for classic home computers. This first milestone targets ZX Spectrum BASIC only.

The generated BASIC is intended to be a useful development artifact: numbered, readable, and suitable for inspection or loading into a Spectrum emulator.

## Status

This project is an early vertical slice. It proves the path from one `.mbas` file to Spectrum BASIC, but it is not a complete language yet.

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

## Supported Syntax

The milestone language supports:

- Blank lines
- Comments beginning with an apostrophe
- Labels such as `start:`
- `print "literal"`
- `goto label`
- Multiline `if expression then ... else ... end if`
- Nested `if` statements
- Optional `else` blocks
- Case-insensitive keywords

Identifiers may contain ASCII letters, digits, and underscores, and must begin with a letter or underscore.

For now, an `if` condition is preserved as trimmed Spectrum BASIC expression text. Meta-BASIC does not parse or type-check expressions yet.

## Example

Source:

```basic
start:
    print "WARNING"

    if confirmed then
        print "ATTACK CONFIRMED"
    else
        print "AWAITING SECOND SOURCE"
    end if

    goto start
```

Spectrum BASIC output:

```basic
10 REM start:
20 PRINT "WARNING"
30 IF confirmed THEN GO TO 50
40 GO TO 80
50 REM __mb_1:
60 PRINT "ATTACK CONFIRMED"
70 GO TO 100
80 REM __mb_3:
90 PRINT "AWAITING SECOND SOURCE"
100 REM __mb_2:
110 GO TO 10
```

## Diagnostics

Invalid input returns a nonzero exit code and writes diagnostics to standard error. Diagnostics include the source filename and line number.

Examples include duplicate labels, undefined labels, missing `END IF`, unexpected `ELSE`, unsupported syntax, invalid CLI options, and file errors.

## Limitations

- Only the `spectrum` target is implemented.
- Only one source file is accepted.
- There are no variables, declarations, procedures, functions, constants, imports, or linking.
- Expressions are not parsed beyond preserving `if` condition text.
- Output is plain text BASIC, not tokenized Spectrum data or TAP.
- There is no optimization, minification, source map support, editor integration, or language server.

## Roadmap

- Add more source constructs after the first syntax remains well-tested.
- Introduce target-specific libraries or namespaces for machine features.
- Add further BASIC dialect backends, such as Commodore and Atari 8-bit family support.
