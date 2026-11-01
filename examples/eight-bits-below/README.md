# Eight Bits Below

Press any key at the startup prompt. The program seeds its random-number
generator after the key press so emulator startup timing does not fix the seed.
The yellow `P` starts at the entrance. Use the direction keys on C64, VIC-20,
Atari, and Agon, or Q/A/O/P (up/down/left/right) on Spectrum. Walk over floor
tiles (`.`), through doors (`+`), and back onto the entrance (`<`). Walls block
movement. Reaching the exit (`>`) generates a new dungeon and places the player
at its entrance, preserving character stats. Atari uses the screen text colour
because its text mode does not support per-cell colours.

The dungeon has a `<` entrance on its left wall and a `>` exit on its right wall.
Both use independently selected random rows, excluding the corners. Splitting
walls leave a floor tile in front of existing openings so they stay accessible.

Run native tests one module at a time to fit the Atari test runner in memory:

```text
npm run launch -- atari2 --project examples/eight-bits-below --run-tests --module dungeon --profile release --printer-output
npm run launch -- atari2 --project examples/eight-bits-below --run-tests --module entrance --profile release --printer-output
npm run launch -- atari2 --project examples/eight-bits-below --run-tests --module characters --profile release --printer-output
```

Use the same module names with other configured target emulators.
