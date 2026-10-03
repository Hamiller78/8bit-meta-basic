# San-Golpe

The fictional intro is stored in `texts/en/intro.txt` and `texts/de/intro.txt`. Short translations such as the continuation prompt are grouped in each language's `strings.json` and referenced with expressions such as `TEXT$("continue")`. Source files contain presentation and keyboard handling.

Game design, confirmed rules, placeholder mechanics, and their implementation are documented in [GAME-RULES.md](GAME-RULES.md). Keep that document synchronized with rule and gameplay-code changes.

```sh
npm run build:all-targets -- --project examples/san-golpe --language en --no-tools
npm run build:all-targets -- --project examples/san-golpe --language de --no-tools
npm run build:c64 -- --project examples/san-golpe --language de --no-tools
```

English is the default language. The project requests the `lowercase` and `international` character groups. C64 therefore selects its uppercase/lowercase set, while Atari XL/XE selects its international ROM set. The German resources use real umlauts; Atari packages them as single-byte ATASCII, while Spectrum and C64 fall back to `ae`/`oe`/`ue`. `ß` falls back to `ss` on every current target. Test runners inherit these project groups, keeping their messages and output assertions consistent with the game. Blank lines delimit paragraphs; single line breaks are treated as spaces during wrapping.

Atari tokenized BASIC packages successfully. The current game uses 99 entries in Atari's variable table, below the dialect's 128-variable limit. The build summary's text-based estimate is 145 because it counts source-level and lowered names differently from the tokenized variable table.

The focused test configurations keep the emulator programs small enough to load, while exercising the actual BASIC for each feature:

These standalone configurations repeat the project's `lowercase` and `international` groups because an explicit `--build-config` has no parent project configuration. This keeps their C64 runner output consistent with the game.

```sh
npm run launch:c64 -- --build-config examples/san-golpe/characterfactory-test.metabasic.json --run-tests --profile release --printer-output --restart
npm run launch:spectrum -- --build-config examples/san-golpe/characterfactory-test.metabasic.json --run-tests --profile release --printer-output --restart
npm run launch:c64 -- --build-config examples/san-golpe/agentoperations-test.metabasic.json --run-tests --profile release --printer-output --restart
npm run launch:spectrum -- --build-config examples/san-golpe/agentoperations-test.metabasic.json --run-tests --profile release --printer-output --restart
npm run launch:c64 -- --build-config examples/san-golpe/mainscreen-test.metabasic.json --run-tests --profile release --printer-output --restart
npm run launch:spectrum -- --build-config examples/san-golpe/mainscreen-test.metabasic.json --run-tests --profile release --printer-output --restart
npm run launch:c64 -- --build-config examples/san-golpe/presidentevents-test.metabasic.json --run-tests --profile release --printer-output --restart
npm run launch:spectrum -- --build-config examples/san-golpe/presidentevents-test.metabasic.json --run-tests --profile release --printer-output --restart
```
