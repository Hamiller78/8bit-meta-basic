# Build and external-tool pipeline

Meta-BASIC itself always emits readable BASIC text. Optional external programs turn that text into formats accepted more directly by emulators and retro devices.

## Build scripts

```text
npm run build:spectrum -- --profile debug
npm run build:atari -- --profile balanced
npm run build:c64 -- --profile release
npm run build:all-targets -- --profile release
npm run build:all-targets -- --source examples/narf.mbas --profile release
npm run build:all-targets -- --build-config examples/multifile/metabasic.json --profile release
npm run build:all-targets -- --project examples/project-demo --profile debug
npm run build:all-targets -- --project examples/project-demo --run-tests --profile debug
npm run build:all-targets -- --project examples/project-demo --run-tests --module math --profile debug
npm run build:all-targets -- --project examples/instruction-suite --run-tests --profile debug
npm run new:project -- examples/my-game
npm run new:module -- --project examples/my-game --module scoring
npm run build:directory -- --source-dir examples --profile debug
npm run launch:all-targets -- --source examples/narf.mbas --restart
npm run launch:all-targets -- --project examples/project-demo --run-tests --restart
npm run launch:atari -- --source examples/narf.mbas
npm run launch:atari -- --source examples/narf.mbas --artifact atr --restart
npm run launch:c64 -- --source examples/narf.mbas
npm run launch:c64 -- --source examples/input-demo.mbas --restart
npm run launch:spectrum -- --source examples/narf.mbas
npm run launch:spectrum -- --source examples/input-demo.mbas --restart
```

The directory build is non-recursive. Use `--target spectrum`, `--target atari800xl`, or `--target c64` to restrict it.

The build and launch scripts accept exactly one program input mode:

- `--source file.mbas` for one file
- `--build-config metabasic.json` for an explicit ordered file list
- `--project folder` for a conventional project folder

A project folder contains `source/` and `tests/` side by side:

```text
project/
  source/
    main.mbas
    math.mbas
  tests/
    math-tests.mbas
```

Normal project builds compile the `.mbas` files directly inside `source/`, sorted by filename. File order still controls ordinary startup code, but the compiler emits top-level `DIM` declarations before startup and also hoists top-level assignments from library-style files that contain only declarations, assignments, and functions. Project test-mode builds compile `source/` and then `tests/`, with `testMode` enabled:

```text
npm run build:spectrum -- --project examples/project-demo --profile debug
npm run build:spectrum -- --project examples/project-demo --run-tests --profile debug
npm run launch:spectrum -- --project examples/project-demo --run-tests --restart
```

To run tests for one module, pass `--module name`. This still compiles all source modules, but includes only matching test files:

```text
npm run build:spectrum -- --project examples/project-demo --run-tests --module math --profile debug
npm run launch:spectrum -- --project examples/project-demo --run-tests --module math --restart
```

Recognized test-file names are `tests/math.mbas`, `tests/math-tests.mbas`, and `tests/math.test.mbas`.

`--run-tests` also works with `--source`, `--build-config`, `build:directory`, and the target/all launch scripts.

To mirror the generated test-runner log to an emulator device, add `--printer-output`. Launch scripts default to the currently verified transport for each target: Spectrum uses `text-printer`, Atari uses `shared-drive`, and C64 uses `rs232`. You can override this with `--test-output-device printer`, `--test-output-device text-printer`, `--test-output-device shared-drive`, or `--test-output-device rs232`:

```text
npm run launch:all-targets -- --project examples/instruction-suite --run-tests --printer-output --restart
npm run launch:atari -- --project examples/instruction-suite --run-tests --printer-output --test-output-device shared-drive --restart
```

The captured host file path is controlled by the emulator block in `scripts/tools.local.json`:

```json
"printerOutputPath": "build/printer/{profile}/{target}/{sourceName}.txt",
"rs232OutputPath": "build/rs232/{profile}/{target}/{sourceName}.txt"
```

For a release C64 run of `examples/instruction-suite`, the RS-232 log is written to:

```text
build/rs232/release/c64/instruction-suite.txt
```

## Project scaffolding

Use the scaffolding scripts to create the conventional folder layout:

```text
npm run new:project -- examples/my-game
npm run new:module -- --project examples/my-game --module scoring
```

The project command creates `source/main.mbas`, `tests/main-tests.mbas`, and a simple `metabasic.json`. The module command creates `source/scoring.mbas` and `tests/scoring-tests.mbas`. Existing files are never overwritten.

## Instruction regression suite

