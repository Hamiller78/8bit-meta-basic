# Build and external-tool pipeline

This reference owns build/launch commands, project and tool configuration, artifacts,
and packaging. Use the [running guide](running-programs.md) for emulator/device
setup, loading, capture configuration, and troubleshooting. Source semantics belong
in the [language reference](language-reference.md); compiler implementation belongs
in [architecture](architecture.md).

## Build scripts

Use Node.js 24 LTS or later and run commands from the repository root. Build helpers
compile the TypeScript compiler, generate readable BASIC, and run configured
packaging tools. Put helper options after npm's `--`; direct `node scripts/...`
commands do not need that separator.

| Command | Purpose |
| --- | --- |
| `npm run build` | Compile the TypeScript compiler with `tsc`. |
| `npm run build:spectrum`, `build:atari`, `build:c64`, `build:vic20`, `build:agon`, `build:cpc` | Build one dialect; the `atari` alias selects `atari800xl`. |
| `npm run build:all-targets` | Build the selected input for every compiler target. |
| `npm run build:all-profiles` | Build all targets and profiles. |
| `npm run build:directory` | Build direct `.mbas` files in a directory, non-recursively. |

```text
npm run build:c64 -- --source examples/narf.mbas --profile debug
npm run build:all-targets -- --project examples/eight-bits-below --profile release
npm run build:c64 -- --build-config examples/multifile/metabasic.json --no-tools
npm run build:directory -- --source-dir examples --target c64 --profile debug
```

Compiler targets are `spectrum`, `atari800xl`, `c64`, `vic20`, `agon`, and `cpc`.
Directory builds accept repeated `--target` options. Build helpers also support
`--all-profiles`. All-target builds still enforce each project's screen requirements;
a project requiring 32 columns cannot compile for the 22-column VIC-20.

## Program inputs and project configuration

Build and launch helpers accept one input selector:

| Selector | Input |
| --- | --- |
| `--source file.mbas` | One source; helpers normally default to `examples/colors.mbas` if no input is specified. |
| `--build-config path/metabasic.json` | An explicit ordered source-file list. |
| `--project folder` | Conventional source/test discovery with optional project configuration. |

The direct compiler (`npm run dev -- ...` or `npm start -- ...`) instead takes a
positional source or `--config metabasic.json`. For helpers, **`--config` selects
the external-tool configuration**, while **`--build-config` selects the program**.

