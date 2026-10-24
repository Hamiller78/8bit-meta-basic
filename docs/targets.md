# Target machines and generated output

All targets share one parsed syntax tree and target-independent control-flow lowering. Each backend then renders readable BASIC and expands portable operations where the original dialect differs.

## Overview

| Behaviour | ZX Spectrum | Atari 800XL | Commodore 64 | Agon Light |
| --- | --- | --- | --- | --- |
| Text area | 22 × 32 | 24 × 40 | 25 × 40 | 30 × 80 (mode 3) |
| Maximum line number | 9999 | 32767 | 63999 | 65279 |
| Practical generated-line limit | 640 | 120 | 80 | 251 |
| Assignment | `LET X=1` | `X=1` | `X=1` | `X=1` |
| `dim values(3)` | `DIM V(3)`, indexes shift to `1..3` | `DIM VALUES(2)`, indexes stay `0..2` | `DIM VALUES(2)`, indexes stay `0..2` | `DIM VALUES(2)`, indexes stay `0..2` |
| `dim messages$(3,12)` | `DIM M$(3,12)`, indexes shift to `1..3` | one backing `DIM MESSAGES$(36)` string | `DIM MESSAGES$(2)` | `DIM MESSAGES$(2)` |
| Jump | `GO TO` | `GOTO` | `GOTO` | `GOTO` |
| Positioned output | Native `PRINT AT` | `POSITION` + `PRINT #6` | POKE/ROM-call macro + `PRINT` | Native `PRINT TAB(column,row)` |
| Column-only cursor move | Current row + native `PRINT AT` | Column POKE | Column POKE | `PRINT TAB(column,VPOS)` |

Line numbers normally begin at 10 in increments of 10. The compiler switches to increments of 1 if necessary and rejects programs that still exceed the target limit.

Release builds pack safe target operations produced by one Meta-BASIC statement onto colon-separated BASIC lines where the target line limit permits it. Consequently, the Atari and C64 expansions shown below may occupy one physical BASIC line in release output while remaining separate in readable output.

Short release-mode conditional bodies use each dialect's native `IF ... THEN statement` form. Atari and C64 line-number branches omit the redundant `GOTO` keyword (`IF condition THEN line`); Spectrum requires and retains `GO TO`. Dense enum-based subroutine dispatch uses `ON ... GOSUB` on Atari and C64 and an equivalent `IF ... THEN GO SUB` sequence on Spectrum. Atari gives native dispatch a dedicated no-match entry and computes a guaranteed in-range index, so unmatched values fall through without an extra guard line or error 3.

## Positioned output

Meta-BASIC:

```basic
print_at 10, 5, "WARNING"
```

Meta-BASIC `PRINT_AT` coordinates are 1-based and written as `row, column`.
The targets use zero-based native coordinates, so the compiler subtracts one
when it renders the final BASIC. Constant coordinates are folded at compile
time.

Spectrum:

```basic
10 PRINT AT 9,4;"WARNING"
```

Atari 800XL:

```basic
10 GRAPHICS 0
20 POSITION 4,9
30 PRINT #6;"WARNING"
```

C64:

```basic
10 POKE 214,9
20 POKE 211,4
30 SYS 58732
40 PRINT "WARNING"
```

Constant Meta-BASIC source coordinates must fit these 1-based ranges:

- Spectrum: rows `1..22`, columns `1..32`
- Atari: rows `1..24`, columns `1..40`
- C64: rows `1..25`, columns `1..40`
- Agon: rows `1..30`, columns `1..80`

Portable `INPUT` lowers to each dialect's native blocking keyboard `INPUT`. Atari ensures string destinations are dimensioned before input; Spectrum maps string names to its required single-letter variables and emits a following empty `PRINT` because native Spectrum `INPUT` does not advance the program's output cursor; C64 applies its deterministic two-character-safe names; and Agon retains safe BBC BASIC names. Meta-BASIC integer and `BYTE` destinations are read through numeric temporary storage and then coerced with `INT`.

