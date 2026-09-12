# Meta-BASIC language tests

`instruction-suite` is the language conformance and regression suite. It is separate from `examples` because its purpose is to verify the language, compiler lowering, and target behavior rather than demonstrate how to build an application.

When changing or adding a language command, syntax rule, semantic rule, shared lowering, or target lowering, add or update a focused test in this suite. Run the affected module frequently while developing:

```text
npm run test:language:c64 -- --module strings --restart
npm run test:language:spectrum -- --module strings --restart
```

Before finishing a language change, build the full suite for every target and run it in each locally available emulator:

```text
npm run test:language:build
npm run test:language:c64 -- --restart
npm run test:language:spectrum -- --restart
npm run test:language:atari -- --restart
```

The suite's `metabasic.json` selects the mixed C64 font. Project build and launch commands preserve that setting, so the generated C64 program switches character sets before the test runner prints its first line.
