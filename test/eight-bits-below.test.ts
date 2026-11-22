import { describe, expect, it } from "vitest";
import { build, loadBuildConfiguration } from "../src/build-configuration.js";

const configPath = "examples/eight-bits-below/metabasic.json";
const targets = ["spectrum", "atari800xl", "c64", "vic20", "agon"] as const;
const modules = ["dungeon", "entrance", "characters", "room-state", "wall-doors", "draw-room", "discovery", "combat", "spawn", "pursuit", "turns", "exit", "inventory", "campaign"] as const;
const screenModules: readonly string[] = ["draw-room", "discovery", "spawn", "turns", "exit"];

describe("Eight Bits Below", () => {
  for (const target of targets) {
    it(`compiles the game for ${target}`, async () => {
      const configuration = await loadBuildConfiguration(configPath);
      const game = await build(configuration, { configPath, target, readability: 0 });
      expect(game).toContain("EIGHT BITS BELOW");
      expect(game).not.toContain("ASSERT");
    }, 120_000);

    for (const module of modules) {
      it(`compiles ${module} native rule tests for ${target}`, async () => {
        const configuration = await loadBuildConfiguration(configPath);
        const tests = await build({
          ...configuration,
          testMode: true,
          ...(screenModules.includes(module) ? { testScreenOutput: true } : {}),
          files: [...configuration.files, `tests/${module}-tests.mbas`]
        }, { configPath, target, readability: 0 });
        expect(tests).toContain("META CONTROL PROGRAM");
      }, 120_000);
    }
  }
});
