# San Golpe game rules and implementation

This document is the source of truth for San Golpe's game rules and their current implementation. Update it whenever a rule is added, changed, removed, or replaced in code.

Rules are labelled as follows:

- **Confirmed**: specified game design that the implementation should follow.
- **Supporting implementation**: data or interface behavior needed to realize a confirmed rule, but not itself a final gameplay decision.
- **Placeholder**: temporary playable logic that may be replaced. Placeholder behavior must not be presented as a confirmed rule.

## Cast and character generation

### Confirmed rules

The game contains seven characters:

- the President;
- the President's daughter;
- the Advisor;
- the General;
- the Priest;
- the Innkeeper; and
- the Landowner.

USA and USSR operatives are not characters. Each country performs two actions per turn instead of having two named agent records in the character array.

The President's daughter is the only female character. All other characters are male. Gender is implied by role and names; it is not stored as character data and is not selected randomly.

Characters use the San Golpe male first-name pool, except the daughter, who uses her own first-name pool. The daughter inherits the President's family name and does not consume a family name during initial character creation. There are no English or Russian name pools.

### Implementation

- `source/characters.mbas` defines the seven-character array, roles, the sparse agenda pool, and their fields. Nationality and agent roles are not stored. There is no gender field or gender enum.
- `source/characterfactory.mbas` creates the seven local figures in a stable role order. It creates the daughter without taking a family name, then copies the President's family name to her.
- `source/characternames.mbas` contains only San Golpe male names, daughter names, and San Golpe family names. Name selection starts at a random pool position and proceeds without repetition.
- `createCharacter(role)` returns the new zero-based character index, or `-1` if the character array or a required name pool is exhausted.

### Placeholder character state

New characters are alive, have integrity from 0 through 10, and initially follow `doDuty`. `doDuty` is represented by the absence of an agenda record and consumes no agenda slot. After the full cast is created, each character has a 75% chance to remain on duty; `usurpRole`, `findLove`, and `secretSpy` each have an equal share of the remaining 25%. At most three characters can receive a non-default agenda. Once those three sparse slots are occupied, remaining characters stay on duty. Usurpation and love choose another character as their target. The spy agenda has no target yet.

`Character` contains the character's name, role, living state, integrity, and one agenda-slot index. An index of `-1` means ordinary duty and no agenda record. A separate `CharacterAgenda` record contains the agenda kind, optional target, money, and weapons. Only three non-default agenda records are allocated; there is no seven-entry parallel agenda array. Agenda access follows the slot index directly rather than scanning. Money and weapons exist only as resources for a non-default agenda.

The sparse pool is defined in `source/characters.mbas`. Assignment is implemented by `assignSecretAgendas()` and `chooseAgendaTarget()` in `source/characterfactory.mbas`.

## Player knowledge and the main view

### Supporting implementation

Player knowledge is stored separately from the true character data:

| Level | Meaning shown to the player |
| ---: | --- |
| 0 | Unknown; absent from the known-character directory |
| 1 | Discovered; name known |
| 2 | Observed; habits understood well enough to make contact |
| 3 | Integrity band known: low `0–3`, medium `4–7`, or high `8–10` |
| 4 | Agenda known |

Knowledge can only increase. `revealCharacter(index, level)` never lowers it. All characters begin at level 0. Their public identities are visible in the government overview, but a person enters the actionable known-character directory only after discovery.

The main view is a fixed 22-row character overview. The government is arranged as an organigram: the President appears above the General, daughter, and Advisor. A second group contains the Priest, Innkeeper, and Landowner. The screen uses plain positioned text for now, without drawn character boxes.

Each character entry has four rows: name, role, agenda, and player status. The identities of the public figures are known at game start even though their habits have not yet been discovered, so their names are always shown on the organigram. On 40-column targets a visible name is shown as first initial, a period, a space, and the family name. On 32-column targets only the family name is shown. Unrevealed agendas are shown as unknown. The status summarizes the highest useful player relationship state, including discovered, observed, assessed, known, contacted, or dead. Compact localized labels are limited to ten characters so the three-column groups fit on a 32-column screen.

