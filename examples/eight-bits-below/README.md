# Eight Bits Below

Press any key at the startup prompt. The program seeds its random-number
generator after the key press so emulator startup timing does not fix the seed.
The yellow `P` starts at the entrance. Use the direction keys on C64, VIC-20,
Atari, and Agon, or Q/A/O/P (up/down/left/right) on Spectrum. Walk over floor
tiles (`.`), through doors (`+`), and back onto the entrance (`<`). Walls block
movement. Reaching the exit (`>`) generates a new dungeon and places the player
at its entrance, preserving character stats. Only the entrance room is revealed
at first. Stepping onto a shared door reveals the next room, including its
walls and doors. Discovered rooms stay visible; doors further away do not reveal
their rooms until the player reaches them. Atari uses the screen text colour
because its text mode does not support per-cell colours.

The dungeon has a `<` entrance on its left wall and a `>` exit on its right wall.
Both use independently selected random rows, excluding the corners. Splitting
walls place an extra door in front of any existing opening they would block,
so adjacent rooms stay connected through doors rather than gaps in their walls.

Room coordinates and dimensions use integer fields (`x%`, `y%`, `width%`, and
`height%`). Every generated room starts with `isDiscovered% = FALSE`, including
when replacing a previous dungeon. Entrance placement and movement onto door
tiles discover rooms using `DiscoverRoomAt(row, column)`. This boundary-only
lookup reveals at most one new room
per call. `DrawDungeon()` clears the map area and redraws only discovered rooms,
preserving the controls below it. Dungeon parameters and
temporary coordinates use integers too; `FOR` counters remain ordinary numeric
variables because Meta-BASIC does not support integer loop variables yet.

`DrawRoom(roomIndex)` prints one room at its dungeon coordinates, including its
surrounding walls, doors, entrance, or exit. It reads the existing map and leaves
the discovery flag untouched. `DiscoverRoomAt` sets the flag before calling it.

Combat uses the same `character` struct for the player and monsters.
`InitBat(monsterIndex, row, column)` fills a monster slot with a bat (`B`):
2 health, 0 armor, 1 attack die, and speed 2. These are initial balancing values;
speed is stored for a future turn system. Bats are not yet spawned in the dungeon.

`RollAttackDamage(attackDice, armor)` rolls one six-sided die per attack die.
1–3 miss, 4–5 count as ordinary hits, and 6 counts as a critical hit worth one
damage that ignores armor. Damage is `criticalHits + max(0, ordinaryHits - armor)`;
armor applies once per attack. Zero attack dice cause no damage and consume no
random values. `AttackMonster(monsterIndex)` applies the player's attack to that
monster; `AttackPlayer(monsterIndex)` applies that monster's attack to the player.
Health stops at zero. Dead characters cannot attack or receive another attack.
These helpers update stored characters directly because struct parameters are
copied. Encounter handling and attack turns are not yet connected to movement.

The combat tests use `SET_RND` sequences to exercise complete attacks
deterministically on every target.

Run native tests one module at a time to fit the Atari test runner in memory:

```text
npm run launch -- atari2 --project examples/eight-bits-below --run-tests --module dungeon --profile release --printer-output
npm run launch -- atari2 --project examples/eight-bits-below --run-tests --module entrance --profile release --printer-output
npm run launch -- atari2 --project examples/eight-bits-below --run-tests --module characters --profile release --printer-output
npm run launch -- atari2 --project examples/eight-bits-below --run-tests --module combat --profile release --printer-output
npm run launch -- atari2 --project examples/eight-bits-below --run-tests --module room-state --profile release --printer-output
npm run launch -- atari2 --project examples/eight-bits-below --run-tests --module wall-doors --profile release --printer-output
npm run launch -- atari2 --project examples/eight-bits-below --run-tests --module draw-room --test-screen-output --profile release --printer-output
npm run launch -- atari2 --project examples/eight-bits-below --run-tests --module discovery --test-screen-output --profile release --printer-output
```

Use the same module names with other configured target emulators.
The `draw-room` and `discovery` tests require `--test-screen-output` because they inspect actual
screen cells, including sentinels outside the room that must remain unchanged.
