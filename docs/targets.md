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
| `dim messages$(3,12)` | `DIM M$(3,12)`, indexes shift to `1..3` | one backing `DIM MESSAGES$(36)` string | `DIM MESSAGES$(2)` |
| Jump | `GO TO` | `GOTO` | `GOTO` |
| Positioned output | Native `PRINT AT` | `POSITION` + `PRINT` | POKE/ROM-call macro + `PRINT` |

Line numbers normally begin at 10 in increments of 10. The compiler switches to increments of 1 if necessary and rejects programs that still exceed the target limit.

## Positioned output

Meta-BASIC:

```basic
print_at 10, 5, "WARNING"
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
- Readability `0` and `1` compact long numeric scalar names while preserving Spectrum's required single-letter names for strings, arrays, and `FOR` counters. Readability `2` keeps readable uppercase numeric scalar names where practical.
- Numeric and integer arrays are mapped to single-letter numeric array names. Meta-BASIC index `0` renders as Spectrum index `1`.
- Fixed-width string arrays are mapped to single-letter Spectrum string arrays such as `M$(3,12)`.
- `PRINT_AT` maps directly to `PRINT AT`.
- `TEXT_PRINTER` device output maps `PRINT_DEVICE` to `LPRINT` so Fuse's ZX Printer text-file capture can receive plain text.
- `SHARED_DRIVE` is not supported on Spectrum.
- `CLS colour` uses `PAPER` and then `CLS`.
- Border, global text, and following-cell colours use native `BORDER`, `INK`, and `PAPER` concepts.
- `SUPPRESS_SCROLL_PROMPT` emits `POKE 23692,255` to refresh the native scroll-prompt counter.
- `PROGRAM_MODE` emits the same scroll-prompt counter refresh.
- `KEY_PRESSED()` checks `INKEY$ <> ""`; `KEY_CODE()` uses `INKEY$`, so short taps can be missed while the program is busy.
- `JIFFIES()` reads the three-byte `FRAMES` counter.
- `FREE_MEMORY()` uses the 48K ROM free-memory routine via `USR 7962`.
- `RND()` lowers to native `RND`; `RANDOMIZE` lowers to Spectrum `RANDOMIZE`.

## Atari 800XL

- The backend targets built-in Atari BASIC, not Turbo-BASIC XL or BASIC XL.
- Assignments omit `LET`.
- Readability `0` and `1` use deterministic compact variable names to save memory and avoid native tokenizer surprises. Readability `2` keeps readable uppercase names where practical for source-level inspection.
- `PRINT_AT` reverses portable `row, column` into Atari's `POSITION column,row`.
- String variables receive `DIM NAME$(255)` before their first assignment.
- String concatenation is lowered into Atari substring assignments where necessary.
- `TEXT_PRINTER` currently lowers like `PRINTER` and opens `P:`.
- `SHARED_DRIVE` opens `H6:MCP.TXT` for Altirra H: host-device text capture.
- Integer `%` variables are rendered as regular numeric variables and assignment is coerced with `INT`.
- Numeric and integer arrays render as native Atari arrays with the declared count lowered to a zero-based upper bound.
- Fixed-width string arrays render as one backing Atari string. In readable output, `dim messages$(3,12)` becomes `DIM MESSAGES$(36)`, and `messages$(2)` renders as the substring `MESSAGES$(25,36)`. In compact output, the backing name is shortened like other variables.
- `CLS` uses `PRINT CHR$(125);`.
- Global colours use `SETCOLOR`; cell colours have no effect in `GRAPHICS 0`.
- `SUPPRESS_SCROLL_PROMPT` has no effect.
- `PROGRAM_MODE` emits `POKE 752,1` to hide the text cursor.
- `KEY_PRESSED()` checks `PEEK(764) <> 255`; `KEY_CODE()` reads `PEEK(764)` and clears a consumed key with `POKE 764,255`.
- `JIFFIES()` reads the three-byte `RTCLOK` counter.
- `FREE_MEMORY()` lowers to native `FRE(0)`.
- `RND()` lowers to `RND(0)`; `RANDOMIZE` is accepted but ignored.
- The compiler does not emit `GRAPHICS 0` automatically.

Atari colour values are deterministic approximations and can look different between PAL, NTSC, emulators, and displays.

## Commodore 64

- The backend targets built-in Commodore BASIC V2 without an extension cartridge or injected runtime.
- Assignments omit `LET`.
- `PRINT_AT` initially expands to writes to row and column editor variables followed by `SYS 58732`.
- `CLS` uses `PRINT CHR$(147);`.
- Border and background colours use `POKE 53280` and `POKE 53281`; the current text colour uses `POKE 646`.
- C64 cell background colour has no direct equivalent and therefore has no effect.
- `SUPPRESS_SCROLL_PROMPT` has no effect.
- `PROGRAM_MODE` emits `POKE 808,234` to disable the simple RUN/STOP check.
- `TEXT_PRINTER` currently lowers like `PRINTER` and uses device 4.
- `SHARED_DRIVE` is not supported on C64.
- `KEY_PRESSED()` checks `PEEK(198) > 0`; `KEY_CODE()` uses `GET` and converts a returned character with `ASC`.
- `JIFFIES()` uses `TI`.
- `FREE_MEMORY()` lowers to `FRE(0)` with the signed-result correction for values above 32767.
- `RND()` lowers to `RND(1)`; `RANDOMIZE seed` lowers to a generated assignment using `RND(-seed)`.
- Integer `%` variables render as native C64 integer variables and assignment is coerced with `INT`.
- Numeric and integer arrays render as native C64 arrays with deterministic variable-name mapping and zero-based upper bounds.
- Fixed-width string arrays render as native C64 string arrays; the fixed width is used by Meta-BASIC diagnostics, not emitted as a C64 dimension.

Commodore BASIC V2 distinguishes variable names using only their first two significant characters. The backend therefore maps Meta-BASIC variables deterministically and prevents two source variables from silently becoming the same C64 variable. Compact modes avoid keywords and system names such as `TI` and `TI$`. Readable mode also shortens names containing C64 BASIC token substrings such as `IF`, `TO`, `GO`, `OR`, or `LET`, because the native tokenizer can reject names that look harmless in Meta-BASIC source.

## Readability

`--readability 0`, `1`, and `2` control label comments and variable-name compactness. Generated code remains deterministic at every level. String literal contents are preserved; target character-set translation is a separate concern.
