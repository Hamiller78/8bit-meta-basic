# San-Golpe

The fictional intro is stored in `texts/en/intro.txt` and `texts/de/intro.txt`. Short translations such as the continuation prompt are grouped in each language's `strings.json` and referenced with expressions such as `TEXT$("continue")`. Source files contain presentation and keyboard handling.

```sh
npm run build:all-targets -- --project examples/san-golpe --language en --no-tools
npm run build:all-targets -- --project examples/san-golpe --language de --no-tools
npm run build:c64 -- --project examples/san-golpe --language de --no-tools
```

English is the default language. The project configuration selects the C64 uppercase/lowercase character set for the game; test runners use the standard C64 font unless `--font mixed` is requested explicitly. German umlauts use portable `ae`/`oe`/`ue` spellings in generated BASIC. Blank lines delimit paragraphs; single line breaks are treated as spaces during wrapping.

Atari tokenized BASIC now packages successfully. Reusing expression temporaries and type-compatible function storage reduces this game's actual Atari variable count from 169 to 115, below the dialect's 128-variable limit. The build summary's text-based variable estimate can be higher than the number of names in Atari's variable table.

`createCharacter(nationality, gender)` creates a randomly named character and returns its zero-based index in `characters()`. Use `native`, `us`, or `russian` for nationality and `male`, `female`, or `any` for gender. It returns `-1` when the character array or a required name pool is exhausted. `resetCharacterFactory()` chooses a random starting position in each name pool; character creation then moves through the pool without repetition.

New characters start with role `none`, zero money and weapons, agenda `doDuty`, no agenda target, and a random integrity from 0 through 10. After `createAllCharacters()` has created the complete cast, each character has a 75% chance to retain `doDuty`; the remaining outcomes are split evenly between `usurpRole`, `findLove`, and `secretSpy`. Usurpation and love select another character as their target. The spy agenda remains targetless until allegiance mechanics are defined.

The main screen shows the budget, both US agents, their contacts, and current missions. Press `1` or `2` for an agent and to assign a mission; `3` opens a character directory grouped by location; `4` ends the turn. Both agents begin with **no contacts**. A visit order persists across turns and may find information or establish a permanent contact at the chosen location. Investigation also persists until the target's agenda is known; a deal is a one-time order. Mission results appear with the next turn's events.

The current cast includes a general at Military HQ. Each visit encounters one accessible character at its location. The information and contact rolls are independent:

| Location | Information | Contact |
| --- | ---: | ---: |
| The Republic's Palace | 35% | 20% |
| Military HQ | 50% | 25% |
| USSR Embassy | 25% | 15% |
| Church | 60% | 40% |
| Pub | 75% | 55% |
| Outside Town | 50% | 35% |

A visit can raise knowledge as far as the rough integrity band. A contact at the target's location is required to investigate further, with a 20-point bonus over that location's information chance (capped at 95%). The President cannot be reached by a cold Palace visit; an existing Palace contact makes him accessible. Contacts belong to individual agents.

Money is measured in `k$`: one unit is 1,000 US dollars. The starting budget is `1,000 k$` ($1,000,000). A deal pays `10 k$` to an agent's contact for full information about a character at that contact's location. Integrity determines the chance the deal is honored: integrity 0 never honors it; integrity 10 always does. An unhonored deal either disappears into the contact's pocket or funds their own agenda. Both failures look the same to the player. Diverted funds become character money, and a power-seeking contact also gains a weapons unit.

Player knowledge is stored as one numeric level per character, separate from the character's true attributes. Level 0 identifies only an entry in a location (the two USSR Embassy agents start here); level 1 reveals the name; level 2 also reveals a rough integrity band (`0–3` low, `4–7` medium, `8–10` high); level 3 also reveals the agenda. All other starting characters are known by name at level 1. `revealCharacter(index, level)` raises knowledge without lowering an existing level.

The President has a hidden economic position from `0` (socialist) to `100` (free market), initially `50`. Game systems move it through `adjustPresidentEconomy(change)`, which keeps it within that range; future coffee-market and event logic can therefore influence the same state. The player never sees the number. Investigating the President through an established Palace contact produces one of five qualitative descriptions. All living characters except US agents, Soviet agents, and the US tourist are considered close enough to have an opinion. A reliable contact reports the correct band; a failed integrity roll moves the report one band in either direction. The bartender is a wildcard who can potentially know about any living character. Other characters can provide information about people at their own location.

The focused test configurations keep the emulator programs small enough to load, while exercising the actual BASIC for each feature:

```sh
npm run launch:c64 -- --build-config examples/san-golpe/characterfactory-test.metabasic.json --run-tests --profile release --printer-output --restart
npm run launch:spectrum -- --build-config examples/san-golpe/characterfactory-test.metabasic.json --run-tests --profile release --printer-output --restart
npm run launch:c64 -- --build-config examples/san-golpe/agentoperations-test.metabasic.json --run-tests --profile release --printer-output --restart
npm run launch:spectrum -- --build-config examples/san-golpe/agentoperations-test.metabasic.json --run-tests --profile release --printer-output --restart
npm run launch:c64 -- --build-config examples/san-golpe/mainscreen-test.metabasic.json --run-tests --profile release --printer-output --restart
npm run launch:spectrum -- --build-config examples/san-golpe/mainscreen-test.metabasic.json --run-tests --profile release --printer-output --restart
```
