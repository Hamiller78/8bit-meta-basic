import { describe, expect, it } from "vitest";
import { build, loadBuildConfiguration } from "../src/build-configuration.js";

const configPath = "examples/eight-bits-below/metabasic.json";

describe("Eight Bits Below", () => {
  for (const target of ["spectrum", "atari800xl", "c64", "agon"] as const) {
    it(`compiles the game and native rule tests for ${target}`, async () => {
      const configuration = await loadBuildConfiguration(configPath);
      const game = await build(configuration, { configPath, target, readability: 0 });
      expect(game).toContain("EIGHT BITS BELOW");
      expect(game).not.toContain("ASSERT");
      for (const module of ["dungeon", "entrance"]) {
        const tests = await build({
          ...configuration,
          testMode: true,
          files: [...configuration.files, `tests/${module}-tests.mbas`]
        }, { configPath, target, readability: 0 });
        expect(tests).toContain("META CONTROL PROGRAM");
      }
    }, 30_000);
  }
});
