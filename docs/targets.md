# Target machines and generated output

This guide owns machine capabilities, target-dependent values, and native BASIC
mappings. Source syntax and portable semantics belong in the
[language reference](language-reference.md); configuration/packaging belong in the
[toolchain reference](toolchain.md), and emulator/device setup in the
[running guide](running-programs.md). Native commands shown here are generated
output, not additional Meta-BASIC source syntax.

## Overview

| Behaviour | ZX Spectrum | Atari 800XL | Commodore 64 | VIC-20 | Agon Light |
| --- | --- | --- | --- | --- | --- |
| `TEXT_ROWS` × `TEXT_COLUMNS` | 22 × 32 | 24 × 40 | 25 × 40 | 23 × 22 | 30 × 80 (mode 3) |
| `JIFFIES_PER_SECOND` | 50 | 50 | 50 | 50 | 100 |
| Maximum line number | 9999 | 32767 | 63999 | 63999 | 65279 |
| Practical generated-line limit | 640 | 120 | 80 | 80 | 251 |
| Assignment | `LET X=1` | `X=1` | `X=1` | `X=1` | `X=1` |
| `dim values(3)` | `DIM V(3)`, indexes shift to `1..3` | `DIM VALUES(2)`, indexes stay `0..2` | `DIM VALUES(2)`, indexes stay `0..2` | `DIM VALUES(2)`, indexes stay `0..2` | `DIM VALUES(2)`, indexes stay `0..2` |
| `dim messages$(3,12)` | `DIM M$(3,12)`, indexes shift to `1..3` | one backing `DIM MESSAGES$(36)` string | `DIM MESSAGES$(2)` | `DIM MESSAGES$(2)` | `DIM MESSAGES$(2)` |
| Jump | `GO TO` | `GOTO` | `GOTO` | `GOTO` | `GOTO` |
| Positioned output | Native `PRINT AT` | `POSITION` + `PRINT #6` | POKE/ROM-call macro + `PRINT` | POKE/ROM-call macro + `PRINT` | Native `PRINT TAB(column,row)` |
| Column-only cursor move | Current row + native `PRINT AT` | Column POKE | Column POKE | Column POKE | `PRINT TAB(column,VPOS)` |

## Environment constants

