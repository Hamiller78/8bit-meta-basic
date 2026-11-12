---
name: add-metabasic-target
description: Add a new MetaBASIC compiler target or platform, including dialect rendering, build and emulator integration, and native instruction-suite conformance.
---

# Add a MetaBASIC target platform

Use this workflow when adding a platform or BASIC dialect. Read the relevant
[targets](../../docs/targets.md), [architecture](../../docs/architecture.md),
[toolchain](../../docs/toolchain.md), and [running guide](../../docs/running-programs.md),
as well as the target's primary manuals and the existing instruction suite.
Distinguish a new compiler dialect from an additional computer configuration that
can use an existing dialect; implement the layers the requested platform needs.

## Establish the target contract

Identify the machine, BASIC version, memory and line limits, character and numeric
behavior, native I/O, storage, and emulator or device options. Record sources and
separate confirmed capabilities from assumptions. Inspect existing targets with a
similar BASIC dialect and their tests and tooling for reusable patterns; verify
differences against the new platform instead of assuming compatibility.

Preserve portable language semantics and readable, deterministic BASIC listings.
Design explicit diagnostics for unsupported constructs and document real limits;
do not silently generate invalid code or weaken existing targets to fit the new one.
Use [add-metabasic-feature](../add-metabasic-feature/SKILL.md) when changing shared
language semantics or test-runtime behavior.

## Implement and integrate

1. Follow the compiler architecture to register the target and implement or reuse
   dialect lowering, rendering, naming, limits, and native device mappings. Inspect
   target-dependent switches and registries throughout the compiler, CLI, build
   tools, project configuration, and extension so the target is selectable wherever
   appropriate. Keep compiler semantics separate from external tool orchestration.
2. Adapt the existing script infrastructure and create the target-specific build,
   packaging, launch, and capture scripts or adapters needed by the platform. Add
   applicable npm entry points and example tool configuration, including an
   instruction-suite launch path. Reuse shared helpers where suitable; do not assume
   a new standalone script is needed for functionality already provided generically.
   Support projects outside this checkout and keep local paths and generated artifacts
   out of version control. If the suite cannot fit in memory, provide a practical
   module-by-module runner that covers every module and preserves each capture.
   Check the existing local tool configuration and available emulator installations
   first. If native verification needs an emulator and no usable path is available,
   ask the user to provide the emulator path; continue independent work while waiting.
3. Add host regression coverage for registration, representative rendering,
   target limits and diagnostics, and affected build/launch integration. Exercise
   relevant debug and release profiles and both development and compiled CLI paths.
   Add or adapt instruction-suite cases for platform-specific risks without removing
   portable coverage or masking failures on existing targets.

Use the instruction suite to drive implementation: build and run focused modules,
classify failures, fix the responsible compiler or tooling behavior, and repeat until
the complete suite passes on the new target. Treat its coverage as a strong guide,
not proof of every platform feature; inspect or report behavior it cannot verify.
Keep working through independent failures and required integration without asking
the user to review intermediate steps. Give concise progress updates, and request
user input only when a necessary choice, unavailable resource, or external blocker
cannot be resolved from the available information. A difficult or lengthy task is
not by itself a reason to stop. When user inspection is needed, make the specific
feature and evidence ready for review and continue independent work in the meantime.

## Verify and document

Run `npm test` and `npm run build`. Build the complete instruction suite for the
new target and execute every module on each relevant available configuration,
including separate module runs where necessary. Follow
[run-metabasic-tests](../run-metabasic-tests/SKILL.md) for fresh captures, expected
test counts, result verification, and emulator lifecycle; a successful build or
launch is not a native pass. Run relevant existing-target regressions when shared
code changes. Inspect actual screens when display behavior cannot be established
by captured assertions. Report failed, unavailable, and unverified runs explicitly.

Update the owning documents for implemented capabilities and restrictions, compiler
architecture, commands and configuration, emulator setup and capture, and sources
as applicable. Report changed files, checks and native results per configuration,
and remaining limitations; do not describe unverified behavior as verified.
