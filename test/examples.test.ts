import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { build, loadBuildConfiguration } from "../src/build-configuration.js";
import { compileSource } from "../src/compiler.js";

describe("example programs", () => {
  it("compile for all targets", () => {
    const filenames = readdirSync("examples")
      .filter((filename) => filename.toLowerCase().endsWith(".mbas"))
      .sort();

    for (const filename of filenames) {
      const sourcePath = `examples/${filename}`;
      const source = readFileSync(sourcePath, "utf8");

      expect(compileSource(source, { filename: sourcePath, target: "spectrum", readability: 0 })).not.toHaveLength(0);
      expect(compileSource(source, { filename: sourcePath, target: "c64", readability: 0 })).not.toHaveLength(0);
      expect(compileSource(source, { filename: sourcePath, target: "atari800xl", readability: 0 })).not.toHaveLength(0);
    }
  });

  it("compiles the multi-file example build configuration for all targets", async () => {
    const configPath = "examples/multifile/metabasic.json";
    const configuration = await loadBuildConfiguration(configPath);

    await expect(build(configuration, { configPath, target: "spectrum", readability: 0 })).resolves.not.toHaveLength(0);
    await expect(build(configuration, { configPath, target: "c64", readability: 0 })).resolves.not.toHaveLength(0);
    await expect(build(configuration, { configPath, target: "atari800xl", readability: 0 })).resolves.not.toHaveLength(0);
  });

  it("compiles the instruction-suite project tests for all targets", async () => {
    const configuration = {
      testMode: true,
      files: [...projectFiles("examples/instruction-suite/source"), ...projectFiles("examples/instruction-suite/tests")]
    };

    await expect(build(configuration, { baseDir: process.cwd(), target: "spectrum", readability: 0 })).resolves.not.toHaveLength(0);
    await expect(build(configuration, { baseDir: process.cwd(), target: "c64", readability: 0 })).resolves.not.toHaveLength(0);
    await expect(build(configuration, { baseDir: process.cwd(), target: "atari800xl", readability: 0 })).resolves.not.toHaveLength(0);
  });

  it("compiles the narf2 project tests for all targets", async () => {
    const configuration = {
      testMode: true,
      files: [...projectFiles("examples/narf2/source"), ...projectFiles("examples/narf2/tests")]
    };

    await expect(build(configuration, { baseDir: process.cwd(), target: "spectrum", readability: 0 })).resolves.not.toHaveLength(0);
    await expect(build(configuration, { baseDir: process.cwd(), target: "c64", readability: 0 })).resolves.not.toHaveLength(0);
    await expect(build(configuration, { baseDir: process.cwd(), target: "atari800xl", readability: 0 })).resolves.not.toHaveLength(0);
  });
});

function projectFiles(directory: string): string[] {
  return readdirSync(directory)
    .filter((filename) => filename.toLowerCase().endsWith(".mbas"))
    .sort()
    .map((filename) => `${directory}/${filename}`);
}
