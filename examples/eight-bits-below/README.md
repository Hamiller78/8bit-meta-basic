# Eight Bits Below

The dungeon has a `<` entrance on its left wall and a `>` exit on its right wall.
Both use independently selected random rows, excluding the corners. Splitting
walls leave a floor tile in front of existing openings so they stay accessible.

Run native tests one module at a time to fit the Atari test runner in memory:

```text
npm run launch -- atari2 --project examples/eight-bits-below --run-tests --module dungeon --profile release --printer-output
npm run launch -- atari2 --project examples/eight-bits-below --run-tests --module entrance --profile release --printer-output
```

Use the same two module names with other configured target emulators.
