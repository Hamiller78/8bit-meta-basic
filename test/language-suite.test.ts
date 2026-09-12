import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { build, loadBuildConfiguration } from "../src/build-configuration.js";

describe("Meta-BASIC language conformance suite", () => {
  it("compiles for every target and selects the mixed C64 character set", async () => {
    const configPath = "language-tests/instruction-suite/metabasic.json";
    const projectConfiguration = await loadBuildConfiguration(configPath);
    const configuration = {
      ...projectConfiguration,
      testMode: true,
      files: [...projectConfiguration.files, ...testFiles()]
    };

    await expect(build(configuration, { configPath, target: "spectrum", readability: 0 })).resolves.not.toHaveLength(0);
    await expect(build(configuration, { configPath, target: "atari800xl", readability: 0 })).resolves.not.toHaveLength(0);

    const c64 = await build(configuration, { configPath, target: "c64", readability: 0 });
    expect(c64).toMatch(/^10 print chr\$\(14\);/u);
    expect(c64).toContain("META CONTROL PROGRAM");
  });
});

function testFiles(): string[] {
  return readdirSync("language-tests/instruction-suite/tests")
    .filter((filename) => filename.toLowerCase().endsWith(".mbas"))
    .sort()
    .map((filename) => `tests/${filename}`);
}
