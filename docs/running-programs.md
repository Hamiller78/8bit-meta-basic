# Running generated programs

This is a practical field guide for loading generated programs into emulators and compatible retro devices. Procedures must be labelled by evidence:

- **Verified:** repeated successfully on the named emulator or physical device.
- **Documented:** taken from tool or device documentation but not yet repeated by this project.
- **Expected:** inferred from compatible formats; still needs a hardware test.

Record emulator/device version, host operating system, target video mode, and relevant menu settings whenever a procedure is verified.

## ZX Spectrum with Fuse

Status: **partly verified**.

Configuration split:

- JSON: set the `bas2tap` path, Fuse executable path, tape launch arguments, optional `testArgs`, and test-output file arguments in `scripts/tools.local.json`.
- Manual: install Fuse and `bas2tap`; choose a 48K-compatible model if your Fuse default differs; decide whether your local Fuse needs `-auto-play` or already starts loaded tapes automatically.

1. Build the Spectrum `.tap` using the configured `bas2tap` integration.
2. Start Fuse with a Spectrum model compatible with the program.
3. At the Sinclair prompt, enter:

   ```basic
   LOAD ""
   ```

4. Attach or open the generated `.tap` using Fuse's tape menu.
5. Start tape playback if the emulator does not do so automatically.
6. Run the program if it was saved without automatic start.

Notes from testing:

- Fuse's extended keyboard mode is entered with `Tab` in the tested configuration.
- On a German host keyboard, `Y` and `Z` may be exchanged.
- Entering quotation marks is a recurring source of friction; document the exact working key mapping next time.
- Fuse can be generous about tape timing, so behaviour may be less forgiving on physical hardware or another emulator.

Still to verify:

- Exact Fuse version and model setting
- Exact menu command for attaching the tape
- Whether the generated file autoloads or requires `RUN`
- Procedure on The Spectrum physical device
- Full project test-runner capture using `--printer-output`

## ZX Spectrum test output capture with Fuse

Status: **minimal path verified locally with Fuse**.

For Spectrum/Fuse text capture, use the Meta-BASIC `TEXT_PRINTER` device:

```text
npm run launch:spectrum -- --project examples/instruction-suite --run-tests --printer-output --test-output-device text-printer --restart
```

If no explicit `--test-output-device` is passed to a launch script, the helper uses the target's configured default. The example configuration uses `text-printer` for Spectrum, `shared-drive` for Atari, and `rs232` for C64.

The Spectrum backend lowers mirrored test-runner output to `LPRINT`. The launch configuration should pass Fuse's ZX Printer text-file options:

```json
"testArgs": ["--speed", "500"],
"printerArgs": ["--printer", "--zxprinter", "--textfile", "{printerOutput}", "--graphicsfile", "{nullDevice}"]
```

When `--run-tests` is used, the Spectrum launcher adds `testArgs`; by default this runs Fuse at `500%` speed. Normal Spectrum launches do not receive this speed override.
`{nullDevice}` expands to `NUL` on Windows and `/dev/null` elsewhere so Fuse does not grow the default `printout.pbm` ZX Printer bitmap file while the text capture is active.

Manual Fuse printer setup is not required for this path when the launcher arguments are configured as above. Keep `--zxprinter`; without it, the verified 48K text-file capture did not produce output. The `--graphicsfile {nullDevice}` part is what prevents the unwanted bitmap printout file.

Captured output is written to:

```text
build/printer/<profile>/spectrum/<source-name>.txt
```

The minimal verified experiment was:

```basic
10 LPRINT "HELLO MCP"
20 GO TO 20
```

with Fuse launched as a 48K Spectrum and ZX Printer text output enabled. The host text file became visible while Fuse was still running. The Interface 1 RS-232 path was not usable on this Windows/Fuse setup because the receive-file option raised a "Not yet implemented on Win32" dialog, and the transmit path did not produce reliable live output.

## Atari 800XL with an ATR listing

Status: **current documented project workflow; emulator details need a clean repeat test**.

Configuration split:

- JSON: set shared Atari packaging tools in `atari800xl.tools`; set Altirra executable path, artifact launch arguments, and shared-drive output paths in `atari800xl.emulators.altirra`.
- Manual: install Altirra and the Atari packaging tools; if using test capture, create or select an Altirra profile with a writable H: host device pointing at the configured shared-drive folder.

