# Computer records

This small program demonstrates polled keys, `INPUT`, struct arrays, and whole-record file I/O. It has room for ten records, starts with four computer records, and leaves six slots empty. You can replace any record and save or load the complete array with one statement. Menu commands and `PRESS ENTER` prompts use `KEY_CODE()`; `INPUT` is reserved for entering record data.

Build it for the default medium of a target:

```text
npm run build:target -- c64 --project examples/computer-records
```

C64, Atari and CPC default to disk, Spectrum and KC 85/3 to tape, and Agon to its SD card. To make a C64 or Atari cassette version, add:

```text
--file-storage tape
```

To try the program in the KC 85/3 or CPC emulator:

```text
npm run launch:kc85 -- --project examples/computer-records --profile release
npm run launch:cpc -- --project examples/computer-records --profile release
```

The KC 85/3 uses cassette audio. Enable recording in JKCEMU when prompted,
press Enter, answer its `VERIFY ?(Y):` prompt, and save the recording; select the
recording as cassette input before choosing LOAD. The CPC writes to its disk
image. Save the modified image in Caprice32 and preserve it before rebuilding;
see the [running guide](../../docs/running-programs.md#amstrad-cpc--caprice32).

On cassette, the program prints a cueing message before the target ROM takes over. C64 and Spectrum search forward for their generated names. Atari reads the next cassette file, so cue it with the recorder counter before choosing LOAD.

The Spectrum version packs all four fields into one character-array tape block, so save and load each display only one native ROM prompt. The generated scratch array costs 720 bytes for this ten-record example. After saving, use **Media > Tape > Write...** to store the accumulated virtual tape as a tape-image file. Before loading, rewind or cue the virtual tape, start playback, and then choose the program's load action. With Fuse's normal ROM tape traps, clear the virtual tape first, answer the single prompt, and finally write the tape image. Direct **Record Start** is mainly needed when recording ROM output in real time.

The Atari emulator launch profiles store named files in their writable host folders: `atari1` uses `H6:` and `atari2` uses `H1:`. A compiler-only Atari build uses `D:` and therefore expects Atari DOS to be present on a real or fully configured disk system.
