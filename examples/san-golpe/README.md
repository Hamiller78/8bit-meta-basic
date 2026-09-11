# San-Golpe

The fictional intro is stored in `texts/en/intro.txt` and `texts/de/intro.txt`. Short translations such as the continuation prompt are grouped in each language's `strings.json` and referenced with expressions such as `TEXT$("continue")`. Source files contain presentation and keyboard handling.

```sh
npm run build:all-targets -- --project examples/san-golpe --language en --no-tools
npm run build:all-targets -- --project examples/san-golpe --language de --no-tools
npm run build:c64 -- --project examples/san-golpe --language de --font mixed --no-tools
```

English is the default. `--font mixed` enables the C64 uppercase/lowercase character set. German umlauts use portable `ae`/`oe`/`ue` spellings in generated BASIC. Blank lines delimit paragraphs; single line breaks are treated as spaces during wrapping.

`createCharacter(nationality, gender)` creates a randomly named character and returns its zero-based index in `characters()`. Use `native`, `us`, or `russian` for nationality and `male`, `female`, or `any` for gender. It returns `noCharacterIndex` when the character array or a required name pool is exhausted. `resetCharacterFactory()` shuffles each name pool once for a new game; character creation then consumes the shuffled names without repetition.
