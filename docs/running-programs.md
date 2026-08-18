# Running generated programs

This is a practical field guide for loading generated programs into emulators and compatible retro devices. Procedures must be labelled by evidence:

- **Verified:** repeated successfully on the named emulator or physical device.
- **Documented:** taken from tool or device documentation but not yet repeated by this project.
- **Expected:** inferred from compatible formats; still needs a hardware test.

Record emulator/device version, host operating system, target video mode, and relevant menu settings whenever a procedure is verified.

## ZX Spectrum with Fuse

Status: **partly verified**.

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

## Atari 800XL with an ATR listing

Status: **current documented project workflow; emulator details need a clean repeat test**.

Mount:

```text
D1: bootable Atari DOS 2.5 disk
D2: generated program ATR data disk
```

After a cold boot, return from DOS to BASIC with `B. RUN CARTRIDGE` if necessary. Then enter:

```basic
NEW
ENTER "D2:WARNING.LST"
LIST
SAVE "D2:WARNING.BAS"
RUN
```

On later boots, the tokenized version can be started directly:

```basic
RUN "D2:WARNING.BAS"
```

`ENTER` parses the text listing; `SAVE` writes Atari BASIC's tokenized format.

If the rightmost column or bottom row is cropped, increase the emulator/device display size or overscan. The program uses the logical `GRAPHICS 0` text area, but the visible TV-safe area varies.

## Atari 800XL with direct tokenized BASIC

Status: **planned evening experiment**.

1. Convert the generated Atari listing with `tbxl-parser` in Atari BASIC mode.
2. Mount or expose the tokenized `.BAS` file to Altirra.
3. In Atari BASIC, run:

   ```basic
   RUN "D:PROGRAM.BAS"
   ```

4. If direct `RUN` behaves differently, try `LOAD "D:PROGRAM.BAS"` followed by `RUN`.
5. `LIST` the result and compare it with the generated text.
6. Optionally detokenize it with `atariconv` or `listbas` and compare the round trip.

Record during the test:

- `tbxl-parser` version and download/build source
- Exact successful command line
- Accepted input line endings
- Whether `-f` preserves Meta-BASIC's readable Atari variable names
- Altirra version and host-directory/disk setup
- A400 Mini file/container requirements

## Commodore 64 emulator

Status: **artifact generation available; exact repeatable procedure still to document**.

1. Build a `.prg` with the configured `petcat -w2` integration.
2. Attach or autostart the `.prg` in VICE.
3. If the emulator loads without running it, enter:

   ```basic
   RUN
   ```

4. Use `LIST` to inspect the tokenized program and compare it with the generated `.bas` file.

Record during the next test:

- VICE version
- Exact `petcat` version and command
- Autostart versus manual load procedure
- Treatment of quotes, PETSCII symbols, and letter case

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

Potential inputs include a device-managed ATR image, a generated ATR, a staged `.LST`, or a tokenized `.BAS`. Do not describe any one of these as supported until it has been verified on the installed firmware.

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
