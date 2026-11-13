# Running generated programs

Use this guide for emulator/device setup, loading, host capture, and runtime
troubleshooting. The [toolchain reference](toolchain.md) owns command options,
configuration fields, packaging, and artifacts. [Targets](targets.md) describes
BASIC dialects and machine capabilities.

Procedures are labelled by evidence:

- **Verified:** repeated successfully on the named emulator or physical device.
- **Documented:** taken from tool/device documentation but not repeated here.
- **Expected:** inferred from compatible formats; still requires a hardware test.

Keep emulator/device version, host OS, video mode, and relevant settings with each
verification record. Historical success is evidence for that setup, not a claim
that every current suite passes on every host.

## Before launching

Install the selected emulator and packaging tools. Start from
`scripts/tools.example.json`, create the ignored local configuration, and set paths
for this machine. Its field definitions are in
[Local tool configuration](toolchain.md#local-tool-configuration).
Emulator arguments must enforce the intended model, ROMs, memory expansion, and
video standard; descriptive computer metadata alone does not set them.

The scripts supply command-line arguments. Manual profiles, host-device mappings,
and installed ROMs may still be required as described below. Close an old emulator
or request `--restart` when switching programs; check the actual result if an
existing instance interferes. General launcher options are documented in
[Emulator launch commands](toolchain.md#emulator-launch-commands).

## Amstrad CPC / Caprice32

Configure a `cpc` target configuration using `scripts/tools.example.json` and set
`emulator.path` to Caprice32's executable. The installation needs its `cap32.cfg`,
ROMs, and resources beside the executable. `npm run launch:cpc -- --project <path>`
builds a CPC DATA disk and starts `MAIN.BAS`; the configuration file used for a run
is staged under `build/.caprice32/` and does not modify the installed configuration.
The emulator's selected model must be a CPC 6128 with BASIC 1.1.
Interactive launches detach the emulator so it can continue after the launcher
exits. The launching environment must provide access to the interactive desktop
and allow detached processes to continue; a successful spawn alone does not
establish that the window is visible.
Caprice32 may require saving a modified disk image through its interface. Preserve
the saved image separately before rebuilding: the build refuses to overwrite an
image changed since it was generated. CPC sessions may run concurrently, but
rebuilding a disk used by another session or sharing a test capture can interfere
with that session. Run captured tests sequentially. On Windows, `--restart`
terminates matching emulator processes.

`npm run test:language:cpc` runs all instruction modules sequentially and requests
visible windows by default. Actual visibility depends on the launching environment
and emulator settings. Use `-- --config <path>` for a nondefault tool configuration. On Windows,
`-- --hidden` sets Node's `windowsHide` option, which suppresses a subprocess
console window but does not guarantee that the emulator's graphical window is
hidden. Other platforms currently reject the option.
Captures are saved under `build/printer/release/cpc/` per module.
The launcher adds a test-only error report and printer padding to flush Caprice32's
buffer; ordinary program disks are not instrumented. Caprice32 on Windows has been
used to run the instruction modules; verify the current captures for current results.

## Complete emulator test workflow

Follow [Run MetaBASIC emulator tests](../skills/run-metabasic-tests/SKILL.md) for
runner builds, launching, keeping the session alive, waiting, and accepting captured
results. Use [MetaBASIC testing](../skills/metabasic-testing/SKILL.md) for application
tests and [Add a MetaBASIC feature](../skills/add-metabasic-feature/SKILL.md) for
instruction-suite coverage. This guide supplies transport setup and troubleshooting.

## Test capture locations

The supplied configurations use these release capture locations. Replace `<name>`
with the source/project artifact name and `release` with the selected profile.
Configured path overrides take precedence; resolve the actual path before a run.

| Configuration | Transport | Capture |
| --- | --- | --- |
| `spectrum48` | Fuse ZX Printer text | `build/printer/release/spectrum48/<name>.txt` |
| `spectrum128` | Fuse ZX Printer text | `build/printer/release/spectrum128/<name>.txt` |
| `c64` | VICE user-port RS-232 | `build/rs232/release/c64/<name>.txt` |
| `vic20` | VICE user-port RS-232 | `build/rs232/release/vic20/<name>.txt` |
| `atari1` | Altirra H: shared directory, `H6:MCP.TXT` | `build/altirra_drive/MCP.TXT` |
| `atari2` | Atari800 H: shared directory, `H1:MCP.TXT` | `build/atari800_drive/MCP.TXT` |
| `agon` | File on the virtual SD card | `<sdcardPath>/MCP.DAT`; runtime errors in `<sdcardPath>/MCP.ERR` |
| `cpc` | Caprice32 printer | `build/printer/release/cpc/<name>.txt`; the instruction orchestrator saves each module separately. |

The historical `--printer-output` launch flag enables the selected transport.
Capture fields and placeholders are defined in the
[toolchain reference](toolchain.md#emulator-fields). Shared Atari/Agon files are
reused across projects; preserve results before another launch clears them.
The sections below explain how each emulator reaches the selected file.

## ZX Spectrum with Fuse

Status: **manual loading partly verified; printer capture verified in Fuse 1.6.0
on Linux/aarch64**.

Configure the selected Fuse entry with its executable and explicit model arguments
(`--machine 48` or `--machine 128`). Keep packaging under `targets.spectrum.tools`
and model-specific arguments under the named configuration. For example:

```text
npm run launch -- spectrum48 --source examples/narf.mbas --restart
```

The tape argument receives the generated `.tap`. Include `-auto-play` when the
installed setup needs it; omit it if playback is already automatic. Use the manual
sequence if loading or startup is not automatic.

### Manual tape loading

1. Start Fuse with a compatible Spectrum model.
2. At the Sinclair prompt, enter `LOAD ""`.
3. Attach the generated `.tap` using the tape menu and start playback.
4. Enter `RUN` if the tape was saved without automatic start.

In the tested keyboard setup, `Tab` enters extended mode; German host layouts may
exchange Y and Z. Quote entry and exact tape-menu paths still need a reproducible
host-specific record. Fuse can be generous about tape timing, so repeat loading
on the physical The Spectrum separately before claiming hardware verification.

### Printer capture setup

Use `TEXT_PRINTER` for this Fuse setup. The selected configuration needs:

```json
"testArgs": ["--speed", "1000"],
"printerArgs": ["--printer", "--zxprinter", "--textfile", "{printerOutput}", "--graphicsfile", "{nullDevice}"]
```

`--zxprinter` is required by the verified 48K capture path. The graphics sink
prevents growth of Fuse's default `printout.pbm`; the
[placeholder reference](toolchain.md#placeholders) defines `{nullDevice}`.
These arguments replace manual printer setup for the verified configuration.
Test launches use the accelerated `testArgs` speed; normal runs retain their
ordinary speed. Choose a percentage suitable for the host.

The minimal verified experiment was a 48K program containing:

```basic
10 LPRINT "HELLO MCP"
20 GO TO 20
```

The host file updated while Fuse was running. Long runner lines can wrap at the
Spectrum text width. The Interface 1 receive-file path raised "Not yet implemented
on Win32" in the Windows experiment; its transmit path did not yield reliable live
text. Printer text capture remains the documented route.

On 2026-09-12, the focused San-Golpe character runner completed in Fuse 1.6.0 on
Linux/aarch64 with 2 tests passed, 46 assertions, and zero failures. The exact
manual tape-loading and physical The Spectrum procedures remain to be recorded.

## Atari 800XL with Altirra

Status: **direct tokenized loading is configured; a clean repeat record of the
broader loading procedure is pending. Minimal H: shared-directory capture is verified**.

Install Altirra with the intended ROM/BASIC profile. Configure `atari1` with the
executable and tokenized loading arguments (`/runbas {artifact}`). Packaging and
artifact selection are described in the
[toolchain reference](toolchain.md#atari-800xl-direct-tokenization).

```text
npm run launch:atari -- --source examples/narf.mbas --restart
```

This uses tokenized `.BAS` by default. A packaged file exposed through an available
disk/device can also be loaded in BASIC with `RUN "D:PROGRAM.BAS"`, or
`LOAD "D:PROGRAM.BAS"` followed by `RUN`. Use `LIST` to inspect it against the
readable listing. The [inspection tools](sources.md#conversion-and-inspection-tools)
can detokenize it for a round-trip comparison. Record the artifact, tool version,
ROM/profile, and host-device mapping when verifying this path.

### Manual loading from a data ATR

The generated ATR contains program files, not a bootable DOS system. To inspect
that artifact in Altirra:

```text
npm run launch:atari -- --source examples/narf.mbas --artifact atr --restart
```

Mount a bootable Atari DOS 2.5 disk as D1 and the generated program ATR as D2.
After cold boot, return to BASIC with `B. RUN CARTRIDGE` if necessary, then enter:

```basic
NEW
ENTER "D2:NARF.LST"
LIST
SAVE "D2:NARF.BAS"
RUN
```

Use the DOS-compatible filename actually staged by the build. On later boots,
`RUN "D2:NARF.BAS"` loads the saved tokenized program. Booting the data ATR alone
causes a boot error. If screen edges are cropped, inspect display size/overscan;
the logical text area can exceed the TV-safe visible area.

### Shared-directory capture setup

Configure Altirra's test profile with a writable Host device (H:) whose H1/H6 path
maps to the repository's `build/altirra_drive/`, or the selected configuration's
host directory. The runner uses `H6:MCP.TXT`; H6 translates Atari line endings into
host CR/LF. The launcher clears its configured host output before starting.

This H: mapping is a **manual Altirra setting**. A host path in JSON does not create
the emulator profile or install its Host device. Verify that the active profile
maps to the directory prepared by the launcher. Minimal Host-device capture is
verified; printer (`P:`) and serial (`R:`) hooks remain experimental alternatives.

## Atari 800XL with Atari800 7.x

Status: **launcher support present; repeat behavior checks for the installed
emulator and ROM set**.

Configure `atari2` with its executable and ROMs for an 800XL with BASIC. The
supplied argument template is:

```json
"args": ["-xl", "-pal", "-basic", "-H1", "{sharedDrive}", "-hreadwrite", "-run", "{artifact}"]
```

The corresponding `artifactArgs` entries retain those model/host-drive arguments
for the selected loading method. Launch with:

```text
npm run launch:atari800 -- --source examples/narf.mbas --restart
```

`-xl` and `-basic` select the BASIC environment. `-H1` maps the host directory and
`-hreadwrite` enables writes. Unlike Altirra's manual profile mapping, this adapter
passes the host-directory setup on the command line. For capture, retain the
supplied `shared-drive` selection and `H1:MCP.TXT` device specification; the
launcher clears `build/atari800_drive/MCP.TXT` before starting.

For empty capture, check that the active H1 directory matches the configured host
capture directory and is writable. Programs launched under these Atari profiles
also use the selected host data drive for data-file operations: mounting an ATR
by itself does not install a DOS `D:` handler. Artifact choices and selection among
named computers belong in the [launcher reference](toolchain.md#emulator-launch-commands).

## Commodore computers with VICE

Status: **C64 RS-232 capture verified in VICE 3.7.1 on Linux/aarch64; exact manual
loading still needs a repeat record. VIC-20 setup is supplied in configuration**.

Install VICE and configure `x64sc` for C64 or `xvic` for VIC-20. Retain the
[petcat packaging settings](toolchain.md#commodore-64-petcat).
The supplied `xvic` profile enables all conventional memory expansions with
`-memory all`, matching the expanded PRG layout. Use a project that supports the
VIC-20 display, such as Eight Bits Below:

```text
npm run launch:c64 -- --source examples/narf.mbas --restart
npm run launch:vic20 -- --project examples/eight-bits-below --restart
```

The supplied profiles autostart the packaged PRG. For manual loading, attach or
autostart `.prg` through VICE, then enter `RUN` if it loads without starting.
Use `LIST` to compare the tokenized program with the readable `.bas`. Record VICE
and petcat versions, loading method, and treatment of quotes/PETSCII when verifying
a new host setup.

### RS-232 capture setup

The supplied C64 and VIC-20 configurations select RS-232 with:

```json
"rs232Args": ["-userportdevice", "2", "-rsuserdev", "0", "-rsuserbaud", "2400", "-rsdev1", "{rs232Endpoint}", "-rsdev1baud", "2400"]
```

The launcher starts the capture helper and supplies its dynamic localhost endpoint.
In the VICE GUI, verify:

- Userport RS232/modem enabled and assigned to Serial 1.
- Baud rate 2400.
- Serial 1 shows `127.0.0.1:<port>`, not a literal placeholder or file path.
- `IP232` unchecked.

C64 BASIC device 2 uses this user-port route; ACIA/SwiftLink settings are separate.
`-userportdevice 2` selects the device in the verified VICE 3.7.1 setup; `-rsuser`
is ambiguous in that version and can make it exit before startup. Arguments must
match the installed VICE version. There is normally no need to enter the dynamic
port manually. The helper decodes received PETSCII into readable host text.

The supplied `testArgs: ["-warp"]` keeps tests accelerated after autostart.
`-autostart-warp` accelerates loading only. Keep serial baud rate at 2400 regardless
of warp speed. Printer capture hooks remain available, but printer-to-file behavior
varies by VICE version/settings and is not the preferred documented route.

For an empty file, inspect startup errors and the actual endpoint/device selection.
A listening helper alone does not establish a VICE connection. Use the
[execution skill](../skills/run-metabasic-tests/SKILL.md) to check fresh output and
accept results. For the expanded VIC-20, use the instruction-module orchestrator
listed in the [toolchain reference](toolchain.md#language-conformance-suite), since
a monolithic suite consumes essentially the whole BASIC area.

On 2026-09-12, the focused San-Golpe character runner completed in VICE 3.7.1 on
Linux/aarch64 with 2 tests passed, 46 assertions, and zero failures. That run used
the former `--font mixed` spelling, now `--font lowercase`; current runners inherit
the project setting.

## Agon Light with Fab Agon Emulator

Status: **tokenized launch, German San Golpe intro, and the then-current 50-test
instruction suite verified in Fab Agon Emulator 1.2.5 with BBC BASIC ADL 1.03**.

Put `bin/bbcbasic24.bin` on the selected virtual card. This backend uses the ADL
1.03 interpreter; its capabilities are described in [targets](targets.md#agon-light).
Configure Fab Agon's executable, working directory, virtual card path, and
`--sdcard {sdcard}` argument. Launch with:

```text
npm run launch:agon -- --project examples/san-golpe --language de --restart
```

The launcher stages the tokenized program and writes `autoexec.txt` on that card:

```text
LOAD bin/bbcbasic24.bin
RUN . /metabasic.bbc
```

The selected card must be writable. The launcher replaces the staged program and
`autoexec.txt`; keep personal card files under other names. Test launches also
clear `MCP.DAT` and `MCP.ERR` and install an error trap. Ordinary runner output is
written to `MCP.DAT`; an unexpected BBC BASIC error writes its number and generated
line to `MCP.ERR`. Inspect both when diagnosing a run.

For a physical Agon, copy `.bbc` onto SD and use the same interpreter `LOAD`/`RUN`
sequence with the chosen filename. Keep `.bas` for inspection rather than relying
on the plain-text loader to accept UTF-8. Encoding and tokenization belong in the
[toolchain reference](toolchain.md#agon-bbc-basic-tokenizer).

## The C64 Mini

Status: **physical device available; detailed loading procedure unverified here**.

Expected procedure: copy `.prg` to a FAT32 USB stick, open it with the Mini's media
browser, and select a mode providing BASIC/keyboard support. Record firmware,
filename restrictions, companion configuration flags, and the keyboard/controller
and USB-hub arrangement before treating this as verified guidance.

## THEVIC20

Status: **deployment artifacts implemented; physical-device verification pending**.

Copy the generated `.prg` and matching `.cjm` into the same directory on a FAT32
USB stick. They must have exactly the same base name, such as `game.prg` and
`game.cjm`, for THEVIC20 to associate the configuration with the program.

Use the generated sidecar so that model, video standard, expansion memory, and
joystick settings accompany the program. The runtime layout must match the compiled
PRG; ordinary builds do not target unexpanded memory. CJM contents, supported
memory aliases, and fields for producing another layout are defined in
[THEVIC20 deployment settings](toolchain.md#thevic20-deployment-settings).

## The A400 Mini

Status: **physical device available; direct tokenized-BASIC and listing-import
procedures need verification**.

Potential inputs include a device-managed ATR, generated ATR, staged `.LST`, or
tokenized `.BAS`. Early testing suggests the carousel can start `.BAS` programs but
not `.LST` listings; treat that as an observation requiring a clean repeat rather
than a general format guarantee. Where the device manages its own ATR, copy the
staged DOS-compatible `.LST` or `.BAS` into it instead of nesting the generated `.atr`.

Record firmware, how BASIC is selected, accepted formats, raw `.BAS` loading,
file-copy steps, keyboard layout, and USB-hub behavior.

## Test record template

```text
Date:
Host operating system:
Emulator/device and version:
Target model/video standard:
Meta-BASIC commit:
Build command:
External tools and versions:
Generated artifacts:
Loading steps:
Result:
Quirks/failures:
Verification status changed to:
```
