# Documentation and software sources

This page records external material used to understand target dialects, file formats, and conversion tools. A link appearing here does not imply that its contents or software have been incorporated into Meta-BASIC.

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
- Commodore BASIC V2 and KERNAL references: add the primary manual or programmer's reference used to validate generated commands and ROM entry points.

## Agon Light

- Dean Belfield, [`agon-bbc-basic-adl`](https://github.com/breakintoprogram/agon-bbc-basic-adl). This is the source project for the currently selected `bbcbasic24.bin`: BBC BASIC for Z80 converted to the eZ80's 24-bit ADL mode, with access to the Agon's available user RAM.
- R.T. Russell, [BBC BASIC (Z80) manual](https://www.bbcbasic.co.uk/bbcbasic/mancpm/). Documents the BBC BASIC 3/4-compatible language inherited by the ADL port, including 255-character strings, 32-bit integers, five-byte real numbers, variable naming, arrays, and memory management.
- Agon Platform community, [BBC BASIC for Agon](https://agonplatform.github.io/agon-docs/BBC-BASIC-for-Agon/). Records the available Agon interpreter families and Agon-specific MOS/VDP integration. The page mixes generations of the interpreter, so version-specific claims are checked against the selected ADL 1.03 source and runtime.

## Source-recording policy

When adding a source:

1. Prefer an original manual, specification, source repository, or official project documentation.
2. Record the author/project, title, stable link, and version or access date where relevant.
3. Say what information was taken from it.
4. Keep licensing information beside software that might be redistributed, modified, or invoked by the build.
5. Distinguish historical documentation from statements verified on current emulator or Mini firmware.
