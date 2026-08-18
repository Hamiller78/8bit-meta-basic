# Build and external-tool pipeline

Meta-BASIC itself always emits readable BASIC text. Optional external programs turn that text into formats accepted more directly by emulators and retro devices.

## Build scripts

```text
npm run build:spectrum -- --profile debug
npm run build:atari -- --profile balanced
npm run build:c64 -- --profile release
npm run build:all-targets -- --profile release
npm run build:all-targets -- --source examples/narf.mbas --profile release
npm run build:directory -- --source-dir examples --profile debug
```

The directory build is non-recursive. Use `--target spectrum`, `--target atari800xl`, or `--target c64` to restrict it.

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

## Spectrum: bas2tap

`bas2tap` converts a Spectrum BASIC text listing to a tape image:

```text
Meta-BASIC .mbas -> Spectrum .bas text -> bas2tap -> .tap
```

The existing example configuration contains the integration. Exact command-line details depend on the installed `bas2tap` build.

Status: **tested manually in Fuse**, but the precise emulator procedure should be recorded in [running-programs.md](running-programs.md) when repeated.

## Commodore 64: petcat

VICE's `petcat` converts text into tokenized Commodore BASIC V2:

```text
Meta-BASIC .mbas -> C64 .bas text -> petcat -w2 -> .prg
```

The integration applies a lowercase input transformation because `petcat` interprets lowercase host ASCII as ordinary uppercase C64 text in its listing format.

Status: packaging hook implemented; exact emulator and Mini procedures need to be kept in the running guide.

## Atari 800XL: current listing/ATR path

The implemented path is:

```text
Meta-BASIC .mbas -> Atari .bas text -> .lst with 0x9B endings
                 -> staging directory -> dir2atr -> .atr
```

The `.lst` file is imported by Atari BASIC with `ENTER`; `SAVE` then creates tokenized `.BAS` data.

## Atari 800XL: direct tokenization candidate

[`tbxl-parser`](https://github.com/dmsc/tbxl-parser) can parse and tokenize both Turbo-BASIC XL and original Atari BASIC. For Atari BASIC, its documentation specifies `-A`; `-f` preserves full variable names.

Proposed command for testing:

```text
basicParser -A -f input.lst -o output.bas
```

Proposed pipeline:

```text
Meta-BASIC .mbas -> Atari listing -> basicParser -A -f -> tokenized .BAS
```

Status: **documented by the external project, not yet verified in our Windows pipeline**. Verify the executable name, argument ordering, output overwrite behaviour, handling of `0x9B` versus host line endings, and compatibility with Altirra before adding it to `tools.example.json`.

Potential validation tools:

- [`atariconv`](https://github.com/mistalro/atariconv): tokenized Atari BASIC to text
- [`bw-atari8-tools`](https://slackware.uk/~urchlay/repos/bw-atari8-tools/tree/README.txt?id=ea8a90992582971100d5d73ab18f0944059587fa): `listbas`, `dumpbas`, `diffbas`, `renumbas`, and other Atari BASIC utilities

A useful automated check would tokenize a generated listing and detokenize it again, then compare the normalized listing rather than the binary representation.

## ATR creation

AtariSIO `dir2atr` can package a staging directory into an ATR image. Some Mini or USB workflows create and manage their own disk image instead. For those devices, copy the staged DOS-compatible `.LST` or tokenized `.BAS` into the device-managed image instead of nesting the generated `.atr` inside it.

## Deliberate separation

External conversion remains outside the compiler core:

- The compiler library has no dependency on platform-specific executables.
- Build scripts orchestrate optional local tools.
- A future VS Code extension can call the same compiler library.
- Failure to install packaging tools must not prevent plain BASIC generation.
