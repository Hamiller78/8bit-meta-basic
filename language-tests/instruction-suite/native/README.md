# Native regressions

## C64 serial state

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

## KC 85 clock and sound

`kc85-clock.mbas` runs outside test mode so it exercises the native interrupt
clock and sound rather than the instruction runner's test fakes. With JKCEMU
configured, run:

```text
npm run launch:kc85 -- --source language-tests/instruction-suite/native/kc85-clock.mbas --profile release
```

The screen should show `BEEP PASSED`, `LONG BEEP PASSED`, `CLOCK PASSED`, and
`DONE`, with no `FAILED` line. The program emits a one-second tone and a longer,
lower tone, then waits approximately six seconds. See [run-metabasic-tests](../../../skills/run-metabasic-tests/SKILL.md)
for emulator setup and verification.
