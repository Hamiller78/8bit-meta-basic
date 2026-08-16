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

Build target output files:

```text
npm run build:spectrum -- --profile debug
npm run build:atari -- --profile balanced
npm run build:c64 -- --profile release
npm run build:all-targets -- --profile release
npm run build:all-targets -- --source examples/narf.mbas --profile release
npm run build:all-profiles
npm run build:spectrum:all-profiles
```

These commands write `.bas` files under:

```text
build/<profile>/<target>/warning.bas
```

Atari builds also create an import-friendly listing file:

```text
build/<profile>/atari800xl/warning.lst
build/<profile>/atari800xl/warning.atr-files/WARNING.LST
```

The Atari `.lst` keeps the generated ASCII BASIC text and uses Atari's `0x9B` line ending, which is the form expected by listing import flows such as `ENTER "D:WARNING.LST"`. The `warning.atr-files` directory is a staging folder for ATR tools and uses an Atari DOS-compatible filename. Full ATASCII character-set conversion is still intentionally out of scope.

When using an emulator that accepts ATR disk images directly, the generated `.atr` file can be mounted as a data disk. Some real-hardware-style devices and mini consoles create or manage their own ATR image from USB storage instead. In that workflow, copy the DOS-compatible listing from the staging directory, for example `build/release/atari800xl/narf.atr-files/NARF.LST`, into the device-managed disk image rather than copying the generated `narf.atr` into it.

Current Atari emulator workflow:

```text
D1: bootable Atari DOS 2.5 disk
D2: generated warning.atr data disk
```

After a cold boot, return to BASIC from DOS with `B. RUN CARTRIDGE` if needed, then import and save the program:

```basic
NEW
ENTER "D2:WARNING.LST"
LIST
SAVE "D2:WARNING.BAS"
RUN
```

`WARNING.LST` is the text-listing bridge. `SAVE` writes `WARNING.BAS` as a tokenized Atari BASIC file, which can later be started with:

```basic
RUN "D2:WARNING.BAS"
```

Profiles map to readability levels:

```text
debug    -> readability 2
balanced -> readability 1
release  -> readability 0
```

Optional local conversion tools are configured by copying `scripts/tools.example.json` to `scripts/tools.local.json` and filling in local executable paths and arguments. The example config includes Spectrum `bas2tap` for `.tap` files, AtariSIO `dir2atr` for `.atr` disk images, and C64 `petcat -w2` for tokenized BASIC V2 `.prg` files. Tool arguments can use placeholders such as `{input}`, `{output}`, `{sourceName}`, `{profile}`, and `{target}`. The Atari `dir2atr` example uses `inputArtifact: "atariDiskDirectory"` so `{input}` points at the generated `warning.atr-files` staging folder. The C64 `petcat` example uses `inputTransform: "lowercase"` because `petcat`'s text format treats lowercase ASCII as normal C64 uppercase/PETSCII text. The build scripts always create `.bas`; conversion tools run only when configured locally.

When passing options through `npm run`, the `--` separates npm's own options from script options. The direct Node form does not need that separator, for example `node scripts/build-target.mjs spectrum --all-profiles`.

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

For C64 output, readability level `1` uses compact variable names and adds `REM SHORTNAME=ORIGINALNAME` comments at the first explicit assignment for each variable.

`--comments 0|1|2` is still accepted as a compatibility alias for the label-comment portion of this setting.

## N.A.R.F. Demo

`examples/narf.mbas` is the larger cross-target demo used during development. It renders a fictional **Nuclear Attack Response Failsafe** screen with a static status area, a ticking clock, and a bottom-row news ticker.

Build deployable release artifacts with local conversion tools enabled:

```text
npm run build:all-targets -- --source examples/narf.mbas --profile release
```

Expected outputs:

```text
build/release/spectrum/narf.bas
build/release/spectrum/narf.tap
build/release/atari800xl/narf.bas
build/release/atari800xl/narf.lst
build/release/atari800xl/narf.atr
build/release/atari800xl/narf.atr-files/NARF.LST
build/release/c64/narf.bas
build/release/c64/narf.prg
```