`TEXT_ROWS`, `TEXT_COLUMNS`, and `JIFFIES_PER_SECOND` have the per-target values
in the overview. Coordinates span 1 through the corresponding text dimension.
`PI` and `E`, portable colour names, key names, and game-control names are described
by the [language reference](language-reference.md#constants); their hardware
interpretation remains target-specific.

## Line limits and numbering

Line numbers normally begin at 10 in increments of 10. The compiler uses increments
of 1 when needed and rejects programs that still exceed the target limit.
Examples below expand native operations for clarity; release packing can put them
on fewer physical lines. Packing/dispatch algorithms belong in
[architecture](architecture.md#control-flow-and-line-packing).

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

## Cursor positioning

`SET_COLUMN column` uses the same 1-based column ranges but retains the current row. Spectrum reads its current print row and emits a native `PRINT AT`; Atari updates the low byte of `COLCRS` at address 85; C64 updates its cursor column at address 211; Agon combines the lowered column with native `VPOS`. Atari's supported 40-column `GRAPHICS 0` environment keeps the `COLCRS` high byte at address 86 equal to zero, so both Atari and C64 need only one `POKE`.

## Keyboard input

Portable `INPUT` lowers to each dialect's native blocking keyboard `INPUT`. Atari ensures string destinations are dimensioned before input; Spectrum maps string names to its required single-letter variables and emits a following empty `PRINT` because native Spectrum `INPUT` does not advance the program's output cursor; C64 applies its deterministic two-character-safe names; and Agon retains safe BBC BASIC names. Meta-BASIC integer and `BYTE` destinations are read through numeric temporary storage and then coerced with `INT`.

Unsupported target keys resolve to `-1`; key constants are native codes, not an
ASCII guarantee. `GAME_UP/DOWN/LEFT/RIGHT` map to Q/A/O/P on Spectrum and cursor
keys on Atari, Commodore, and Agon; `GAME_FIRE` maps to Space. These event codes
are separate from the held controls described under [Joystick mappings](#joystick-mappings).

## Joystick mappings

| Target | Input source |
| --- | --- |
| ZX Spectrum | Q/A for up/down, O/P for left/right, Space for fire, through keyboard-matrix `IN` reads. No joystick interface is required and buffered key input is not consumed. |
| Atari 800XL | First joystick, through `STICK(0)` and `STRIG(0)`. |
| C64 | Port 2 through `PEEK(56320)` and native masks. |
| VIC-20 | Control port through VIA registers; the right-direction bit is exposed during the read. |
| Agon | Cursor keys and Space through held-key polling; native scan selectors are listed under [Agon Light](#agon-light). |

Normalized selector/value semantics and independent polling are defined in
[Joystick input](language-reference.md#joystick-input).

## File storage

| Target | Default medium | Other supported medium |
| --- | --- | --- |
| ZX Spectrum | Tape | None |
| Atari 800XL | Disk | Tape; emulator host-drive overrides |
| C64/VIC-20 | Disk | Tape |
| Agon Light | SD-card filesystem | None |

Select the medium using the [toolchain configuration](toolchain.md#program-inputs-and-project-configuration).

Portable `SAVE_FILE`/`LOAD_FILE` use sequential files on C64/VIC-20 (`OPEN` device 8 for disk or device 1 for cassette), Atari (`D:` or `C:`), and Agon (`OPENOUT`/`OPENIN` on SD). Numeric records and length-prefixed character-code records make string data independent of delimiters. A plain Atari compilation retains `D:` for a DOS-equipped machine; host-drive overrides are described in the [running guide](running-programs.md#atari-800xl-with-atari800-7x).

Sequential-file targets serialize struct arrays field by field through their existing
backing arrays rather than allocating a duplicate record array. Strings are stored
as lengths followed by character codes, preserving delimiters and empty values.

`FILE_EXISTS("NAME")` probes the 1541 status channel on C64, uses a trapped read-only `OPEN` on Atari, and tests the handle returned by `OPENIN` on Agon. The handle is closed immediately when the file exists. `DELETE_FILE "NAME"` lowers to a 1541 `SCRATCH` command on C64, `XIO 33` against the selected data drive on Atari, and MOS `*DELETE` on Agon. Source-level storage restrictions and replacement semantics are defined in [Data files](language-reference.md#data-files).

On Spectrum, one `SAVE_FILE` operation produces one tape block even when a struct array has several backing arrays. The compiler packs the logical values into a reusable character-array buffer before native `SAVE name DATA array$()` and unpacks it after `LOAD name DATA array$()`. Loading reconstructs numeric values with `VAL`. This consumes additional RAM: fixed-width strings reserve their declared width plus one length byte per element, while numeric elements reserve 17 bytes each for a length-prefixed `STR$` representation. The buffer is shared by all file operations and is sized for the largest one.

C64 and Spectrum can search forward for a named tape block but cannot search
backward. Atari cassette files have no filename; loading reads the next file at
the current position. Native BASIC/ROM prompts still handle PLAY or RECORD+PLAY
where provided. Physical loading and media setup belong in the [running guide](running-programs.md).

## Numeric output formatting

When a C64 numeric `PRINT` or `PRINT_DEVICE` item follows a string item on the same Meta-BASIC statement, it is converted through `STR$` and has the reserved positive-sign space removed. This prevents an unwanted extra gap in mixed output such as `PRINT "TURN "; turn`. Other numeric items retain C64's native formatting. Compound numeric expressions are evaluated once into reusable temporary storage before conversion.

VIC-20 shares the Commodore numeric formatting path. Other targets retain their
native BASIC numeric spelling and spacing.

## Runtime function mappings

`CODE`/`ASC` render as native `CODE` on Spectrum and `ASC` on Atari, Commodore,
and Agon. `STR$`/`VAL` use Spectrum's operator-style spelling and parenthesized
forms on the other dialects. Spectrum can evaluate a string expression through
native `VAL`; portable source should use plain numeric strings.

Runtime math functions use the native BASIC equivalents and retain native angle
units, numeric precision, and domain restrictions. `INT` on constants is folded
before rendering. Runtime `MOD` is expanded as `A - INT(A / B) * B`; operands can
therefore be evaluated more than once. Per-machine timer, memory, keyboard, random,
and screen-code implementations are listed in the dialect sections below.

## Screen boundaries

Atari positioned `PRINT #6` and C64 output scroll immediately when a character is
written into the bottom-right cell, even with a trailing semicolon. Spectrum
`PRINT AT` leaves that cell in place. Portable layouts that must not scroll should
leave it unused; the rest of the bottom row and right edge remain usable. Agon
edge behavior needs further verification; its character-recognition caveats are
listed under [Agon Light](#agon-light).

## Character sets

Requested character groups are [toolchain settings](toolchain.md#program-inputs-and-project-configuration).
`lowercase` selects C64's uppercase/lowercase font and matching BASIC syntax;
Spectrum and Atari already provide lowercase in their normal fonts. VIC-20 uses
the shared Commodore character handling. `international` selects Atari XL/XE's
international ROM with `POKE 756,204`; Spectrum and Commodore use fallback spellings
where that group is unsupported.

When `international` is requested for Atari or Agon, `ä`, `ö`, `ü`, `Ä`, `Ö`, and `Ü` remain display characters; Agon also preserves `ß`. `ß` and `ẞ` still become `ss` and `SS` on Atari because its ROM set does not contain them. Targets that cannot honor a requested group use the normal fallbacks: German umlauts become `ae`/`oe`/`ue`; an uppercase umlaut becomes `AE`/`OE`/`UE` when its whole word is uppercase, so `PRÄSIDENT` becomes `PRAESIDENT` while `Präsident` becomes `Praesident`. A C64 build without `lowercase` capitalizes all static text. Common typographic quotes, dashes, and ellipses become plain equivalents. Other unsupported Unicode and unavailable font punctuation produce diagnostics.

Readable listings and directly loadable artifacts can have different encodings.
Atari native listing conversion and Agon UTF-8/Windows-1252 tokenization are owned
by the [toolchain reference](toolchain.md#generated-artifacts).

## Device mappings

| Target | Native device behavior |
| --- | --- |
| ZX Spectrum | `TEXT_PRINTER` uses `LPRINT`; `PRINTER` opens stream `#4` as `"P"`, and `RS232` opens stream `#4` as `"t"` for Interface 1 text serial output. No shared-drive support. |
| Atari 800XL | Printer devices use `P:`, serial uses `R:`, and the shared-drive default is `H6:MCP.TXT`; the Atari800 adapter selects `H1:MCP.TXT`. |
| C64/VIC-20 | Printer devices use device 4; RS-232 uses device 2. No shared-drive support. |
| Agon Light | Device handles become SD-card files. Text output uses `BPUT#` rather than typed binary `PRINT#` records. |

`DEVICE_AVAILABLE` is best-effort. Atari probes through a trapped `OPEN` where practical; Commodore printers can be probed through the status channel. Commodore serial availability currently reports
true because probing the connection can disturb it. Working host captures and
manual device mappings are described in the
[running guide](running-programs.md#test-capture-locations).

## Storage layouts

Scalar struct values use one generated scalar per field. Struct arrays use the
native layouts described for each dialect below; source field access and copying
retain the [language-level rules](language-reference.md#structs).

## Inverted output

On targets with a persistent inverse-video mode, adjacent inverted prints share
one mode-change pair. Any intervening instruction, including a label, ends that
run so a control-flow entry cannot bypass the mode setup. Native mechanisms are
listed per machine below.

## ZX Spectrum

- Assignments use `LET`.
- Labels and identifiers are rendered in uppercase where appropriate.
- String variables are mapped deterministically to single-letter names such as `A$`.
- Integer `%` variables are rendered as regular numeric variables and assignment is coerced with `INT`.
- In `AND` and `OR`, comparison results are used directly; other numeric operands are normalized to preserve Meta-BASIC's nonzero truth semantics.
- Readability `0` and `1` compact long numeric scalar names while preserving Spectrum's required single-letter names for strings, arrays, and `FOR` counters. Readability `2` keeps readable uppercase numeric scalar names where practical.
- Numeric and integer arrays are mapped to single-letter numeric array names. Meta-BASIC index `0` renders as Spectrum index `1`.
- A source index written as `position - 1` uses `position` directly as the native one-based subscript. A one-character `MID$` slice uses the same start and end position. Fractional positions near rounding boundaries can therefore differ from older generated listings that evaluated cancelling arithmetic first.
- Experimental `BYTE` arrays and fields use single-letter string storage at one character per value. Writes use `CHR$`; reads use `CODE` and become ordinary numeric expressions.
- When a struct array has multiple numeric fields, the compiler packs those fields into one two-dimensional Spectrum numeric array: the first dimension selects the element and the second selects the field. This saves single-letter array names; Meta-BASIC source still uses ordinary struct field access. String fields remain separate string arrays.
- Fixed-width string arrays are mapped to single-letter Spectrum string arrays such as `M$(3,12)`, plus hidden numeric arrays holding each element's logical length. Reads slice to the stored length, so implementation padding is excluded while deliberate trailing spaces remain part of the value.
- `PRINT_INVERT` and `PRINT_INVERT_AT` use native `INVERSE 1`/`INVERSE 0`. Consecutive inverted prints share one pair; the current INK and PAPER values do not need to be read or rewritten.
- `CLS colour` uses `PAPER` and then `CLS`.
- Border, global text, and following-cell colours use native `BORDER`, `INK`, and `PAPER` concepts.
- `SUPPRESS_SCROLL_PROMPT` emits `POKE 23692,255` to refresh the native scroll-prompt counter.
- `PROGRAM_MODE` emits the same scroll-prompt counter refresh.
- `KEY_PRESSED()` checks `INKEY$ <> ""`; `KEY_CODE()` uses `INKEY$`, so short taps can be missed while the program is busy.
- `JIFFIES()` reads the three-byte `FRAMES` counter and renders it as one parenthesized expression, so arithmetic such as `targetTime - jiffies()` subtracts the whole counter value.
- `FREE_MEMORY()` uses the 48K ROM free-memory routine via `USR 7962`.
- Native exponentiation rejects negative bases at runtime, including expressions such as `(-x) ^ 2`; use another form for portable programs.
- `SCREEN_CODE` uses native `SCREEN$` followed by `CODE`.
- `RND()` lowers to native `RND`; `RANDOMIZE` lowers to Spectrum `RANDOMIZE`.

## Atari 800XL

- The backend targets built-in Atari BASIC, not Turbo-BASIC XL or BASIC XL.
- Assignments omit `LET`.
- Readability `0` and `1` use deterministic compact variable names to save memory and avoid native tokenizer surprises. Readability `2` keeps readable uppercase names where practical for source-level inspection.
- `PRINT_AT` lowers 1-based source coordinates to Atari's zero-based `POSITION column,row`, then writes through the graphics-zero `S:` screen device with `PRINT #6`. This bypasses channel 0's logical-line editor, which can move existing physical rows when several independently positioned fields share a row. When a program uses this direct screen output, its generated startup executes `GRAPHICS 0` once to ensure channel 6 is open before the first positioned write; launchers and loaders are not required to preserve the interpreter's initial channel setup.
- Ordinary `PRINT` newlines return to Atari's left margin, which defaults to zero-based column 2. `PROGRAM_MODE` sets that margin to zero, allowing aligned rows with one initial `SET_POS` followed by ordinary `PRINT` statements.
- `PRINT_INVERT` and `PRINT_INVERT_AT` accept string literals only and use `basicParser`'s inverse-string notation. The tokenized program contains inverse ATASCII bytes directly; no runtime `CHR$` construction or screen-memory inversion pass is generated.
- String variables receive `DIM NAME$(255)` before their first assignment.
- String concatenation is lowered into Atari substring assignments where necessary.
- A one-character `MID$` slice uses the same start and end position. Fractional positions near rounding boundaries can therefore differ from older generated listings that evaluated cancelling arithmetic first.
- Integer `%` variables are rendered as regular numeric variables and assignment is coerced with `INT`.
- In `AND` and `OR`, comparison results are used directly; other numeric operands are normalized to preserve Meta-BASIC's nonzero truth semantics.
- Numeric and integer arrays render as native Atari arrays with the declared count lowered to a zero-based upper bound.
- Experimental `BYTE` arrays and fields use packed string storage at one character per value. Writes use `CHR$`; reads use `ASC` on a one-character slice.
- Fixed-width string arrays render as one packed Atari backing string plus a hidden numeric array holding each element's logical length. In readable output, `dim messages$(3,12)` reserves `DIM MESSAGES$(36)` for character storage. Reads copy only the recorded number of characters from the corresponding slice, preserving deliberate trailing spaces without exposing unused padding. Empty elements use a guarded read because Atari BASIC rejects an end position before the start position.
- `CLS` uses `PRINT CHR$(125);`.
- Global colours use `SETCOLOR`; cell colours have no effect in `GRAPHICS 0`.
- `SUPPRESS_SCROLL_PROMPT` has no effect.
- `PROGRAM_MODE` emits `POKE 752,1` to hide the text cursor and `POKE 82,0` to remove the left text margin.
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
- `CLS` uses `PRINT CHR$(147);`.
- Border and background colours use `POKE 53280` and `POKE 53281`; the current text colour uses `POKE 646`.
- C64 cell background colour has no direct equivalent and therefore has no effect.
- `SUPPRESS_SCROLL_PROMPT` has no effect.
- `PROGRAM_MODE` stores a three-byte no-STOP routine (`LDA #1; RTS`) in free RAM at `$02ED–$02EF`, then changes only the STOP vector's high byte with `POKE 809,2`. The standard C64 vector already has low byte `$ED`. This keeps `LIST` working and avoids an unsafe vector address between POKEs. Programs using `PROGRAM_MODE` must leave those three RAM bytes alone.
- `KEY_PRESSED()` checks `PEEK(198) > 0`; `KEY_CODE()` uses `GET` and converts a returned character with `ASC`.
- `JIFFIES()` uses `TI`.
- `FREE_MEMORY()` lowers to `FRE(0)` with the signed-result correction for values above 32767.
- `SCREEN_CODE` reads the standard BASIC text screen at address 1024 and converts ordinary printable screen codes to their comparable PETSCII codes.
- `RND()` lowers to `RND(1)`; bare `RANDOMIZE` reseeds it from the jiffy clock with `RND(-(TI+1))`, and `RANDOMIZE seed` uses `RND(-seed)`.
- Integer `%` variables render as native C64 integer variables. Assignments preserve `INT` coercion, omitting the call when the value is already known to be an integer.
- In `AND` and `OR`, native comparison results are used directly; other numeric operands are normalized to preserve Meta-BASIC's nonzero truth semantics.
- Numeric and integer arrays render as native C64 arrays with deterministic variable-name mapping and zero-based upper bounds.
- Experimental `BYTE` arrays and fields render as native `%` integer storage. Compatible byte fields may be packed into a two-dimensional integer backing array.
- In a struct array, two or more floating numeric fields share one two-dimensional numeric array, and two or more `%` fields share one two-dimensional integer array. The first dimension selects the element and the second selects the field. A single field of either type keeps its one-dimensional array; string fields remain separate.
- Fixed-width string arrays render as native C64 string arrays; the fixed width is used by Meta-BASIC diagnostics, not emitted as a C64 dimension.

Commodore BASIC V2 distinguishes variable names using only their first two significant characters. The backend therefore maps Meta-BASIC variables deterministically and prevents two source variables from silently becoming the same C64 variable. Compact modes avoid keywords and system names such as `TI` and `TI$`. Readable mode also shortens names containing C64 BASIC token substrings such as `IF`, `TO`, `GO`, `OR`, or `LET`, because the native tokenizer can reject names that look harmless in Meta-BASIC source.

## VIC-20

- The backend shares Commodore BASIC V2 syntax, tokenizer handling, compact variable mapping, files, strings, arrays, inverse text, keyboard input, and numeric formatting with the C64 backend.
- Generated PRGs use the expanded BASIC start at `$1201`; the supplied `xvic` profile enables all conventional memory expansions. Unexpanded VIC-20 memory layouts are not currently a supported build profile.
- The text display has 22 columns and 23 rows. `PRINT_AT` writes the shared editor row/column variables and calls the VIC-20 ROM cursor-update routine at `SYS 58759`.
- Border and background share VIC register 36879. Generated POKEs preserve the register's unrelated bits; text colour remains at address 646.
- `SCREEN_CODE` obtains the active screen page from KERNAL location 648, so it remains correct with the expanded screen-memory layout.
- `PROGRAM_MODE` hides the cursor with `POKE 204,1`; it does not install the C64-specific STOP-vector routine.
- `GET_JOYSTICK` reads the VIA registers. Reading right requires temporarily changing VIA direction register 37154, so lowering saves each joystick result before restoring that register.
- The complete instruction suite nearly fills expanded BASIC memory. See the [toolchain module orchestrator](toolchain.md#language-conformance-suite) for a runner that fits.

## Agon Light

- The backend currently targets Dean Belfield's BBC BASIC ADL 1.03 in `bbcbasic24.bin`. It is a 24-bit conversion of BBC BASIC for Z80 3.00, broadly compatible with BBC BASIC 4; it is not the separate, newer BBC BASIC V port.
- ADL mode gives programs and data access to the Agon's available user RAM rather than a 64 KiB Z80 segment. The interpreter nevertheless retains important older language limits: ordinary strings contain at most 255 characters, integers are signed 32-bit values, and five-byte real numbers provide about nine significant decimal digits. Variable count, variable-name length, and practical array size are limited by available memory rather than a small fixed table. Generated tokenized lines remain limited to 251 characters and numbered lines to the BBC BASIC range.
- Target lowering therefore uses only features supported by `bbcbasic24.bin`; the compiler must not assume that a facility from BBC BASIC V is available merely because a newer Agon interpreter implements it.
- Generated programs begin with `MODE 3`, establishing the compiler's fixed 80-column by 30-row text environment.
- Assignments omit `LET`; `%` variables use BBC BASIC's native 32-bit integer storage.
- In `AND` and `OR`, native comparison results are used directly; other numeric operands are normalized before BBC BASIC's bitwise operations.
- Readable variable names are preserved unless they begin with a BBC BASIC keyword; unsafe names such as `TOTAL` and `VALUES` receive a `V_` prefix so the native tokenizer cannot reinterpret `TO` or `VAL` as syntax.
- Numeric, integer, byte, and string arrays retain Meta-BASIC's zero-based indexes. Declared element counts become BBC BASIC upper bounds, while a fixed string width remains a compile-time check and is not emitted as another array dimension.
- A `FOR` loop containing `EXIT FOR` or an early function `RETURN` lowers to an explicit counter loop. It therefore creates no BBC BASIC loop-control stack frame that could be bypassed by the jump or return; ordinary `FOR` loops retain native syntax. Literal limits and steps are used directly, and fixed steps use a direction-specific loop test. Dynamic limits and steps are captured; dynamic step direction is checked at runtime.
- `PRINT_AT` and `SET_POS` use native `PRINT TAB(column,row);`; `SET_COLUMN` uses `VPOS` to retain the current row.
- `PRINT_INVERT` and `PRINT_INVERT_AT` query the current logical text foreground and background colours, swap them for an adjacent run of inverted prints, and then restore them. The query uses `VDU 23,0,&94` and MOS's returned palette-index byte, requiring Console8 VDP 2.7.0 or newer. Consecutive inverted prints share one query and swap.
- `SCREEN_CODE` sends Agon's VDP character-read command, synchronizes through OSBYTE 19, and reads MOS system-variable byte 9 through OSBYTE.
- Agon's VDP reconstructs a character by comparing the pixels at the requested cell with the active character set. Its firmware documents that this may fail, and boundary cells on the final row or column can return `0` even when the character is visibly present. Tests for scrolling therefore read a separate sentinel away from the boundary rather than relying on boundary-cell recognition.
- In the configured Fab Agon 1.2.5 / BBC BASIC ADL 1.03 setup, `SCREEN_CODE` at the final text column returned `0` both before and after clearing a printed character; the preceding column returned the expected character codes. Screen assertions should currently use columns through `TEXT_COLUMNS - 1`, with visual checks for the final column.
- `JIFFIES()` uses BBC BASIC `TIME`, whose unit is one centisecond; `JIFFIES_PER_SECOND` is therefore 100.
- `FREE_MEMORY()` uses `HIMEM-TOP`, and `RND()` uses `RND(1)`. BBC BASIC has no `RANDOMIZE` statement, so bare `RANDOMIZE` seeds through an assignment from `RND(-TIME)` and `RANDOMIZE seed` uses `RND(-seed)`.
- Portable foreground/background colours use BBC BASIC `COLOUR`. Because the Agon text display has no separate border, a portable border-colour request changes the background instead; this keeps the test runner's red failure indication visible.
- `PROGRAM_MODE` hides the text cursor with a VDU command. `SUPPRESS_SCROLL_PROMPT` has no effect.
- `KEY_CODE()` uses ADL BASIC `INKEY(0)`. Agon MOS cursor codes are Up `11`, Down `10`, Left `8`, and Right `21`; `KEY_UP/DOWN/LEFT/RIGHT` and `GAME_UP/DOWN/LEFT/RIGHT` use these values. These were checked with physical key presses in Fab Agon 1.2.5 and BBC BASIC ADL 1.03; the classic BBC Micro codes `139/138/136/137` do not match this runtime.
- `GET_JOYSTICK` uses cursor keys and Space as keyboard-backed controls, including on Agon Light models without Console8 joystick ports. It checks held-key state with ADL BASIC `INKEY(-n)`: Left `-26`, Right `-122`, Up `-58`, Down `-42`, and Space `-99`. These scan selectors differ from the event codes returned by `KEY_CODE()`. Opposite directions cancel, diagonals are supported, and fire can be held with movement.

## Readability

The [toolchain profiles](toolchain.md#profiles-and-readable-output) select comments
and naming compactness. Per-dialect name rules are listed above. Generated names
are deterministic; character-set conversion follows the selected groups described
under [Character sets](#character-sets). Shared compiler storage allocation is
explained in [architecture](architecture.md#generated-storage-allocation).
