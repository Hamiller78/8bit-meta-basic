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
      expect(compileSource(source, { filename: sourcePath, target: "vic20", readability: 0 })).not.toHaveLength(0);
      expect(compileSource(source, { filename: sourcePath, target: "atari800xl", readability: 0 })).not.toHaveLength(0);
      expect(compileSource(source, { filename: sourcePath, target: "agon", readability: 0 })).not.toHaveLength(0);
    }
  });

  it("lays out the N.A.R.F. header according to the target screen width", () => {
    const sourcePath = "examples/narf.mbas";
    const source = readFileSync(sourcePath, "utf8");
    const agon = compileSource(source, { filename: sourcePath, target: "agon", readability: 0 });
    const c64 = compileSource(source, { filename: sourcePath, target: "c64", readability: 0 });
    const vic20 = compileSource(source, { filename: sourcePath, target: "vic20", readability: 0 });

    expect(agon).toContain(`TICKERTEXT$=TICKERTEXT$ + "${" ".repeat(64)}"`);
    expect(agon).not.toContain(`TICKERTEXT$=TICKERTEXT$ + "${" ".repeat(79)}"`);
    expect(c64).toContain('POKE 211,31:SYS 58732:PRINT "23:00:00";');
    expect(c64).toContain('PRINT "1983-11-06";');
    expect(c64).toContain("POKE 214,1:POKE 211,31");
    expect(c64).toContain('PRINT "23:";CHR$(48 + CL);CHR$(48 + V3);":";CHR$(48 + V4);CHR$(48 + V5);');
    expect(vic20).toContain('POKE 211,13:SYS 58759:PRINT "23:00:00";');
    expect(vic20).not.toContain("1983-11-06");
  });

  it("compiles the multi-file example build configuration for all targets", async () => {
    const configPath = "examples/multifile/metabasic.json";
    const configuration = await loadBuildConfiguration(configPath);

    await expect(build(configuration, { configPath, target: "spectrum", readability: 0 })).resolves.not.toHaveLength(0);
    await expect(build(configuration, { configPath, target: "c64", readability: 0 })).resolves.not.toHaveLength(0);
    await expect(build(configuration, { configPath, target: "atari800xl", readability: 0 })).resolves.not.toHaveLength(0);
  });

  it("compiles the computer-record file I/O example for all targets", async () => {
    const configPath = "examples/computer-records/metabasic.json";
    const configuration = await loadBuildConfiguration(configPath);

    await expect(build(configuration, { configPath, target: "spectrum", readability: 0 })).resolves.not.toHaveLength(0);
    await expect(build(configuration, { configPath, target: "c64", readability: 0 })).resolves.not.toHaveLength(0);
    await expect(build(configuration, { configPath, target: "atari800xl", readability: 0 })).resolves.not.toHaveLength(0);
    await expect(build(configuration, { configPath, target: "agon", readability: 0 })).resolves.not.toHaveLength(0);
  });

  it("compiles the narf2 project tests for all targets", async () => {
    const configuration = {
      testMode: true,
      files: [...projectFiles("examples/narf2/source"), ...projectFiles("examples/narf2/tests")]
    };

    await expect(build(configuration, { baseDir: process.cwd(), target: "spectrum", readability: 0 })).resolves.not.toHaveLength(0);
    await expect(build(configuration, { baseDir: process.cwd(), target: "c64", readability: 0 })).resolves.not.toHaveLength(0);
    await expect(build(configuration, { baseDir: process.cwd(), target: "atari800xl", readability: 0 })).resolves.not.toHaveLength(0);
  }, 120000);
});

function projectFiles(directory: string): string[] {
  return readdirSync(directory)
    .filter((filename) => filename.toLowerCase().endsWith(".mbas"))
    .sort()
    .map((filename) => `${directory}/${filename}`);
}
