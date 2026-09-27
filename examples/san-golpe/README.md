# San-Golpe

The fictional intro is stored in `texts/en/intro.txt` and `texts/de/intro.txt`. Short translations such as the continuation prompt are grouped in each language's `strings.json` and referenced with expressions such as `TEXT$("continue")`. Source files contain presentation and keyboard handling.

Game design, confirmed rules, placeholder mechanics, and their implementation are documented in [GAME-RULES.md](GAME-RULES.md). Keep that document synchronized with rule and gameplay-code changes.

```sh
npm run build:all-targets -- --project examples/san-golpe --language en --no-tools
npm run build:all-targets -- --project examples/san-golpe --language de --no-tools
npm run build:c64 -- --project examples/san-golpe --language de --no-tools
```

English is the default language. The project configuration selects the C64 uppercase/lowercase character set for the game; test runners use the standard C64 font unless `--font mixed` is requested explicitly. German umlauts use portable `ae`/`oe`/`ue` spellings in generated BASIC. Blank lines delimit paragraphs; single line breaks are treated as spaces during wrapping.

Atari tokenized BASIC now packages successfully. Reusing expression temporaries and type-compatible function storage reduces this game's actual Atari variable count from 169 to 115, below the dialect's 128-variable limit. The build summary's text-based variable estimate can be higher than the number of names in Atari's variable table.

The focused test configurations keep the emulator programs small enough to load, while exercising the actual BASIC for each feature:

```sh
npm run launch:c64 -- --build-config examples/san-golpe/characterfactory-test.metabasic.json --run-tests --profile release --printer-output --restart
npm run launch:spectrum -- --build-config examples/san-golpe/characterfactory-test.metabasic.json --run-tests --profile release --printer-output --restart
npm run launch:c64 -- --build-config examples/san-golpe/agentoperations-test.metabasic.json --run-tests --profile release --printer-output --restart
npm run launch:spectrum -- --build-config examples/san-golpe/agentoperations-test.metabasic.json --run-tests --profile release --printer-output --restart
npm run launch:c64 -- --build-config examples/san-golpe/mainscreen-test.metabasic.json --run-tests --profile release --printer-output --restart
npm run launch:spectrum -- --build-config examples/san-golpe/mainscreen-test.metabasic.json --run-tests --profile release --printer-output --restart
```
