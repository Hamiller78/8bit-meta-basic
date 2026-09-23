# String-array performance benchmark

This benchmark measures common fixed-width string-array operations on the target machine. Each result is the number of target jiffies used for 200 operations. All current targets define 50 jiffies per emulated second.

Run release builds so debug comments and readable variable names do not affect the result:

```text
npm run benchmark:string-arrays:build
npm run benchmark:string-arrays:spectrum -- --restart
npm run benchmark:string-arrays:atari -- --restart
npm run benchmark:string-arrays:c64 -- --restart
```

The program prints results to the screen and to a host-readable device. Spectrum and C64 use `TEXT_PRINTER`; the Atari build uses `SHARED_DRIVE`, matching the unit-test capture path. With the documented Altirra `Testrunner` profile, Atari results are written to `build/altirra_drive/MCP.TXT`. The Spectrum and C64 launch commands enable the configured emulator speed-up or warp arguments, reducing host-side waiting without changing the measured emulated jiffy count. Subtract `NUMERIC LOOP` from the other results for a rough estimate of the work beyond the nested loop itself.

The cases cover numeric-loop and numeric-array controls, scalar string assignment and `LEN`, literal and variable string-array writes, full reads, array-element `LEN`, `LEFT$`, concatenation, and a read with a computed index. The benchmark is diagnostic rather than a pass/fail test: compare results between commits and targets, and keep the operation count unchanged when comparing runs.

## Initial baseline

The Spectrum and C64 release-build measurements were captured on 2026-09-15 with Fuse at 1000% speed and VICE in warp mode. The Atari results were captured on 2026-09-23 with Altirra 4.40 using the `Testrunner` PAL profile. Each column is target jiffies, so emulator acceleration does not reduce the reported values.

| 200 operations | Spectrum | Atari 800XL | C64 |
| --- | ---: | ---: | ---: |
| Numeric loop | 182 | 26 | 54 |
| Scalar string write | 182 | 22 | 42 |
| Scalar `LEN` | 198 | 37 | 73 |
| Numeric array write | 206 | 26 | 75 |
| Numeric array read | 237 | 32 | 91 |
| Literal string-array write | 309 | 94 | 72 |
| Variable string-array write | 573 | 138 | 72 |
| String-array read | 328 | 125 | 73 |
| String-array `LEN` | 263 | 33 | 102 |
| String-array `LEFT$` | 359 | 136 | 106 |
| String-array concatenation | 366 | 158 | 86 |
| Computed-index string-array read | 374 | 132 | 92 |

The largest Spectrum-specific cost is a variable string-array write. The current lowering measures the runtime string, writes the fixed-width array slice, records its logical length, and clamps that length to the declared width. A literal write has a known compile-time length and avoids the runtime measurement and clamp. C64 needs neither operation because its native string arrays retain each element's logical length.