Portable `SAVE_FILE`/`LOAD_FILE` use sequential files on C64 (`OPEN` device 8 for disk or device 1 for cassette), Atari (`D:` or `C:`), and Agon (`OPENOUT`/`OPENIN` on SD). Numeric records and length-prefixed character-code records make string data independent of delimiters. Spectrum packs the complete logical array into one compiler-generated character array and uses one native `SAVE name DATA array$()` or `LOAD name DATA array$()` tape block. Strings and the `STR$` representation of numbers are length-prefixed inside that block; loading reconstructs numeric values with `VAL`. The reusable scratch array is sized at compile time from the largest file operation in the program, trading some RAM for a single ROM tape interaction. A plain Atari compilation retains `D:` for a real DOS-equipped machine. The `atari1` and `atari2` launch profiles instead select their writable emulator host devices (`H6:` and `H1:`), because merely mounting the generated program image does not install a DOS `D:` handler in the BASIC session.

`FILE_EXISTS("NAME")` probes the 1541 status channel on C64, uses a trapped read-only `OPEN` on Atari, and tests the handle returned by `OPENIN` on Agon. The handle is closed immediately when the file exists. `DELETE_FILE "NAME"` lowers to a 1541 `SCRATCH` command on C64, `XIO 33` against the selected data drive on Atari, and MOS `*DELETE` on Agon. Both operations are rejected when the selected storage is tape unless they are inside a branch made unreachable by a compile-time false condition such as `IF FILE_STORAGE_DISK THEN`. Disk/SD `SAVE_FILE` already uses each target's replacing output operation; no preceding `DELETE_FILE` is required for ordinary overwrites.

When a C64 numeric `PRINT` or `PRINT_DEVICE` item follows a string item on the same Meta-BASIC statement, it is converted through `STR$` and has the reserved positive-sign space removed. This prevents an unwanted extra gap in mixed output such as `PRINT "TURN "; turn`. Other numeric items retain C64's native formatting. Compound numeric expressions are evaluated once into reusable temporary storage before conversion.

`SET_COLUMN column` uses the same 1-based column ranges but retains the current row. Spectrum reads its current print row and emits a native `PRINT AT`; Atari updates the low byte of `COLCRS` at address 85; C64 updates its cursor column at address 211; Agon combines the lowered column with native `VPOS`. Atari's supported 40-column `GRAPHICS 0` environment keeps the `COLCRS` high byte at address 86 equal to zero, so both Atari and C64 need only one `POKE`.

## ZX Spectrum

- Assignments use `LET`.
- Labels and identifiers are rendered in uppercase where appropriate.
- String variables are mapped deterministically to single-letter names such as `A$`.
- Integer `%` variables are rendered as regular numeric variables and assignment is coerced with `INT`.
- Readability `0` and `1` compact long numeric scalar names while preserving Spectrum's required single-letter names for strings, arrays, and `FOR` counters. Readability `2` keeps readable uppercase numeric scalar names where practical.
- Numeric and integer arrays are mapped to single-letter numeric array names. Meta-BASIC index `0` renders as Spectrum index `1`.
- Experimental `BYTE` arrays and fields use single-letter string storage at one character per value. Writes use `CHR$`; reads use `CODE` and become ordinary numeric expressions.
- When a struct array has multiple numeric fields, the compiler packs those fields into one two-dimensional Spectrum numeric array: the first dimension selects the element and the second selects the field. This saves single-letter array names; Meta-BASIC source still uses ordinary struct field access. String fields remain separate string arrays.
- Fixed-width string arrays are mapped to single-letter Spectrum string arrays such as `M$(3,12)`, plus hidden numeric arrays holding each element's logical length. Reads slice to the stored length, so implementation padding is excluded while deliberate trailing spaces remain part of the value.
- `PRINT_AT` maps to native `PRINT AT` with source coordinates lowered by one.
- `PRINT_INVERT` and `PRINT_INVERT_AT` use native `INVERSE 1`/`INVERSE 0`. Consecutive inverted prints share one pair; the current INK and PAPER values do not need to be read or rewritten.
- Printing into the bottom-right cell does not scroll the Spectrum display. Atari and C64 differ, and Agon's edge behavior has not yet been emulator-tested, so portable layouts should leave that one cell unused.
- `TEXT_PRINTER` device output maps `PRINT_DEVICE` to `LPRINT` so Fuse's ZX Printer text-file capture can receive plain text.
- `SHARED_DRIVE` is not supported on Spectrum.
- `CLS colour` uses `PAPER` and then `CLS`.
- Border, global text, and following-cell colours use native `BORDER`, `INK`, and `PAPER` concepts.
- `SUPPRESS_SCROLL_PROMPT` emits `POKE 23692,255` to refresh the native scroll-prompt counter.
- `PROGRAM_MODE` emits the same scroll-prompt counter refresh.
- `KEY_PRESSED()` checks `INKEY$ <> ""`; `KEY_CODE()` uses `INKEY$`, so short taps can be missed while the program is busy.
- `JIFFIES()` reads the three-byte `FRAMES` counter and renders it as one parenthesized expression, so arithmetic such as `targetTime - jiffies()` subtracts the whole counter value.
- `FREE_MEMORY()` uses the 48K ROM free-memory routine via `USR 7962`.
- `SCREEN_CODE` uses native `SCREEN$` followed by `CODE`.
- `RND()` lowers to native `RND`; `RANDOMIZE` lowers to Spectrum `RANDOMIZE`.

