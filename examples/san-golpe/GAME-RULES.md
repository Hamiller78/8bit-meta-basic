# San Golpe game rules and implementation

This document is the source of truth for San Golpe's game rules and their current implementation. Update it whenever a rule is added, changed, removed, or replaced in code.

Rules are labelled as follows:

- **Confirmed**: specified game design that the implementation should follow.
- **Supporting implementation**: data or interface behavior needed to realize a confirmed rule, but not itself a final gameplay decision.
- **Placeholder**: temporary playable logic that may be replaced. Placeholder behavior must not be presented as a confirmed rule.

## Cast and character generation

### Confirmed rules

The game contains twelve characters:

- two US agents controlled by the player;
- two Soviet agents;
- the President;
- the President's daughter;
- the Advisor;
- the General;
- the Priest;
- the Innkeeper;
- the Landowner; and
- the US tourist.

The President's daughter is the only female character. All other characters are male. Gender is implied by role and names; it is not stored as character data and is not selected randomly.

Characters receive a first name and family name appropriate to their nationality. American and Russian characters use male first-name pools. Native characters use the native male pool, except the daughter, who uses her own first-name pool. The daughter inherits the President's family name and does not consume a family name during initial character creation.

### Implementation

- `source/characters.mbas` defines the twelve-character array, nationalities, roles, the sparse agenda pool, and their fields. There is no gender field or gender enum.
- `source/characterfactory.mbas` creates the cast in a stable role order. The first two array entries are the player agents. It creates the daughter without taking a family name, then copies the President's family name to her.
- `source/characternames.mbas` contains native male names, daughter names, American male names, Russian male names, and the three family-name pools. Name selection starts at a random pool position and proceeds without repetition.
- `createCharacter(nationality, role)` returns the new zero-based character index, or `-1` if the character array or a required name pool is exhausted.

### Placeholder character state

New characters are alive, have integrity from 0 through 10, and initially follow `doDuty`. `doDuty` is represented by the absence of an agenda record and consumes no agenda slot. After the full cast is created, each character has a 75% chance to remain on duty; `usurpRole`, `findLove`, and `secretSpy` each have an equal share of the remaining 25%. At most three characters can receive a non-default agenda. Once those three sparse slots are occupied, remaining characters stay on duty. Usurpation and love choose another character as their target. The spy agenda has no target yet.

`Character` contains the character's name, role, living state, integrity, and one agenda-slot index. An index of `-1` means ordinary duty and no agenda record. A separate `CharacterAgenda` record contains the agenda kind, optional target, money, and weapons. Only three non-default agenda records are allocated; there is no twelve-entry parallel agenda array. Agenda access follows the slot index directly rather than scanning. Compared with storing four agenda values on all twelve characters, this reduces agenda-related numeric array entries from 48 to 24. Money and weapons exist only as resources for a non-default agenda.

The sparse pool is defined in `source/characters.mbas`. Assignment is implemented by `assignSecretAgendas()` and `chooseAgendaTarget()` in `source/characterfactory.mbas`.

## Player knowledge and the main view

### Supporting implementation

Player knowledge is stored separately from the true character data:

| Level | Meaning shown to the player |
| ---: | --- |
| 0 | Unknown; absent from the known-character directory |
| 1 | Discovered; name known |
| 2 | Integrity band known: low `0–3`, medium `4–7`, or high `8–10` |
| 3 | Agenda known |

Knowledge can only increase. `revealCharacter(index, level)` never lowers it. The two player agents begin at level 1; all other characters begin unknown.

The main view shows the budget, both player agents, their contacts and missions, and a compact `DISCOVERED` list. That list contains the first name of every discovered non-agent character and displays `None` when empty. The separate known-character directory lists every discovered character with their full name and all details permitted by the current knowledge level.

This is implemented in `source/intelligence.mbas` and `source/mainscreen.mbas`. Main-view behavior is covered by `tests/mainscreen-tests.mbas`.

## Agent action: Observe Location

### Confirmed rules

**Observe Location** discovers one random, previously unknown living character from the selected location's encounter table. Discovery means that the agents know enough about the character's habits to rediscover them at will, so the character is added to the known-character directory.

There are common and rare candidates. Each eligible common character has weight 3 and each eligible rare character has weight 1. Therefore, an individual common candidate is three times as likely to be selected as an individual rare candidate. Known or dead characters are excluded before the roll. If no eligible candidate remains, the agent reports no lead.

