# BYTE-array performance benchmark

This benchmark compares experimental `BYTE` arrays with ordinary numeric arrays on each target. Every timed case performs 200 logical array operations inside the same nested-loop shape, and reports target jiffies (50 jiffies per emulated second).

Run release builds so readability comments do not affect the listing:

```text
npm run benchmark:byte-arrays:build
npm run benchmark:byte-arrays:spectrum -- --restart
npm run benchmark:byte-arrays:atari -- --restart
npm run benchmark:byte-arrays:c64 -- --restart
```

Spectrum writes results through `TEXT_PRINTER`. The Atari-specific configuration writes to `SHARED_DRIVE`, normally `build/altirra_drive/MCP.TXT` with the documented Altirra profile. The C64-specific configuration writes to `RS232`; its launcher connects that output to the configured RS232 capture endpoint.

The paired cases measure writes, reads, a read followed by an unchanged write, and a read/native calculation/write sequence. `NUMERIC LOOP` is the common control. BYTE storage is expected to reduce memory substantially, but the character-code conversions on Spectrum and Atari may cost time; C64 uses native integer arrays and should have a smaller conversion cost.
