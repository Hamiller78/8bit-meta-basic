# Documentation and software sources

This page records external material used to understand target dialects, file formats, and conversion tools. A link appearing here does not imply that its contents or software have been incorporated into Meta-BASIC.

## Atari BASIC

### File format and tokenization

- Lane Winner, *Atari BASIC Outline*: [Internet Archive PDF](https://dn710701.ca.archive.org/0/items/ataribasicoutline/Atari_BASIC_OUTLINE_text.pdf)

  Useful sections include the tokenized program layout, variable-name and value tables, token output buffer, command/operator/function token tables, memory pointers, and six-byte BCD numeric representation.

### Conversion and inspection tools

- dmsc, [`tbxl-parser`](https://github.com/dmsc/tbxl-parser), GPL-2.0. Parses and tokenizes Turbo-BASIC XL or original Atari BASIC; Atari mode is selected with `-A`.
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

## Source-recording policy

When adding a source:

1. Prefer an original manual, specification, source repository, or official project documentation.
2. Record the author/project, title, stable link, and version or access date where relevant.
3. Say what information was taken from it.
4. Keep licensing information beside software that might be redistributed, modified, or invoked by the build.
5. Distinguish historical documentation from statements verified on current emulator or Mini firmware.