The top row retains compact keys for the two USA action slots, known-character directory, and ending the turn, together with turn and budget. Row 18 shows the two actions available to each power and the target's currently free BASIC memory as a whole-KiB `RAM nK` value. The separate known-character directory lists every discovered character with their full name and all details permitted by the current knowledge level.

This is implemented in `source/intelligence.mbas` and `source/mainscreen.mbas`. Main-view behavior is covered by `tests/mainscreen-tests.mbas`.

## USA action: Observe Location

### Confirmed rules

**Observe Location** discovers one random, previously unknown living character from the selected location's encounter table. Discovery means that USA intelligence knows enough about the character's habits to rediscover them at will, so the character is added to the known-character directory.

There are common and rare candidates. Each eligible common character has weight 3 and each eligible rare character has weight 1. Therefore, an individual common candidate is three times as likely to be selected as an individual rare candidate. Known or dead characters are excluded before the roll. If no eligible candidate remains, the action reports no lead.

| Location | Common, weight 3 each | Rare, weight 1 each |
| --- | --- | --- |
| Republic's Palace | General, Advisor | President's daughter, Landowner |
| Church | Priest | Any other San Golpe native with integrity above 3 |
| Pub | Innkeeper | Any other San Golpe native with integrity below 9 |

The President cannot be discovered with **Observe Location**. Operatives of either power are not candidates because they are not characters.

The only locations are the Republic's Palace, Church, and Pub. The USSR Embassy, Military HQ, and Outside Town do not exist as observation locations. Characters have no assigned or permanent location; these locations are encounter tables used only by observation.

An observation order persists each turn until the player changes that USA action slot.

### Implementation

`source/agentoperations.mbas` implements the rule without character-to-location state:

- `ObservationLocation` contains exactly the three encounter tables.
- Every character is a San Golpe native, so the Church and Pub conditions can test integrity directly without nationality data.
- `observationWeight()` applies eligibility, exclusion, integrity, and 3:1 weighting rules.
- `observationTotalWeight()` totals the current eligible weights.
- `observationCandidateAt()` converts a random weighted selection into a character.
- `resolveObservationMission()` rolls and `resolveObservationRoll()` reveals the selected character at name level.

The weighted pools, exclusions, and exhausted-pool behavior are covered by `tests/agentoperations-tests.mbas`.

## USA action: Observe Character

### Confirmed rules

A discovered living character can be observed more closely. This raises player knowledge from name-known to the distinct observed level. It does not reveal the character's integrity and cannot raise knowledge beyond the observed level. Observed knowledge means USA intelligence understands the person's habits well enough to attempt contact.

### Implementation

**Observe Character** is a deterministic one-turn action. `setUsaObserveCharacter()` accepts only a living character whose knowledge is exactly `intelName`. `resolveCharacterObservationMission()` raises that character to `intelObserved`, reports the new intel, and returns the action slot to idle. It is implemented in `source/agentoperations.mbas` and exposed in `source/mainscreen.mbas`.

## Foreign-power actions

### Confirmed rules

USA and USSR each perform two actions per turn. These are action slots belonging to a country, not named agent characters. They have no names, character records, integrity, agendas, contacts, or entries in location encounter tables.

### Current implementation

The two USA action slots hold the orders previously assigned to player agents. Persistent orders continue to occupy a slot until changed; one-time orders return their slot to idle after resolution. The main view opens slots 1 and 2 directly and reports their results as USA action reports.

`numberOfUsaActions` and `numberOfUssrActions` both define the confirmed count of two. USSR action selection and resolution are not implemented yet because the USSR action list and effects have not been designed. No placeholder Soviet characters or missions are retained.

## Shared contacts

### Confirmed rules

The USA action slots share one contact directory. A person must have reached the observed intel level before a contact action can target them. Once a person becomes a cooperative contact, either USA action slot may use that contact.

Making contact may improve the player's intel about that person. The person may then demand a price for cooperating: money, weapons, or a favor. Integrity creates a deliberate tension: a high-integrity person is less willing to work for a foreign power, but information from a cooperative high-integrity contact is more reliable.