`examples/instruction-suite` is a conventional Meta-BASIC project that tests the portable instruction set using the Meta-BASIC test runner. It is intended for compiler regression checks and emulator/device smoke tests:

```text
npm run build:all-targets -- --project examples/instruction-suite --run-tests --profile debug
npm run launch:all-targets -- --project examples/instruction-suite --run-tests --restart
```

For memory-constrained targets or focused debugging, run one module's tests:

```text
npm run build:spectrum -- --project examples/instruction-suite --run-tests --module strings --profile debug
```

The suite currently covers expressions, functions, control flow, storage, string handling, colours, `DATA`/`READ`/`RESTORE`, random numbers, jiffies, and free-memory reads where the behavior is deterministic enough to assert portably.

Generated files normally appear below:

```text
build/<profile>/<target>/<source-name>.bas
```

Atari builds additionally produce:

```text
build/<profile>/atari800xl/<source-name>.lst
build/<profile>/atari800xl/<source-name>.atr-files/PROGRAM.LST
```

The Atari `.lst` contains the ASCII listing with Atari `0x9B` line endings. Full ATASCII character conversion is not implemented yet.

When `basicParser` is configured, Atari builds also produce:

```text
build/<profile>/atari800xl/<source-name>.tokenized.bas
build/<profile>/atari800xl/<source-name>.atr-files/PROGRAM.BAS
```

The tokenized `.BAS` is copied into the ATR staging directory before `dir2atr` runs, so the generated ATR can contain both the importable `.LST` and direct-load `.BAS` forms.

## Local tool configuration

Copy:

```text
scripts/tools.example.json
```

to:

```text
scripts/tools.local.json
```

and configure local executable paths. Keep `tools.local.json` out of version control because paths differ per machine.

The scripts understand placeholders including `{input}`, `{output}`, `{sourceName}`, `{profile}`, and `{target}`. They always produce `.bas` text even when an optional conversion tool is absent.

Device-output launch arguments may also use `{printerOutput}`, `{rs232Output}`, and `{rs232Endpoint}`. `{printerOutput}` and `{rs232Output}` expand to host output files. `{rs232Endpoint}` is a dynamically created `127.0.0.1:<port>` endpoint used by the C64/VICE RS-232 capture workflow.
Spectrum printer launch arguments may also use `{nullDevice}`, which expands to `NUL` on Windows and `/dev/null` elsewhere. Atari shared-drive settings use `sharedDriveSpec`, `sharedDrivePath`, and `sharedDriveOutputPath`.

Each launch script understands an `emulator` block with an `{artifact}` placeholder. It builds the selected source, runs the configured conversion tools, then starts the emulator and exits without waiting for the emulator window.

Use `--restart` when switching examples to close an existing emulator process before launching the new one.

To launch every target with an emulator path configured:

```text
npm run launch:all-targets -- --source examples/narf.mbas --restart
```

The all-targets launch script skips targets without `emulator.path` in `scripts/tools.local.json`. Atari uses the tokenized `.BAS` artifact by default; pass `--atari-artifact atr` to launch the ATR artifact instead. When both Altirra and Atari800 are configured, Altirra is used by default; pass `--atari-emulator atari800` to choose Atari800, or `--atari-emulator all` to launch both Atari emulators.

## Configuration Boundary

Use `scripts/tools.local.json` for values the scripts can pass to external tools:

| Area | Put in JSON | Do manually |
| --- | --- | --- |
| Spectrum/Fuse | `bas2tap` path, Fuse path, tape launch args, test speed args, printer text-file args and output path | Install Fuse and `bas2tap`; choose the desired Spectrum model if your local Fuse default is not 48K; keep or remove `-auto-play` depending on your Fuse setup |
| Atari 800XL | Shared `basicParser` and `dir2atr` paths in `atari800xl.tools`; Altirra settings in `atari800xl.emulators.altirra`; Atari800 settings in `atari800xl.emulators.atari800` | Install/configure the chosen emulator; for Altirra, set up a writable H: host device in the profile used for tests; for Atari800 7.x, provide usable Atari OS/BASIC ROM configuration if your build does not auto-detect it |
| C64/VICE | `petcat` path, VICE path, autostart args, RS-232 capture args and output path | Install VICE; verify userport RS-232 is enabled when inspecting the GUI; leave `IP232` unchecked for the local capture helper |

The committed `scripts/tools.example.json` documents the expected shape. The local copy is intentionally machine-specific and should not be committed.

## Spectrum: bas2tap

