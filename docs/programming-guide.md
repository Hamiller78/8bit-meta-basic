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
  "textsDir": "texts",
  "minimumScreenColumns": 32,
  "minimumScreenRows": 22
}
```

Choose minimum dimensions that match the layout you intend to support. For a VIC-20-compatible game, set `"minimumScreenColumns": 22`. Defaults, configuration fields, and source-discovery rules are defined in the [toolchain reference](toolchain.md#program-inputs-and-project-configuration).

Build a readable version while developing:

```text
npm run build:c64 -- --project my-game --profile debug
```

Inspect the generated `.bas` when diagnosing behavior. For other targets, build profiles, and packaging options, use the [toolchain reference](toolchain.md#build-scripts). An all-target build requires a layout compatible with every selected computer.

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

Keep each module's dependencies visible at the top of the file. In this example, both `main.mbas` and `names.mbas` declare their direct access to `characters.mbas`. Add dependencies to the selected build input too: `USES` does not load them. The full [module rules](language-reference.md#module-dependencies-uses) explain access and ownership.

Prefer constants and shared storage in a module that callers can name directly, and initialize application state in a clearly named setup function. Check [declaration and initialization order](language-reference.md#declaration-and-initialization-order) when splitting an existing program across files.

## Variables, arrays, and structs

Meta-BASIC infers the storage kind from the name and usage. There are no separate scalar declarations.

| Source form | Value |
| --- | --- |
| `score` | Number |
| `counter%` | Integer number; assignments apply `INT(...)` |
| `name$` | String |
| `dim scores(10)` | Numeric array with indexes `0..9` |
| `dim counters%(10)` | Integer array with indexes `0..9` |
| `dim flags as byte(10)` | Compact byte array with indexes `0..9` |
| `dim names$(10, 16)` | Ten strings, each with a declared width of 16 |

Assignment never uses `LET` in Meta-BASIC:

```basic
score = 100
counter% = score / 3
name$ = "PABLO"
scores(0) = score
names$(0) = name$
```

Use `0` through `count - 1` when looping over an array. Validate indexes derived from user input before accessing it; see the [array rules](language-reference.md#arrays).

Use experimental `BYTE` storage for dense values that remain in `0..255`:

```basic
dim tileColours as byte(100)

tileColours(0) = 7
nextColour = tileColours(0) + 1
tileColours(1) = nextColour
```

Use compact bytes for dense maps, flags, or character indexes, then measure memory and execution time on the intended computer. The [target guide](targets.md) explains storage costs; `performance-tests/byte-arrays` provides a comparison benchmark.

Reserve enough capacity for each string element, but use `LEN` for its current content. For example, a width-12 slot containing `"READY"` still has length 5. Deliberate trailing spaces remain significant. Exact capacity and assignment rules are in the [language reference](language-reference.md#arrays).

Structs group related values at source level:

```basic
struct Message
    row
    column
    flags as byte
    text$(32)
end struct

dim queue AS Message(20)
dim nextMessage AS Message

nextMessage.row = 4
nextMessage.column = 1
nextMessage.text$ = "READY"
queue(0) = nextMessage
```

For a bounded queue, `insert_element` and `remove_element` can shift entries for you. Choose a policy for a full queue before inserting; the [array operations reference](language-reference.md#arrays) defines what happens at its ends.

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

Declare scratch values with `LOCAL`, so a helper does not accidentally overwrite global state. Keep global changes explicit in functions such as `InitializeGame` or `ApplyDamage`. The [function reference](language-reference.md#user-defined-functions) defines scope, returns, inline helpers, and recursion restrictions.

Call a procedure-like helper as a standalone statement when you need its side effect; use a returned value in an assignment or expression when it computes a result.

Scalar structs can be parameters:

```basic
function DrawMessage(item AS Message)
    print_at item.row, item.column, item.text$
end function
```

Treat struct parameters as input values. Return the calculated value or update explicitly owned global state when the caller needs to observe a change; see [struct parameter semantics](language-reference.md#user-defined-functions).

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

Use `CONTINUE FOR` to skip an item and `EXIT FOR` to stop a search. Labels and classic subroutines remain useful for simple flows:

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
set_column 20
print "RIGHT-HAND FIELD"
```

`SET_COLUMN` retains the current row, which is useful when assembling aligned fields with several print statements.

Use portable screen commands for common text-mode operations:

```basic
program_mode
screen_border_color BLUE
screen_background_color BLACK
screen_text_color WHITE
pen_colors RED, YELLOW, BLUE, GREEN
cls
```

