# Architecture

Meta-BASIC is built as a small TypeScript compiler plus thin command-line and editor shells. The compiler core should stay independent from emulators, packaging tools, VS Code, and local filesystem conventions.

This document owns compiler structure, lowering algorithms, and boundaries between
the core and its shells. Source contracts belong in the [language reference](language-reference.md),
native mappings in [targets](targets.md), build configuration in the
[toolchain reference](toolchain.md), and emulator setup in the [running guide](running-programs.md).

The important design rule is that target-independent meaning is decided before target rendering. A construct such as `PRINT_AT`, `STRUCT`, `FUNCTION`, `ASSERT_EQ`, or `DEVICE_AVAILABLE` has one Meta-BASIC meaning first; only after that do Spectrum, Atari, C64, VIC-20, and Agon lowering choose the native spelling.

## Pipeline

```text
source files / project config
  -> build configuration loading
  -> lexer tokens
  -> parser AST
  -> semantic analysis
  -> shared lowering, including startup prelude creation
  -> target lowering and expression rendering
  -> line numbering and line validation
  -> optional line-length relief with generated temporaries
  -> BASIC text
  -> optional packaging tools
  -> optional emulator launch
```

The compiler library ends at BASIC text plus diagnostics and stats. Everything after that is script orchestration.

## Compiler invariants

Parse statements from tokens and represent expressions as typed AST nodes rather
than unvalidated source text. Keep keywords centralized in the lexer and built-in
function names in `src/functions.ts`; semantic analysis validates function calls,
and the shared function-rendering helper selects native spellings.

Preserve filename, line, and column through compiler stages for actionable
diagnostics. Keep generated internal labels distinct from user labels. Render
identical input/options deterministically, including culture-independent numeric
literals with `.` as decimal separator. Normalize logical truth in lowering or
rendering where a native dialect uses bitwise operators or different true values.

Generated-line relief may split complex expressions into temporary assignments
before reporting a target line-length error. Simple oversized statements, such as
an unbreakable long string literal, still produce a diagnostic.

## Main Source Areas

- `src/ast.ts` defines the syntax tree as discriminated unions.
- `src/lexer.ts` tokenizes source text and owns the centralized keyword set. Built-in function names remain identifiers.
- `src/parser.ts` turns tokens into statements and expressions. It should make syntax decisions from tokens, not whole-line regular expressions.
- `src/semantic.ts` checks language rules, resolves constants, validates labels, functions, structs, arrays, test-only constructs, devices, and built-in calls. Struct values are erased here into generated backing scalar and array names.
- `src/functions.ts` is the central list of portable built-in functions.
- `src/devices.ts` is the central list of portable device constants.
- `src/function-semantics.ts` analyzes user functions, local variables, parameters, and recursion.
- `src/function-call-lowering.ts` expands Meta-BASIC function calls into generated parameter assignments, `GOSUB`, and return-value reads.
- `src/lowering.ts` performs shared structural lowering for ordinary statements. For multi-file builds it creates startup calls to per-module initialization sections, keeps those sections and functions in configured module order, and collects `DATA` into a final data section.
- `src/targets/byte-storage.ts` selects the experimental compact `BYTE` representation, rewrites byte reads to native numeric conversions where needed, and initializes character-backed byte arrays before entry code.
- `src/test-runner-lowering.ts` builds the generated MCP test runner and assertion support when test mode is enabled.
- `src/targets/*.ts` render and lower target-specific details for Spectrum, Atari 800XL, C64, VIC-20, and Agon Light.
- `src/targets/function-rendering.ts` maps portable built-in functions to target BASIC spellings.
- `src/line-numbering.ts` assigns BASIC line numbers and enforces target maximums.
- `src/compiler.ts` coordinates final rendering and may retry with generated temporaries when complex generated code would exceed a target line-length limit.
- `src/output-stats.ts` reports generated-line and variable-use information, plus final rendered-BASIC byte estimates attributed to source modules through instruction locations.
- `src/build-configuration.ts` loads `metabasic.json` style program descriptions.
- `src/cli.ts` is the thin command-line shell around the compiler.

## Scripts And Tools

The executable `scripts/*.mjs` files are thin command-line entry points outside the compiler core. Reusable build, packaging, launch, capture, and scaffolding logic lives in header-free `scripts/lib/*.mjs` modules so tests and other scripts never need to import an executable file or parse its shebang.