`bas2tap` converts a Spectrum BASIC text listing to a tape image:

```text
Meta-BASIC .mbas -> Spectrum .bas text -> bas2tap -> .tap
```

The existing example configuration contains the integration. Exact command-line details depend on the installed `bas2tap` build.

Status: **tested manually in Fuse**, but the precise emulator procedure should be recorded in [running-programs.md](running-programs.md) when repeated.

## Spectrum: emulator launch

Configure Fuse in `scripts/tools.local.json`:

```json
  "emulator": {
  "name": "Fuse",
  "path": "C:\\Program Files (x86)\\Fuse\\fuse.exe",
  "args": ["-tape", "{artifact}", "-auto-play"],
  "testArgs": ["--speed", "500"]
}
```

Then run:

```text
npm run launch:spectrum -- --source examples/narf.mbas
```

The launch script defaults to the `release` profile because it is intended for emulator/device runs rather than inspecting generated BASIC.
If Fuse is already configured to play loaded tapes automatically, `-auto-play` can be omitted from the local config.

When another Fuse instance is already running:

```text
npm run launch:spectrum -- --source examples/input-demo.mbas --restart
```

## Commodore 64: petcat

VICE's `petcat` converts text into tokenized Commodore BASIC V2:

```text
Meta-BASIC .mbas -> C64 .bas text -> petcat -w2 -> .prg
```

The integration applies a lowercase input transformation because `petcat` interprets lowercase host ASCII as ordinary uppercase C64 text in its listing format.

Status: packaging hook implemented; exact emulator and Mini procedures need to be kept in the running guide.

## Commodore 64: emulator launch

Configure VICE in `scripts/tools.local.json`:

```json
"emulator": {
  "name": "x64sc",
  "path": "C:\\Emulator\\C64\\GTK3VICE-3.5-win64\\bin\\x64sc.exe",
  "args": ["-autostart", "{artifact}", "-autostart-warp"]
}
```

Then run:

```text
npm run launch:c64 -- --source examples/narf.mbas
```

The launch script defaults to the `release` profile because it is intended for emulator/device runs rather than inspecting generated BASIC.

When another VICE instance is already running:

```text
npm run launch:c64 -- --source examples/input-demo.mbas --restart
```

## Commodore 64: test output capture

For test-runner output inspection in VICE, prefer RS-232 capture over the printer path:

```text
npm run launch:c64 -- --project examples/instruction-suite --run-tests --printer-output --test-output-device rs232 --restart
```

The launch script starts `scripts/rs232-capture.mjs`, passes VICE a temporary `127.0.0.1:<port>` value through `{rs232Endpoint}`, and writes received bytes to `build/rs232/<profile>/c64/<source-name>.txt`.

The example VICE arguments are:

```json
"rs232Args": ["-rsuser", "-rsuserdev", "0", "-rsuserbaud", "2400", "-rsdev1", "{rs232Endpoint}", "-rsdev1baud", "2400"]
```

In the VICE GUI this appears under RS232 as Serial 1 set to a localhost port. Leave `IP232` unchecked for this capture helper. The userport RS-232 emulation must be enabled; ACIA/SwiftLink settings are separate from the BASIC `OPEN 1,2,...` path used here.

The older printer capture config remains available, but local VICE printer-to-file behavior can vary by version and settings.

## Spectrum and Atari: test output capture

The configuration file has matching `printerOutputPath`, `printerArgs`, `rs232OutputPath`, and `rs232Args` hooks for Spectrum and Atari.

For Spectrum/Fuse, use `--test-output-device text-printer` for host text capture. The Spectrum backend then emits `LPRINT`, and the example printer config uses Fuse's ZX Printer/text-file options:

```json
"testArgs": ["--speed", "500"],
"printerArgs": ["--printer", "--zxprinter", "--textfile", "{printerOutput}", "--graphicsfile", "{nullDevice}"]
```

Spectrum test launches append `testArgs` automatically when `--run-tests` is active; the default is Fuse `--speed 500`. Normal Spectrum launches keep the configured `args` only.
`{nullDevice}` expands to `NUL` on Windows and `/dev/null` elsewhere, which prevents Fuse from appending ZX Printer bitmap data to the default `printout.pbm` while still writing OCR-style text to `{printerOutput}`.

The verified minimal Fuse experiment was a 48K program containing `LPRINT "HELLO MCP"`, launched with ZX Printer text output enabled. The host file was updated while Fuse was still running. The older Spectrum `PRINTER` stream path (`OPEN #...,"P"` plus `PRINT #...`) did not produce text output in that experiment.