| Location | Common, weight 3 each | Rare, weight 1 each |
| --- | --- | --- |
| Republic's Palace | General, Advisor | President's daughter, Landowner |
| USSR Embassy | Both Soviet agents | None |
| Church | Priest | Any other San Golpe native with integrity above 3 |
| Pub | Innkeeper | Any other San Golpe native with integrity below 9, plus the US tourist |

The two US agents are not candidates because they execute the action. The President cannot be discovered with **Observe Location**.

The only locations are the Republic's Palace, USSR Embassy, Church, and Pub. Military HQ and Outside Town do not exist. Characters have no assigned or permanent location; these locations are encounter tables used only by observation.

An observation order persists each turn until the player changes the agent's mission.

### Implementation

`source/agentoperations.mbas` implements the rule without character-to-location state:

- `ObservationLocation` contains exactly the four encounter tables.
- `isSanGolpeNative()` identifies the native roles used by the Church and Pub conditions.
- `observationWeight()` applies eligibility, exclusion, integrity, and 3:1 weighting rules.
- `observationTotalWeight()` totals the current eligible weights.
- `observationCandidateAt()` converts a random weighted selection into a character.
- `resolveObservationMission()` rolls and `resolveObservationRoll()` reveals the selected character at name level.

The weighted pools, exclusions, and exhausted-pool behavior are covered by `tests/agentoperations-tests.mbas`.

## Current turn and interface flow

### Supporting implementation

The current program resolves both agents' existing missions, processes NPC actions, shows reports, and then opens the main view. The player can inspect people, change either agent's mission, or end the turn. Results from newly assigned missions appear at the start of the following turn.

This loop is implemented in `source/main.mbas`; menus and report rendering are in `source/mainscreen.mbas`.

## Placeholder mechanics

Everything in this section is temporary logic that keeps the game loop playable. It is not a confirmed game rule.

### Contacts and investigation

Both agents begin without contacts. Adding a contact also reveals that character's name. An investigation currently requires the agent to have any living contact and succeeds on a flat 50% roll. On success it advances the target's knowledge by one level. The order persists until the target's agenda is known, at which point the agent becomes idle.

The President can be investigated only when the agent has a living contact. Other living non-agent characters can currently be approached globally; there is no location check.

Implementation: contact arrays, `canApproach()`, `canInvestigate()`, `setAgentInvestigation()`, and `resolveInvestigationRoll()` in `source/agentoperations.mbas`.

### Deals and money

Money is measured in `k$`; one unit represents 1,000 US dollars. The starting budget is `1,000 k$`. A deal is a one-time order costing `10 k$` and asks one of the agent's living contacts for full information about a selected character.

The contact's integrity controls a ten-sided outcome roll. Integrity 0 never honors a deal and integrity 10 always honors it. A failed deal is either pocketed or diverted to the contact's own agenda, but both failures look identical to the player. Diverted money is stored only when the contact has a non-default agenda; a contact pursuing `usurpRole` also gains one weapons unit. A character on ordinary duty has no agenda storage, so diverted resources have no persistent gameplay effect.

Implementation: `setAgentDeal()`, `dealOutcomeFor()`, and `resolveDealRoll()` in `source/agentoperations.mbas`.

### Presidential politics

The President has a hidden economic value from 0, socialist, to 100, free market. It starts at 50 and is clamped to that range. Reports translate it into one of five qualitative bands rather than revealing the number.

For a Presidential report, all living native characters except the US agents, Soviet agents, and US tourist are treated as close enough to have an opinion. A reliable contact reports the correct band. A failed integrity roll moves the report one neighboring band in a random direction. For non-President targets, any living character can currently know about any other living character.

Implementation: `source/politics.mbas`, with report integration in `resolveInvestigationRoll()` in `source/agentoperations.mbas`.

### NPC actions

Only one NPC agenda currently produces an event: a character pursuing `findLove`, with money and a living target, runs away with that target and spends all their money. If both characters are discovered, their names are reported; otherwise the event is reported without names. Other agendas do nothing yet.

Implementation: `source/npclogic.mbas`.

## Test coverage

Focused configurations keep generated emulator test programs small:

- `characterfactory-test.metabasic.json` covers character and name generation.
- `agentoperations-test.metabasic.json` covers observation and the placeholder agent mechanics.
- `mainscreen-test.metabasic.json` covers the main view and discovered-character display.

When a confirmed rule changes, update its implementation, its focused tests, and this document together.
