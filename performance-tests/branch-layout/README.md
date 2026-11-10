# Branch layout benchmark

This benchmark compares identical control-flow patterns near the beginning and
end of one generated BASIC listing. Generate its sources from the repository root:

```text
node performance-tests/branch-layout/generate.mjs
npm run build
```

The sources are written to `build/branch-layout/`, one per target output device.
For the configured computers, example launch commands are:

```text
node scripts/launch-target.mjs spectrum48 --source build/branch-layout/spectrum.mbas --profile release --skip-build --fast --printer-output --hidden
node scripts/launch-target.mjs atari1 --source build/branch-layout/atari800xl.mbas --profile release --skip-build --hidden
node scripts/launch-target.mjs atari2 --source build/branch-layout/atari800xl.mbas --profile release --skip-build --hidden
node scripts/launch-target.mjs c64 --source build/branch-layout/c64.mbas --profile release --skip-build --fast --printer-output --test-output-device rs232 --hidden
```

Use the configured emulator's normal capture path and preserve each capture before
the next run. The Atari launchers select their configured shared-drive path.
Follow [the benchmark skill](../../skills/run-metabasic-benchmarks/SKILL.md) for
fresh captures, emulator cleanup, and comparisons. `DONE` indicates completion;
both `COUNT` values must be 200 and both `SKIPPED` values must be zero.

The cases report target jiffies for 200 iterations. A block of 300 unreachable,
individually labelled assignments separates the early and late cases. Inspect
the release listing when comparing compiler versions: labels must still force the
intended line layout and the jump in each forward case must remain present.

| Case | Timed work |
| --- | --- |
| CONTROL | Empty `FOR`/`NEXT` loop, early or late. |
| FORWARD | Loop with a counter increment and a short forward `GOTO`, early or late. |
| BACKWARD | Counter increment and conditional backward branch, early or late. |
| DEST | An early caller repeatedly calls an empty early or late subroutine. |
| CALLER | An early or late caller repeatedly calls the same empty early subroutine. |

These are complete loops, not isolated instruction timings. In particular,
`FOR`/`NEXT` and the return to a caller can themselves depend on location, so
compare the control alongside the other cases. `CALLER` includes the call, return,
and loop costs. The label numbers, generated statements, runtime, and emulator
configuration all affect the result.

## Measurements on 2026-11-10

The following are jiffies for 200 iterations. Three runs produced the same
reported values for each configuration. Spectrum used Fuse 48K; C64 used VICE
C64SC; `atari2` used Atari800 with original Atari ROMs; and `atari1` used the
configured Altirra profile. The exact BASIC ROM selected in Altirra was not
independently verified. Generated release listings contained about 400 lines.

| Case: early / late | Spectrum | Atari800 | Altirra | C64 |
| --- | ---: | ---: | ---: | ---: |
| CONTROL | 48 / 293 | 24 / 207 | 9 / 9 | 21 / 20 |
| FORWARD | 136 / 627 | 88 / 453 | 28 / 29 | 73 / 74 |
| BACKWARD | 131 / 374 | 83 / 262 | 33 / 115 | 128 / 370 |
| DEST | 141 / 397 | 102 / 293 | 26 / 103 | 59 / 278 |
| CALLER | 130 / 622 | 93 / 459 | 20 / 27 | 39 / 59 |

These measurements use different native output devices, outside the timed loops.
They demonstrate layout sensitivity in these configurations; they do not explain
the different Atari results or establish the impact on a particular application.
