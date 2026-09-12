# Programming Meta-BASIC

This guide is for writing games and applications in Meta-BASIC. It describes normal source patterns without requiring knowledge of the compiler pipeline. The [language reference](language-reference.md) is the exhaustive syntax reference, and [targets.md](targets.md) lists machine-specific behavior.

## Start a project

A conventional project has an ordered build configuration, source modules, optional tests, and optional localized text:

```text
my-game/
  metabasic.json
  source/
    main.mbas
    characters.mbas
    names.mbas
  tests/
    characters-tests.mbas
  texts/
    en/
      strings.json
      intro.txt
    de/
      strings.json
      intro.txt
```

List source modules in the order in which they should appear in generated BASIC. Put the entry module first:

```json
{
  "files": [
    "source/main.mbas",
    "source/characters.mbas",
    "source/names.mbas"
  ],
  "textsDir": "texts"
}
```

Build the project for one or every target:

```text
npm run build:c64 -- --project my-game --profile debug
npm run build:all-targets -- --project my-game --profile debug
```

| Profile | Generated BASIC |
| --- | --- |
| `debug` | Module separators, source and generated labels, source comments, readable names where possible |
| `balanced` | Module separators and source labels with compact variables |
| `release` | Compact output without generated comments |

Use `debug` while developing. Generated `.bas` files are meant to be read and debugged.

## Organize modules

`main.mbas` normally contains startup and the main loop. Other modules normally contain constants, enums, structs, storage, and functions.

```basic
' source/main.mbas
uses "characters.mbas"
uses "names.mbas"

program_mode
cls BLACK
CreateCharacters()

mainLoop:
    ' game update and drawing
    goto mainLoop
```

```basic
' source/characters.mbas
enum Gender
    any
    male
    female
end enum

struct Character
    gender
    first$(10)
    last$(10)
end struct

const characterCapacity = 12
dim characters AS Character(characterCapacity)
```

```basic
' source/names.mbas
uses "characters.mbas"

function CreateCharacters()
    characters(0).gender = female
    characters(0).first$ = "Irina"
    characters(0).last$ = "Ivanova"
end function
```

Every cross-module access needs a direct `USES` declaration. Paths are relative to the module containing `USES`. `USES` grants access; it does not load a file, so every source module must also appear in `metabasic.json`. Dependencies are not transitive: if `main.mbas` uses symbols from both `characters.mbas` and `names.mbas`, it names both modules even when `names.mbas` already uses `characters.mbas`.

Top-level enums, structs, and `DIM` declarations are known across the compilation unit before executable code is checked. They may live in a later configured module. Constants are the exception: constant expressions can only refer to constants declared earlier in build order.

The compiler runs generated storage and module-global initialization before entry code. It keeps the configured module order in the listing. All `DATA` statements are collected, in source order, into a final generated data section.

## Variables, arrays, and structs

Meta-BASIC infers the storage kind from the name and usage. There are no separate scalar declarations.

| Source form | Value |
| --- | --- |
| `score` | Number |
| `counter%` | Integer number; assignments apply `INT(...)` |
| `name$` | String |
| `dim scores(10)` | Numeric array with indexes `0..9` |
| `dim counters%(10)` | Integer array with indexes `0..9` |
| `dim names$(10, 16)` | Ten strings, each with a declared width of 16 |

Assignment never uses `LET` in Meta-BASIC:

```basic
score = 100
counter% = score / 3
name$ = "PABLO"
scores(0) = score
names$(0) = name$
```

An array dimension is an element count rather than the largest index. Constant indexes are checked by the compiler; dynamic indexes remain the program's responsibility.

Treat values read from fixed-width string arrays and string fields as padded to their declared width. Spectrum and Atari can preserve trailing spaces that C64 native strings do not. Trim that padding or keep a separate logical length before concatenating more text; [`examples/san-golpe/source/characterfactory.mbas`](../examples/san-golpe/source/characterfactory.mbas) contains a small `trimName$` example.

