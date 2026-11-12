# Meta-BASIC agent instructions

## Project purpose

Meta-BASIC transpiles a small modern source language into readable BASIC for classic
home computers. Preserve each machine's character and keep generated listings useful
for inspection and debugging. Supported dialects and machine-specific limitations
are maintained in [targets](docs/targets.md).

The intended product is a Visual Studio Code extension for creating, compiling,
and testing Meta-BASIC projects in their own repositories. Applications currently
live under `examples/` to support coordinated changes while the language and tools
evolve. Keep tooling usable with projects outside this checkout; see the
[architectural boundary](docs/architecture.md#scripts-and-tools).

## Find the authoritative guidance

| Task or question | Read |
| --- | --- |
| Application patterns and project organization | [Programming guide](docs/programming-guide.md) and the relevant examples |
| Source syntax, semantics, restrictions, and test facilities | [Language reference](docs/language-reference.md) |
| Machine capabilities and native BASIC mappings | [Targets](docs/targets.md) |
| Compiler structure and lowering algorithms | [Architecture](docs/architecture.md) |
| Build/CLI options, project/tool configuration, packaging, and artifacts | [Toolchain](docs/toolchain.md) |
| Emulator/device setup, loading, captures, and troubleshooting | [Running guide](docs/running-programs.md) |
| External manuals and software sources | [Sources](docs/sources.md) |
| Editor extension commands and setup | [Extension README](vscode-extension/README.md) |

For ordinary application work, use the language/application documentation and
examples first. Inspect compiler implementation when diagnosing compiler behavior
or resolving a concrete documentation gap. If that reveals undocumented user-visible
behavior, update its owning document as part of the change.

## Required workflows

Read the relevant repository skill before starting the workflow:

- [MetaBASIC testing](skills/metabasic-testing/SKILL.md): write application tests and
  implement behavior using the existing language.
- [Add a MetaBASIC feature](skills/add-metabasic-feature/SKILL.md): change syntax,
  built-ins, semantics, shared/target lowering, or test-runtime behavior. Use the
  instruction suite for language conformance, with host regression coverage.
- [Add a MetaBASIC target](skills/add-metabasic-target/SKILL.md): add a platform or
  BASIC dialect, its tooling, and native instruction-suite coverage.
- [Run MetaBASIC emulator tests](skills/run-metabasic-tests/SKILL.md): build runners,
  launch configured computers, receive fresh captures, and verify results.
- [Run MetaBASIC benchmarks](skills/run-metabasic-benchmarks/SKILL.md): measure
  generated-code performance and compare compiler versions on target emulators.

Keep procedures in these skills and specifications in their owning documents.
Link to them rather than maintaining duplicate instructions here.

## Working rules

- Preserve unrelated working-tree changes and user-created files.
- Keep work within the requested scope. Do not introduce language features,
  backends, dependencies, or infrastructure as incidental fixes.
- Follow [compiler architecture](docs/architecture.md) when changing the core.
  Keep portable semantics separate from native rendering and external orchestration.
- Use explicit TypeScript types and discriminated unions. Reject unsupported or
  ambiguous syntax with actionable source-location diagnostics.
- Preserve deterministic generated output and target semantics. Update expected
  listings only when the behavior change is intentional.
- Adapt existing tooling rather than replacing it. Avoid new production
  dependencies without a clear need.
- Keep generated `build/` output and per-machine tool configuration out of version control.
- Document only implemented support; do not present assumptions as verified results.
- Keep README as an introduction and navigation entry point. Put detailed changes
  in the owning document listed above.
- Do not commit, push, publish packages, create releases, or change repository
  settings unless the user explicitly asks.

## Runtime and verification

Use Node.js 24 LTS or later, npm, strict TypeScript, and ECMAScript modules.
Use `tsx` for development, Vitest for host tests, and `tsc` for distributable JavaScript.

For implementation changes, run `npm test` and `npm run build` before completion.
When CLI output or target rendering changes, exercise the affected development and
compiled CLI paths as well; commands are documented in the toolchain reference.

For executable Meta-BASIC changes, complete native verification through the workflows
above. If behavior cannot be asserted automatically, run the application in the
available target emulators and report what was inspected. State unavailable or
incomplete runs explicitly; successful compilation is not native runtime verification.

For documentation-only changes, check links, anchors, and formatting. Compile revised
code examples where relevant; full compiler/emulator suites are unnecessary unless
a behavior change or unresolved concern warrants them.

Report changed files, verification performed, and material limitations or warnings.