A character with a non-default agenda prefers payment that supports that agenda. Money or weapons paid to such a character become agenda resources and may trigger the agenda once its resource requirements are met. If the character has no agenda that can use the payment, the resources simply disappear from play. A favor is comparatively safe because it does not directly supply resources to any agenda.

A cooperative contact can provide information about characters in their vicinity, including the President. Most successful information should improve the target's intel level. A contact may sometimes uncover a target's agenda, but revealing an agenda requires an additional price.

Vicinity is a directional information relationship, not a permanent character location:

| Contact | Characters in their vicinity |
| --- | --- |
| General | President |
| Advisor | President |
| President's daughter | President |
| Priest | Other San Golpe natives with integrity above 5 |
| Innkeeper | Other San Golpe natives with integrity below 6 |

A contact is not considered to be in their own vicinity. Characters not listed as contacts in this table currently have nobody in their vicinity.

### Unresolved rule parameters

The following details must be decided before this contact flow replaces the placeholder mechanics:

- the chance that an initial contact attempt improves intel;
- how integrity determines refusal, cooperation, and whether a price is demanded;
- how the price type and amount are selected;
- how weapons are acquired and valued;
- how favors are represented, repaid, or called in later;
- which resource each agenda prefers and the threshold that triggers it;
- how integrity controls accurate, inaccurate, and failed reports;
- the chance and extra price for revealing an agenda; and
- whether cooperation is permanent or must be renewed for later information.

### Current supporting implementation

Contacts are stored in one `contacts%()` array with one shared `contactCount%`; there are no per-action contact arrays. Both USA action screens display the same shared contacts. This storage model can remain, but the current contact-resolution behavior is only a placeholder until the unresolved rules above are defined.

## Current turn and interface flow

### Supporting implementation

At the start of each turn, the current program updates the world coffee price, selects and applies one President event, resolves both USA action slots, and processes NPC actions. It then shows the NPC events, President event, and USA action reports before opening the main view. The player can inspect people, change either USA action, or end the turn. Results from newly assigned actions appear at the start of the following turn. USSR action resolution is still pending design.

Keys without an assigned main-view action, including Enter, are ignored and simply redraw the overview.

This loop is implemented in `source/main.mbas`; menus and report rendering are in `source/mainscreen.mbas`.

## President turn events

### Confirmed rules

At the start of every turn, the President performs one randomly selected event. Event probabilities depend on the President's socialism value, so the political direction of the President changes which events are more likely rather than merely changing their presentation.

Every event has player-facing text. An event may change the President's own statistics, the statistics of one or more other characters, or both. Event selection, presentation, and effects are separate concerns: selecting an event determines what happened, the text reports it, and the effect logic applies its state changes.

### Current implementation

The existing `presidentEconomy%` scale is retained: `0` is socialist and `100` is free market. The first President event occurs on turn 1. `source/presidentevents.mbas` keeps selection, effects, and presentation separate and provides deterministic entry points for tests.

The world coffee price is currently a hidden index from `0` to `100`, initially `50`. At the start of each turn it moves by a uniformly random amount from `-10` through `+10` and is clamped to its range. Prices at or below `25` are exceptionally low; prices at or above `75` are exceptionally high.

The initial example event table is:

| Event | Weight | Effect |
| --- | --- | --- |
| Praise Advisor or General | `10 + economy / 5` | Mentioned character integrity `+1` |
| Criticize Advisor or General | `10 + (100 - economy) / 5` | Mentioned character integrity `-1` |
| React to high coffee price | Eligible at price `75+`; weight `10 + economy / 2` | President economy `+5` toward free market |
| React to low coffee price | Eligible at price `25-`; weight `10 + (100 - economy) / 2` | President economy `-5` toward socialism |

Weights use integer division. Integrity is clamped to `0–10`; the President's economy and coffee price are clamped to `0–100`. Advisor and General are selected with equal probability when both are alive. Each event has localized English and German text.

The precise weights, thresholds, coffee movement, and stat changes are balancing placeholders. The event-system structure and its dependence on the retained economy scale are confirmed.

## Placeholder mechanics

Everything in this section is temporary logic that keeps the game loop playable. It is not a confirmed game rule.

