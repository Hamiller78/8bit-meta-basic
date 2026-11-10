---
name: run-metabasic-benchmarks
description: Run and compare MetaBASIC performance benchmarks on configured target emulators, including before-and-after compiler measurements.
---

# Run MetaBASIC benchmarks

Use this workflow to measure generated-code performance. For compiler changes,
benchmarking supplements correctness verification in
[add-metabasic-feature](../add-metabasic-feature/SKILL.md); it does not replace it.

## Select a benchmark

Inspect [performance-tests](../../performance-tests) and the chosen benchmark's
README before creating a new case. The README describes its operations, output,
and interpretation; [toolchain](../../docs/toolchain.md#performance-benchmarks)
and `package.json` identify build and launch entry points. Choose cases and
targets that exercise the requested change. Keep operation counts and benchmark
source identical across a comparison; add a focused case only when the existing
ones cannot answer the question.

## Prepare comparable artifacts

- Record the baseline and changed compiler revisions or working-tree states,
  including relevant uncommitted changes. Preserve the user's work. Build each
  compiler separately, and keep each generated listing and packaged artifact in a
  distinct location. Do not replace the active compiler or switch the user's
  checkout merely to run a comparison.
- Verify which compiler produced each artifact: check the compiler source/build
  identity and inspect the relevant generated statements. Identical artifacts can
  be legitimate; determine whether the optimization is actually exercised before
  claiming a performance comparison. Capture baseline artifacts before rebuilding
  shared output, or use isolated copies. Avoid putting copied test files where the
  host test runner can discover them.
- Keep benchmark source, target, release profile, target configuration, emulator
  model, clock/video settings, output transport, and operation count consistent.
  Record any intentional difference. Emulator acceleration affects host waiting
  time; use target-measured timings, not elapsed host time, for target performance.

## Run and interpret

Use the benchmark's existing commands and capture transport. Apply the session,
hidden-window, restart, fresh-capture, and cleanup guidance in
[run-metabasic-tests](../run-metabasic-tests/SKILL.md); benchmark output has its
own completion criteria, not the instruction suite's pass/fail summary. Keep
baseline and changed captures separately and verify the expected case names,
operation count, and complete output. Do not run configurations concurrently
when their artifacts or capture paths overlap.

Compare the relevant cases and any control case described by the benchmark.
Repeat measurements when practical if timing variation could affect the conclusion;
report the individual values or range and the number of runs. Distinguish measured
timings from listing size, tokenized size, and runtime free memory: they measure
different effects. State unavailable targets, incomplete captures, configuration
differences, or single-run uncertainty rather than inferring a speedup.

Report the benchmark and case, target and emulator, compiler versions or states,
operation count, baseline and changed values with units, and any meaningful
limitations. Link the retained captures when useful. Do not overwrite published
benchmark baselines unless updating them is part of the requested work.