The launch helper can build the selected program and run the tokenized `.BAS` in Altirra:

```text
npm run launch:atari -- --source examples/narf.mbas
```

Use `--restart` when switching examples. To open the generated data ATR instead:

```text
npm run launch:atari -- --source examples/narf.mbas --artifact atr --restart
```

The generated ATR is not bootable; booting from it directly causes a boot error.

Mount:

```text
D1: bootable Atari DOS 2.5 disk
D2: generated program ATR data disk
```

After a cold boot, return from DOS to BASIC with `B. RUN CARTRIDGE` if necessary. Then enter:

```basic
NEW
ENTER "D2:COLORS.LST"
LIST
SAVE "D2:COLORS.BAS"
RUN
```

On later boots, the tokenized version can be started directly:

```basic
RUN "D2:COLORS.BAS"
```

`ENTER` parses the text listing; `SAVE` writes Atari BASIC's tokenized format.

If the rightmost column or bottom row is cropped, increase the emulator/device display size or overscan. The program uses the logical `GRAPHICS 0` text area, but the visible TV-safe area varies.

## Atari 800XL with direct tokenized BASIC

Status: **artifact generation available; emulator/device loading still needs a clean repeat test**.

1. Build the Atari target with `basicParser` configured in `scripts/tools.local.json`.
2. Mount the generated ATR or expose the staged tokenized `.BAS` file to Altirra.
3. In Atari BASIC, run:

   ```basic
   RUN "D:PROGRAM.BAS"
   ```

4. If direct `RUN` behaves differently, try `LOAD "D:PROGRAM.BAS"` followed by `RUN`.
5. `LIST` the result and compare it with the generated text.
6. Optionally detokenize it with `atariconv` or `listbas` and compare the round trip.

Record during the test:

- `tbxl-parser` version, `basicParser` executable path/name, and download/build source
- Exact generated artifact used: `.tokenized.bas`, staged `.BAS`, or generated `.atr`
- Whether `-f` preserves Meta-BASIC's readable Atari variable names
- Altirra version and host-directory/disk setup
- A400 Mini file/container requirements

For an explicit raw tokenized-file launch in Altirra:

```text
npm run launch:atari -- --source examples/narf.mbas --artifact tokenized-bas --restart
```

## Atari 800XL with Atari800 7.x

Status: **script support added; emulator behavior should be checked per machine**.

Atari800 7.x can be launched directly from the command line. Configure `atari800xl.emulators.atari800.path` in `scripts/tools.local.json`, then run:

```text
npm run launch:atari800 -- --source examples/narf.mbas --restart
```

The example configuration uses:

```text
-xl -pal -basic -H1 build/atari800_drive -hreadwrite -run <artifact>
```

`-xl` and `-basic` should start the emulator directly into Atari BASIC. The launcher still builds the normal Atari 800XL target and uses the configured Atari tokenization/ATR tools. The default launch artifact is the tokenized `.BAS`; `--artifact basic`, `--artifact lst`, and `--artifact atr` are also available for experiments.

For all-target launches, Altirra is preferred when both Atari emulators are configured:

```text
npm run launch:all-targets -- --source examples/narf.mbas --restart
npm run launch:all-targets -- --source examples/narf.mbas --restart --atari-emulator atari800
npm run launch:all-targets -- --source examples/narf.mbas --restart --atari-emulator all
```

## Atari 800XL test output capture

Status: **minimal Altirra H: host-device path verified locally**.

Meta-BASIC can lower `PRINTER` output to Atari `P:`, `RS232` output to `R:`, and `SHARED_DRIVE` output to Altirra's H: host-device file `H6:MCP.TXT`.

For test-runner capture, configure Altirra's `Testrunner` profile with a writable Host device (H:) whose H1/H6 path points at:

```text
C:\Users\Knees\source\repos\8bit-meta-basic\build\altirra_drive\
```

The launcher clears `build/altirra_drive/MCP.TXT` before starting Altirra, and the generated Atari test runner writes to `H6:MCP.TXT` so line endings become readable on the host.