Structs group related values at source level:

```basic
struct Message
    row
    column
    text$(32)
end struct

dim queue AS Message(20)
dim nextMessage AS Message

nextMessage.row = 4
nextMessage.column = 1
nextMessage.text$ = "READY"
queue(0) = nextMessage
```

Use `insert_element(queue, index, value)` and `remove_element(queue, index)` with one-dimensional native or struct arrays. Insert shifts values upward and discards the last slot. Remove shifts values downward; the final slot is left unspecified.

## Constants and expressions

Use constants for values that should disappear during compilation:

```basic
const statusRow = TEXT_ROWS - 2
const rule$ = string$("-", TEXT_COLUMNS)
const delayTicks = 3 * JIFFIES_PER_SECOND
```

The portable environment constants are `TEXT_ROWS`, `TEXT_COLUMNS`, `JIFFIES_PER_SECOND`, `PI`, and `E`. Portable colours and key codes are also constants.

The main operators are:

```text
^  unary -  NOT  *  /  MOD  +  -
=  <>  <  <=  >  >=  AND  OR
```

Use parentheses when an expression is meant to communicate grouping. Write comparison ranges as separate comparisons:

```basic
if value >= minimum and value <= maximum then
    print "IN RANGE"
end if
```

The [built-in function table](language-reference.md#built-in-functions) gives every supported function signature. Frequently used functions include `len`, `mid$`, `left$`, `right$`, `chr$`, `code`, `str$`, `val`, `int`, `rnd`, `jiffies`, and `free_memory`.

## Functions and local values

Functions may return a value or act as procedures:

```basic
function RollDie(sides)
    local result
    result = int(rnd() * sides) + 1
    return result
end function

function DrawStatus(row, text$)
    print_at row, 1, text$
end function

roll = RollDie(6)
DrawStatus(2, "READY")
```

Declare function and test-local values in one or more `LOCAL` statements. Parameters and locals belong to that function in Meta-BASIC source. A name used in a function that is neither a parameter nor declared `LOCAL` refers to global program state, so declare every scratch value explicitly. Functions are top-level declarations and may be called before their definition. The generated target storage is static, so recursive and mutually recursive function calls are rejected.

A function used only for side effects may omit an explicit `RETURN`; reaching `END FUNCTION` returns to the caller. Use `RETURN expression` when the call appears in an expression.

Scalar structs can be parameters:

```basic
function DrawMessage(item AS Message)
    print_at item.row, item.column, item.text$
end function
```

The struct is copied into function storage. Assigning to `item.field` does not change the caller's value. Struct arrays cannot currently be parameters.

## Control flow

Use multiline conditional blocks:

```basic
if score >= 100 then
    print "HIGH SCORE"
else
    print "KEEP GOING"
end if
```

The supported loops are:

```basic
for index = 0 to count - 1
    if index = 2 then
        continue for
    end if
    if index = 8 then
        exit for
    end if
next index

while key_pressed() = 0
wend

repeat
    key = key_code()
until key <> KEY_NONE
```

`EXIT FOR` and `CONTINUE FOR` apply to the nearest `FOR` loop. Labels, `GOTO`, `GOSUB`, and `RETURN` are available for code that naturally fits classic BASIC subroutines.

```basic
gosub DrawHeader
end

DrawHeader:
    print "TITLE"
    return
```

## Printing and screen layout

Separate print items with semicolons. A final semicolon suppresses the newline:

```basic
print "SCORE: "; score
print "WAIT";
print
```

Coordinates are always 1-based and written as `row, column`:

```basic
print_at 3, 5, "WARNING"
set_pos TEXT_ROWS, 1
print "BOTTOM ROW";
```

Use portable screen commands for common text-mode operations:

```basic
program_mode
screen_border_color BLUE
screen_background_color BLACK
screen_text_color WHITE
cls
```

The [screen and colour reference](language-reference.md#screen-and-colour-commands) describes global and per-cell operations and which targets ignore an unsupported operation.

## Compile-time wrapping and localization

Use `PRINT_WRAP` for literal or compile-time strings without localization:

```basic
print_wrap "A long message that should fit the target screen."
print_wrap "A narrow column.", TEXT_COLUMNS - 8
print_centered "SAN-GOLPE"
```

Use `PRINT_TEXT` for localized resources. Long text belongs in an individual UTF-8 file such as `texts/en/intro.txt`. Short strings share `strings.json`:

```json
{
  "continue": "Press any key to continue",
  "new_game": "New game"
}
```

```basic
print_text "intro"
print_centered text$("continue")
```

`PRINT_TEXT`, `PRINT_WRAP`, and `PRINT_CENTERED` wrap during compilation, using the selected target's column count and the optional width. They require compile-time text; they do not wrap a runtime string variable.

English (`en`) is the default language. Select a translation and C64 font from the build command:

```text
npm run build:c64 -- --project my-game --language de --font mixed
```

Resource keys are case-sensitive. Every selected language needs its own value; there is no automatic English fallback. C64 `mixed` selects its uppercase/lowercase character set for the whole generated program.

## Input, time, and random numbers

Keyboard polling is non-blocking:

```basic
if key_pressed() then
    key = key_code()
end if
```

`KEY_CODE()` must currently be the complete right-hand side of a numeric assignment. Key constants represent target key codes rather than portable ASCII values. Use `GAME_UP`, `GAME_DOWN`, `GAME_LEFT`, `GAME_RIGHT`, and `GAME_FIRE` for portable keyboard game controls.

Joystick polling uses normalized values:

```basic
x = get_joystick(JOY_X)        ' -1 left, 0 neutral, 1 right
y = get_joystick(JOY_Y)        ' -1 up, 0 neutral, 1 down
fire = get_joystick(JOY_FIRE1) ' 0 released, 1 pressed
```

Seed and read the random-number generator with:

```basic
randomize
die = int(rnd() * 6) + 1
```

`RND()` returns a native value in the range `0 <= value < 1`. Use `jiffies()` for the running target tick counter and `JIFFIES_PER_SECOND` to express portable delays.

## Data streams

`DATA`, `READ`, and bare `RESTORE` form one program-wide stream:

```basic
data 10, "READY"
data 20, "ALERT"

restore
read itemCode, message$
```

`DATA` accepts compile-time numbers, strings, and booleans. `READ` currently targets scalar variables. `RESTORE` always rewinds the complete stream and takes no label. Generated `DATA` lines appear at the end of the BASIC listing, regardless of their source module.

When several modules contribute data, their configured source order determines the stream. Keep a function that calls `RESTORE` coupled to the expected first data block, or read the stream once during initialization and store it in arrays.

## Test application code

Tests live in the project's `tests/` folder and directly name the source modules they access:

```basic
uses "../source/dice.mbas"

test RollStaysInRange()
    local roll
    randomize 1983
    roll = RollDie(6)
    assert_true roll >= 1
    assert_true roll <= 6
end test
```

Build the generated runner first, then run it in the target emulators:

```text
npm run build:all-targets -- --project my-game --run-tests --profile debug
npm run launch:spectrum -- --project my-game --run-tests --profile debug --printer-output --restart
npm run launch:c64 -- --project my-game --run-tests --profile debug --printer-output --restart
```

`--printer-output` mirrors the test runner through the target's verified host transport. Spectrum/Fuse uses ZX Printer text output, C64/VICE uses RS-232, and Atari uses a shared-drive file. The launch command returning only confirms that the emulator started. Wait for the captured file to reach the `META CONTROL PROGRAM (M.C.P.) RUN FINISHED` banner, which a narrow target may wrap across lines, then check that the reported values for both `FAILED` and `FAILURES` are zero:

```text
cat build/printer/debug/spectrum/my-game.txt
cat build/rs232/debug/c64/my-game.txt
cat build/altirra_drive/MCP.TXT
```

Use `--module dice` on both the build and launch commands to select a matching test file when a focused runner is more useful. Keep `--language` and `--font` consistent too; C64 test output containing mixed case is readable on the emulated screen when launched with `--font mixed`. Test the profile that will be used for the program; `debug` is convenient while diagnosing generated BASIC, while `release` catches problems caused by compact naming or memory pressure. Run every locally configured target emulator that is available. If an emulator cannot be run, report that target separately rather than treating a successful build as an emulator result. The complete setup and troubleshooting workflow is in [Running generated programs](running-programs.md#complete-emulator-test-workflow).

Available assertions include `ASSERT_TRUE`, `ASSERT_FALSE`, `ASSERT_EQ`, `ASSERT_NE`, `ASSERT_PRINT`, `ASSERT_PRINTAT`, and the screen/cell colour assertions. `GLOBALS ... END GLOBALS` establishes fixture assignments replayed before every test. Runtime fakes are documented in [Test Mode](language-reference.md#test-mode).

## Common mistakes

| Mistake | Meta-BASIC form |
| --- | --- |
| `LET score = 1` | `score = 1` |
| Treating `DIM values(10)` as indexes `0..10` | It creates indexes `0..9` |
| `print_at 0, 0, "X"` | Coordinates start at `1, 1` |
| `if ready then print "OK"` | Use a multiline `IF ... END IF` block |
| `restore names` | Only bare `RESTORE` is supported |
| Using a dependency through another module | Add a direct `USES` declaration |
| Passing a runtime string to `PRINT_WRAP` | Wrapping is compile-time only |
| Expecting target character codes to be ASCII | `CHR$`, `CODE`, key codes, and fonts remain target-specific |
| Using an integer `%` variable as a `FOR` counter | Use a regular numeric loop variable |
| Expecting a dynamic array index to be checked | Validate it in the program before access |
| Naming a variable `code`, `rnd`, or another built-in function | Choose a distinct variable name such as `itemCode` |
| Expecting `USES` to load a module | Add the module to `metabasic.json` as well |

Keep runtime strings within the portable 255-character limit. `PRINT` uses semicolons; comma zones, streams, `INK`, `PAPER`, and other target-specific print clauses are not portable source syntax. Prefer the explicit portable screen commands.

## Find a working example

| Topic | Example |
| --- | --- |
| Small program and colours | [`examples/colors.mbas`](../examples/colors.mbas) |
| Arrays and integer arrays | [`examples/array-demo.mbas`](../examples/array-demo.mbas) |
| String arrays | [`examples/string-array-demo.mbas`](../examples/string-array-demo.mbas) |
| Structs | [`examples/struct-demo.mbas`](../examples/struct-demo.mbas) |
| Functions | [`examples/function-demo.mbas`](../examples/function-demo.mbas) |
| Loops | [`examples/loop-demo.mbas`](../examples/loop-demo.mbas) |
| Keyboard input | [`examples/input-demo.mbas`](../examples/input-demo.mbas) |
| Joystick input | [`examples/joystick.mbas`](../examples/joystick.mbas) |
| Data streams | [`examples/data-demo.mbas`](../examples/data-demo.mbas) |
| Multi-file program | [`examples/multifile`](../examples/multifile) |
| Localization and a larger project | [`examples/san-golpe`](../examples/san-golpe) |

For normal application work, consult this guide, the language reference, and the examples before relying on generated output or compiler implementation details. If accepted compiler behavior is missing from the reference, treat that as a documentation gap and update the reference with the code change.

The compiler's portable language conformance tests live separately in [`language-tests/instruction-suite`](../language-tests/instruction-suite). They are regression tests for language and target behavior rather than programming examples.