## Atari 800XL

- The backend targets built-in Atari BASIC, not Turbo-BASIC XL or BASIC XL.
- Requesting the `international` character group emits `POKE 756,204` to select the XL/XE international ROM character set. Supported umlauts stay readable in generated `.bas` text and become their one-byte ATASCII codes in the `.LST` passed to `basicParser`; they do not generate runtime `CHR$` fragments.
- Assignments omit `LET`.
- Readability `0` and `1` use deterministic compact variable names to save memory and avoid native tokenizer surprises. Readability `2` keeps readable uppercase names where practical for source-level inspection.
- `PRINT_AT` lowers 1-based source coordinates to Atari's zero-based `POSITION column,row`, then writes through the graphics-zero `S:` screen device with `PRINT #6`. This bypasses channel 0's logical-line editor, which can move existing physical rows when several independently positioned fields share a row. When a program uses this direct screen output, its generated startup executes `GRAPHICS 0` once to ensure channel 6 is open before the first positioned write; launchers and loaders are not required to preserve the interpreter's initial channel setup.
- `PRINT_INVERT` and `PRINT_INVERT_AT` accept string literals only and use `basicParser`'s inverse-string notation. The tokenized program contains inverse ATASCII bytes directly; no runtime `CHR$` construction or screen-memory inversion pass is generated.
- Writing the bottom-right cell through `PRINT #6` scrolls the display immediately, including with a trailing semicolon. Leave that cell unused when scrolling is unwanted.
- String variables receive `DIM NAME$(255)` before their first assignment.
- String concatenation is lowered into Atari substring assignments where necessary.
- `TEXT_PRINTER` currently lowers like `PRINTER` and opens `P:`.
- `SHARED_DRIVE` opens `H6:MCP.TXT` by default for Altirra H: host-device text capture. The Atari800 launcher overrides it to `H1:MCP.TXT`.
- Integer `%` variables are rendered as regular numeric variables and assignment is coerced with `INT`.
- Numeric and integer arrays render as native Atari arrays with the declared count lowered to a zero-based upper bound.
- Experimental `BYTE` arrays and fields use packed string storage at one character per value. Writes use `CHR$`; reads use `ASC` on a one-character slice.
- Fixed-width string arrays render as one packed Atari backing string plus a hidden numeric array holding each element's logical length. In readable output, `dim messages$(3,12)` reserves `DIM MESSAGES$(36)` for character storage. Reads copy only the recorded number of characters from the corresponding slice, preserving deliberate trailing spaces without exposing unused padding. Empty elements use a guarded read because Atari BASIC rejects an end position before the start position.
- `CLS` uses `PRINT CHR$(125);`.
- Global colours use `SETCOLOR`; cell colours have no effect in `GRAPHICS 0`.
- `SUPPRESS_SCROLL_PROMPT` has no effect.
- `PROGRAM_MODE` emits `POKE 752,1` to hide the text cursor.
- `KEY_PRESSED()` checks `PEEK(764) <> 255`; `KEY_CODE()` reads `PEEK(764)` and clears a consumed key with `POKE 764,255`.
- `JIFFIES()` reads the three-byte `RTCLOK` counter and renders it as one parenthesized expression, so arithmetic such as `targetTime - jiffies()` subtracts the whole counter value.
- `FREE_MEMORY()` lowers to native `FRE(0)`.
- `RND()` lowers to `RND(0)`; `RANDOMIZE` is accepted but ignored.
- `SCREEN_CODE` reads the current `SAVMSC` screen buffer and converts ordinary printable screen codes to their comparable character codes.

