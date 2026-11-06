---
name: run-metabasic-tests
description: Build existing MetaBASIC test runners, launch configured target emulators, receive their captured MCP logs, and verify native test results. Use when running a project test suite, checking an affected test module, or executing the language instruction suite on real target BASIC interpreters in emulators.
---

# Run MetaBASIC emulator tests

Execute this workflow from the repository root. Use the existing npm/JavaScript
scripts for compilation, packaging, launching, and capture. Keep test authoring
and application changes in [metabasic-testing](../metabasic-testing/SKILL.md).
Use [add-metabasic-feature](../add-metabasic-feature/SKILL.md) for language changes
and selection of instruction-suite regression coverage.

## 1. Identify the run

1. Read `package.json`, the project's README and `metabasic.json`, and the selected
   tool configuration (normally `scripts/tools.local.json`). Use the
   [toolchain reference](../../docs/toolchain.md) for CLI options and artifacts.
2. Record the project/source/build configuration, selected test module, profile,
   language, font, and storage settings. Preserve project defaults unless an
   override is intentional. Use the same selections for building and launching.
3. Distinguish compiler targets from runnable computers. Read current targets from
   build tooling and `targetConfigurations` from the selected tool configuration.
   Include every configured, available computer relevant to the project, including
   multiple computers for one dialect. Do not hard-code a target list here.
   Respect the project's minimum screen size and other declared target constraints;
   report incompatibility instead of lowering requirements to force a test run.
4. Resolve the actual output transport and capture path for each configuration
   using the [running guide](../../docs/running-programs.md#test-capture-locations).
   Read target-specific setup there only as needed. Check configured tools,
   emulator paths, writable staging locations, and effective permissions. Existing
   paths do not prove that a tool can run or a transport can connect.

## 2. Build current artifacts

For an implementation change, finish the relevant host checks first (`npm test`
and `npm run build`). For a run-only request, ensure the compiler is current using
the normal build/launch helpers; do not require unrelated host tests on every run.

Build the normal application and selected native runner, for example:

```text
npm run build:all-targets -- --project examples/eight-bits-below --profile release
npm run build:all-targets -- --project examples/eight-bits-below --run-tests --module combat --profile release
```

Substitute the actual project/module and options. Omit `--module` for the full
application suite. Use the intended profile; include release verification when
compact naming or memory pressure is relevant.

Use `--no-tools` only for compiler-only verification when packaging is unavailable.
Report that limitation and never launch an older packaged artifact after a failed
build. `--skip-build` skips rebuilding the TypeScript compiler; it does not skip
MetaBASIC generation and packaging.

For instruction-suite selection and required language-change coverage, follow
[add-metabasic-feature](../add-metabasic-feature/SKILL.md). The suite is a test-mode
project, not a normal application: build it with `--run-tests`, not the normal-build
command above. When using a module orchestrator, inspect its current options and
timeouts; preserve each module's capture before it is overwritten.

## 3. Launch and wait in a live session

Launch a named configuration with capture enabled, for example:

```text
npm run launch -- spectrum48 --project examples/eight-bits-below --run-tests --module combat --profile release --printer-output --restart
```

Repeat for each relevant available configuration with the same input selections.
The historical `--printer-output` flag enables the configured runner-log transport;
it does not imply that every emulator uses a printer.

- Record the start time and confirm that the capture was cleared/recreated for
  this run. Look for current test names. Never reuse another suite's log as proof.
- Keep the launching shell session alive until its emulator and capture helper
  have delivered the result. If the execution environment kills descendants when
  a command exits, launch and poll in the same shell command and yield that live
  tool session for progress updates. Starting a later polling command cannot
  revive terminated processes.
- Poll in short intervals with a reasonable overall deadline for the target and
  suite. Report progress during long runs. Atari BASIC and algorithm-heavy tests
  can take minutes; an unchanged or buffered file alone does not prove a hang.
- Run configurations sequentially when they share an executable, artifact, SD
  card, or capture path. Preserve each capture before another launch clears it.
  Avoid concurrent rebuilds or `--restart` calls that interrupt an active runner.
- Prevent test windows from accumulating. Between sequential runs, use
  `--restart` when all existing instances of that emulator are disposable test
  sessions. `--restart` can terminate every process matching the emulator, not
  just the previous test. If an existing session must be preserved, omit it and
  close only the test instance you started after its capture is complete.
- After the final run, preserve its capture and close the test emulator and any
  capture helper you started unless the user wants the session left open. Track
  process identities so cleanup does not close unrelated emulator sessions.
- Prefer individual launch commands when diagnosing failures. `launch:all` stops
  launching further configurations on a launcher failure and does not aggregate
  native results. Continue other independent configurations when one is unavailable.
- Verify actual startup and output rather than trusting `--restart`: Windows
  launchers suppress failures from best-effort process termination.

## 4. Verify the captured result

Read the fresh capture and require its complete final summary:

```text
META CONTROL PROGRAM (M.C.P.) RUN FINISHED
TESTS: ...
PASSED: ...
FAILED: 0
ASSERTIONS: ...
FAILURES: 0
FREE MEMORY: ...
```

Accept a pass only when the completion banner and all summary fields are present,
`TESTS` matches the expected selected tests, `PASSED` equals `TESTS`, and both
`FAILED` and `FAILURES` are zero. Inspect individual results and any failed-test
list. Establish the expected selection from the current tests and generated debug
sidecar; do not infer it from an old capture. A zero-test runner does not verify
expected tests.

Allow capture casing differences and wrapped lines. Spectrum can split the banner
as `RU` then `N FINISHED`; normalize line-wrap whitespace for that check while
preserving the original log. Do not merge separate runs or confuse per-test
`PASSED` messages with summary totals. Do not require identical assertion totals
across platforms when test behavior legitimately depends on native randomness.

Treat missing/partial summaries, timeouts, and runtime errors as unverified runs.
A launcher's zero exit status proves neither successful startup nor completed
assertions. A host test that compiles generated BASIC does not execute it.

## 5. Diagnose and report

Classify failures before changing code: compiler diagnostic, packaging error,
emulator startup error, capture error, native runtime error, or assertion failure.
Consult the running guide for the selected target's setup and troubleshooting.
Map native error lines back to source using the generated `.bas` and `.debug.json`.

Distinguish listener startup from successful emulator connection for serial/TCP
capture; listening and connecting can have different permissions. Verify shared
host-directory mappings for Atari. Inspect both the ordinary capture and runtime
error file for Agon. Keep these target details in the running guide.

Prefer writable workspace staging and explicit temporary tool configurations for
environment-specific diagnostics when necessary; report any overrides. Preserve
persistent emulator settings unless changes are part of the task. Do not weaken
Windows security or use administrator rights as a routine test step. Record the
actual denied operation instead of generalizing a past session's restrictions.

Report the commands and a result for each configuration: passed, failed, or
unverified/unavailable. Include test/assertion totals and capture paths for completed
runs, plus specific blockers for others. Build unavailable targets where possible
and label those results as build-only verification.
