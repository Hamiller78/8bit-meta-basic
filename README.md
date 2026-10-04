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
  "minimumScreenColumns": 32,
  "minimumScreenRows": 22,
  "files": [
    "src/main.mbas",
    "src/game.mbas",
    "src/ui.mbas"
  ]
}
```

These optional minimums default to 32 columns and 22 rows. A project must explicitly lower them if it supports a smaller screen; otherwise such a compile target is rejected before code generation.

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
npm run launch:all -- --build-config examples/multifile/metabasic.json --restart
```

For a conventional project folder, use `--project`. A project folder contains sibling `source/` and `tests/` folders. Normal builds compile `source/*.mbas`; test-mode builds compile `source/*.mbas` plus `tests/*.mbas` and generate the automatic test runner:

```text
npm run build:all-targets -- --project examples/project-demo --profile debug
npm run build:all-targets -- --project examples/project-demo --run-tests --module math --profile debug
npm run launch:all -- --project examples/project-demo --run-tests --restart
```

Scaffold conventional projects and modules with:

```text
npm run new:project -- examples/my-game
npm run new:module -- --project examples/my-game --module scoring
```

The language conformance and regression suite lives in `language-tests/instruction-suite`, outside the application examples. Use it whenever language syntax, commands, semantics, or target lowering changes:

```text
npm run test:language:build
npm run test:language:spectrum -- --module strings --restart
npm run test:language:c64 -- --module strings --restart
```

The target launch scripts mirror the generated test-runner output to the configured emulator device. Run the full suite before finishing a language change:

```text
npm run test:language:spectrum -- --restart
npm run test:language:c64 -- --restart
npm run test:language:atari -- --restart
```

Compiler targets and runnable computers are configured separately. The compiler targets remain `spectrum`, `atari800xl`, and `c64`; they select a BASIC dialect and shared packaging tools. Named entries under `targetConfigurations` select a concrete computer and emulator. The supplied names are `spectrum48`, `spectrum128`, `atari1`, `atari2`, and `c64`.

Launch any named configuration directly:

```text
npm run launch -- spectrum48 --source examples/narf.mbas --restart
npm run launch -- spectrum128 --source examples/narf.mbas --restart
npm run launch -- atari1 --source examples/narf.mbas --restart
npm run launch -- atari2 --source examples/narf.mbas --restart
```

The familiar `launch:spectrum`, `launch:atari`, `launch:atari800`, and `launch:c64` commands remain convenient aliases for those names. Test-output transports belong to the selected target configuration: the supplied Spectrum configurations use Fuse ZX Printer text output, `atari1` and `atari2` use their respective shared-drive arrangements, and `c64` uses VICE RS-232 capture.

Build artifacts for all targets:

```text
npm run build:all-targets -- --source examples/narf.mbas --profile release
```

Launch every named target configuration whose emulator has a path:

```text
npm run launch:all -- --source examples/narf.mbas --restart
```

Select one or more configurations during an all-configuration launch by repeating `--target-configuration`, for example `npm run launch:all -- --target-configuration spectrum128 --target-configuration atari2`. `launch:all-targets` is retained as a compatibility alias, but the configurations—not compiler targets—are what it launches.

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

- [Programming guide](docs/programming-guide.md)
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

Translations may include named placeholders such as `{name}`. Bind each value after a semicolon and declare its maximum display length so wrapping can reserve enough room. Translations may reorder the names:

```basic
print_text "welcome"; name = playerName$, 20
print_text "meeting", 32; host = hostName$, 20; guest = guestName$, 20
```

```basic
set_pos 1, 1
print_text "intro"
print_centered text$("continue")
print_wrap "This literal or a compile-time string constant wraps automatically."
print_wrap "A narrower text block.", TEXT_COLUMNS - 4
print_centered "SAN-GOLPE"
print
```

`PRINT_WRAP` and `PRINT_CENTERED` accept compile-time string expressions. `PRINT_TEXT`, `PRINT_WRAP`, and `PRINT_CENTERED` accept an optional width after a comma, from 1 through `TEXT_COLUMNS`; the default is the full screen width (Spectrum 32, Atari 40, C64 40). Placeholder maxima are positive compile-time integers no larger than that width. Centering applies to each wrapped line. Runtime string wrapping is not supported. Start layout output at column 1; after ordinary line endings, BASIC returns to the left margin. Width limits layout; it does not create a persistent left indent or track cursor positions across branches. Atari programs using text layout initialize the screen margins to columns 0 and 39 so all 40 columns are available.

`SET_POS row, column` sets the cursor without printing visible text or advancing to the next line. Coordinates are 1-based, just like `PRINT_AT`; constant coordinates are checked against target bounds. Bare `PRINT` emits a blank line.

```sh
npm run build:all-targets -- --project examples/san-golpe --language de --no-tools
npm run build:c64 -- --project examples/san-golpe --language en --font lowercase,international --no-tools
npm run launch:c64 -- --project examples/san-golpe --language de --font lowercase,international
npm run dev -- --config examples/san-golpe/metabasic.json --target spectrum --language de
```

Build and launch scripts accept `--language` and `--font`. The option declares independent character groups: `lowercase`, `international`, or both as `lowercase,international`. C64 reacts to `lowercase` by selecting its uppercase/lowercase character set and lowercasing BASIC syntax outside strings. Atari reacts to `international` by selecting its XL/XE international ROM set. Targets that already support a group need no switch.

On international Atari builds, `ä`, `ö`, `ü` and their uppercase forms are stored as single-byte ATASCII in the packaged listing; the readable `.bas` keeps the Unicode spelling and the program pays no runtime `CHR$` cost. Unsupported targets fall back to `ae`/`oe`/`ue`; `ß` always falls back to `ss`. Common typographic quotes/dashes become plain equivalents. Unsupported Unicode or unavailable font punctuation is rejected. Text pages do not paginate automatically; use `SET_POS` and split resources for pages that exceed the screen height.

For JSON builds, optional `textsDir`, `language`, and `font` fields set defaults. `textsDir` is relative to the configuration file and defaults to `texts`; CLI options override language/font defaults. Conventional `--project` builds preserve these fields from the project's `metabasic.json`, or use the project's sibling `texts/` folder when `textsDir` is omitted. Single-source CLI builds look beside the source for `texts/`, or use `--texts-dir path`. Library callers pass a selected-language `texts` dictionary in `CompileOptions`; the compiler core performs no filesystem I/O.