Atari colour values are deterministic approximations and can look different between PAL, NTSC, emulators, and displays.

## Commodore 64

- The backend targets built-in Commodore BASIC V2 without an extension cartridge or injected runtime.
- Assignments omit `LET`.
- `PRINT_AT` lowers 1-based source coordinates to writes to zero-based row and column editor variables followed by `SYS 58732`.
- `PRINT_INVERT` and `PRINT_INVERT_AT` use PETSCII reverse-on and reverse-off control bytes. `petcat` places those bytes directly in string literals, and consecutive inverted prints share one control pair.
- Printing into the bottom-right cell scrolls the display immediately, including with a trailing semicolon. Leave that cell unused when scrolling is unwanted.
- `CLS` uses `PRINT CHR$(147);`.
- Border and background colours use `POKE 53280` and `POKE 53281`; the current text colour uses `POKE 646`.
- C64 cell background colour has no direct equivalent and therefore has no effect.
- `SUPPRESS_SCROLL_PROMPT` has no effect.
- `PROGRAM_MODE` stores a three-byte no-STOP routine (`LDA #1; RTS`) in free RAM at `$02ED–$02EF`, then changes only the STOP vector's high byte with `POKE 809,2`. The standard C64 vector already has low byte `$ED`. This keeps `LIST` working and avoids an unsafe vector address between POKEs. Programs using `PROGRAM_MODE` must leave those three RAM bytes alone.
- `TEXT_PRINTER` currently lowers like `PRINTER` and uses device 4.
- `SHARED_DRIVE` is not supported on C64.
- `KEY_PRESSED()` checks `PEEK(198) > 0`; `KEY_CODE()` uses `GET` and converts a returned character with `ASC`.
- `JIFFIES()` uses `TI`.
- `FREE_MEMORY()` lowers to `FRE(0)` with the signed-result correction for values above 32767.
- `SCREEN_CODE` reads the standard BASIC text screen at address 1024 and converts ordinary printable screen codes to their comparable PETSCII codes.
- `RND()` lowers to `RND(1)`; bare `RANDOMIZE` reseeds it from the jiffy clock with `RND(-(TI+1))`, and `RANDOMIZE seed` uses `RND(-seed)`.
- Integer `%` variables render as native C64 integer variables and assignment is coerced with `INT`.
- Numeric and integer arrays render as native C64 arrays with deterministic variable-name mapping and zero-based upper bounds.
- Experimental `BYTE` arrays and fields render as native `%` integer storage. Compatible byte fields may be packed into a two-dimensional integer backing array.
- In a struct array, two or more floating numeric fields share one two-dimensional numeric array, and two or more `%` fields share one two-dimensional integer array. The first dimension selects the element and the second selects the field. A single field of either type keeps its one-dimensional array; string fields remain separate.
- Fixed-width string arrays render as native C64 string arrays; the fixed width is used by Meta-BASIC diagnostics, not emitted as a C64 dimension.

Commodore BASIC V2 distinguishes variable names using only their first two significant characters. The backend therefore maps Meta-BASIC variables deterministically and prevents two source variables from silently becoming the same C64 variable. Compact modes avoid keywords and system names such as `TI` and `TI$`. Readable mode also shortens names containing C64 BASIC token substrings such as `IF`, `TO`, `GO`, `OR`, or `LET`, because the native tokenizer can reject names that look harmless in Meta-BASIC source.

## Agon Light

