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
- `src/targets/beep.ts` expands non-Spectrum beeps into sound-register operations and blocking clock waits; constant pitches are converted during compilation.
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

`HOT_MODULE` requests a stable partition of the physical module sections: marked
modules precede unmarked modules, with configured order preserved within each
group. Startup initialization calls and executable module flow retain configured
order; explicit branches bridge any reordered sections, including an initial
branch when the entry module moves. `DATA` remains in source order. Programs
without a layout change retain the existing lowering. In test mode the hint only
orders function bodies, leaving test execution and fixture setup unchanged.

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

Before reusing temporary storage, the compiler forwards a numeric function return directly to an immediately following assignment or conditional branch when its generated snapshot has exactly one definition and one consuming instruction. Other snapshots remain in place, including those needed across calls or branches.

After temporary storage has been assigned, a conservative instruction cleanup removes repeated numeric copies when the source and destination have not changed. It summarizes the scalar writes of reachable subroutines, including nested calls, so a repeated parameter assignment can be removed across a call only when the called code preserves both values. Branch targets and unknown side effects discard the available-copy facts; string and byte assignments are not removed. This cleanup runs before target expansion and line numbering and is repeated for line-length relief attempts.

The same cleanup can forward an inline function's integer result to an immediate assignment. It repeats until no eligible copy remains; each successful pass removes an instruction. Agon numeric variables preserve integer values in integer form, including the signed 32-bit limits. Target-specific integer coercion cleanup then handles any newly exposed expressions.

During inline expansion, a returned integer local can instead share the caller's integer local directly, including across branches. This requires a definite assignment on every path, no earlier read of the result, and no access to the caller's destination within the expanded body. The optimization is restricted to compiler-allocated locals and retains any numeric snapshot required by the target's precision rules.

Integer assignment retains `INT` coercion for expressions that may be fractional. Semantic analysis omits the redundant call for integer and boolean literals, comparisons and logical expressions, `INT` and `SGN` results, and addition or subtraction of known integers, including parenthesized forms. It preserves each target's numeric truth values. A target-aware pass also recognizes native integer variables and arrays on Commodore and Agon; Spectrum and Atari use floating-point storage for these values.

Struct parameters are copied into generated function storage before the native call; inline function bodies are expanded at their call sites rather than emitted as separate BASIC subroutines. Source-level copying and scope rules are defined in the [language reference](language-reference.md#user-defined-functions).

Before lowering, integer analysis uses the complete set of syntactic call sites to prove when a parameter receives only integral values. It propagates parameter, function-result, and numeric struct-field facts to a fixed point. A read-only numeric parameter is integral only if all call sites supply integral values. An unmodified scoped `FOR` index is integral inside the loop when its start and step are integral. A result is integral only when all returns are integral and the function cannot fall through without returning a value; a numeric field is integral only when all its writes are integral. The analysis also recognizes explicitly assigned scoped locals, integer globals, and integer arrays and struct fields when their contents cannot have been loaded or inserted without conversion. It accounts for shared function storage and raw `READ` values; unknown or fractional inputs prevent the proof. Proven facts remove redundant integer coercions while preserving the existing behavior of fractional inputs. This runs before target cleanup because source-level function and storage identities are still available.

## Control-flow and line packing

Shared lowering prefers fall-through control flow. A block without `ELSE` inverts its condition and jumps over the body instead of emitting a conditional jump followed by an unconditional jump. `WHILE` and `REPEAT` use the same rule.

After target lowering and before line numbering, a cleanup pass removes an unconditional jump when its destination is among the immediately following labels. The labels remain available to other branches. The pass runs on each line-length relief attempt so target-generated jumps are covered as well.

After target lowering, a shared bottom-up expression simplifier folds safe integer constants, combines adjacent integer offsets, and removes additive zero and multiplicative one. It retains evaluation of nonconstant operands, including calls; it does not discard an operand multiplied by zero. The pass runs before line numbering on each line-length relief attempt. Backends can also use the same simplifier while building expression trees for arithmetic introduced during rendering.

Spectrum rendering uses this helper for its zero-to-one-based array adjustment. Atari uses it when constructing substring endpoints and packed string-array offsets; target-specific string representations and rendering remain in their backends.

C64 RS-232 device operations use KERNAL `SETLFS`, `SETNAM`, `OPEN`, and `CLOSE`
with fixed buffers in high RAM. They bypass BASIC's device-2 memory-boundary
reset, preserve variables and control stacks, and forward genuine KERNAL errors
to BASIC's error handler. The buffers and native limitations are documented in
the [target guide](targets.md#device-mappings).

For nonliteral Spectrum string-array assignments, lowering saves the assigned expression once in a reusable scalar string before updating the element and its logical length. This preserves the original value for self-referential assignments and avoids evaluating complex expressions twice, at the cost of temporary string memory.

Atari materializes packed string-array elements before using them in expressions. Within one stable expression, repeated reads of the same element with the same stable index share a materialized string. Calls outside a conservative pure-function set or indexes that cannot be identified as stable prevent reuse; separate expressions never share the captured value. A packed string-array assignment uses a distinct scalar string source directly for both the write and its length; computed sources are captured first.

Consecutive terminal equality branches over the same value are recognized as a computed dispatch after constants and enum members have been folded. Zero-based enums are shifted to the one-based native dispatch index. Atari BASIC and C64 BASIC V2 render the result as `ON expression GOTO ...`; Spectrum expands it to a straight sequence of `IF expression = n THEN GO TO ...` statements. Equality branches that each make one subroutine or side-effect function call similarly lower to `ON expression GOSUB ...`, with Spectrum receiving an `IF ... THEN GO SUB ...` sequence. Atari rewrites the native index as a compact sum of equality matches with a dedicated no-match entry, using Atari comparison results directly as zero or one. The result is always within the `ON` label range, avoiding Atari error 3 without a separate guard line and without retaining gaps between sparse values such as Atari key codes.

An `IF`/`ELSE` whose branch always transfers control is laid out so that the terminal branch removes the otherwise necessary join jump. In release output, a short conditional body may be fused back into native `IF expression THEN statement[:statement...]` form after target expansion. If the fused line would exceed the target limit, rendering automatically falls back to the separate branch and body. Atari and C64 conditional line branches use their shorter `THEN line` spelling; Spectrum retains `THEN GO TO line`.

Agon's stack-free lowering for loops with an early exit or return uses literal
limits and steps directly, and the known direction of a constant step to emit
one loop-bound comparison. Dynamic limits and steps retain their saved values;
dynamic steps also retain runtime direction checks.

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