Tool configuration belongs to the script layer; the compiler core does not read
executable paths or emulator arguments. Configuration fields and templates are
defined in the [toolchain reference](toolchain.md#local-tool-configuration).

The VS Code extension in `vscode-extension/` is also a shell. It calls the existing scripts and parses their output for editor diagnostics. It should not grow a second compiler.

Application repositories are a separate boundary from the tool installation.
Resolve project sources, resources, configuration, and build output from the
selected application project and its settings; resolve bundled compiler/helper
files from the tool installation. Build, test, and launch paths must work when the
application is outside this checkout. Avoid assumptions that an application lives
under `examples/` or shares the compiler repository's working directory.

## Program Inputs

The build shell resolves source files, their order, and text resources before
calling the compiler. Input selectors and discovery rules are defined in the
[toolchain reference](toolchain.md#program-inputs-and-project-configuration).

Multi-file compilation produces one compilation unit. Semantic analysis collects
top-level type and storage declarations before checking executable statements and
checks cross-module access through `USES`. Source visibility, ownership, and
initialization rules are defined in the
[language reference](language-reference.md#module-dependencies-uses).

Shared lowering inserts startup calls to generated per-module initialization
sections, leaving those sections and function bodies in configured module order.
All `DATA` statements are collected in source order into a final data section.
This separates execution of initialization from the physical listing order;
modules are not independently compiled or linked.

## Test Mode

Test-runner lowering is an alternate startup path selected by the compiler's test
mode. It generates calls to discovered tests, fixture resets, assertion counters,
logical output-capture storage, progress messages, and a final summary. Normal
builds omit this runtime. Test syntax and observable behavior are specified in the
[language reference](language-reference.md#test-mode); enabling runner options is
covered by the [toolchain reference](toolchain.md#test-build-and-capture-options).

Timer, keyboard, and joystick fakes use generated per-test storage. `SET_RND`
sequences use a shared queue; each queued result is consumed once before target
expression rendering, with native random generation retained when no queued
values remain.

Runner output uses a shared logical result protocol and optional device-output
lowering. The backend chooses native I/O; launch/capture adapters receive it on
the host. Native [device mappings](targets.md#device-mappings) and
[verified capture setups](running-programs.md#test-capture-locations) are maintained
separately from the compiler design.

## Target Responsibilities

Targets are responsible for dialect-specific output, including:

- keyword spelling and identifier casing,
- variable-name mapping and collision avoidance,
- string-variable and string-array storage quirks,
- array index shifting or native dimension adjustments,
- control-flow spelling such as `GO TO` versus `GOTO`,
- built-in function rendering,
- colour, keyboard, device, and positioned-output lowering,
- practical line-length validation.

Targets should not invent new source-language semantics. If a feature has portable meaning, validate and normalize it before target rendering.

## Generated storage allocation

The compiler reuses generated expression-result variables when their values cannot be live at the same time. A result needed across a `GOSUB` keeps storage distinct from temporaries in the called routine. Function parameters, locals, and return values also draw from shared type-specific storage pools. Functions that can call one another receive distinct slots, while functions that cannot be active together may share slots across those source-level roles. This reduces variable-table pressure on all targets without changing Meta-BASIC source variables or function-call order.

Struct parameters are copied into generated function storage before the native call; inline function bodies are expanded at their call sites rather than emitted as separate BASIC subroutines. Source-level copying and scope rules are defined in the [language reference](language-reference.md#user-defined-functions).

## Control-flow and line packing

Shared lowering prefers fall-through control flow. A block without `ELSE` inverts its condition and jumps over the body instead of emitting a conditional jump followed by an unconditional jump. `WHILE` and `REPEAT` use the same rule.

Consecutive terminal equality branches over the same value are recognized as a computed dispatch after constants and enum members have been folded. Zero-based enums are shifted to the one-based native dispatch index. Atari BASIC and C64 BASIC V2 render the result as `ON expression GOTO ...`; Spectrum expands it to a straight sequence of `IF expression = n THEN GO TO ...` statements. Equality branches that each make one subroutine or side-effect function call similarly lower to `ON expression GOSUB ...`, with Spectrum receiving an `IF ... THEN GO SUB ...` sequence. Atari rewrites the native index as a compact sum of equality matches with a dedicated no-match entry, using Atari comparison results directly as zero or one. The result is always within the `ON` label range, avoiding Atari error 3 without a separate guard line and without retaining gaps between sparse values such as Atari key codes.

An `IF`/`ELSE` whose branch always transfers control is laid out so that the terminal branch removes the otherwise necessary join jump. In release output, a short conditional body may be fused back into native `IF expression THEN statement[:statement...]` form after target expansion. If the fused line would exceed the target limit, rendering automatically falls back to the separate branch and body. Atari and C64 conditional line branches use their shorter `THEN line` spelling; Spectrum retains `THEN GO TO line`.

Agon's stack-free lowering for loops with an early exit or return uses the known
direction of a constant step to emit one loop-bound comparison. Dynamic steps
retain their saved value and runtime direction checks.

Release output may join up to four safe target instructions with colons when they came from the same Meta-BASIC source statement. Labels, branches, returns, comments, and unrelated source statements are never joined. A simple `FOR`, non-branching body, and matching `NEXT` may also share one line. If a packed line would exceed a target's practical line-length limit, the compiler automatically splits it and assigns line numbers again.

## Adding A Feature

The main extension points are:

| Change | Compiler path |
| --- | --- |
| Statement | Central lexer keyword set, AST, parser, semantic checks, shared lowering, target expansion/rendering |
| Built-in function | `src/functions.ts`, semantic argument validation, shared function rendering and target implementations |
| Device constant | `src/devices.ts`, semantic/device validation, target device lowering; launch/capture adapters when needed |

Use the [feature-development workflow](../skills/add-metabasic-feature/SKILL.md)
for host regressions, native instruction-suite coverage, and documentation updates.
That workflow owns the implementation and validation procedure; this page locates
the components involved.
