# Meta-BASIC language reference

This document describes the implemented source language. Start with the [programming guide](programming-guide.md) for project structure and copyable application patterns. Machine-specific values, native behavior, and generated BASIC are documented in [targets](targets.md). Build/configuration options belong in the [toolchain reference](toolchain.md).

The forms documented here are the supported Meta-BASIC source syntax. Do not infer additional source syntax from generated Spectrum, Atari, C64, VIC-20, or Agon BBC BASIC. In particular, target output may contain `LET`, native functions, `POKE`, `SYS`, compact variable names, and zero-based coordinates that are not written that way in Meta-BASIC.

Meta-BASIC is case-insensitive for keywords and symbol lookup. Identifiers may contain ASCII letters, digits, and underscores, must begin with a letter or underscore, and may end in `$` to denote a string variable or `%` to denote an integer numeric variable.

## Contents

- [Program structure](#program-structure)
- [Module dependencies: USES](#module-dependencies-uses)
- [Constants](#constants)
- [Variables and assignment](#variables-and-assignment)
- [Arrays and structs](#arrays)
- [Expressions and built-in functions](#expressions)
- [Keyboard input](#keyboard-input)
- [Joystick input](#joystick-input)
- [Data streams](#data-streams)
- [Data files](#data-files)
- [User-defined functions](#user-defined-functions)
- [Output, layout, localization, and devices](#output)
- [Test Mode](#test-mode)
- [Control flow](#control-flow)
- [Screen and colour commands](#screen-and-colour-commands)
- [Current omissions](#current-omissions)

## Syntax summary

| Purpose | Source form |
| --- | --- |
| Dependency | `uses "module.mbas"` |
| Constant | `const name = expression` |
| Enum | `enum Name ... end enum` |
| Struct type | `struct Name ... end struct` |
| Array | `dim values(count)` or `dim names$(count, width)` |
| Struct storage | `dim value AS Type` or `dim values AS Type(count)` |
| Assignment | `name = expression`, `name% = expression`, `name$ = expression` |
| Array/field assignment | `values(index) = expression`, `item.field = expression` |
| Function | `function Name(parameters) ... end function` |
| Inline function | `inline function Name(parameters) ... end function` |
| Function local | `local first, second$` |
| Conditional | `if expression then ... else ... end if` |
| Counted loop | `for index = start to limit [step amount] ... next index` |
| Conditional loops | `while expression ... wend`, `repeat ... until expression` |
| Loop control | `exit for`, `continue for` |
| Label and jumps | `name:`, `goto name`, `gosub name`, `return` |
| Program termination | `end` |
| Keyboard input | `input variable [, variable ...]` |
| Output | `print`, `print items`, `print_at row, column, items`, `print_invert items`, `print_invert_at row, column, items` |
| Cursor | `set_pos row, column`, `set_column column` |
| Compile-time layout | `print_wrap text`, `print_centered text`, `print_text "key"` |
| Data stream | `data values`, `read variables`, `restore` |
| Random numbers | `randomize [seed]`, `rnd()` |
| Test | `test Name() ... end test` |

Statements are line-oriented. Write one source statement per line; a colon is used for a label, not as a general statement separator.

## Program structure

Blank lines are allowed. An apostrophe starts a comment that continues to the end of the source line.

```basic
' Wait for confirmation
start:
    goto start ' Keep polling
```

Source comments have no runtime effect. Keeping comments in generated output is controlled by the [toolchain readability options](toolchain.md#profiles-and-readable-output).

Labels use `name:` and may be referenced by `goto` or `gosub`. Duplicate and undefined labels are compile-time errors.

## Module dependencies: USES

Each `.mbas` file is a module. Declare access to another module with a module-level `USES` statement:

```basic
uses "text.mbas"
uses "../shared/clock.mbas"

DrawText()
```

The quoted path is relative to the file containing `USES`, not the build configuration. The referenced file must already be a selected build input. `USES` does not load files, insert source text, emit BASIC, or change configured execution or initializer order. Use one declaration per dependency. Empty paths, duplicate declarations (including normalized aliases), missing build inputs, and declarations inside blocks are errors. Input selection is described in the [toolchain reference](toolchain.md#program-inputs-and-project-configuration).

A module may access another module's functions, constants, enum members, global variables, arrays, struct types and values, labels, and device handles only with a direct `USES` declaration. This applies to writes as well as reads, including test assertions and `GLOBALS` fixtures. Built-in functions and target environment constants need no declaration. Parameters and `LOCAL` variables retain their existing function/test scope.

Dependencies are not transitive: if A uses B and B uses C, A must also declare `USES` for C to access C's symbols. Circular dependencies are rejected even when the modules do not call each other: A using itself, A using B using A, and longer cycles are all compilation errors. Diagnostics identify the source location and the dependency cycle. The existing prohibition on recursive function calls remains in force.

`USES` introduces access checking, not namespaces or exports. Existing global name uniqueness rules remain; symbols are still used without qualification. A scalar's module-level initialization determines ownership before assignments inside functions or tests. When an importing module also assigns that scalar, the dependency's initializer remains its owner. Otherwise, the first unscoped assignment in build order establishes ownership; a read-only implicit scalar belongs to its first referencing module. Initialize shared state in its owning module and use `LOCAL` for unrelated scratch variables that happen to share a name.

Tests normally use paths such as `uses "../source/math.mbas"`; source modules should not depend on tests.

### Declaration and initialization order

`HOT_MODULE` is an optional, standalone module-level directive that asks the
compiler to place that module's generated code before unmarked modules. It can
appear once per module, including the entry module. Mark modules containing code
that runs frequently; moving one module earlier can move another later. Marked
modules retain their configured relative order, as do unmarked modules. With no
directive, the existing physical layout is unchanged. The directive does not
change dependency checking, entry point, initialization order, executable
statement order, constant resolution, or `DATA` order. It is a layout hint, not
a guarantee of a particular speedup. In test mode it orders function bodies;
the test runner and test execution order remain unchanged.

Top-level enum members, struct types, and `DIM` storage are available across the selected compilation unit before executable statements are checked, subject to direct `USES` access. They can be declared in a later configured module. Constant declarations still evaluate in source/build order and can reference only earlier constants. Storage setup and module-global initialization run before entry-module code. Module order is defined by the selected build input; see the [toolchain reference](toolchain.md#program-inputs-and-project-configuration).

## Constants

Constants are evaluated during compilation and emit no BASIC statements:

```basic
const warningRow = TEXT_ROWS - 2
const initialCountdown = 5 * 12
const borderLine$ = string$("*", TEXT_COLUMNS)
```

A constant may reference an earlier constant. Names are case-insensitive. Duplicate constants, unknown references, invalid operations, and compile-time division by zero are rejected.

Enums are compile-time collections of integer constants:

```basic
enum ThreatState
    ThreatIdle
    ThreatTracking = 4
    ThreatLocked
end enum
```

Members without explicit values count upward from the previous value, starting at `0`. In the example, `ThreatIdle` is `0`, `ThreatTracking` is `4`, and `ThreatLocked` is `5`. Enum members currently become ordinary compile-time constants in the surrounding scope; the enum name is documentation, not a namespace.

`TEXT_ROWS` and `TEXT_COLUMNS` describe the selected text area; `JIFFIES_PER_SECOND` gives the timer frequency. Their values are listed in [target environment constants](targets.md#environment-constants). Target key constants, portable game-control constants, and portable colour constants are read-only too; device/key mappings belong in [targets](targets.md).

All targets also provide compile-time numeric constants `PI` and `E`.

Key constants include `KEY_NONE`, `KEY_UP`, `KEY_DOWN`, `KEY_LEFT`, `KEY_RIGHT`,
`KEY_SPACE`, `KEY_ENTER`, `KEY_ESCAPE`, `KEY_F1` through `KEY_F8`, `KEY_A` through
`KEY_Z`, and `KEY_0` through `KEY_9`. Portable game-control names are `GAME_UP`,
`GAME_DOWN`, `GAME_LEFT`, `GAME_RIGHT`, and `GAME_FIRE`. These are read-only numeric
constants; their native interpretation is described in [targets](targets.md#keyboard-input).

## Variables and assignment

Assignment does not use `LET` in Meta-BASIC source:

```basic
urgency = sensorCount * 2 + alertLevel
countdown% = 60
tickerText$ = "DEFENCE NETWORK ONLINE"
```

Variables ending in `$` are strings. Variables ending in `%` are integer numeric variables. Other runtime variables are regular numeric variables. Constants and environment constants cannot be assigned to.

Integer variable assignment accepts any numeric expression and stores `INT(expression)`. This means non-integer constants are allowed:

```basic
counter% = 3.7
```

Integer variables cannot currently be used as `FOR` loop counters. Native integer storage differs by target; see [targets](targets.md).

`BYTE` is an experimental compact storage type for scalars, one-dimensional arrays, and struct fields. A read yields a numeric value and a write applies `INT(...)`. Compile-time numeric writes must be integers in `0..255`; runtime expressions are the program's responsibility to keep in range.

Current string support includes assignment, concatenation, output, `MID$`, `LEFT$`, `RIGHT$`, `LEN`, `CHR$`, `CODE`, `ASC`, `STR$`, and `VAL`. Keep string values within the portable 255-character limit.

## Arrays

Arrays are declared with `DIM`. Dimensions are element counts, and Meta-BASIC array indexes start at zero:

```basic
dim values(3)
dim counters%(3)
dim pixels as byte(256)

values(0) = 1.5
values(2) = values(0) + 2
counters%(2) = values(2)
print values(0); counters%(2)
```

`dim values(3)` creates valid indexes `0`, `1`, and `2`. Constant indexes are checked at compile time; dynamic indexes are not range-checked yet. Dimensions must be positive compile-time integers. Integer arrays ending in `%` coerce assigned values with `INT(...)`, matching integer variable assignments.

`dim pixels as byte(256)` creates 256 byte slots; `dim currentColour as byte` creates a byte scalar. Byte arrays take exactly one element-count dimension. Byte storage is initialized to zero before entry code. Native representations and memory trade-offs are described in [targets](targets.md).

String arrays are fixed-width:

```basic
dim messages$(3, 12)

messages$(0) = "READY"
messages$(2) = "STANDBY"
print messages$(0); messages$(2)
```

The declared width is the element's storage capacity, not part of the string value: `"READY"` has length 5, while `"READY "` has length 6 and preserves the trailing space. Reads, `LEN`, slicing, comparisons, output, and concatenation use the logical value on every target. String-array access supplies only the element index; width belongs to the declaration. Literal assignments exceeding that width are rejected. String fields in struct arrays use the same rules.

### Structs

Use `STRUCT` blocks to define small record-like storage shapes:

```basic
struct TelegraphText
    textQueueRow
    textQueueColumn
    flags as byte
    textQueue$(39)
end struct

dim textQueue AS TelegraphText(100)
dim newElement AS TelegraphText

textQueue(0).textQueueRow = 4
newElement.textQueue$ = "READY"
```

Struct definitions are compile-time-only type definitions and cannot be nested. A numeric field is a bare name, a byte field uses `AS BYTE`, and a fixed-width string field has one width argument such as `text$(39)`. Access fields with `value.field` or `array(index).field`. The [target storage layouts](targets.md) do not change source indexing or value semantics.

Whole-struct assignment copies every field from a scalar struct value of the same type:

```basic
dim queue AS TelegraphText(100)
dim nextText AS TelegraphText
dim copyText AS TelegraphText

queue(0) = nextText
copyText = nextText
```

The right-hand side must be a scalar struct value, not an expression or struct array element.

`insert_element(array, index, value)` inserts into a one-dimensional native array or struct array. Existing elements from `index` upward are moved one slot higher, and the last element is lost. For struct arrays, `value` must currently be a scalar struct value of the same type. `remove_element(array, index)` moves elements from `index + 1` downward and overwrites the element at `index`; the final slot is left as whatever value remains there.

Scalar struct parameters and their copy semantics are defined under [User-defined functions](#user-defined-functions).

Declaration visibility and startup initialization follow the [module-order rules](#declaration-and-initialization-order).

## Expressions

Supported primary expressions are:

- Numeric and string literals
- Identifiers
- Array reads such as `values(0)` and `messages$(0)`
- `TRUE` and `FALSE`
- Parenthesized expressions
- Supported function calls

Supported operators, from highest to lowest precedence:

1. `^`
2. Unary `-` and `NOT`
3. `*`, `/`, and `MOD`
4. `+` and `-`
5. `=`, `<>`, `<`, `<=`, `>`, and `>=`
6. `AND`
7. `OR`

Binary operators are left-associative. `MOD` uses the floor-based remainder; its current runtime implementation may evaluate operands more than once, so avoid side-effecting operands such as `RND()`. Exponentiation retains target-native numeric/domain restrictions; see [runtime function mappings](targets.md#runtime-function-mappings). Comparison chaining such as `a < b < c` is rejected; write `a < b AND b < c`.

Meta-BASIC treats zero as false and every nonzero numeric value as true, regardless of the native BASIC representation of logical values.

## Built-in functions

| Function | Kind | Purpose |
| --- | --- | --- |
| `string$(text$, count)` | Compile time | Repeat a string |
| `space$(count)` | Compile time | Produce spaces |
| `text$("key")` | Compile time | Resolve a selected-language resource in output or a string constant |
| `mid$(text$, start, length)` | Runtime | Extract a string section |
| `mid$(text$, start)` | Runtime | Extract from a position through the end of the string |
| `left$(text$, length)` | Compile time for literal arguments; otherwise runtime | Extract the left part of a string |
| `right$(text$, length)` | Compile time for literal arguments; otherwise runtime | Extract the right part of a string |
| `len(text$)` | Compile time for a literal argument; otherwise runtime | Return string length |
| `chr$(code)` | Runtime | Convert a numeric character code to a one-character string |
| `code(text$)` | Runtime | Convert the first character of a string to a numeric code |
| `asc(text$)` | Runtime | Alias-style source spelling for `code(text$)` |
| `str$(x)` | Runtime | Convert a number to a string |
| `val(text$)` | Runtime | Convert a numeric string to a number |
| `abs(x)` | Runtime | Return absolute value |
| `atn(x)` | Runtime | Return arctangent |
| `cos(x)` | Runtime | Return cosine |
| `exp(x)` | Runtime | Return `e` raised to a power |
| `int(x)` | Compile time for constant `x`; otherwise runtime | Round down to an integer |
| `sgn(x)` | Runtime | Return sign |
| `sin(x)` | Runtime | Return sine |
| `sqr(x)` | Runtime | Return square root |
| `rnd()` | Runtime | Return the next pseudo-random number in the target's native `0 <= x < 1` range |
| `jiffies()` | Runtime | Read the target's running tick counter |
| `free_memory()` | Runtime | Return the target's current free BASIC memory in bytes |
| `key_code()` | Runtime | Poll the keyboard without waiting |
| `key_pressed()` | Runtime | Check whether a key is waiting without blocking |
| `get_joystick(control)` | Runtime | Read a joystick axis or fire button without blocking |
| `screen_code(row, column)` | Runtime | Read the character code currently visible at a 1-based text-screen position |
| `device_available(device)` | Runtime | Best-effort availability check for `PRINTER`, `TEXT_PRINTER`, `SHARED_DRIVE`, or `RS232` |

`CHR$`, `CODE`, and `ASC` use target character codes rather than promising ASCII outside ordinary printable text. Use `VAL` with plain numeric strings for portability. Native spellings, numeric behavior, and memory/timer implementations are documented in [targets](targets.md#runtime-function-mappings).

`SCREEN_CODE(row, column)` uses 1-based coordinates and returns a code comparable with `CODE("X")` for ordinary portable printable text. Constant coordinates are range-checked; dynamic coordinates are not yet checked at runtime. It reads actual display state rather than logical test capture. Character recognition and screen-edge limitations are [target-specific](targets.md#screen-boundaries).

Random numbers use:

```basic
randomize 1983
value = rnd()
```

`RANDOMIZE` accepts an optional numeric seed. Seeding behavior depends on the target; it does not promise an identical sequence across dialects. See [target mappings](targets.md#runtime-function-mappings).

`STRING$` and `SPACE$` require constant arguments, and their result is limited to 255 characters. `KEY_PRESSED()` returns true when a key is available. `KEY_CODE()` is currently supported only as the complete right-hand side of a numeric assignment:

```basic
key = key_code()
```

For controlled runtime input values in tests, see [Runtime input controls](#runtime-input-controls).

## Keyboard input

`INPUT` waits for ordinary keyboard input and assigns one or more scalar variables:

```basic
print "NAME";
input name$
input age, score%
```

Fields of a scalar struct are valid destinations, which is convenient when building a record interactively:

```basic
dim person as Person
input person.name$, person.age%
```

Integer and `BYTE` destinations retain their Meta-BASIC integer coercion. Whole arrays, indexed array elements, whole structs, and fields of struct arrays are not direct `INPUT` destinations yet; input into a scalar or scalar struct first and then assign that value to the array element. Target BASIC controls the editing prompt and validation shown while input is in progress.

## Joystick input

```basic
x = get_joystick(JOY_X)
y = get_joystick(JOY_Y)
fire = get_joystick(JOY_FIRE1)
```

The read-only selectors `JOY_X` (0), `JOY_Y` (1), and `JOY_FIRE1` (2) must be known at compile time. Constant aliases are allowed; runtime selector variables and unknown selector values are rejected. Use underscores, not hyphens, in selector names.

| Selector | Negative | Neutral | Positive |
| --- | --- | --- | --- |
| `JOY_X` | -1: left | 0 | 1: right |
| `JOY_Y` | -1: up | 0 | 1: down |
| `JOY_FIRE1` | Not applicable | 0: released | 1: pressed |

Diagonal movement and fire together are supported. Simultaneous opposing directions cancel to zero. Each call polls independently; separate calls are not an atomic snapshot. The function may appear in numeric expressions, conditions, and function return values, not just assignments.

Only the selectors above are supported. `GAME_*` constants are keyboard key codes, not joystick selectors. Hardware ports, keyboard-backed controls, and native polling are listed in [Joystick mappings](targets.md#joystick-mappings). Test controls are defined under [Runtime input controls](#runtime-input-controls).

## Data streams

`DATA`, `READ`, and bare `RESTORE` provide the classic BASIC data stream:

```basic
data 10, "READY"
data 20, "ALERT"

read itemCode, message$
print itemCode; " "; message$

restore
read itemCode, message$
```

`DATA` values must fold to numeric, string, or boolean literals; runtime expressions and calls are rejected. Values form one program-wide stream in source order. `READ` targets scalar variables only, not array elements. Bare `RESTORE` rewinds the whole stream; labelled/line-targeted restore is not supported. The placement of generated data records is described in [architecture](architecture.md#program-inputs).

## Data files

`SAVE_FILE` and `LOAD_FILE` write or read one complete numeric, integer, `BYTE`, fixed-width string, or struct array:

```basic
dim names$(20, 24)
save_file "STORY1", names$
load_file "STORY1", names$

dim people AS Person(12)
save_file "PEOPLE", people
load_file "PEOPLE", people
```

The filename is a portable logical name: 1 to 8 letters or digits, beginning with a letter. The array must already be declared. Whole-array storage preserves values including empty strings, commas, and quotes; native formats, serialization, and temporary memory requirements are described in [File storage](targets.md#file-storage).

`FILE_EXISTS("NAME")` returns `1` if the corresponding data file exists and `0` otherwise; it must currently be the complete right-hand side of a numeric assignment. `DELETE_FILE "NAME"` deletes that file. Both require rewritable storage. Unguarded uses are rejected in tape builds because cassette storage has no directory. A compile-time `IF FILE_STORAGE_DISK THEN` guard removes these operations from tape builds:

```basic
if FILE_STORAGE_DISK then
    autosaveExists = file_exists("AUTOSAVE")
    if autosaveExists then
        delete_file "AUTOSAVE"
    end if
end if
```

Deleting a nonexistent or protected file retains the target system's native behavior.

`FILE_STORAGE_TAPE` and `FILE_STORAGE_DISK` are read-only compile-time constants, one `1` and the other `0`, for the selected medium. Storage selection is a [toolchain option](toolchain.md#program-inputs-and-project-configuration); supported/default media are listed in [targets](targets.md#file-storage). A program can issue appropriate user instructions before an operation:

```basic
if FILE_STORAGE_TAPE then
    print text$("rewindAndCueTape")
end if
load_file "SAVE1", gameState
```

Tape operations continue from the current physical position. Loading an earlier save requires rewinding or cueing first. File-not-found and media errors remain native BASIC errors; there is no portable recovery/status API. Machine-specific prompts and tape naming are described in [targets](targets.md#file-storage).

`SAVE_FILE` replaces an existing file on rewritable storage; a preceding `DELETE_FILE` is unnecessary. Replacement is not a portable transactional or crash-recovery guarantee.

## User-defined functions

Functions may have parameters, local variables, side effects, and return values:

```basic
function AddBonus(Score, Bonus)
    local Result
    Result = Score + Bonus
    return Result
end function

Total = AddBonus(CurrentScore, 10)
```

Functions are top-level declarations and may be called before their definition. Parameters and names declared with one or more `LOCAL` statements are scoped to the function; other names refer to globals. Recursive and mutually recursive calls are rejected.

Scalar struct parameters use `AS` in the parameter list:

```basic
function ShiftedRow(item AS TelegraphText, offset)
    local result
    result = item.row + offset
    item.row = 99
    return result
end function
```

Scalar structs are passed by value: changing a parameter field does not change the caller's struct. Struct arrays cannot currently be parameters.

Use a function call in an expression when the return value matters. A user-defined function may also be called as a standalone statement when only its side effects matter:

```basic
DrawHeader()
```

A standalone call discards the return value. A side-effect-only function may omit `RETURN expression`; reaching `END FUNCTION` returns to its caller. Built-ins and array reads are not valid standalone statements, so `values(0)` by itself is rejected.

Small helpers can be declared as `INLINE FUNCTION`. Their body is expanded at each call site; the restrictions below make that expansion predictable:

```basic
inline function PrintCell(row, column, text$)
    print_at row, column, text$
end function

PrintCell(4, 1, "READY")
```

Inline functions are intentionally limited to predictable expansion. They cannot contain labels, `GOTO`, `GOSUB`, `EXIT FOR`, or `CONTINUE FOR`; they cannot assign to their parameters; and if they return a value, the `RETURN expression` must be the final statement.

## Output

`PRINT` accepts semicolon-separated expressions. A trailing semicolon suppresses the newline:

```basic
print "SECONDS: "; countdown
print "WAIT";
```

Portable positioned output uses 1-based `row, column` coordinates:

```basic
print_at 1, 1, "WARNING"
print_at warningRow, 1, "SECONDS: "; countdown
```

The comma after the column is required. Constant coordinates are checked against the selected screen dimensions; dynamic coordinates are not range-checked yet. See [targets](targets.md#overview) for screen dimensions and [positioned output](targets.md#positioned-output) for generated BASIC.

`PRINT_INVERT` and `PRINT_INVERT_AT` draw string literals with foreground and background reversed. They retain the ordinary trailing-semicolon and `PRINT_AT` coordinate syntax, but do not accept runtime strings or numeric expressions:

```basic
print_invert "SELECTED"
print_invert_at menuRow, menuColumn, "CURRENT ACTION"
```

Native inverse-video mechanisms and firmware requirements are documented in [targets](targets.md).

### Cursor positioning and blank lines

Bare `PRINT` emits a blank line. `SET_POS row, column` moves the cursor without visible output or a newline. `SET_COLUMN column` changes only the current column and preserves the current row:

```basic
set_pos 3, 5
print "READY"
set_column 20
print "STATUS"
print
```

Coordinates are numeric expressions with the same 1-based order and bounds as `PRINT_AT`. Cursor movement emits no visible output or newline and does not replace captured print output used by test assertions. Constant positions are checked; dynamic positions are not range-checked.

### Compile-time text layout

| Statement | Text source | Behavior |
| --- | --- | --- |
| `PRINT_WRAP expression [, width]` | String literal or compile-time string constant/expression | Wraps text without localization files |
| `PRINT_TEXT "name" [, width] [; name = expression, maxLength ...]` | Selected-language text resource | Loads localized text, inserts named values, and wraps it |
| `PRINT_CENTERED expression [, width]` | String literal or compile-time string constant/expression | Wraps text and centers each resulting line |

```basic
const welcome$ = "Welcome to San-Golpe!"
set_pos 1, 1
print_centered welcome$
print_wrap "This paragraph is wrapped during compilation."
print_wrap welcome$, 28
print_text "intro"
print_text "npcRanAway"; actor = actorName$, 21; target = targetName$, 21
print_centered text$("continue")
print_centered text$("creatingCharactersProgress"); created = createdCount, 2; total = 11, 2
```

Text layout is resolved during compilation. Runtime string variables cannot be wrapped or centered. Width must fold to an integer from `1` through `TEXT_COLUMNS`; it defaults to the selected screen's full width.

Words stay together when possible; longer words split. Single line breaks within a paragraph become spaces, and blank lines separate paragraphs. Layout starts at the current cursor position and does not track cursor state across statements/branches. Start full-width output at column 1. A narrower width limits line length without establishing a persistent left indent; native left-margin behavior is described in [targets](targets.md).

Text is not automatically paginated. Split long pages into separate resources and position them explicitly to avoid native screen scrolling.

### Localized text resources and fonts

A conventional project can include an optional `texts/` folder beside `source/`:

```text
source/main.mbas
texts/en/intro.txt
texts/en/strings.json
texts/de/intro.txt
texts/de/strings.json
```

Each language directory may contain a `strings.json` object for short texts:

```json
{
  "continue": "PRESS ANY KEY TO CONTINUE",
  "new_game": "NEW GAME"
}
```

Use one UTF-8 `.txt` file per long text when editing paragraphs is more convenient. Its filename stem becomes the resource key, so `intro.txt` provides `intro`. `PRINT_TEXT "intro"` resolves a resource and wraps it directly. The compile-time expression `TEXT$("continue")` resolves a resource for other output forms, such as `PRINT_CENTERED TEXT$("continue")`, `PRINT TEXT$("continue")`, or `CONST continueText$ = TEXT$("continue")`. Both resource forms use the same lookup. Keys are case-sensitive and must be written as string literals. Defining the same key in `strings.json` and a `.txt` file is an error.

Localized resources used by `PRINT_TEXT` or `PRINT_CENTERED` may contain named placeholders:

```json
{
  "npcRanAway": "{actor} ran away with {target}."
}
```

Bind each placeholder after a semicolon and give the inserted expression's maximum possible display length:

```basic
print_text "npcRanAway"; actor = actorName$, 21; target = targetName$, 21
print_text "npcRanAway", 30; actor = actorName$, 21; target = targetName$, 21
print_centered text$("npcRanAway"); actor = actorName$, 21; target = targetName$, 21
```

The compiler reserves the declared maximum length while wrapping and centering, then emits ordinary runtime `PRINT` expressions in place of the placeholders. Centering uses these maximum lengths, so a shorter runtime value can appear slightly off center; target-specific numeric `PRINT` spacing can also affect its visible width. The maximum must be a positive compile-time integer no larger than the selected output width. It is a promise about the runtime value rather than an instruction to truncate it. A placeholder and surrounding punctuation form one word and must fit within the output width at its maximum size. Every placeholder in the selected translation needs one binding, and every binding must be used. Names are case-insensitive and translations may reorder or repeat them. Use `{{` and `}}` for literal braces.

Missing translations produce a source-location diagnostic; there is no automatic fallback to another language. Resource discovery, language selection, and requested font groups are [toolchain settings](toolchain.md#program-inputs-and-project-configuration). Character preservation, transliteration, and output encodings depend on the [selected target](targets.md#character-sets). Placeholder values retain their runtime contents because they are not known during compilation.

### Device output

Device output is available for printer-like logging and emulator capture workflows:

```basic
if device_available(RS232) then
    open_device Log, RS232
    print_device Log; "TEST RESULT: "; 1
    close_device Log
end if
```

Supported device constants are `PRINTER`, `TEXT_PRINTER`, `SHARED_DRIVE`, and `RS232`. Handles are source-level names for opened devices. A handle must be declared with `OPEN_DEVICE` for use by `PRINT_DEVICE` or `CLOSE_DEVICE`; duplicate handle declarations are rejected. `PRINT_DEVICE` accepts the same semicolon-separated items as `PRINT`. Native channels and support differ by target; see [Device mappings](targets.md#device-mappings).

`DEVICE_AVAILABLE` is a best-effort availability check, not a guarantee that later I/O will succeed. Target-specific probing limitations are listed with [device mappings](targets.md#device-mappings).

## Test Mode

Enable test mode through the [toolchain runner options](toolchain.md#test-build-and-capture-options).

Test-only syntax is rejected in normal builds. In test mode, the compiler generates a test runner instead of normal program startup. All `TEST` blocks are discovered automatically and executed in deterministic source order.

By default, application print, cursor, clear-screen, and colour operations in tests are captured for assertions without changing the real display. Optional screen-output execution performs them as well, permitting `SCREEN_CODE` checks while retaining logical print assertions. Build settings are documented in the [toolchain reference](toolchain.md#test-build-and-capture-options).

Tests use the project's selected character groups for application output, runner messages, and expected text. Font selection is a [toolchain setting](toolchain.md#program-inputs-and-project-configuration); native character-set behavior belongs in [targets](targets.md#character-sets).

```basic
function Add(Left, Right)
    return Left + Right
end function

globals
    CurrentScore = 0
    PlayerName$ = "READY"
end globals

test AdditionWorks()
    local Result
    Result = Add(2, 3)
    assert_eq 5, Result
end test
```

`GLOBALS` blocks may contain assignment statements. The generated test runner replays those assignments before each test, so shared global fixture variables return to their declared initial values. This is explicit on purpose: globals outside a `GLOBALS` block are left alone.

`TEST Name()` takes no parameters and returns no value. It may declare `LOCAL` variables, use normal statements, and call normal `FUNCTION`s.

### Runtime input controls

In test mode, tests can replace the runtime values returned by the timer and keyboard helpers:

```basic
test FakesRuntimeInputs()
    set_jiffies(123)
    set_key_code(KEY_SPACE)
    set_key_pressed(1)

    assert_eq 123, jiffies()
    assert_eq KEY_SPACE, key_code()
    assert_true key_pressed()

    set_key_pressed(0)
    assert_false key_pressed()
end test
```

`SET_JIFFIES`, `SET_KEY_CODE`, and `SET_KEY_PRESSED` are valid only inside `TEST` blocks. The generated runner resets all three fake values to `0` before every test.

In test mode, all `GET_JOYSTICK` calls, including calls in ordinary functions, read independent fake controls instead of hardware:

```basic
test MoveLeftAndFire()
    set_joystick(JOY_X, -1)
    set_joystick(JOY_FIRE1, 1)
    assert_eq -1, get_joystick(JOY_X)
    assert_eq 0, get_joystick(JOY_Y)
    assert_eq 1, get_joystick(JOY_FIRE1)
end test
```

`SET_JOYSTICK(control, value)` is a statement allowed only directly inside a `TEST` block. Its selector must be constant, and its value must be numeric. Supply normalized values from the [joystick input table](#joystick-input); the fake stores the supplied value without conversion. Setting one control leaves the other controls unchanged. All three reset to zero before every test, independently of the keyboard fakes. Normal builds emit no joystick fake storage or resets.

`SET_RND(value, ...)` supplies an ordered sequence of results for the next `RND()` calls, including calls inside ordinary and inline functions:

```basic
test AttackDice()
    set_rnd(0, 0.5, 0.99)
    assert_eq 1, int(rnd() * 6) + 1
    assert_eq 4, int(rnd() * 6) + 1
    assert_eq 6, int(rnd() * 6) + 1
end test
```

The command takes one or more numeric expressions. Values must satisfy `0 <= value < 1`; out-of-range constants are rejected, and callers must keep runtime expressions in range. Arguments are evaluated left to right before replacing any unused sequence. Each `RND()` call consumes exactly one value, in source expression order. A second `SET_RND` replaces the sequence rather than appending to it. Before each test the sequence is cleared. Without a sequence, or after it is exhausted, `RND()` uses the target's native generator; supply enough values for a fully deterministic test. `RANDOMIZE` affects the native generator and leaves queued values intact.

Like `SET_KEY_CODE` and the other runtime setters, `SET_RND` is a statement allowed only inside a `TEST` block with test mode enabled; it cannot be called from an ordinary helper function or used as a value. Normal builds emit no random fake storage or helper, and test builds without `SET_RND` retain native `RND()` directly.

### Assertions

Supported assertions are:

```basic
assert_true expression
assert_false expression
assert_eq expected, actual
assert_ne expected, actual
assert_print expectedText$
assert_printat row, column, expectedText$
assert_screen_border_color colour
assert_screen_background_color colour
assert_screen_text_color colour
assert_cell_text_color colour
assert_cell_background_color colour
```

Assertions count successes and failures, continue after failure, and failed tests do not prevent later tests from running. The generated summary prints test, pass, fail, assertion, failure, and free-memory counts.

Runner progress and summaries can be mirrored to an external device. This mirrors the runner log, not arbitrary application output; application prints retain their test-capture behavior. Configuration is described in the [toolchain reference](toolchain.md#test-build-and-capture-options), and working transports in the [running guide](running-programs.md#test-capture-locations).

`ASSERT_PRINT` compares against the most recent logical non-positioned `PRINT` output captured in test mode. Semicolon-separated print items are concatenated into one captured value, so `print "A"; "B"` captures `AB`.
For portable text assertions, prefer strings. Numeric formatting follows target BASIC conventions; see [numeric output formatting](targets.md#numeric-output-formatting).

`ASSERT_PRINTAT row, column, text$` compares against the most recent logical `PRINT_AT` output captured in test mode. It checks the portable 1-based row, column, and semicolon-concatenated text. It does not inspect emulator screen memory; use `testScreenOutput` together with `SCREEN_CODE` when the actual rendered screen is what matters.

Colour assertions compare the latest portable colour command state captured in test mode. `CLS colour` counts as setting the screen background colour. Colour assertion values use portable colour names such as `BLUE` and `WHITE`, not target-specific numeric colour codes.

## Control flow

### Conditional blocks

```basic
if confirmed and urgency >= 4 then
    print "ATTACK CONFIRMED"
else
    print "AWAITING SECOND SOURCE"
end if
```

`ELSE` is optional, nesting is supported, and every `IF` requires `END IF`.

### Subroutines

```basic
gosub updateClock
goto continue

updateClock:
    print "TICK"
    return
```

### Loops

```basic
for row = 0 to TEXT_ROWS - 1
    print row
next row

for countdown = 10 to 0 step -1
    print countdown
next countdown
```

Use `CONTINUE FOR` to advance the current `FOR` loop early, and `EXIT FOR` to leave it:

```basic
for index = 0 to count - 1
    if values(index) = 0 then
        continue for
    end if
    if values(index) < 0 then
        exit for
    end if
    print values(index)
next index
```

`WHILE/WEND` checks the condition before every iteration:

```basic
while count < 3
    print count
    count = count + 1
wend
```

`REPEAT/UNTIL` runs the body once before checking the exit condition:

```basic
repeat
    count = count - 1
    print count
until count = 0
```

`END` terminates program execution:

```basic
print "DONE"
end
```

## Screen and colour commands

Portable colours are `BLACK`, `BLUE`, `RED`, `MAGENTA`, `GREEN`, `CYAN`, `YELLOW`, and `WHITE`. Colour arguments must be known at compile time and resolve to a portable colour. Constant aliases such as `const alertColour = RED` are allowed.

```basic
cls
cls BLUE
screen_border_color BLUE
screen_background_color BLACK
screen_text_color WHITE
cell_text_color YELLOW
cell_background_color BLUE
suppress_scroll_prompt
program_mode
```

`CLS` clears the text screen. `CLS colour` first selects the screen background and does not change foreground/text or border colour. `SCREEN_BORDER_COLOR`, `SCREEN_BACKGROUND_COLOR`, and `SCREEN_TEXT_COLOR` select screen-wide/current colours; `CELL_TEXT_COLOR` and `CELL_BACKGROUND_COLOR` affect following printed cells where supported.

`border_color` is a compatibility spelling for `screen_border_color`; `text_color` is a compatibility spelling for `screen_text_color`.

Cell colours may have no effect on targets without the corresponding per-cell feature. This is deliberate rather than an attempt to simulate the feature with a large runtime.

`SUPPRESS_SCROLL_PROMPT` requests uninterrupted long output on targets with an interactive scroll prompt. Other targets may ignore it; native effects are documented in [targets](targets.md).

`PROGRAM_MODE` requests best-effort setup for running a finished program. Effects differ by machine, including cursor/margin changes and break-key handling; see [targets](targets.md) for native effects and any reserved memory. It does not prevent native scrolling from output at the screen boundary.

## Current omissions

The language does not yet implement variable declarations beyond `DIM` and function/test locals, a separate `PROCEDURE` declaration, namespaces, exports, automatic dependency loading, separate compilation, dynamically resizable string-array element capacities, labelled `RESTORE`, general function calls beyond documented built-ins and Meta-BASIC functions, or `PRINT` comma/apostrophe separators.
