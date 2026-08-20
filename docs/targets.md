# Target machines and generated output

All targets share one parsed syntax tree and target-independent control-flow lowering. Each backend then renders readable BASIC and expands portable operations where the original dialect differs.

## Overview

| Behaviour | ZX Spectrum | Atari 800XL | Commodore 64 |
| --- | --- | --- | --- |
| Text area | 22 × 32 | 24 × 40 | 25 × 40 |
| Maximum line number | 9999 | 32767 | 63999 |
| Practical generated-line limit | 640 | 120 | 80 |
| Assignment | `LET X=1` | `X=1` | `X=1` |
| `dim values(3)` | `DIM V(3)`, indexes shift to `1..3` | `DIM VALUES(2)`, indexes stay `0..2` | `DIM VALUES(2)`, indexes stay `0..2` |
| Jump | `GO TO` | `GOTO` | `GOTO` |
| Positioned output | Native `PRINT AT` | `POSITION` + `PRINT` | POKE/ROM-call macro + `PRINT` |

Line numbers normally begin at 10 in increments of 10. The compiler switches to increments of 1 if necessary and rejects programs that still exceed the target limit.

## Positioned output

Meta-BASIC:

```basic
print_at 10, 5; "WARNING"
```

Spectrum:

```basic
10 PRINT AT 10,5;"WARNING"
```

Atari 800XL:

```basic
10 POSITION 5,10
20 PRINT "WARNING"
```

C64:

```basic
10 POKE 214,10
20 POKE 211,5
30 SYS 58732
40 PRINT "WARNING"
```

Constant coordinates must fit these zero-based ranges:

- Spectrum: rows `0..21`, columns `0..31`
- Atari: rows `0..23`, columns `0..39`
- C64: rows `0..24`, columns `0..39`

## ZX Spectrum

- Assignments use `LET`.
- Labels and identifiers are rendered in uppercase where appropriate.
- String variables are mapped deterministically to single-letter names such as `A$`.
- Integer `%` variables are rendered as regular numeric variables and assignment is coerced with `INT`.
- Numeric and integer arrays are mapped to single-letter numeric array names. Meta-BASIC index `0` renders as Spectrum index `1`.
- `PRINT_AT` maps directly to `PRINT AT`.
- `CLS colour` uses `PAPER` and then `CLS`.
- Border, global text, and following-cell colours use native `BORDER`, `INK`, and `PAPER` concepts.
- `KEY_CODE()` uses `INKEY$`; short taps can be missed while the program is busy.
- `JIFFIES()` reads the three-byte `FRAMES` counter.

## Atari 800XL

- The backend targets built-in Atari BASIC, not Turbo-BASIC XL or BASIC XL.
- Assignments omit `LET`.
- `PRINT_AT` reverses portable `row, column` into Atari's `POSITION column,row`.
- String variables receive `DIM NAME$(255)` before their first assignment.
- String concatenation is lowered into Atari substring assignments where necessary.
- Integer `%` variables are rendered as regular numeric variables and assignment is coerced with `INT`.
- Numeric and integer arrays render as native Atari arrays with the declared count lowered to a zero-based upper bound.
- `CLS` uses `PRINT CHR$(125);`.
- Global colours use `SETCOLOR`; cell colours have no effect in `GRAPHICS 0`.
- `KEY_CODE()` reads `PEEK(764)` and clears a consumed key with `POKE 764,255`.
- `JIFFIES()` reads the three-byte `RTCLOK` counter.
- The compiler does not emit `GRAPHICS 0` automatically.

Atari colour values are deterministic approximations and can look different between PAL, NTSC, emulators, and displays.

## Commodore 64

- The backend targets built-in Commodore BASIC V2 without an extension cartridge or injected runtime.
- Assignments omit `LET`.
- `PRINT_AT` initially expands to writes to row and column editor variables followed by `SYS 58732`.
- `CLS` uses `PRINT CHR$(147);`.
- Border and background colours use `POKE 53280` and `POKE 53281`; the current text colour uses `POKE 646`.
- C64 cell background colour has no direct equivalent and therefore has no effect.
- `KEY_CODE()` uses `GET` and converts a returned character with `ASC`.
- `JIFFIES()` uses `TI`.
- Integer `%` variables render as native C64 integer variables and assignment is coerced with `INT`.
- Numeric and integer arrays render as native C64 arrays with deterministic variable-name mapping and zero-based upper bounds.

Commodore BASIC V2 distinguishes variable names using only their first two significant characters. The backend therefore maps Meta-BASIC variables deterministically and prevents two source variables from silently becoming the same C64 variable. Compact modes avoid keywords and system names such as `TI` and `TI$`.

## Readability

`--readability 0`, `1`, and `2` control label comments and variable-name compactness. Generated code remains deterministic at every level. String literal contents are preserved; target character-set translation is a separate concern.
