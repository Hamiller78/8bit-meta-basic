# Meta-BASIC Next Steps

This document records the next small language milestone after the current tokenizer, expression, and three-backend work is complete. Do not begin it until the current milestone satisfies its definition of done.

## Goal

Add a small set of genuinely portable screen features for ZX Spectrum BASIC, Atari BASIC in `GRAPHICS 0`, and Commodore BASIC V2:

- target-provided environment constants;
- a portable `CLS` statement with an optional background colour;
- the canonical single-keyword spelling `PRINT_AT`.

Also investigate a portable `TEXT_COLOR` statement. Spectrum and C64 support it directly, but Atari `GRAPHICS 0` cannot represent an arbitrary foreground hue independently of the background, so its exact portable semantics must be decided before implementation.

Keep these features target-independent in the syntax tree. Target-specific numeric colour representations and BASIC command sequences belong in target lowering and rendering.

## Environment constants

Provide read-only, case-insensitive constants supplied by the selected target environment. They must participate in normal compile-time constant evaluation and emit no BASIC statements.

The initial numeric constants are:

```text
TEXT_ROWS
TEXT_COLUMNS
```

Their values describe the coordinates usable by portable `PRINT_AT`, not necessarily every physical character cell owned by the video hardware:

| Target | `TEXT_ROWS` | `TEXT_COLUMNS` |
| --- | ---: | ---: |
| ZX Spectrum | 22 | 32 |
| Atari 800XL | 24 | 40 |
| Commodore 64 | 25 | 40 |

For example:

```basic
const status_row = TEXT_ROWS - 2
print_at status_row, 0; "READY"
```

Environment constants must be resolved after target selection but without introducing target checks into the parser. Model the selected target's values in a central typed target-environment definition. User code must not be allowed to redeclare or assign to an environment constant.

## Portable colours

Provide these read-only, case-insensitive portable colour constants:

```text
BLACK BLUE RED MAGENTA GREEN CYAN YELLOW WHITE
```

These names represent semantic colours, not native numeric colour codes. The same colour has different numeric representations on the Spectrum and C64, while Atari colour selection requires both hue and luminance. Preserve the semantic colour until target lowering maps it to the target representation.

Initially, a colour argument must be known at compile time and resolve to one of the portable colours. This permits aliases while avoiding runtime lookup machinery:

```basic
const alert_colour = RED
cls alert_colour
```

The Atari mappings are necessarily approximations and may look different across PAL, NTSC, emulator, and display configurations. Choose deterministic mappings, cover them with golden tests, and document them.

Do not introduce native target colour numbers into portable source. Target-specific colour constants or namespaces may be considered in a later milestone.

## `CLS`

Support both forms:

```basic
cls
cls BLUE
```

Semantics:

- `CLS` clears the text screen and retains the currently selected background colour.
- `CLS colour` selects the portable background colour and then clears the text screen.
- The colour form does not change the foreground/text colour.
- Neither form changes the border colour.
- The cursor is left at the normal home position produced by the target's clear-screen operation.

Represent `CLS` explicitly in the target-independent AST, with an optional colour expression. Do not parse it into raw target BASIC.

Expected target lowering:

### ZX Spectrum

```basic
CLS
```

With a colour:

```basic
PAPER targetColour
CLS
```

`PAPER` changes the permanent background used by later output; `CLS` applies it across the cleared display.

### Atari 800XL

```basic
PRINT CHR$(125);
```

With a colour in `GRAPHICS 0`:

```basic
SETCOLOR 2,targetHue,targetLuminance
PRINT CHR$(125);
```

Do not lower portable `CLS` to `GRAPHICS 0`, because selecting a graphics mode has additional state-changing semantics beyond clearing the current text screen.

### Commodore 64

```basic
PRINT CHR$(147);
```

With a colour:

```basic
POKE 53281,targetColour
PRINT CHR$(147);
```

This changes the screen background register but deliberately leaves the border register at `53280` unchanged.

Keep one BASIC statement per generated numbered line, so colour-setting forms expand to two lines.

## Desired `TEXT_COLOR` command

The desired Meta-BASIC syntax is:

```basic
text_color WHITE
```

It should change the colour used by subsequent text output without clearing the screen or recolouring text that is already visible.

The straightforward target operations are:

```basic
' ZX Spectrum
INK targetColour
```

```basic
' Commodore 64
POKE 646,targetColour
```

Atari `GRAPHICS 0` is the portability problem. `SETCOLOR 1` controls the character luminance, but the character foreground uses the hue selected for the background in colour register 2. It therefore cannot provide an arbitrary foreground hue independently of the background. Supplying a different hue argument to `SETCOLOR 1` does not solve this in `GRAPHICS 0`.

Do not silently claim that all eight portable colours work on Atari. Before implementing `TEXT_COLOR`, choose and document one of these approaches:

- expose a genuinely portable light/dark or contrast setting instead of arbitrary text colours;
- define an explicitly approximate Atari lowering constrained to the background hue;
- introduce an Atari-specific runtime or different text mode capable of independent colours;
- reject unsupported Atari colour combinations with a target-specific diagnostic.

The first option is the smallest genuinely portable abstraction. The runtime or alternate-mode option belongs to a later, more machine-specific milestone. Until this decision is made, `TEXT_COLOR` is a recorded design goal rather than part of this milestone's definition of done.

## Canonical `PRINT_AT`

Replace the two-keyword Meta-BASIC spelling:

```basic
print at row, column; "MESSAGE"
```

with the single canonical keyword:

```basic
print_at row, column; "MESSAGE"
```

`PRINT_AT` is case-insensitive like every other keyword. Do not support `PRINTAT` or retain `PRINT AT` as aliases; the project is still experimental and should avoid accumulating redundant syntax.

Only the Meta-BASIC spelling changes. Preserve the existing target-independent positioned-print AST and target lowering:

- Spectrum: `PRINT AT row,column;...`
- Atari: `POSITION column,row` followed by `PRINT ...`
- C64: cursor row/column `POKE`s, the ROM cursor-update `SYS`, and `PRINT ...`

Update the centralized keyword set, parser dispatch, diagnostics, examples, tests, and README. Remove `AT` from the keyword set if no remaining syntax requires it.

## Required tests

Add tests covering at least:

- target-specific values of `TEXT_ROWS` and `TEXT_COLUMNS`;
- environment constants in expressions and user constants;
- case-insensitive environment constant lookup;
- diagnostics for redeclaration and assignment;
- every portable colour in every backend;
- a constant alias used as a `CLS` colour;
- rejection of unknown or runtime-dependent colours;
- plain `CLS` output for all three targets;
- coloured `CLS` output and statement ordering for all three targets;
- proof that coloured `CLS` does not emit border- or text-colour changes;
- parsing and output of the canonical `PRINT_AT` spelling;
- rejection of `PRINTAT` and the former `PRINT AT` spelling;
- exact golden output for one adaptive layout using `TEXT_ROWS`, `TEXT_COLUMNS`, `CLS colour`, and `PRINT_AT` on all three targets.

## Explicitly deferred

Do not add these as part of this milestone:

- `INK`, `PAPER`, `BORDER`, `COLOR`, or `SETCOLOR` as portable source commands;
- implementation of `TEXT_COLOR` before its Atari semantics are decided;
- changing existing screen colours without clearing;
- dynamic runtime colour expressions;
- bright, flash, inverse, or multicolour attributes;
- target-specific extended palettes;
- graphics-mode selection;
- colour validation inside arbitrary strings or legacy character graphics.

Once these features and their documentation are complete and verified on all three backends, stop before beginning another milestone.
