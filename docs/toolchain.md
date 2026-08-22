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

Normal project builds compile the `.mbas` files directly inside `source/`, sorted by filename. Project test-mode builds compile `source/` and then `tests/`, with `testMode` enabled:

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

The suite currently covers expressions, functions, control flow, storage, string handling, colours, `DATA`/`READ`/`RESTORE`, random numbers, and jiffies where the behavior is deterministic enough to assert portably.

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

Each launch script understands an `emulator` block with an `{artifact}` placeholder. It builds the selected source, runs the configured conversion tools, then starts the emulator and exits without waiting for the emulator window.

Use `--restart` when switching examples to close an existing emulator process before launching the new one.

To launch every target with an emulator path configured:

```text
npm run launch:all-targets -- --source examples/narf.mbas --restart
```

The all-targets launch script skips targets without `emulator.path` in `scripts/tools.local.json`. Atari uses the tokenized `.BAS` artifact by default; pass `--atari-artifact atr` to launch the ATR artifact instead.

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
  "args": ["-tape", "{artifact}", "-auto-play"]
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
