# Native C64 serial state regression

`c64-rs232-state.mbas` is a standalone C64 program because opening another
RS-232 channel inside the mirrored instruction runner would disturb the runner's
own serial connection. It verifies initialized scalar, string, array and `DATA`
values, a `FOR` loop, and a `GOSUB` across serial open, close and reopen.

Run it with a configured C64 serial capture, for example:

```text
node scripts/launch-target.mjs c64 --source language-tests/instruction-suite/native/c64-rs232-state.mbas --profile release --printer-output --test-output-device rs232 --fast --hidden
```

The fresh capture must contain two `CYCLE PASSED` lines and `AFTER RETURN PASSED`,
with no `FAILED` line. See [run-metabasic-tests](../../../skills/run-metabasic-tests/SKILL.md)
for capture, process cleanup and emulator session handling. This program is not
portable to every target because it requires a working native RS-232 connection.