- The backend currently targets Dean Belfield's BBC BASIC ADL 1.03 in `bbcbasic24.bin`. It is a 24-bit conversion of BBC BASIC for Z80 3.00, broadly compatible with BBC BASIC 4; it is not the separate, newer BBC BASIC V port.
- ADL mode gives programs and data access to the Agon's available user RAM rather than a 64 KiB Z80 segment. The interpreter nevertheless retains important older language limits: ordinary strings contain at most 255 characters, integers are signed 32-bit values, and five-byte real numbers provide about nine significant decimal digits. Variable count, variable-name length, and practical array size are limited by available memory rather than a small fixed table. Generated tokenized lines remain limited to 251 characters and numbered lines to the BBC BASIC range.
- Target lowering therefore uses only features supported by `bbcbasic24.bin`; the compiler must not assume that a facility from BBC BASIC V is available merely because a newer Agon interpreter implements it.
- Generated programs begin with `MODE 3`, establishing the compiler's fixed 80-column by 30-row text environment.
- Assignments omit `LET`; `%` variables use BBC BASIC's native 32-bit integer storage.
- Readable variable names are preserved unless they begin with a BBC BASIC keyword; unsafe names such as `TOTAL` and `VALUES` receive a `V_` prefix so the native tokenizer cannot reinterpret `TO` or `VAL` as syntax.
- Numeric, integer, byte, and string arrays retain Meta-BASIC's zero-based indexes. Declared element counts become BBC BASIC upper bounds, while a fixed string width remains a compile-time check and is not emitted as another array dimension.
- A `FOR` loop containing `EXIT FOR` or an early function `RETURN` lowers to an explicit counter loop. It therefore creates no BBC BASIC loop-control stack frame that could be bypassed by the jump or return; ordinary `FOR` loops retain native syntax.
- `PRINT_AT` and `SET_POS` use native `PRINT TAB(column,row);`; `SET_COLUMN` uses `VPOS` to retain the current row.
- `PRINT_INVERT` and `PRINT_INVERT_AT` query the current logical text foreground and background colours, swap them for an adjacent run of inverted prints, and then restore them. The query uses `VDU 23,0,&94` and MOS's returned palette-index byte, requiring Console8 VDP 2.7.0 or newer. Consecutive inverted prints share one query and swap.
- `SCREEN_CODE` sends Agon's VDP character-read command, synchronizes through OSBYTE 19, and reads MOS system-variable byte 9 through OSBYTE.
- Portable `CODE(text$)` renders as BBC BASIC `ASC(text$)`.
- Generated `.bas` listings are readable UTF-8 and preserve supported international characters directly. The built-in Agon packaging step encodes them as Windows-1252 bytes in the tokenized `.bbc` artifact. Use `.bbc` rather than the UTF-8 listing as the directly loadable program.
- `JIFFIES()` uses BBC BASIC `TIME`, whose unit is one centisecond; `JIFFIES_PER_SECOND` is therefore 100.
- `FREE_MEMORY()` uses `HIMEM-TOP`, and `RND()` uses `RND(1)`. BBC BASIC has no `RANDOMIZE` statement, so bare `RANDOMIZE` seeds through an assignment from `RND(-TIME)` and `RANDOMIZE seed` uses `RND(-seed)`.
- Portable foreground/background colours use BBC BASIC `COLOUR`. Because the Agon text display has no separate border, a portable border-colour request changes the background instead; this keeps the test runner's red failure indication visible.
- `PROGRAM_MODE` hides the text cursor with a VDU command. `SUPPRESS_SCROLL_PROMPT` has no effect.
- `GET_JOYSTICK` currently provides the portable Q/A/O/P/Space keyboard controls, which also works on Agon Light models without Console8 joystick ports.
- Device handles lower to files on the SD card. `PRINT_DEVICE` uses BBC BASIC `BPUT#` string output so test logs and ordinary output remain readable text instead of `PRINT#`'s typed binary record format.

The Fab Agon launch configuration copies tokenized BBC BASIC to the configured virtual SD card and writes an `autoexec.txt` that starts BBC BASIC ADL 1.03 from `bin/bbcbasic24.bin` with the staged `.bbc` program. Every build retains the readable `.bas` listing beside that tokenized artifact.

## Readability

`--readability 0`, `1`, and `2` control label comments, module separators, and variable-name compactness. The separate `--source-comments` option can keep `.mbas` apostrophe comments as generated `REM` lines; the debug profile enables it automatically. Generated code remains deterministic at every level. String literal contents are preserved; target character-set translation is a separate concern.

The compiler reuses generated expression-result variables when their values cannot be live at the same time. A result needed across a `GOSUB` keeps storage distinct from temporaries in the called routine. Function parameters, locals, and return values also draw from shared type-specific storage pools. Functions that can call one another receive distinct slots, while functions that cannot be active together may share slots across those source-level roles. This reduces variable-table pressure on all targets without changing Meta-BASIC source variables or function-call order.
