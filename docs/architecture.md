# Architecture

Meta-BASIC is built as a small TypeScript compiler plus thin command-line and editor shells. The compiler core should stay independent from emulators, packaging tools, VS Code, and local filesystem conventions.

The important design rule is that target-independent meaning is decided before target rendering. A construct such as `PRINT_AT`, `STRUCT`, `FUNCTION`, `ASSERT_EQ`, or `DEVICE_AVAILABLE` has one Meta-BASIC meaning first; only after that do Spectrum, Atari, and C64 lowering choose the awkward native spelling.

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
  -> BASIC text
  -> optional packaging tools
  -> optional emulator launch
```

The compiler library ends at BASIC text plus diagnostics and stats. Everything after that is script orchestration.

## Main Source Areas

- `src/ast.ts` defines the syntax tree as discriminated unions.
- `src/lexer.ts` tokenizes source text and owns the centralized keyword set. Built-in function names remain identifiers.
- `src/parser.ts` turns tokens into statements and expressions. It should make syntax decisions from tokens, not whole-line regular expressions.
- `src/semantic.ts` checks language rules, resolves constants, validates labels, functions, structs, arrays, test-only constructs, devices, and built-in calls. Struct values are erased here into generated backing scalar and array names.
- `src/functions.ts` is the central list of portable built-in functions.
- `src/devices.ts` is the central list of portable device constants.
- `src/function-semantics.ts` analyzes user functions, local variables, parameters, and recursion.
- `src/function-call-lowering.ts` expands Meta-BASIC function calls into generated parameter assignments, `GOSUB`, and return-value reads.
- `src/lowering.ts` performs shared structural lowering for ordinary statements. It also creates the generated startup prelude: top-level storage declarations are emitted before ordinary executable code, and library-style source files can contribute global initializers before startup.
- `src/test-runner-lowering.ts` builds the generated MCP test runner and assertion support when test mode is enabled.
- `src/targets/*.ts` render and lower target-specific details for Spectrum, Atari 800XL, and C64.
- `src/targets/function-rendering.ts` maps portable built-in functions to target BASIC spellings.
- `src/line-numbering.ts` assigns BASIC line numbers and enforces target maximums.
- `src/output-stats.ts` reports generated-line and variable-use information.
- `src/build-configuration.ts` loads `metabasic.json` style program descriptions.
- `src/cli.ts` is the thin command-line shell around the compiler.

## Scripts And Tools

The `scripts/*.mjs` files are outside the compiler core. They build programs, run optional conversion tools, launch emulators, and manage host-side test-output files.

`scripts/tools.example.json` is the committed template. `scripts/tools.local.json` is the per-machine copy where executable paths and emulator arguments belong. The compiler itself does not read these files.

The VS Code extension in `vscode-extension/` is also a shell. It calls the existing scripts and parses their output for editor diagnostics. It should not grow a second compiler.

## Program Inputs

There are three input shapes:

- `--source file.mbas` compiles one file.
- `--build-config metabasic.json` compiles an explicit ordered file list.
- `--project folder` compiles a conventional project with `source/` and optional `tests/`.

Multi-file compilation currently creates one compilation unit. File order still matters for startup code, but shared lowering emits top-level storage declarations first. Source files that contain only compile-time declarations, storage declarations, simple top-level assignments, and functions are treated as library-style files; their top-level assignments are emitted before normal startup code so functions in that file can depend on their initialized globals. There are no namespaces, imports, exports, or separate compilation yet.

## Test Mode

Normal builds reject `TEST` and `ASSERT_*` syntax and emit no test runtime.

When `--run-tests` or `testMode` is enabled, startup code is replaced by a generated test runner. The runner:

- discovers test blocks in compilation order,
- calls each test through generated `GOSUB`s,
- captures logical program output for assertions,
- prints MCP progress and summary lines,
- optionally mirrors that runner log to an emulator device.

The verified external test-output transports are:

- Spectrum/Fuse: `TEXT_PRINTER`, lowered to `LPRINT`, captured through Fuse ZX Printer text output.
- Atari/Altirra: `SHARED_DRIVE`, lowered to `H6:MCP.TXT` on Altirra's H: host device.
- C64/VICE: `RS232`, lowered to BASIC device 2 and captured by a local TCP helper.

The logical result protocol is shared. Only the physical transport differs per emulator.

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

## Adding A Feature

For a new statement, usually touch:

```text
lexer keyword set -> AST -> parser -> semantic checks -> shared lowering -> targets -> tests -> docs
```

For a new built-in function, usually touch:

```text
src/functions.ts -> semantic argument validation -> target function rendering -> tests -> docs
```

For a new device constant, usually touch:

```text
src/devices.ts -> semantic/device validation -> target device lowering -> scripts if launch capture is needed -> tests -> docs
```

Keep examples small and executable on all three targets when possible. The generated BASIC is meant to be read, so changes should be tested both as compiler behavior and as listings a human can inspect.
