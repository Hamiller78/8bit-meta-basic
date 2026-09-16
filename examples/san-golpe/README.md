# San-Golpe

The fictional intro is stored in `texts/en/intro.txt` and `texts/de/intro.txt`. Short translations such as the continuation prompt are grouped in each language's `strings.json` and referenced with expressions such as `TEXT$("continue")`. Source files contain presentation and keyboard handling.

```sh
npm run build:all-targets -- --project examples/san-golpe --language en --no-tools
npm run build:all-targets -- --project examples/san-golpe --language de --no-tools
npm run build:c64 -- --project examples/san-golpe --language de --no-tools
```

English is the default language. The project configuration selects the C64 uppercase/lowercase character set, including for test runs; `--font default` overrides it when needed. German umlauts use portable `ae`/`oe`/`ue` spellings in generated BASIC. Blank lines delimit paragraphs; single line breaks are treated as spaces during wrapping.

`createCharacter(nationality, gender)` creates a randomly named character and returns its zero-based index in `characters()`. Use `native`, `us`, or `russian` for nationality and `male`, `female`, or `any` for gender. It returns `-1` when the character array or a required name pool is exhausted. `resetCharacterFactory()` chooses a random starting position in each name pool; character creation then moves through the pool without repetition.

New characters start with role `none`, zero money and weapons, agenda `doDuty`, no agenda target, and a random integrity from 0 through 10. After `createAllCharacters()` has created the complete cast, each character has a 75% chance to retain `doDuty`; the remaining outcomes are split evenly between `usurpRole`, `findLove`, and `secretSpy`. Usurpation and love select another character as their target. The spy agenda remains targetless until allegiance mechanics are defined.

The main screen shows the budget, both US agents, their contacts, and current missions. Press `1` or `2` for an agent and to assign a mission; `3` opens a character directory grouped by government, USSR Embassy, Church, Rebellion, and others; `4` ends the turn. Each agent begins with two provisional contacts. Meet, investigate, and support orders can be assigned and displayed, but their effects have not yet been implemented. The Rebellion directory is empty until rebellion characters are added.

Money is measured in `k$`: one unit is 1,000 US dollars. The starting budget is `1,000 k$` ($1,000,000). Character `money` values use the same unit, so a future small bribe of `1 k$` would be $1,000. Spending rules have not been implemented yet.

Player knowledge is stored as one numeric level per character, separate from the character's true attributes. Level 0 identifies only an entry in an area (the two USSR Embassy agents start here); level 1 reveals the name; level 2 also reveals a rough integrity band (`0–3` low, `4–7` medium, `8–10` high); level 3 also reveals the agenda. All other starting characters are known by name at level 1. `revealCharacter(index, level)` raises knowledge without lowering an existing level. Investigate orders do not yet produce reveals; that outcome rule remains to be designed.
