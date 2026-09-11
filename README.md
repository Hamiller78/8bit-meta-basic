# 8bit-meta-basic

Meta-BASIC is an experimental source language that transpiles a small, structured BASIC-like syntax into readable BASIC for classic home computers.

The currently implemented targets are:

- ZX Spectrum BASIC
- Atari BASIC on the Atari 800XL
- Commodore BASIC V2 on the Commodore 64

Generated BASIC is a development artifact: numbered, readable, and suitable for inspection, debugging, conversion, and loading into an emulator or compatible retro device.

## Status

This is an early compiler prototype. It has a tokenizer, typed syntax tree, compile-time constants, struct-backed arrays, structured-control lowering, named and inline functions with local variables, `EXIT FOR`/`CONTINUE FOR`, simple multi-file build configurations, deterministic line numbering, target-specific rendering, build profiles, source and module comments in readable output, and optional hooks for external packaging tools.

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

Paths in the configuration are resolved relative to the JSON file. The listed files form one compilation unit in the listed order. Cross-file access requires explicit `USES` declarations in the accessing file:

```basic
uses "game.mbas"
uses "ui.mbas"
```

`USES` paths are relative to the declaring source file, and dependencies must already be included in the build. Dependencies are not transitive; circular dependencies are compile-time errors. `USES` emits no code and does not change file order. See [module dependencies](docs/language-reference.md#module-dependencies-uses) for the access and ownership rules.

With those declarations, top-level constants, enums, struct definitions, and `DIM` declarations can be accessed before executable statements are analyzed. The configured file order becomes the module order in generated BASIC, with the first file as the entry module. Startup calls initialize module storage and globals before entry code runs, and `DATA` statements are collected at the end of the generated program.
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
Atari800 7.x is also supported as an alternate Atari emulator through `npm run launch:atari800`; configure it in the `atari800xl.emulators.atari800` block of `scripts/tools.local.json`.

Build artifacts for all targets:

```text
npm run build:all-targets -- --source examples/narf.mbas --profile release
```

Launch every configured emulator for one source:

```text
npm run launch:all-targets -- --source examples/narf.mbas --restart
```

When both Altirra and Atari800 are configured, `launch:all-targets` launches both Atari emulators by default. Use `--atari-emulator auto` to launch only one Atari emulator, preferring Altirra when configured.

Build profiles select the output readability:

| Profile | Readability | Purpose |
| --- | ---: | --- |
| `debug` | 2 | Source comments, module separators, source and generated label comments; readable variable names where possible |
| `balanced` | 1 | Module separators and source label comments; more compact target variables |
| `release` | 0 | Compact output without generated comments |

Debug profile builds pass apostrophe comments from `.mbas` source through as generated `REM` lines. The lower-level CLI flag is `--source-comments`; the profile scripts enable it automatically for `debug`.

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

- Multi-file builds require explicit, acyclic `USES` dependencies and form one compilation unit. Generated startup calls initialize module storage and globals while preserving configured module order, and `DATA` is emitted at the end. There are no namespaces, exports, automatic dependency loading, or separate compilation.
- User functions use statically allocated storage and do not support recursion.
- There is no general type system yet.
- Character-set conversion and validation for Spectrum text, ATASCII, and PETSCII remain incomplete.
- Plain `.bas` text is always generated. TAP, ATR, PRG, and tokenized Atari BASIC files require locally installed external tools.
- External tools and physical-device procedures are platform-dependent. Consult the running guide for verification status.

This project does not attempt to erase the differences between its target computers. Portable operations share one source form; machine-specific behaviour remains visible in the generated BASIC.

### Localized text and compile-time layout

Projects may include an optional `texts/` folder containing UTF-8 text files:

```text
my-project/
  source/main.mbas
  texts/en/intro.txt
  texts/en/strings.json
  texts/de/intro.txt
  texts/de/strings.json
```

Each language's optional `strings.json` groups short translations as string-valued key/value pairs. Longer prose stays in individual UTF-8 `.txt` files, whose filename stems become resource keys. `PRINT_TEXT` resolves either form and generates word-wrapped BASIC `PRINT` statements. Duplicate keys across `strings.json` and `.txt` files are rejected. English (`en`) is the default. Resource keys are case-sensitive. A missing resource in the selected language produces a source-location diagnostic; there is no implicit fallback to English. Single line breaks inside a paragraph become spaces; blank lines separate paragraphs. Long words split when necessary.

```basic
set_pos 1, 1
print_text "intro"
print_centered text$("continue")
print_wrap "This literal or a compile-time string constant wraps automatically."
print_wrap "A narrower text block.", TEXT_COLUMNS - 4
print_centered "SAN-GOLPE"
print
```

`PRINT_WRAP` and `PRINT_CENTERED` accept compile-time string expressions. `PRINT_TEXT`, `PRINT_WRAP`, and `PRINT_CENTERED` accept an optional width after a comma, from 1 through `TEXT_COLUMNS`; the default is the full screen width (Spectrum 32, Atari 40, C64 40). Centering applies to each wrapped line. Runtime string wrapping is not supported. Start layout output at column 1; after ordinary line endings, BASIC returns to the left margin. Width limits layout; it does not create a persistent left indent or track cursor positions across branches. Atari programs using text layout initialize the screen margins to columns 0 and 39 so all 40 columns are available.

`SET_POS row, column` sets the cursor without printing visible text or advancing to the next line. Coordinates are 1-based, just like `PRINT_AT`; constant coordinates are checked against target bounds. Bare `PRINT` emits a blank line.

```sh
npm run build:all-targets -- --project examples/san-golpe --language de --no-tools
npm run build:c64 -- --project examples/san-golpe --language en --font mixed --no-tools
npm run launch:c64 -- --project examples/san-golpe --language de --font mixed
npm run dev -- --config examples/san-golpe/metabasic.json --target spectrum --language de
```

Build and launch scripts accept `--language` and `--font`. Fonts are `default`, `uppercase`, and `mixed`. On C64, `mixed` emits the character-set switch, lowercases BASIC syntax, and preserves the case of quoted strings through the `lowercase-syntax` `petcat` input transform. `uppercase` selects the C64 uppercase/graphics font. C64 `default` assumes the normal uppercase/graphics font. Spectrum and Atari keep their normal fonts; `uppercase` capitalizes layout text and `mixed` preserves its case. Font conversion applies to the three layout commands; ordinary `PRINT` strings retain their existing native behavior.

German umlauts and ß are transliterated before wrapping (`ä` → `ae`, `Ä` → `Ae`, `ß` → `ss`), and common typographic quotes/dashes become plain equivalents. Unsupported Unicode or unavailable font punctuation is rejected. This is portable text support, not a custom font loader or general character-set converter. Text pages do not paginate automatically; use `SET_POS` and split resources for pages that exceed the screen height.

For JSON builds, optional `textsDir`, `language`, and `font` fields set defaults. `textsDir` is relative to the configuration file and defaults to `texts`; CLI options override language/font defaults. Conventional `--project` builds automatically use the project's sibling `texts/` folder. Single-source CLI builds look beside the source for `texts/`, or use `--texts-dir path`. Library callers pass a selected-language `texts` dictionary in `CompileOptions`; the compiler core performs no filesystem I/O.