The Spectrum `.tap` and C64 `.prg` are currently the most direct emulator/mini-console artifacts. Atari workflows vary more: emulators can often mount `narf.atr` directly, while some USB/device workflows need `NARF.LST` copied into a disk image created by the device itself, then imported with:

```basic
ENTER "D:NARF.LST"
RUN
```

If the Atari display crops the far right or bottom of the ticker, increase the emulator or device display size/overscan setting. The program writes to the logical `GRAPHICS 0` text area, but visible TV-safe area differs across emulators, PAL/NTSC settings, and displays.

## Supported Syntax

The milestone language supports:

- Blank lines
- Comments beginning with an apostrophe
- Labels such as `start:`
- Target-provided environment constants such as `TEXT_ROWS`, `TEXT_COLUMNS`, and `JIFFIES_PER_SECOND`
- Compile-time constants such as `const warningRow = TEXT_ROWS - 2`
- Compile-time string fill helpers such as `string$("*", TEXT_COLUMNS)` and `space$(TEXT_COLUMNS)`
- Runtime string slicing with `mid$(text$, start, length)`
- Runtime jiffy timer reading with `jiffies()`
- Numeric assignments such as `urgency = sensorCount * 2 + alertLevel`
- String variable assignments such as `tickerText$ = "READY"`
- `print` with one or more semicolon-separated expressions
- Portable positioned output such as `print_at 10, 5; "WARNING"`
- `cls` and `cls colour` with portable background colour constants
- `border_color colour` with portable border colour constants
- `text_color colour` with portable foreground/text colour constants
- `goto label`
- `gosub label`
- `return`
- Multiline `if expression then ... else ... end if`
- Nested `if` statements
- Optional `else` blocks
- Case-insensitive keywords

Identifiers may contain ASCII letters, digits, and underscores, and must begin with a letter or underscore. A trailing `$` marks a string variable.

Expressions support numeric literals, string literals, identifiers, compile-time `STRING$` and `SPACE$`, runtime `MID$`, `LEN`, and `JIFFIES`, parentheses, unary `-`, `NOT`, arithmetic `+ - * /`, comparisons, `AND`, `OR`, and boolean literals `TRUE` and `FALSE`.

Constants are evaluated at compile time, emit no BASIC lines, and may reference earlier constants or target environment constants. `JIFFIES_PER_SECOND` currently resolves to `50` for all targets. `STRING$(char$, count)` and `SPACE$(count)` are compile-time-only helpers; their arguments must fold to constants, and their result length is capped at 255 characters. Runtime variables are numeric unless their name ends in `$`. Current runtime string support includes assignment, output, concatenation, `MID$(text$, start, length)`, and `LEN(text$)`. Atari output lowers Meta-BASIC string concatenation into Atari-style substring assignments where needed.

`jiffies()` returns the target machine's running timer tick count: Spectrum uses the three-byte `FRAMES` counter, Atari uses the three-byte `RTCLOK` counter, and C64 uses `TI`. The portable unit is a target jiffy/frame-ish tick, not milliseconds.

The portable colour constants are `BLACK`, `BLUE`, `RED`, `MAGENTA`, `GREEN`, `CYAN`, `YELLOW`, and `WHITE`. They are semantic colour names, not native target colour numbers, and currently may be used only where a colour is expected, such as `cls BLUE`, `border_color BLUE`, or `text_color YELLOW`.

Compiler output is readable BASIC text. Atari builds additionally create a `.lst` text-listing variant with Atari line endings and a staging folder for ATR creation. The optional build-script tool hooks can additionally create packaged files such as Spectrum `.tap`, Atari `.atr`, or C64 `.prg` when local conversion tools are configured.

Generated lines are checked against practical editable limits for each target: 80 characters on C64, 120 on Atari 800XL, and 640 on Spectrum. If a generated line is too long, compilation fails with a diagnostic pointing back to the source line.

