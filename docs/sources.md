# Documentation and software sources

This page records external material used to understand target dialects, file formats, and conversion tools. A link appearing here does not imply that its contents or software have been incorporated into Meta-BASIC.

## Apple II

- [DS1216 SmartWatch data sheet](https://www.analog.com/en/products/ds1216e.html): No-Slot Clock serial protocol and hundredths-of-a-second registers.
- [Apple II family identification bytes](https://prodos8.com/docs/technote/misc/07/): monitor ROM identifiers used to distinguish the II Plus and IIe clock locations.

- [Applesoft BASIC Programmer's Reference Manual](https://mirrors.apple2.org.za/ftp.apple.asimov.net/documentation/programming/basic/Applesoft%20BASIC%20Programming%20Reference%20Manual%20-%20Apple%20Computer.pdf)
- [Apple IIe Reference Manual](https://applelogic.org/files/AIIEREF.pdf): vertical blanking status and machine capabilities.
- [Apple II Technical Note: VBL Signal](https://apple2.gs/technotes/tn-iigs-040/): interrupt availability on Apple II models and peripherals.
- [AppleWin command-line documentation](https://github.com/AppleWin/AppleWin/blob/master/help/CommandLine.html)
- [AppleCommander command-line documentation](https://applecommander.github.io/cli/ac/)

## Atari BASIC

### File format and tokenization

- Lane Winner, *Atari BASIC Outline*: [Internet Archive PDF](https://dn710701.ca.archive.org/0/items/ataribasicoutline/Atari_BASIC_OUTLINE_text.pdf)

  Useful sections include the tokenized program layout, variable-name and value tables, token output buffer, command/operator/function token tables, memory pointers, and six-byte BCD numeric representation.

### Conversion and inspection tools

- dmsc, [`tbxl-parser`](https://github.com/dmsc/tbxl-parser), GPL-2.0. Provides the `basicParser` executable, which parses and tokenizes Turbo-BASIC XL or original Atari BASIC. Atari mode is selected with `-A`; binary output can be selected with `-b`; full variable names in binary output are preserved with `-f`.
- mistalro, [`atariconv`](https://github.com/mistalro/atariconv). Converts tokenized Atari BASIC programs to text and can inspect/reconstruct variable-name information.
- Urchlay, [`bw-atari8-tools`](https://slackware.uk/~urchlay/repos/bw-atari8-tools/tree/README.txt?id=ea8a90992582971100d5d73ab18f0944059587fa). Includes `listbas`, `dumpbas`, `diffbas`, `renumbas`, cross-reference tools, ATR utilities, and ATASCII conversion tools.
- [AtariAge discussion: Tools to convert text Atari BASIC to a runnable format](https://forums.atariage.com/topic/296123-tools-to-convert-text-atari-basic-to-a-runnable-format/). Contains a practical text-to-BAS-to-ATR workflow from the `tbxl-parser` author.

### Disk-image tooling

- AtariSIO tools by Hias: [Atari 8-bit software](https://www.horus.com/~hias/atari/). Includes `dir2atr` builds referenced by the Atari community workflow.

## ZX Spectrum

- `bas2tap`: add the precise upstream project/download link and version used by the project after confirming which Windows source archive was compiled.
- Fuse emulator: add the precise upstream documentation page and tested version during the next verification pass.

## Commodore 64

- VICE `petcat`: add a direct link to the documentation for the exact VICE release used locally.
- Commodore, *Commodore 64 Programmer's Reference Guide*, chapter 6: [RS-232 interface](https://www.devili.iki.fi/Computers/Commodore/C64/Programmers_Reference/Chapter_6/page_349.html) and [BASIC `OPEN` note](https://www.devili.iki.fi/Computers/Commodore/C64/Programmers_Reference/Chapter_6/page_352.html). Documents the serial buffers and BASIC variable reset.
- [Commodore 64 BASIC and KERNAL ROM disassembly](https://www.pagetable.com/c64ref/c64disasm/). Used to inspect device-2 buffer allocation, open/close status, and BASIC error handling; the generated behavior is verified separately in VICE.

## Agon Light

- Dean Belfield, [`agon-bbc-basic-adl`](https://github.com/breakintoprogram/agon-bbc-basic-adl). This is the source project for the currently selected `bbcbasic24.bin`: BBC BASIC for Z80 converted to the eZ80's 24-bit ADL mode, with access to the Agon's available user RAM.
- R.T. Russell, [BBC BASIC (Z80) manual](https://www.bbcbasic.co.uk/bbcbasic/mancpm/). Documents the BBC BASIC 3/4-compatible language inherited by the ADL port, including 255-character strings, 32-bit integers, five-byte real numbers, variable naming, arrays, and memory management.
- Agon Platform community, [BBC BASIC for Agon](https://agonplatform.github.io/agon-docs/BBC-BASIC-for-Agon/). Records the available Agon interpreter families and Agon-specific MOS/VDP integration. The page mixes generations of the interpreter, so version-specific claims are checked against the selected ADL 1.03 source and runtime.

## Amstrad CPC

- Amstrad, [CPC 664 User Instructions](https://www.cpcmania.com/Docs/Manuals/CPC664%20User%20Instructions.pdf). Documents the machine's BASIC commands, screen streams, and devices. Consult the relevant machine and BASIC version when implementing a target.
- Amstrad, [AMSDOS firmware specification](https://www.cpcwiki.eu/imgs/b/bc/S968se09.pdf). Describes CPC disk formats and file handling.
- CPC Tech, [standard DSK image format](https://www.cpctech.cpcwiki.de/docs/dsk.html). Describes the disk and track headers used by the built-in image packager.
- Colin Pitrat and contributors, [Caprice32](https://github.com/ColinPitrat/caprice32), GPL-2.0. The emulator's documentation and configuration describe supported CPC models, disk images, and printer output; these are leads for integration, not evidence of a successful Meta-BASIC run.

## KC 85/3 and KC 85/4

- VEB Mikroelektronik Mühlhausen, [KC 85/3 BASIC manual](https://mathematikalpha.de/wp-content/uploads/2023/05/KC_85_3_BASIC.pdf) (1988) and [KC 85/4 BASIC manual](https://www.mpm-kc85.de/dokupack/D001_BASIC_HB.pdf) (1989). Document HC-BASIC syntax, screen operations, variable naming, memory, and peripherals. The latter describes both models but identifies machine-dependent memory and display details.
- VEB Mikroelektronik Mühlhausen, [KC 85/3 supplementary description](https://www.sax.de/~zander/kc85/doku/kc853erg.pdf). Documents extensions to the KC 85/2 BASIC and CAOS, including peripheral channels.
- VEB Mikroelektronik Mühlhausen, [KC 85/3 service manual](https://www.sax.de/~zander/kc85/doku/kc853serv.pdf). Documents the CTC and PIO hardware and their port addresses.
- VEB Mikroelektronik Mühlhausen, [KC 85/4 system manual](https://www.kc85emu.de/Download/KC854-Systemhandbuch.pdf). Describes KC cassette signal frequencies and data blocks; the generated BASIC cassette WAV was also checked through JKCEMU 0.9.9.1.
- Jens Müller, [JKCEMU KC 85 emulation](https://www.jens-mueller.org/jkcemu/kc85.html). Describes emulated machine models and expansion modules, including the M003 serial/printer interface. Emulator documentation is not evidence of a successful Meta-BASIC run.
- Jens Müller, JKCEMU 0.9.9.1 bundled help, `help/fileformats.htm` and `help/loadsavebasic.htm`. Describes the KC-BASIC `.sss` length header, padding, and BASIC-aware loading. A user-saved data-test file was compared byte for byte with this project's generated file.

## Source-recording policy

When adding a source:

1. Prefer an original manual, specification, source repository, or official project documentation.
2. Record the author/project, title, stable link, and version or access date where relevant.
3. Say what information was taken from it.
4. Keep licensing information beside software that might be redistributed, modified, or invoked by the build.
5. Distinguish historical documentation from statements verified on current emulator or Mini firmware.