### Contact resolution

**Make Contact** currently succeeds automatically as a one-turn action. `setUsaContact()` requires a living, observed character who is not already a contact. `resolveContactMission()` immediately adds that person to the shared directory, reports success, and returns the action slot to idle.

This does not yet implement possible intel improvement, refusal based on integrity, price negotiation, money/weapons/favor choices, agenda preferences, or agenda activation.

### Investigation

The shared directory begins empty. An investigation currently requires a living shared contact whose vicinity includes the observed living target, and succeeds on a flat 50% roll. On success it advances the target's knowledge by one level, from observed to rough integrity and then to agenda. The order persists until the target's agenda is known, at which point the action slot becomes idle.

The President can be investigated only when the shared directory contains a living contact. Other living characters can currently be approached globally; there is no location check.

Implementation: `canApproach()`, `canInvestigate()`, `setUsaInvestigation()`, and `resolveInvestigationRoll()` in `source/agentoperations.mbas`.

The implementation now enforces vicinity, but the flat-chance model does not yet distinguish report accuracy from report success or charge an extra price for agenda information.

### Deals and money

Money is measured in `k$`; one unit represents 1,000 US dollars. The starting budget is `1,000 k$`. A deal is a one-time order costing `10 k$` and asks one of the shared living contacts for full information about a selected character.

The contact's integrity controls a ten-sided outcome roll. Integrity 0 never honors a deal and integrity 10 always honors it. This is placeholder behavior and conflicts with the intended rule that high integrity makes cooperation with a foreign power less likely. A failed deal is either pocketed or diverted to the contact's own agenda, but both failures look identical to the player. Diverted money is stored only when the contact has a non-default agenda; a contact pursuing `usurpRole` also gains one weapons unit. A character on ordinary duty has no agenda storage, so diverted resources have no persistent gameplay effect.

Implementation: `setUsaDeal()`, `dealOutcomeFor()`, and `resolveDealRoll()` in `source/agentoperations.mbas`.

### Presidential politics

The President has a hidden economic value from 0, socialist, to 100, free market. It starts at 50 and is clamped to that range. Reports translate it into one of five qualitative bands rather than revealing the number.

For a Presidential report, only a living General, Advisor, or President's daughter can provide information. A reliable contact reports the correct band. A failed integrity roll moves the report one neighboring band in a random direction. Other targets use the Priest and Innkeeper integrity-based vicinity rules above.

Implementation: `source/politics.mbas`, with report integration in `resolveInvestigationRoll()` in `source/agentoperations.mbas`.

### NPC actions

Only one NPC agenda currently produces an event: a character pursuing `findLove`, with money and a living target, runs away with that target and spends all their money. If both characters are discovered, their names are reported; otherwise the event is reported without names. Other agendas do nothing yet.

Implementation: `source/npclogic.mbas`.

## Test coverage

Focused configurations keep generated emulator test programs small:

- `characterfactory-test.metabasic.json` covers character and name generation.
- `agentoperations-test.metabasic.json` covers observation and the placeholder USA action mechanics.
- `mainscreen-test.metabasic.json` covers the fixed main-view layout, width-dependent names, compact knowledge state, two independent USA action slots, and the known-character directory.
- `presidentevents-test.metabasic.json` covers event weighting, selection, effects, bounds, and text output.

When a confirmed rule changes, update its implementation, its focused tests, and this document together.

## Future design areas

The following ideas are intentionally not confirmed rules or placeholder mechanics yet. They should be designed as one connected political and economic loop before implementation:

- which additional President events exist and what each one changes;
- how the coffee price changes and influences the President's event probabilities or effects;
- how the coffee price influences the Landowner;
- what actions the Landowner takes;
- when the player should seek to replace the President;
- when the player should protect the President instead;
- how character agendas connect to political and economic developments;
- which more drastic foreign-power and NPC actions become available; and
- how character death works, including a later funeral event.

`Character.isAlive%` already distinguishes living and dead characters, but no general death mechanic or funeral event is implemented. These fields and future ideas must not be treated as settled rules until the surrounding systems are defined.