A project has sibling `source/`, optional `tests/`, and optional `texts/` directories.
With `--project`, direct `.mbas` files in `source/` are discovered. Matching entries
from `metabasic.json` come first in configured order; remaining discovered sources
follow in filename order. Without configuration, all sources use filename order.
Use `--build-config` for an exact file selection instead of directory discovery.
The first source is the entry module. Refer to
[USES](language-reference.md#module-dependencies-uses) for dependency and initializer
semantics; the build scripts do not load dependencies from those declarations.

An explicit program configuration supports:

| Field | Meaning |
| --- | --- |
| `files` | Required nonempty array of source paths relative to this configuration. |
| `textsDir`, `language`, `font` | Resource directory (default `texts`), language (default `en`), and character-group array (`lowercase`, `international`, or both). |
| `minimumScreenColumns`, `minimumScreenRows` | Positive minimum dimensions; defaults 32 columns and 22 rows. |
| `fileStorage` | `disk` or `tape`, subject to target support. |
| `testMode`, `testScreenOutput` | Runner generation and optional execution of tested screen operations. |
| `testPrinterOutput`, `testOutputDevice` | Runner mirroring and selected device. |

Conventional project helpers write an effective configuration under `build/.projects/`.
They preserve resource, language/font, minimum-screen settings, and test-mode
`testScreenOutput`; they set source/test selection and mirroring from helper options.
Other explicit-configuration fields are not automatically copied by this adapter.

`--language`/`--font` override configuration defaults. Combined font groups use
`--font lowercase,international`; JSON uses an array. Single-source compilation
looks for `texts/` beside the source; the direct compiler's `--texts-dir` overrides
resource discovery. Resource and placeholder syntax is defined in the
[language reference](language-reference.md#localized-text-resources-and-fonts).

### Direct compiler output and errors

After `npm run build`, `npm start -- ...` runs the compiled CLI; `npm run dev -- ...`
runs its TypeScript entry point. The direct compiler writes BASIC to standard output
unless `--output path` (or `-o path`) selects a file. Invalid arguments, file errors,
and compilation failures return a nonzero exit code with diagnostics on standard error.
Unknown targets are rejected rather than replaced by a different backend.

### Common build options

| Option | Effect |
| --- | --- |
| `--profile debug\|balanced\|release` | Readability profile; build helpers default to `debug`. |
| `--out-dir path` | Artifact root; default `build`. |
| `--config path` | Tool configuration; default `scripts/tools.local.json`. |
| `--no-tools` | Skip external packaging; built-in Agon tokenization still runs. Build helpers only. |
| `--skip-build` | Reuse compiled TypeScript; still generate/package the selected Meta-BASIC program. |
| `--language code`, `--font groups` | Override text-language and character groups. |

Target-specific build helpers also accept `--file-storage disk|tape`,
`--atari-shared-drive-spec`, and `--atari-data-drive-spec`. These are not universal
options on every orchestrator; use an explicit program configuration or a helper
that accepts the required override.

## Profiles and readable output

| Profile | Readability | Generated comments |
| --- | ---: | --- |
| `debug` | 2 | Source comments, module separators, source/generated labels. |
| `balanced` | 1 | Module separators and source labels. |
| `release` | 0 | Compact output without generated comments. |

Target-specific variable naming is documented in [targets](targets.md#readability).

The debug profile passes `.mbas` apostrophe comments through as generated `REM` lines. Trailing comments are emitted after the generated statement they annotate, so:

```basic
print "READY" ' shown after startup
```

can become:

```basic
10 PRINT "READY"
20 REM SHOWN AFTER STARTUP
```

The direct compiler flag for this behavior is `--source-comments`; the profile scripts add it automatically for `debug`. Long source comments may be split into multiple `REM` lines to stay within target line-length limits. In multi-file programs, readable profiles also insert prominent module separators such as `REM -------- MODULE MAIN.MBAS --------` when the generated output crosses from one source file to another.

## Generated artifacts

Paths normally use `build/<profile>/<compiler-target>/<name>`, with the root
controlled by `--out-dir`. `<name>` is the source stem or project-folder name.
Explicit configurations use their JSON stem, except that `metabasic.json` uses
its parent directory's name. Selecting a test module does not change the base name.

| Artifact | Produced when |
| --- | --- |
| `<name>.bas`, `<name>.debug.json` | Every successful helper build; readable BASIC and its debug sidecar. |
| Atari `<name>.lst`, `<name>.atr-files/` | Every Atari build; native listing and DOS-compatible staged files. |
| Atari `<name>.tokenized.bas` | Configured `basicParser` runs; also copied into staging as a DOS-compatible `.BAS`. |
| Atari `<name>.atr` | Configured `dir2atr` packages staging. |
| Spectrum `<name>.tap` | Configured `bas2tap` runs. |
| C64/VIC-20 `<name>.prg` | Configured `petcat` runs. |
| VIC-20 `<name>.cjm` | Packaging produces a PRG; deployment configuration is written beside it. |
| Agon `<name>.bbc` | Every Agon build, including `--no-tools`; built-in tokenization. |
| CPC `<name>.dsk` | Every CPC build, including `--no-tools`; a DATA disk containing an ASCII `MAIN.BAS` listing. The adjacent `.dsk.sha256` records the generated image so later builds can protect modified disks. |

Missing optional tools do not prevent BASIC generation. A configured tool failure
fails the build. Loading and copying these artifacts is described in the
[running guide](running-programs.md).

### Build statistics

Build summaries report line counts, variable usage, rendered BASIC size, and a
per-module breakdown. The size estimate counts final numbered text after lowering,
packing, and line-length repair, at one byte per supported target character and
logical line terminator. Instructions without a source module appear under
`<generated>`. It is a comparison metric, not exact free RAM: native tokenization,
variable tables, strings, and arrays also consume memory.

## Debug information sidecar

Every CLI build written with `--output program.bas` also writes `program.debug.json` beside it. The `build:*` and `launch:*` scripts use this output mode, so their BASIC artifacts have matching sidecars in the same build directory. To choose another sidecar path, pass `--debug-info path/to/map.json` to the compiler. This option also works when BASIC is printed to standard output; without `--output` or `--debug-info`, no file is written.

The JSON format has `formatVersion: 1`, the selected target, language, font, readability level, and test-mode flag, plus these mappings:

- `lines` maps each final numbered BASIC line to its source filename, line, column when available, and lowered instruction kind. It reflects the actual output after target lowering, comment selection, and line-length fixes.
- `functions` and `tests` record source names and locations, generated entry lines, and parameter, local, and return-variable storage names. Inline functions have no entry line because their bodies are expanded at call sites.
- `labels` records source and generated labels with their resolved BASIC line numbers, including labels whose `REM` lines were omitted in a compact build.
- `variables` maps internal storage names to target BASIC names. `sourceAliases` may contain several parameter and local names because functions can reuse storage; the same storage may also appear as a function's `returnVariable`. Generated temporaries may have no source alias.
- `structFields` maps each struct-array field to its target array. On Spectrum and C64, packed numeric fields share a two-dimensional array and `targetFieldIndex` gives the native second index. `targetElementIndexBase` gives the native first index (1 on Spectrum, 0 on C64 and Atari).

These are compile-time mappings for reading and debugging generated BASIC; the sidecar is not loaded by the target machine. The source paths are those used for compilation, so a build from absolute project paths records absolute paths. Target variable names use the compiler's canonical spelling and can appear in a different case in a C64 listing that requests the `lowercase` group.

## Project scaffolding

Use the scaffolding scripts to create the conventional folder layout:

```text
npm run new:project -- examples/my-game
npm run new:module -- --project examples/my-game --module scoring
```

The project command creates `source/main.mbas`, `tests/main-tests.mbas`, and a simple `metabasic.json`. The module command creates `source/scoring.mbas` and `tests/scoring-tests.mbas`; its generated test declares `uses "../source/scoring.mbas"`. Add `USES` declarations to other files that access the new module. When building from an explicit configuration, add the new source to its `files` list as well. Existing files are never overwritten.

## Test build and capture options

`--run-tests` works with source/config/project builds, directory builds, and
launchers. Project test builds append discovered test files after source files.
`--module name` requires `--project` and `--run-tests`, retains all source modules,
and selects matching test files: `name.mbas`, `name-tests.mbas`, or `name.test.mbas`.

```text
npm run build:c64 -- --project examples/eight-bits-below --run-tests --module combat --profile release
```

| Option | Effect |
| --- | --- |
| `--test-screen-output` | With `--run-tests`, execute tested screen operations as well as capturing them. |
| `--printer-output` | With `--run-tests`, mirror runner output; launchers arrange host capture. |
| `--test-output-device printer\|text-printer\|shared-drive\|rs232` | Mirroring device; launchers use the emulator override or adapter default if omitted. |

A standalone build's default device can differ from a named configuration's choice.
The launcher regenerates the runner with its selected device before starting.
Language semantics belong in [Test Mode](language-reference.md#test-mode);
physical transport setup and capture paths belong in the
[running guide](running-programs.md#test-capture-locations). Follow
[Run MetaBASIC emulator tests](../skills/run-metabasic-tests/SKILL.md) for waiting
and result acceptance.

## Language conformance suite

`language-tests/instruction-suite` is the language conformance project. Its command
entry points are:

| Command | Selection |
| --- | --- |
| `npm run test:language:build` | Build the complete suite for all compiler targets. |
| `npm run test:language:spectrum` | Launch on `spectrum48` with capture. |
| `npm run test:language:atari` | Launch on `atari1` with capture. |
| `npm run test:language:c64` | Launch on `c64` with capture. |
| `npm run test:language:agon` | Launch on `agon` with capture. |
| `npm run test:language:cpc` | Run CPC modules sequentially with visible Caprice32 windows and separate captures. |
| `npm run test:language:vic20` | VIC-20 module orchestrator; waits for captures and reports totals. |

Individual launch aliases accept options such as `--module strings`, `--restart`,
and `--hidden` after npm's `--`. The VIC-20 orchestrator has its own fixed module
list and timeout and requests hidden windows by default; use `-- --visible` to see
them. It does not forward arbitrary launch options. Other named configurations can use
the generic launcher with the suite's `--project`. Required development coverage
is owned by [Add a MetaBASIC feature](../skills/add-metabasic-feature/SKILL.md), and
execution by [Run MetaBASIC emulator tests](../skills/run-metabasic-tests/SKILL.md).
The CPC orchestrator discovers instruction modules, preserves a capture for each,
and shows emulator windows unless `--hidden` is supplied. For one module, use
`npm run launch:cpc -- --project language-tests/instruction-suite --run-tests --module strings --printer-output`.

## Performance benchmarks

Benchmarks have separate entry points, for example:

```text
npm run benchmark:string-arrays:build
npm run benchmark:string-arrays:spectrum -- --restart
npm run benchmark:string-arrays:atari -- --restart
npm run benchmark:string-arrays:c64 -- --restart
```

The [benchmark README](../performance-tests/string-arrays/README.md) owns measured
operations and interpretation. `package.json` also defines `benchmark:byte-arrays:*`.
The [branch-layout benchmark](../performance-tests/branch-layout/README.md) compares
early and late control flow in generated listings.

## Local tool configuration

Copy `scripts/tools.example.json` to the ignored `scripts/tools.local.json` and set
machine-local executable paths. The [committed template](../scripts/tools.example.json)
contains complete example configurations; the tables below define the fields.

| Section | Responsibility |
| --- | --- |
| `targets.<compiler-target>` | Packaging tools shared by a dialect: `spectrum`, `atari800xl`, `c64`, `vic20`, `agon`, `cpc`. |
| `targetConfigurations.<name>` | A freely named computer, compiler target, and emulator. |

Named configurations require `compilerTarget` and `emulator.type`. Adapter types
are `fuse`, `altirra`, `atari800`, `vice`, `fab-agon`, and `caprice32`. Optional `computer`
metadata describes model, memory, video standard, BASIC, ROMs, and screen assumptions;
emulator arguments enforce the actual setup. Multiple named computers may share
a compiler target.

### Packaging tool fields

Tools under `targets.<target>.tools` run in array order:

| Field | Meaning |
| --- | --- |
| `name`, `path`, `args` | Tool name, executable, argument array. An empty path leaves a tool unconfigured. |
| `inputArtifact` | Default `basic`; other keys include `atariListing`, `atariDiskDirectory`, `agonTokenized`, and earlier tool names. |
| `outputExtension` | Output suffix such as `.tap`, `.prg`, `.atr`. |
| `inputTransform` | `c64-petcat` applies the Commodore text convention; `lowercase`/`lowercase-syntax` lowercase syntax outside strings. |
| `failureOutputPattern` | Diagnostic regex that fails packaging even if the tool exits with status zero. |
| `copyToArtifact`, `copyExtension` | Copy output into a directory artifact with a DOS-compatible filename. |

### Emulator fields

| Field | Meaning |
| --- | --- |
| `type`, `name`, `path`, `args` | Adapter, display name, executable, normal launch arguments. |
| `testArgs` | Extra Spectrum/VICE arguments for test or fast launches. |
| `artifactArgs` | Atari argument templates by selected artifact, overriding normal `args`. |
| `processNames` | Additional Spectrum process names used for restart handling. |
| `testOutputDevice` | Runner mirroring device override. |
| `printerOutputPath`, `printerArgs` | Printer capture filename template and arguments. |
| `rs232OutputPath`, `rs232Args`, `rs232CapturePort` | Serial capture filename/arguments and optional fixed VICE helper port; default port zero is dynamic. |
| `sharedDriveSpec`, `sharedDrivePath`, `sharedDriveOutputPath`, `sharedDriveArgs` | Atari device specification, host directory, captured file, extra arguments. |
| `workingDirectory`, `sdcardPath`, `basicBinary`, `cardProgramName` | Fab Agon working directory, card, interpreter path on the card (default `bin/bbcbasic24.bin`), staged program name (normalized to `.bbc`). |
| `configPath` | Optional Caprice32 configuration template; defaults to `cap32.cfg` beside the executable. A run-specific copy is written under the build directory. |

Configured relative host paths resolve against the repository working directory.
Manual setup such as Altirra's host-device mapping is described in the running
guide; defining a JSON field does not create that emulator profile.

### Placeholders

| Placeholder | Expansion |
| --- | --- |
| `{input}`, `{output}` | Packaging input/output. |
| `{source}`, `{sourceName}` | Program input path and artifact base name. |
| `{profile}`, `{target}`, `{targetConfiguration}` | Profile, compiler target, named computer. |
| `{artifact}` | Packaged artifact selected for loading. |
| `{printerOutput}`, `{rs232Output}` | Host capture filenames. |
| `{rs232Endpoint}` | Dynamic VICE capture endpoint, `127.0.0.1:<port>`. |
| `{nullDevice}` | `NUL` on Windows, `/dev/null` elsewhere. |
| `{sharedDrive}`, `{sharedDriveOutput}` | Atari host directory and capture file. |
| `{sdcard}` | Fab Agon virtual card directory. |

Placeholder availability depends on the adapter/packaging step. Concrete argument
recipes belong in the [running guide](running-programs.md).

### THEVIC20 deployment settings

`targets.vic20.theVic20` accepts `videoStandard` (`pal` or `ntsc`, default `pal`)
and `memory` (`3k`, `4k`, `8k`, `16k`, `24k`, `32k`, or `35k`, default `35k`).
The generated `.cjm` default is:

```text
X:vic,pal,35k
J:1*:JU,JD,JL,JR,JF,JF,JF,JF,JF,JF,JF,JF,JF,JF,JF
```

It selects model, video standard, expansion memory, and primary joystick port 1,
mapping buttons to fire. A CJM requires an explicit joystick definition; otherwise
no joystick is available. Supported runtime memory assumptions belong in
[targets](targets.md#vic-20); USB deployment belongs in the
[running guide](running-programs.md#thevic20).

## Emulator launch commands

The generic launcher selects a named computer, builds with its compiler target,
packages the program, starts the emulator, and returns without waiting for native
completion:

```text
npm run launch -- spectrum128 --source examples/narf.mbas --restart
npm run launch -- vic20 --project examples/eight-bits-below --restart
```

Aliases are `launch:spectrum` (`spectrum48`), `launch:atari` (`atari1`),
`launch:atari800` (`atari2`), `launch:c64`, `launch:vic20`, and `launch:agon`.
They default to `release`; common input, test, profile, language/font, configuration,
output-directory, and `--skip-build` options apply.

| Launch option | Scope and effect |
| --- | --- |
| `--restart` | Request termination of existing emulator processes. Windows handling is best-effort. |
| `--hidden` | Request a hidden emulator window on Windows; intended for captured automated runs. Agon uses SDL's dummy video driver and software renderer. Other platforms do not hide the window. |
| `--fast` | Individual Spectrum/VICE launchers append `testArgs`, as test mode does. Agon accepts it without a speed change. |
| `--artifact tokenized-bas\|lst\|atr\|disk-directory` | Individual Atari launchers; default `tokenized-bas`. Atari800 also accepts `basic`. |
| `--file-storage disk\|tape` | Individual Commodore/Atari launchers support this override. |

Spectrum restart matching on Linux includes executable symlink resolution and
fallback process-name matching; `processNames` supplements names for wrappers.

```text
npm run launch:all -- --project examples/eight-bits-below --restart
```

This launches named entries with nonempty emulator paths. Repeat
`--target-configuration name` to restrict the selection. Common input/test/profile,
language/font, configuration, output-directory, and `--skip-build` options apply.
Use `--atari-artifact` rather than an individual Atari launcher's `--artifact`. `--hidden` is forwarded to each emulator.
The command skips unconfigured emulators and stops launching further configurations
on a launcher error. `launch:all-targets` and `launch:all-configurations` are aliases.
It does not aggregate native test results; use the
[execution skill](../skills/run-metabasic-tests/SKILL.md).

## Spectrum: bas2tap

`bas2tap` packages Spectrum `.bas` as `.tap` under `targets.spectrum.tools`.
BAS2TAP 2.6 can print `ERROR in line` while exiting with status zero; scripts check
that diagnostic and fail packaging rather than launching a truncated tape image.
Other tools can use `failureOutputPattern` for equivalent behavior.
See [Fuse loading](running-programs.md#zx-spectrum-with-fuse).

## Commodore 64: petcat

`petcat -w2` creates tokenized BASIC V2 PRGs. The `c64-petcat` transform creates a
separate `.petcat.input.bas`: syntax is lowercased; quoted text is lowercased for
the default uppercase/graphics set, or preserves case when `lowercase` is selected.
The compiler supplies the corresponding character-set switch.

VIC-20 uses the same tokenizer with `-l 1201` for expanded BASIC memory. The build
then creates the THEVIC20 sidecar. For loading, see
[VICE](running-programs.md#commodore-computers-with-vice).

## Atari 800XL: listing/ATR path

Atari generation creates `.lst` with `0x9B` line endings and a staging directory.
Requested, supported international characters become single-byte ATASCII; this
is not a general Unicode-to-ATASCII conversion. `dir2atr` uses
`inputArtifact: "atariDiskDirectory"` to package staged files into an ATR.

## Atari 800XL: direct tokenization

The [tbxl-parser tool](sources.md#conversion-and-inspection-tools) supplies:

```text
basicParser -A -b -f -o output.bas input.bas
```

`-A` selects original Atari BASIC, `-b` binary tokenized output, and `-f` full variable
names. Set `inputArtifact: "atariListing"` so native bytes reach the tokenizer.
The resulting `.tokenized.bas` is copied into staging as a DOS-compatible `.BAS`
before `dir2atr` runs, allowing both listing and tokenized files in an ATR.
See [Altirra loading](running-programs.md#atari-800xl-with-altirra) for their use,
and [sources](sources.md#conversion-and-inspection-tools) for inspection tools.

## Agon BBC BASIC tokenizer

Agon tokenization is built in. `.bas` is readable UTF-8; `.bbc` is directly loadable.
Tokenization follows ADL 1.03's token/line-record format, encoded line references,
and Windows-1252 string bytes. Interpreter capabilities belong in
[targets](targets.md#agon-light).

```text
npm run tokenize:agon -- input.bas output.bbc
```

Input must be a numbered UTF-8 listing; the output directory is created if needed.
Supported international characters in literals, comments, and data become
Windows-1252 bytes. Target builds do this automatically. For staging and startup,
see [Fab Agon](running-programs.md#agon-light-with-fab-agon-emulator).
