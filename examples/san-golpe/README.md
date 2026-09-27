# San-Golpe

The fictional intro is stored in `texts/en/intro.txt` and `texts/de/intro.txt`. Short translations such as the continuation prompt are grouped in each language's `strings.json` and referenced with expressions such as `TEXT$("continue")`. Source files contain presentation and keyboard handling.

```sh
npm run build:all-targets -- --project examples/san-golpe --language en --no-tools
npm run build:all-targets -- --project examples/san-golpe --language de --no-tools
npm run build:c64 -- --project examples/san-golpe --language de --no-tools
```

English is the default language. The project configuration selects the C64 uppercase/lowercase character set for the game; test runners use the standard C64 font unless `--font mixed` is requested explicitly. German umlauts use portable `ae`/`oe`/`ue` spellings in generated BASIC. Blank lines delimit paragraphs; single line breaks are treated as spaces during wrapping.

Atari tokenized BASIC now packages successfully. Reusing expression temporaries and type-compatible function storage reduces this game's actual Atari variable count from 169 to 115, below the dialect's 128-variable limit. The build summary's text-based variable estimate can be higher than the number of names in Atari's variable table.

`createCharacter(nationality, role)` creates a randomly named character and returns its zero-based index in `characters()`. Use `native`, `us`, or `russian` for nationality. Every role receives a male first name except `daughter`, which uses the dedicated native daughter-name pool and inherits the President's family name without consuming another family name. The function returns `-1` when the character array or a required name pool is exhausted. `resetCharacterFactory()` chooses a random starting position in each name pool; character creation then moves through the pool without repetition.

New characters start with role `none`, zero money and weapons, agenda `doDuty`, no agenda target, and a random integrity from 0 through 10. After `createAllCharacters()` has created the complete cast, each character has a 75% chance to retain `doDuty`; the remaining outcomes are split evenly between `usurpRole`, `findLove`, and `secretSpy`. Usurpation and love select another character as their target. The spy agenda remains targetless until allegiance mechanics are defined.

The main screen shows the budget, both US agents, their contacts, and current missions. Press `1` or `2` for an agent and to assign a mission; `3` opens the flat known-character directory; `4` ends the turn. Both agents begin with **no contacts**. Mission results appear with the next turn's events.

## Confirmed action rules

**Observe Location** discovers one random, previously unknown living character from the selected location's discovery pool. Discovery means learning enough about that character's habits to find them again at will; the character is added to the known-character directory. An already-known character is removed from subsequent observation pools. A common character has weight `3` and a rare character weight `1`, so any eligible common character is three times as likely to be selected as any eligible rare character. If no eligible unknown character remains, the action reports no lead. The order persists until changed.

The observation pools are:

| Location | Common (weight 3 each) | Rare (weight 1 each) |
| --- | --- | --- |
| Republic's Palace | General, Advisor | President's daughter, Landowner |
| USSR Embassy | Both Soviet agents | — |
| Church | Priest | Any other San Golpe native with integrity above 3 |
| Pub | Innkeeper | Any other San Golpe native with integrity below 9, plus the US tourist |

The two US agents are never discovery candidates: they are the characters executing the action. The President is also never discoverable through **Observe Location**. Characters have no permanently assigned locations; the four locations exist only as observation encounter tables. Only the two player agents are known at the start of a game; everyone else must be discovered or revealed by another mechanic.

## Placeholder mechanics

Investigation, contacts, deals, their success probabilities, and the President's economic reports are prototype logic, not confirmed game rules. They remain implemented so the current game loop is playable while actions are reworked. At present, investigation requires any living contact and succeeds on a flat 50% roll. Investigation persists until the target's agenda is known. Deals are one-time orders, cost `10 k$`, and use the selected contact's integrity to decide the outcome.

Money is measured in `k$`: one unit is 1,000 US dollars. The starting budget is `1,000 k$` ($1,000,000). A deal pays `10 k$` to an agent's contact for full information about a selected known character. Integrity determines the chance the deal is honored: integrity 0 never honors it; integrity 10 always does. An unhonored deal either disappears into the contact's pocket or funds their own agenda. Both failures look the same to the player. Diverted funds become character money, and a power-seeking contact also gains a weapons unit.

Player knowledge is stored as one numeric level per character, separate from the character's true attributes. Level 0 is unknown and omitted from the directory; level 1 means discovered and reveals the name; level 2 also reveals a rough integrity band (`0–3` low, `4–7` medium, `8–10` high); level 3 also reveals the agenda. `revealCharacter(index, level)` raises knowledge without lowering an existing level.

The placeholder political model gives the President a hidden economic position from `0` (socialist) to `100` (free market), initially `50`. Game systems move it through `adjustPresidentEconomy(change)`, which keeps it within that range. The player never sees the number. Investigating the President through a contact produces one of five qualitative descriptions. All living characters except US agents, Soviet agents, and the US tourist are considered close enough to have an opinion. A reliable contact reports the correct band; a failed integrity roll moves the report one band in either direction. For other targets, any living character can potentially provide information; accuracy is decided separately by dice rolls.

The focused test configurations keep the emulator programs small enough to load, while exercising the actual BASIC for each feature:

```sh
npm run launch:c64 -- --build-config examples/san-golpe/characterfactory-test.metabasic.json --run-tests --profile release --printer-output --restart
npm run launch:spectrum -- --build-config examples/san-golpe/characterfactory-test.metabasic.json --run-tests --profile release --printer-output --restart
npm run launch:c64 -- --build-config examples/san-golpe/agentoperations-test.metabasic.json --run-tests --profile release --printer-output --restart
npm run launch:spectrum -- --build-config examples/san-golpe/agentoperations-test.metabasic.json --run-tests --profile release --printer-output --restart
npm run launch:c64 -- --build-config examples/san-golpe/mainscreen-test.metabasic.json --run-tests --profile release --printer-output --restart
npm run launch:spectrum -- --build-config examples/san-golpe/mainscreen-test.metabasic.json --run-tests --profile release --printer-output --restart
```
