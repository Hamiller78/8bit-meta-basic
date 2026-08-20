# Roadmap

This roadmap records attractive directions rather than promises. New work should preserve tests and the readable generated output.

## Near-term toolchain work

- Verify `basicParser -A -b -f` tokenized Atari output in Altirra and on the A400 Mini.
- Add a tokenizer/detokenizer round-trip test outside the compiler core.
- Record reproducible emulator and Mini loading procedures.
- Complete direct source links and tested versions in `sources.md`.

## Language evolution

- Multiple source files and linking
- Procedures and functions
- Local variables with deterministic target name allocation
- Variable-length string arrays and richer array utilities
- More string operations
- Target-specific libraries or namespaces for machine capabilities
- Optional optimization and minification passes

## Text and character sets

- Validate literal strings for each packaging tool and target character set
- Define source escapes for Spectrum characters, ATASCII, and PETSCII
- Support localized strings selected by human language and target
- Document an interchange workflow with tools such as Petmate for character graphics

## Development tooling

- VS Code syntax highlighting
- Diagnostics and language-service integration
- Build and emulator launch commands
- Character-set preview/editing integration where existing specialist tools do not suffice

## Possible future targets

Additional BASIC dialects should be added only when their semantics and practical packaging workflow are understood. Candidate machines belong here until implemented; documentation must not present them as supported.

## Native Atari tokenization

The discovered external tools solve the immediate packaging problem. A native TypeScript Atari BASIC tokenizer remains a possible learning project, not a current requirement. Lane Winner's *Atari BASIC Outline* provides valuable format information if the project later needs to remove an external dependency or perform deeper validation.
