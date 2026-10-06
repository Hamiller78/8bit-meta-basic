# San-Golpe

The fictional intro is stored in `texts/en/intro.txt` and `texts/de/intro.txt`. Short translations such as the continuation prompt are grouped in each language's `strings.json` and referenced with expressions such as `TEXT$("continue")`. Source files contain presentation and keyboard handling.

Game design, confirmed rules, placeholder mechanics, and their implementation are documented in [GAME-RULES.md](GAME-RULES.md). Keep that document synchronized with rule and gameplay-code changes.

The cast is limited to seven named San Golpe figures. USA and USSR operatives are not characters; each power instead has two actions per turn. The current interface implements the two USA action slots, while USSR action types and resolution remain pending design. The English and Russian character-name pools and the US tourist have been removed.

The main view uses a fixed 22-row character overview on every supported target. Government figures and other prominent characters appear in three columns, with their public identities visible from the start. Forty-column targets show an initial plus family name, while the 32-column Spectrum shows only the family name. Row 18 shows the two-action allowance for each power and a compact whole-KiB free-RAM reading for debugging. The current presentation is plain positioned text, deliberately leaving graphical or bordered character boxes for later Meta-BASIC support.

```sh
npm run build:all-targets -- --project examples/san-golpe --language en --no-tools
npm run build:all-targets -- --project examples/san-golpe --language de --no-tools
npm run build:c64 -- --project examples/san-golpe --language de --no-tools
```

English is the default language. The project requests the `lowercase` and `international` character groups. C64 therefore selects its uppercase/lowercase set, while Atari XL/XE selects its international ROM set. The German resources use real umlauts; Atari packages them as single-byte ATASCII, while Spectrum and C64 fall back to `ae`/`oe`/`ue`. `ß` falls back to `ss` on every current target. Test runners inherit these project groups, keeping their messages and output assertions consistent with the game. Blank lines delimit paragraphs; single line breaks are treated as spaces during wrapping.

The release build currently reports 114 Atari variables, below the dialect's 128-variable limit. This compiler-side count is useful as an early warning; the tokenized artifact remains the authority for the final Atari variable table.

The focused test configurations keep the emulator programs small enough to load, while exercising the actual BASIC for each feature:

These standalone configurations repeat the project's `lowercase` and `international` groups because an explicit `--build-config` has no parent project configuration. This keeps their C64 runner output consistent with the game.

```sh
npm run launch:c64 -- --build-config examples/san-golpe/characterfactory-test.metabasic.json --run-tests --profile release --printer-output --restart
npm run launch:spectrum -- --build-config examples/san-golpe/characterfactory-test.metabasic.json --run-tests --profile release --printer-output --restart
npm run launch:c64 -- --build-config examples/san-golpe/agentoperations-test.metabasic.json --run-tests --profile release --printer-output --restart
npm run launch:spectrum -- --build-config examples/san-golpe/agentoperations-test.metabasic.json --run-tests --profile release --printer-output --restart
npm run launch:c64 -- --build-config examples/san-golpe/mainscreen-test.metabasic.json --run-tests --profile release --printer-output --restart
npm run launch:spectrum -- --build-config examples/san-golpe/mainscreen-test.metabasic.json --run-tests --profile release --printer-output --restart
npm run launch -- atari1 --build-config examples/san-golpe/mainscreen-test.metabasic.json --run-tests --profile release --printer-output --restart
npm run launch -- atari2 --build-config examples/san-golpe/mainscreen-test.metabasic.json --run-tests --profile release --printer-output --restart
npm run launch:c64 -- --build-config examples/san-golpe/presidentevents-test.metabasic.json --run-tests --profile release --printer-output --restart
npm run launch:spectrum -- --build-config examples/san-golpe/presidentevents-test.metabasic.json --run-tests --profile release --printer-output --restart
```

`atari1` runs the Atari 800XL build in Altirra with the replacement ROM set. `atari2` runs the same Atari 800XL build in Atari800 with the original ROM set. Both use their configured shared-drive transport for test output.
