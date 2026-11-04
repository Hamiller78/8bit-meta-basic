---
name: metabasic-testing
description: Write focused native MetaBASIC tests and implement application behavior using the existing language. Use when adding or fixing application .mbas code or writing application tests. Route compiler and language changes to add-metabasic-feature, and emulator execution to run-metabasic-tests.
---

# MetaBASIC testing

Use this skill to develop and test behavior. Use
[run-metabasic-tests](../run-metabasic-tests/SKILL.md) to execute existing tests
on target emulators and receive their results.

## Read the relevant sources

- Read the project's README, `metabasic.json`, affected source, and existing tests.
  Inspect the working tree and preserve unrelated changes.
- Use the [programming guide](../../docs/programming-guide.md) for application
  patterns and the [language reference](../../docs/language-reference.md#test-mode)
  for test syntax, assertion semantics, fixture behavior, and controllable runtime
  functions. Keep those definitions in the reference; do not maintain another
  list of assertions or test fakes here.
- For ordinary application work, inspect compiler implementation only to diagnose
  a compiler problem or resolve a concrete documentation gap.

## Develop a focused change

1. Identify observable behavior, relevant boundaries, and the regression to prevent.
   Express these in focused `TEST Name()` blocks rather than reproducing the
   implementation in assertions. Where practical, establish that a regression test
   fails before implementing the fix.
2. Follow the project's test-file naming convention, such as
   `tests/combat-tests.mbas`. Add direct `USES` declarations for every accessed
   source module, including fixture writes. Include dependencies in the project
   build; `USES` grants access but does not load files.
3. Keep test-only scalar values local and initialize shared state explicitly.
   Consult the language reference before assuming storage resets between tests.
   Control external inputs through the supported test facilities when deterministic
   behavior is needed, including reads made by called functions.
4. Test outcomes that matter to the caller. Choose logical output assertions or
   actual screen inspection according to the behavior being tested; consult the
   language reference for the distinction.
5. Implement the smallest source change that satisfies the tests. Keep application
   work within supported MetaBASIC features; do not introduce compiler features as
   an incidental application fix.
6. Keep tests bounded and practical on slow BASIC targets. Prefer a few targeted
   deterministic cases over expensive randomized sweeps when they establish the
   same rule.

For changes to the language or compiler, switch to
[add-metabasic-feature](../add-metabasic-feature/SKILL.md), which owns host
regression and native instruction-suite coverage. Keep application-specific cases
in the application's own `tests/` directory.

## Verify the change

Run focused host tests while iterating. Before completing an implementation change,
run `npm test` and `npm run build`. Use the
[emulator execution skill](../run-metabasic-tests/SKILL.md) to build the normal
application and native runner, execute the affected tests, and verify fresh
captures on every available configured computer. Broaden from the affected module
to the complete relevant suite before completion; account for target memory limits.

If behavior cannot be asserted automatically, run the application in the available
emulators and record precisely what was inspected manually. Report changed files,
verification commands, native results, and any unverified targets. Keep manual
inspection distinct from native test results.
