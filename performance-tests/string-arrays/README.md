# String-array performance benchmark

This benchmark measures common fixed-width string-array operations on the target machine. Each result is the number of target jiffies used for 200 operations. All current targets define 50 jiffies per emulated second.

Run release builds so debug comments and readable variable names do not affect the result:

```text
npm run benchmark:string-arrays:build
npm run benchmark:string-arrays:spectrum -- --restart
npm run benchmark:string-arrays:atari -- --restart
npm run benchmark:string-arrays:c64 -- --restart
```

The program prints results to the screen and to `TEXT_PRINTER`. The Spectrum and C64 launch commands enable the configured emulator speed-up or warp arguments, reducing host-side waiting without changing the measured emulated jiffy count. Subtract `NUMERIC LOOP` from the other results for a rough estimate of the work beyond the nested loop itself.

The cases cover numeric-loop and numeric-array controls, scalar string assignment and `LEN`, literal and variable string-array writes, full reads, array-element `LEN`, `LEFT$`, concatenation, and a read with a computed index. The benchmark is diagnostic rather than a pass/fail test: compare results between commits and targets, and keep the operation count unchanged when comparing runs.

## Initial baseline

These release-build measurements were captured on 2026-09-15 with Fuse at 1000% speed and VICE in warp mode. Each column is still target jiffies, so emulator acceleration does not reduce the reported values.

| 200 operations | Spectrum | C64 |
| --- | ---: | ---: |
| Numeric loop | 182 | 54 |
| Scalar string write | 182 | 42 |
| Scalar `LEN` | 198 | 73 |
| Numeric array write | 206 | 75 |
| Numeric array read | 237 | 91 |
| Literal string-array write | 309 | 72 |
| Variable string-array write | 573 | 72 |
| String-array read | 328 | 73 |
| String-array `LEN` | 263 | 102 |
| String-array `LEFT$` | 359 | 106 |
| String-array concatenation | 366 | 86 |
| Computed-index string-array read | 374 | 92 |

The largest Spectrum-specific cost is a variable string-array write. The current lowering measures the runtime string, writes the fixed-width array slice, records its logical length, and clamps that length to the declared width. A literal write has a known compile-time length and avoids the runtime measurement and clamp. C64 needs neither operation because its native string arrays retain each element's logical length.
