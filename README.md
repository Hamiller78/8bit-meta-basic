# 8bit-meta-basic

Meta-BASIC is an experimental source language that transpiles a small, structured BASIC-like syntax into readable BASIC for classic home computers.

The currently implemented targets are:

- ZX Spectrum BASIC
- Atari BASIC on the Atari 800XL
- Commodore BASIC V2 on the Commodore 64

Generated BASIC is a development artifact: numbered, readable, and suitable for inspection, debugging, conversion, and loading into an emulator or compatible retro device.

## Status

This is an early compiler prototype. It has a tokenizer, typed syntax tree, compile-time constants, struct-backed arrays, structured-control lowering, named and inline functions with local variables, `EXIT FOR`/`CONTINUE FOR`, simple multi-file build configurations, deterministic line numbering, target-specific rendering, build profiles, and optional hooks for external packaging tools.

## Quick start

Meta-BASIC requires Node.js 24 LTS or later.

```text
npm install
npm test
npm run build
```

Compile the example directly during development:

```text
npm run dev -- examples/colors.mbas --target spectrum
npm run dev -- examples/colors.mbas --target atari800xl
npm run dev -- examples/colors.mbas --target c64
```

Compile an ordered multi-file program through a small JSON build configuration:

```json
{
  "files": [
    "src/main.mbas",
    "src/game.mbas",
    "src/ui.mbas"
  ]
}
```

```text
npm run dev -- --config metabasic.json --target spectrum
```

Paths in the configuration are resolved relative to the JSON file. The listed files form one compilation unit in the listed order.
See `examples/multifile/metabasic.json` for a small working example.

The build and launch helper scripts use `--build-config` for Meta-BASIC project files, leaving `--config` for local tool/emulator configuration:

```text
npm run build:all-targets -- --build-config examples/multifile/metabasic.json --profile release
npm run launch:all-targets -- --build-config examples/multifile/metabasic.json --restart
```

For a conventional project folder, use `--project`. A project folder contains sibling `source/` and `tests/` folders. Normal builds compile `source/*.mbas`; test-mode builds compile `source/*.mbas` plus `tests/*.mbas` and generate the automatic test runner:

```text
npm run build:all-targets -- --project examples/project-demo --profile debug
npm run build:all-targets -- --project examples/project-demo --run-tests --module math --profile debug
npm run launch:all-targets -- --project examples/project-demo --run-tests --restart
```

Scaffold conventional projects and modules with:

```text
npm run new:project -- examples/my-game
npm run new:module -- --project examples/my-game --module scoring
```

The portable instruction-set regression suite lives in `examples/instruction-suite`:

```text
npm run build:all-targets -- --project examples/instruction-suite --run-tests --profile debug
npm run launch:all-targets -- --project examples/instruction-suite --run-tests --module strings --restart
```

Test runs can also mirror the generated test-runner output to a configured emulator device:

```text
npm run launch:all-targets -- --project examples/instruction-suite --run-tests --printer-output --restart
npm run launch:c64 -- --project examples/instruction-suite --run-tests --printer-output --test-output-device rs232 --restart
```

The launch scripts default to the verified capture transport for each target: Spectrum uses `TEXT_PRINTER`/Fuse ZX Printer text output, Atari uses `SHARED_DRIVE`/Altirra H: output below `build/altirra_drive/`, and C64 uses a small local RS-232 capture endpoint below `build/rs232/<profile>/c64/`.

Build artifacts for all targets:

```text
npm run build:all-targets -- --source examples/narf.mbas --profile release
```

Launch every configured emulator for one source:

```text
npm run launch:all-targets -- --source examples/narf.mbas --restart
```

Build profiles select the output readability:

| Profile | Readability | Purpose |
| --- | ---: | --- |
| `debug` | 2 | Source and generated label comments; readable variable names where possible |
| `balanced` | 1 | Source label comments; more compact target variables |
| `release` | 0 | Compact output without label comments |

## Small example

Meta-BASIC source:

```basic
const titleColumn = 5
const ruleLine$ = string$("-", TEXT_COLUMNS)

screen_border_color BLUE
screen_background_color BLACK
screen_text_color WHITE
cls

cell_text_color YELLOW
cell_background_color BLUE
print ruleLine$
print_at 3, titleColumn, "META-BASIC COLOURS"
```

Spectrum output begins like this:

```basic
10 BORDER 1
20 PAPER 0
30 INK 7
40 CLS
50 INK 6
60 PAPER 1
70 PRINT "--------------------------------"
80 PRINT AT 2,4;"META-BASIC COLOURS"
```

## Documentation

- [Language reference](docs/language-reference.md)
- [Architecture](docs/architecture.md)
- [Target machines and generated output](docs/targets.md)
- [Build and external-tool pipeline](docs/toolchain.md)
- [Running programs on emulators and retro devices](docs/running-programs.md)
- [Documentation and software sources](docs/sources.md)
- [Roadmap](docs/roadmap.md)

## VS Code extension prototype

The first small VS Code extension shell lives in `vscode-extension/`. It registers `*.mbas` files for syntax highlighting and adds `MetaBASIC: Build Project`, which runs the existing project build script for a workspace folder containing `source/` and `tests/`.

See [vscode-extension/README.md](vscode-extension/README.md) for the current development workflow and next steps.

## Important limitations

- Multi-file builds are simple ordered concatenation into one compilation unit; there are no modules, imports, exports, namespaces, or separate compilation.
- User functions use statically allocated storage and do not support recursion.
- There is no general type system yet.
- Character-set conversion and validation for Spectrum text, ATASCII, and PETSCII remain incomplete.
- Plain `.bas` text is always generated. TAP, ATR, PRG, and tokenized Atari BASIC files require locally installed external tools.
- External tools and physical-device procedures are platform-dependent. Consult the running guide for verification status.

This project does not attempt to erase the differences between its target computers. Portable operations share one source form; machine-specific behaviour remains visible in the generated BASIC.