Line numbers start at 10 and normally use increments of 10. If that would exceed the target's maximum line number, the compiler automatically switches to increments of 1. Programs that still do not fit are rejected. Current line-number limits are Spectrum 9999, Atari 800XL 32767, and C64 63999.

## Example

Source:

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

Spectrum BASIC output:

```basic
10 LET SENSORCOUNT=1
20 LET ALERTLEVEL=2
30 LET CONFIRMED=1
40 LET A$="DEFENCE NETWORK ONLINE"
50 BORDER 1
60 PAPER 1
70 CLS
80 REM START:
90 PRINT "********************************"
100 PRINT "WARNING"
110 PRINT A$
120 PRINT "SECONDS: ";60
130 LET URGENCY=SENSORCOUNT * 2 + ALERTLEVEL
140 IF ((CONFIRMED) <> 0) AND ((URGENCY >= 4) <> 0) THEN GO TO 160
150 GO TO 190
160 REM __MB_1:
170 PRINT AT 20,5;"ATTACK CONFIRMED"
180 GO TO 210
190 REM __MB_3:
200 PRINT "AWAITING SECOND SOURCE AT ROW ";20
210 REM __MB_2:
220 GO TO 80
```

## Positioned Output

The same Meta-BASIC statement:

```basic
print_at 10, 5; "WARNING"
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

## Clear Screen

Plain `cls` clears the current text screen. The colour form selects a portable background colour and then clears:

```basic
cls BLUE
```

Spectrum BASIC:

```basic
10 PAPER 1
20 CLS
```

Atari 800XL BASIC:

```basic
10 SETCOLOR 2,7,8
20 PRINT CHR$(125);
```

Commodore 64 BASIC V2:

```basic
10 POKE 53281,6
20 PRINT CHR$(147);
```

The colour form does not emit border-colour or text-colour changes. Atari colour values are deterministic `GRAPHICS 0` approximations and may vary in appearance across PAL, NTSC, emulator, and display settings.

## Border Colour

`border_color colour` changes the target machine's border colour without changing the text/background colour:

```basic
border_color BLUE
```

Spectrum BASIC:

```basic
10 BORDER 1
```

Atari 800XL BASIC:

```basic
10 SETCOLOR 4,7,8
```

Commodore 64 BASIC V2:

```basic
10 POKE 53280,6
```

Atari border colours use the same deterministic hue/luminance approximations as `cls colour`.

## Diagnostics

Invalid input returns a nonzero exit code and writes diagnostics to standard error. Diagnostics include the source filename and line number.

Examples include duplicate labels, undefined labels, duplicate constants, unknown constants in constant expressions, assignment to a constant, division by zero while folding constants, missing operands, unmatched parentheses, missing `END IF`, unexpected `ELSE`, unsupported syntax, invalid CLI options, and file errors.

## Limitations

- Only the `spectrum`, `atari800xl`, and `c64` targets are implemented.
- Only one source file is accepted.
- There are no variable declarations, local variables, procedures, functions, imports, or linking.
- There is no type system beyond limited compile-time checks for constants and known string assignments.
- Arrays, runtime `LEFT$`/`RIGHT$`, general function calls, and exponentiation are not implemented.
- Commas and apostrophe print separators in `PRINT`, streams, and target character-set conversion are not implemented.
- The compiler emits plain text BASIC. Atari `.lst` output currently only adapts line endings to Atari's `0x9B`; full ATASCII conversion is not implemented. Tokenized BASIC, TAP, ATR, PRG, and disk images are optional build-script artifacts that require local tools.
- There is no optimization, minification, source map support, editor integration, or language server.

## Roadmap

- Add more source constructs after the first syntax remains well-tested.
- Introduce target-specific libraries or namespaces for machine features.
- Refine portable text-colour mappings after more emulator and hardware testing, especially for Atari `GRAPHICS 0`.
- Add further BASIC dialect backends.