This H: mapping is currently a manual Altirra setting. The JSON config only tells the launcher which host folder and output filename to prepare; it does not create the emulator profile or change Altirra's GUI settings.

For Atari800, the launcher configures the H: host device on the command line. The default Atari800 test path is `H1:MCP.TXT`, mapped to `build/atari800_drive/MCP.TXT`:

```text
npm run launch:atari800 -- --project examples/instruction-suite --run-tests --printer-output --restart
```

Shared-drive capture:

```text
npm run launch:atari -- --project examples/instruction-suite --run-tests --printer-output --restart
```

Printer and serial hooks remain available for experiments:

```text
npm run launch:atari -- --project examples/instruction-suite --run-tests --printer-output --test-output-device printer --restart
npm run launch:atari -- --project examples/instruction-suite --run-tests --printer-output --test-output-device rs232 --restart
```

## Commodore 64 emulator

Status: **artifact generation available; exact repeatable procedure still to document**.

Configuration split:

- JSON: set `petcat`, VICE executable path, autostart arguments, and optional printer/RS-232 capture arguments in `scripts/tools.local.json`.
- Manual: install VICE; use `--restart` when changing programs if you want the launcher to replace an existing VICE window.

1. Build and launch with:

   ```text
   npm run launch:c64 -- --source examples/narf.mbas
   ```

2. When switching to another example, close VICE yourself or launch with `--restart`.
3. Or build a `.prg` with the configured `petcat -w2` integration and attach or autostart it in VICE manually.
4. If the emulator loads without running it, enter:

   ```basic
   RUN
   ```

4. Use `LIST` to inspect the tokenized program and compare it with the generated `.bas` file.

Record during the next test:

- VICE version
- Exact `petcat` version and command
- Autostart versus manual load procedure
- Treatment of quotes, PETSCII symbols, and letter case

## Commodore 64 test output capture in VICE

Status: **verified locally with VICE and a localhost RS-232 capture endpoint**.

Run:

```text
npm run launch:c64 -- --project examples/instruction-suite --run-tests --printer-output --test-output-device rs232 --restart
```

The launch script starts a small local TCP capture helper, passes VICE a dynamic `127.0.0.1:<port>` Serial 1 endpoint, and writes the test-runner output to:

```text
build/rs232/release/c64/instruction-suite.txt
```

For other programs, replace `instruction-suite` with the selected source or project name. For other profiles, replace `release` with the selected profile.

VICE settings observed during verification:

- Userport RS232 emulation enabled
- Userport RS232 device set to Serial 1
- Baud rate 2400
- Serial 1 displays the dynamic localhost endpoint
- `IP232` unchecked

ACIA/SwiftLink RS-232 settings are separate from this workflow. C64 BASIC V2 `OPEN 1,2,...` uses the userport RS-232 path configured above.

The launcher supplies the dynamic localhost endpoint through `rs232Args`. In normal use you do not need to type that port into VICE yourself; the GUI is only useful for checking that the placeholder was expanded correctly.

If the file is empty, check that the GUI shows a localhost endpoint rather than a literal placeholder such as `{rs232Endpoint}` or `{rs232Output}`.

## The C64 Mini

Status: **physical device available; detailed workflow unverified in this guide**.

Likely workflow:

1. Copy the `.prg` to a FAT32 USB stick.
2. Open it with the Mini's media browser.
3. Start in the mode that provides BASIC/keyboard support.

Record:

- Firmware version
- Filename restrictions
- Whether the program must be renamed or accompanied by configuration flags
- Required keyboard, joystick, and USB-hub arrangement
- Whether two USB ports are sufficient for the tested setup

## The A400 Mini

Status: **physical device available; needs direct tokenized-BASIC and listing-import experiments**.

Potential inputs include a device-managed ATR image, a generated ATR, a staged `.LST`, or a tokenized `.BAS`. Early testing suggests the carousel may start BASIC programs from `.BAS` files but not `.LST` listings, making the `basicParser` tokenized output especially useful. Treat this as a working observation until the exact firmware flow has been repeated and recorded.

Record:

- Firmware version
- How BASIC is selected
- Accepted disk/file formats
- Whether a raw `.BAS` can be opened directly
- How files are copied into a device-managed ATR
- Keyboard layout and USB-hub behaviour

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