For Atari/Altirra, the source language can emit `OPEN_DEVICE ..., PRINTER`, `OPEN_DEVICE ..., RS232`, or `OPEN_DEVICE ..., SHARED_DRIVE`, lowering to `P:`, `R:`, or `H6:MCP.TXT` respectively. `SHARED_DRIVE` is the verified test-runner capture path: configure Altirra's Host device (H:) in the test profile to map H1/H6 to the configured `sharedDrivePath`, leave the device writable, and use `--printer-output --test-output-device shared-drive`. The launcher clears the configured `sharedDriveOutputPath` before starting the emulator.

For Atari800 7.x, configure `atari800xl.emulators.atari800.path` and use:

```text
npm run launch:atari800 -- --source examples/narf.mbas --restart
```

The example Atari800 arguments start an 800XL in PAL BASIC mode, map `H1:` to `build/atari800_drive`, and run the selected artifact:

```json
"args": ["-xl", "-pal", "-basic", "-H1", "{sharedDrive}", "-hreadwrite", "-run", "{artifact}"]
```

For Atari800 test capture, keep `testOutputDevice` as `shared-drive` and `sharedDriveSpec` as `H1:MCP.TXT`. The generated test runner then opens `H1:MCP.TXT`, and the launcher clears `build/atari800_drive/MCP.TXT` before starting the emulator.

## Atari 800XL: listing/ATR path

The implemented path is:

```text
Meta-BASIC .mbas -> Atari .bas text -> .lst with 0x9B endings
                 -> staging directory -> dir2atr -> .atr
```

The `.lst` file is imported by Atari BASIC with `ENTER`; `SAVE` then creates tokenized `.BAS` data.

## Atari 800XL: direct tokenization

The [`tbxl-parser`](https://github.com/dmsc/tbxl-parser) project provides an executable named `basicParser`. It can parse and tokenize both Turbo-BASIC XL and original Atari BASIC. For Atari BASIC, its documentation specifies `-A`; binary tokenized output is the default and can also be forced with `-b`; `-f` preserves full variable names in binary output.

The configured command shape is:

```text
basicParser -A -b -f -o output.bas input.bas
```

Configured pipeline:

```text
Meta-BASIC .mbas -> Atari .bas text -> basicParser -A -b -f -> tokenized .BAS
```

Status: **integrated into the optional Windows tool pipeline**. Emulator/device loading of the tokenized output should still be recorded when repeated.

Potential validation tools:

- [`atariconv`](https://github.com/mistalro/atariconv): tokenized Atari BASIC to text
- [`bw-atari8-tools`](https://slackware.uk/~urchlay/repos/bw-atari8-tools/tree/README.txt?id=ea8a90992582971100d5d73ab18f0944059587fa): `listbas`, `dumpbas`, `diffbas`, `renumbas`, and other Atari BASIC utilities

A useful automated check would tokenize a generated listing and detokenize it again, then compare the normalized listing rather than the binary representation.

## Atari 800XL: emulator launch

Configure Altirra in `scripts/tools.local.json`:

```json
"emulator": {
  "name": "Altirra",
  "path": "C:\\Emulator\\Altirra-4.40\\Altirra64.exe",
  "args": ["{artifact}"]
}
```

Then run:

```text
npm run launch:atari -- --source examples/narf.mbas
```

The Atari launcher defaults to the tokenized `.BAS` and uses Altirra's `/runbas` mode. Other artifact choices are available for experiments:

```text
npm run launch:atari -- --source examples/narf.mbas --artifact atr
npm run launch:atari -- --source examples/narf.mbas --artifact lst
npm run launch:atari -- --source examples/narf.mbas --artifact disk-directory
```

Use `--restart` to close an existing Altirra process before launching the new one. The generated ATR is a data disk, not a bootable DOS disk; launching it with `/disk` is useful for inspection or manual loading, but it should not be treated as an autorun disk.

## ATR creation

AtariSIO `dir2atr` can package a staging directory into an ATR image. Some Mini or USB workflows create and manage their own disk image instead. For those devices, copy the staged DOS-compatible `.LST` or tokenized `.BAS` into the device-managed image instead of nesting the generated `.atr` inside it.

## Deliberate separation

External conversion remains outside the compiler core:

- The compiler library has no dependency on platform-specific executables.
- Build scripts orchestrate optional local tools.
- A future VS Code extension can call the same compiler library.
- Failure to install packaging tools must not prevent plain BASIC generation.
