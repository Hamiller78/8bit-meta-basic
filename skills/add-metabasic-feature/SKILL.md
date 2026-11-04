---
name: add-metabasic-feature
description: Add or fix MetaBASIC language and compiler features with host regression tests and native instruction-suite coverage. Use when changing syntax, built-ins, semantic checks, shared lowering, target rendering, or test-runtime behavior. Use the instruction suite rather than application examples as the language conformance test bed.
---

# Add a MetaBASIC language feature

Use this skill for compiler/language changes. For application behavior using the
existing language, use [metabasic-testing](../metabasic-testing/SKILL.md).
Delegate emulator launching and captured-result verification to
[run-metabasic-tests](../run-metabasic-tests/SKILL.md).

## 1. Define the language contract

Read the relevant [language reference](../../docs/language-reference.md),
[target behavior](../../docs/targets.md), and [compiler architecture](../../docs/architecture.md).
Inspect the affected compiler stages and existing host and instruction tests.
Preserve unrelated working-tree changes.

Define accepted syntax, types/values, evaluation order, diagnostics, and supported
target behavior before implementation. Clarify how unsupported or ambiguous cases
are rejected. For a bug fix, identify the existing contract being violated.
Keep user-visible semantics in the language reference and implementation structure
in the architecture document; do not duplicate either specification in this skill.

## 2. Add regression coverage in the right places

1. Add focused host tests under `test/` for the relevant pipeline stages. Cover
   invalid syntax/arguments, useful source-location diagnostics, and generated
   output where relevant. Keep intentionally rejected programs in host tests;
   the native instruction suite must compile successfully to run.
2. Add native behavior tests to the appropriate module under
   [language-tests/instruction-suite/tests/](../../language-tests/instruction-suite/tests/).
   Use an existing module for related behavior; introduce a module only when a new
   category is warranted. Use the suite's `source/` modules for shared helpers and
   fixtures, with direct `USES` declarations where required.
3. Test the language feature independently of any application that motivated it.
   Assert observable results, relevant boundaries, and interactions affected by the
   change. Follow the language reference for test syntax and facilities.
4. Where practical, demonstrate the regression before the fix. Implement the feature
   through the appropriate compiler stages, preserving target-independent semantics
   before dialect rendering. Follow the architecture's extension points rather than
   embedding shared meaning in an individual target renderer.
5. Keep native cases bounded and portable over the supported targets. For deliberately
   target-specific behavior, make the supported scope explicit in tests and docs.
   Use actual screen inspection when generated display behavior is the subject of
   the regression; logical output capture alone does not establish rendered output.

If adding a new instruction-test module, inspect the suite configuration and every
explicit module orchestrator, including `scripts/run-vic20-instruction-suite.mjs`.
Update fixed module lists so the new tests participate in full-suite execution.
Do not assume directory-based discovery updates an orchestrator's hard-coded list.

## 3. Validate from the focused case to the complete suite

Run focused host tests while iterating, then `npm test` and `npm run build`.
Build the affected instruction module for the compiler targets, for example:

```text
npm run build:all-targets -- --project language-tests/instruction-suite --run-tests --module random --profile release
```

Replace `random` with the affected test module. Run it through the execution skill
on each relevant available computer. Existing aliases can select a module, e.g.:

```text
npm run test:language:c64 -- --module random --restart
```

Before completion, build the complete instruction suite with
`npm run test:language:build` and execute the complete suite on every available
configured computer. Where a monolithic runner exceeds target memory, build and
run every module separately; report the memory limitation instead of skipping
coverage. Use `npm run test:language:vic20` for the existing VIC-20 module-by-module
orchestrator. Check its current module list and options before relying on its totals.

Use [run-metabasic-tests](../run-metabasic-tests/SKILL.md) for transport selection,
live-session handling, fresh captures, summary checks, and unavailable targets.
Build-only checks do not establish native runtime correctness. Recheck affected
CLI paths and application regressions when their behavior changes.

## 4. Document and report

Update the language reference for syntax, semantics, restrictions, and diagnostics.
Update target documentation when dialect capabilities or lowering behavior change;
update architecture documentation when the compiler design changes. Add a short
programming-guide example when it teaches a useful new application pattern.
Keep the execution procedure in its skill and emulator setup in the running guide.

Report changed files, host checks, the instruction modules exercised, and captured
native results per configuration. List unverified or unavailable configurations
explicitly. Do not substitute an application playthrough for instruction-suite
coverage of a new language feature.