Initialize common screen settings once, then use positioned output for fields that change. Leave the bottom-right cell unused when the layout must not scroll; [screen boundaries](targets.md#screen-boundaries) differ by computer. The [screen command reference](language-reference.md#screen-and-colour-commands) defines the portable operations.

## Compile-time wrapping and localization

Use `PRINT_WRAP` for literal or compile-time strings without localization:

```basic
print_wrap "A long message that should fit the target screen."
print_wrap "A narrow column.", TEXT_COLUMNS - 8
print_centered "SAN-GOLPE"
```

Use one UTF-8 file such as `texts/en/intro.txt` for a long passage. Put short messages and templates together in `texts/en/strings.json`:

```json
{
  "continue": "Press any key to continue",
  "new_game": "New game",
  "npcRanAway": "{actor} ran away with {target}."
}
```

```basic
print_text "intro"
print_text "npcRanAway"; actor = actorName$, 21; target = targetName$, 21
print_centered text$("npcRanAway"); actor = actorName$, 21; target = targetName$, 21
print_centered text$("continue")
```

The `21` values reserve display space for the inserted names. Choose realistic maxima before translating the message so each language can arrange those names naturally. Start wrapped output at the left margin and split long pages explicitly; layout is performed during compilation.

Keep the same resource keys in each selected language. The [layout and resource reference](language-reference.md#localized-text-resources-and-fonts) defines bindings and lookup errors. Choose language and font groups through the [toolchain settings](toolchain.md#program-inputs-and-project-configuration); check [target character sets](targets.md#character-sets) when a translation needs non-ASCII characters.

## Input, time, and random numbers

For a blocking sound cue, `beep 0.25, NOTE_C4` requests a quarter-second middle
C. Named notes and the portable range are described in the
[sound reference](language-reference.md#sound). In test mode, use
`assert_beep 0.25, NOTE_C4` to check the request without playing it.

Use `INPUT` when the program should stop and let the user enter a complete numeric or string value:

```basic
print "NAME";
input name$
print "AGE";
input age%
```

Several scalar destinations may be listed with commas. Scalar struct fields are accepted too, so an interactive record can be filled directly before it is copied into a struct array:

```basic
dim person as Person
input person.name$, person.age%
people(0) = person
```

Use blocking input for menus and forms. For a game that must keep responding between commands, poll instead:

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

## Saving and loading arrays

Store a compact save state in an array and write/read the whole array:

```basic
dim saveState(3)
saveState(0) = 12
saveState(1) = 2
saveState(2) = 40
save_file "SAVE1", saveState

if FILE_STORAGE_DISK then
    saveExists = file_exists("SAVE1")
    if saveExists then
        load_file "SAVE1", saveState
    end if
else
    print "REWIND TO SAVE1"
    load_file "SAVE1", saveState
end if
```

The disk branch checks for a file before loading; tape needs a user rewind/cue prompt instead. Use the same guard around disk-only `DELETE_FILE` when offering a delete-save action. A probe does not protect against all media errors, and saving is not transactional. Consult [Data files](language-reference.md#data-files) for the contract, [target storage costs](targets.md#file-storage) when sizing a save, and the [toolchain](toolchain.md#program-inputs-and-project-configuration) for medium selection.

## Data streams

`DATA`, `READ`, and bare `RESTORE` form one program-wide stream:

```basic
data 10, "READY"
data 20, "ALERT"

restore
read itemCode, message$
```

Read a stream once during initialization when several parts of the game need the same table, then keep the results in arrays. The [data-stream reference](language-reference.md#data-streams) defines accepted values and rewind behavior.

Keep data tables together or make their order clear in the build input; a helper that rewinds the stream depends on that order.

## Test application code

Tests live in the project's `tests/` folder and directly name the source modules they access:

```basic
uses "../source/dice.mbas"

test RollUsesSuppliedRandomInput()
    set_rnd(0.5)
    assert_eq 4, RollDie(6)
end test
```

For the development sequence, use [MetaBASIC testing](../skills/metabasic-testing/SKILL.md).
For building runners, selecting test modules, running configured emulators, and
checking captured results, follow [Run MetaBASIC emulator tests](../skills/run-metabasic-tests/SKILL.md).
Emulator setup and capture locations belong in the [running guide](running-programs.md#test-capture-locations).

The test supplies a known input to the dice function, so it checks the same outcome on different machines. The [test reference](language-reference.md#test-mode) defines assertions, fixtures, and runtime-input controls, including calls made through helpers. Use logical output assertions for presentation logic, or actual display checks when rendered screen cells are the behavior being tested.

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
| Struct-array file I/O | [`examples/computer-records`](../examples/computer-records) |
| File deletion | [`examples/file-delete.mbas`](../examples/file-delete.mbas) |
| Joystick input | [`examples/joystick.mbas`](../examples/joystick.mbas) |
| Sound listening demo | [`examples/beep-demo.mbas`](../examples/beep-demo.mbas) |
| Data streams | [`examples/data-demo.mbas`](../examples/data-demo.mbas) |
| Multi-file program | [`examples/multifile`](../examples/multifile) |
| Localization and a larger project | [`examples/san-golpe`](../examples/san-golpe) |

For normal application work, consult this guide, the language reference, and the examples before relying on generated output or compiler implementation details. If accepted compiler behavior is missing from the reference, treat that as a documentation gap and update the reference with the code change.

The compiler's portable language conformance tests live separately in [`language-tests/instruction-suite`](../language-tests/instruction-suite). They are regression tests for language and target behavior rather than programming examples.

## Performance-sensitive module layout

For targets where branches search from the beginning of the BASIC listing,
`HOT_MODULE` can move a module containing frequently executed code earlier:

```basic
hot_module
```

The hint does not change startup or execution order. See the
[language reference](language-reference.md#declaration-and-initialization-order)
for its scope and the [branch-layout benchmark](../performance-tests/branch-layout/README.md)
for measurements.
