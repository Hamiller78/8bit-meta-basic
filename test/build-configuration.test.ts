import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { build, compileBuildConfiguration, loadBuildConfiguration } from "../src/build-configuration.js";
import { compileSource } from "../src/compiler.js";

describe("build configuration", () => {
  it("combines two files in configured order", async () => {
    await withTempProject(async (dir) => {
      await writeFile(join(dir, "main.mbas"), 'print "MAIN"\n', "utf8");
      await writeFile(join(dir, "ui.mbas"), 'print "UI"\n', "utf8");

      await expect(compileBuildConfiguration({ files: ["main.mbas", "ui.mbas"] }, { baseDir: dir, target: "spectrum", readability: 0 })).resolves.toBe(
        ['10 PRINT "MAIN"', '20 PRINT "UI"', ""].join("\n")
      );
    });
  });

  it("preserves configured order for three or more files", async () => {
    await withTempProject(async (dir) => {
      await writeFile(join(dir, "main.mbas"), 'print "ONE"\n', "utf8");
      await writeFile(join(dir, "game.mbas"), 'print "TWO"\n', "utf8");
      await writeFile(join(dir, "ui.mbas"), 'print "THREE"\n', "utf8");

      await expect(
        compileBuildConfiguration({ files: ["main.mbas", "game.mbas", "ui.mbas"] }, { baseDir: dir, target: "spectrum", readability: 0 })
      ).resolves.toBe(['10 PRINT "ONE"', '20 PRINT "TWO"', '30 PRINT "THREE"', ""].join("\n"));
    });
  });

  it("allows a function defined in a later file to be called from an earlier file", async () => {
    await withTempProject(async (dir) => {
      await writeFile(join(dir, "main.mbas"), "score = addBonus(10, 5)\nprint score\n", "utf8");
      await writeFile(join(dir, "math.mbas"), "function addBonus(score, bonus)\nreturn score + bonus\nend function\n", "utf8");

      const output = await compileBuildConfiguration({ files: ["main.mbas", "math.mbas"] }, { baseDir: dir, target: "spectrum", readability: 0 });

      expect(output).toContain("GO SUB");
      expect(output).toContain("LET SCORE=MBT1");
      expect(output).toContain("LET MBF1R=MBF1P1 + MBF1P2");
    });
  });

  it("allows functions in different files to call one another", async () => {
    await withTempProject(async (dir) => {
      await writeFile(join(dir, "main.mbas"), "total = outer(5)\nprint total\n", "utf8");
      await writeFile(join(dir, "outer.mbas"), "function outer(value)\nreturn inner(value) + 1\nend function\n", "utf8");
      await writeFile(join(dir, "inner.mbas"), "function inner(value)\nreturn value * 2\nend function\n", "utf8");

      const output = await compileBuildConfiguration({ files: ["main.mbas", "outer.mbas", "inner.mbas"] }, { baseDir: dir, target: "spectrum", readability: 0 });

      expect(output).toContain("LET MBF1R=MBT2 + 1");
      expect(output).toContain("LET MBF2R=MBF2P1 * 2");
    });
  });

  it("keeps FUNCTION and LOCAL lowering working across file boundaries", async () => {
    await withTempProject(async (dir) => {
      await writeFile(join(dir, "main.mbas"), "result = 999\ntotal = addBonus(1, 2)\nprint result; total\n", "utf8");
      await writeFile(join(dir, "functions.mbas"), "function addBonus(score, bonus)\nlocal result\nresult = score + bonus\nreturn result\nend function\n", "utf8");

      const output = await compileBuildConfiguration({ files: ["main.mbas", "functions.mbas"] }, { baseDir: dir, target: "spectrum", readability: 0 });

      expect(output).toContain("LET RESULT=999");
      expect(output).toContain("LET MBF1L1=MBF1P1 + MBF1P2");
      expect(output).toContain("LET MBF1R=MBF1L1");
    });
  });

  it("keeps file boundaries from merging adjacent lines", async () => {
    await withTempProject(async (dir) => {
      await writeFile(join(dir, "main.mbas"), 'print "A"', "utf8");
      await writeFile(join(dir, "next.mbas"), 'print "B"', "utf8");

      await expect(compileBuildConfiguration({ files: ["main.mbas", "next.mbas"] }, { baseDir: dir, target: "spectrum", readability: 0 })).resolves.toBe(
        ['10 PRINT "A"', '20 PRINT "B"', ""].join("\n")
      );
    });
  });

  it("resolves relative paths from the build configuration file", async () => {
    await withTempProject(async (dir) => {
      await mkdir(join(dir, "project", "src"), { recursive: true });
      const configPath = join(dir, "project", "metabasic.json");
      await writeFile(configPath, JSON.stringify({ files: ["src/main.mbas", "src/ui.mbas"] }), "utf8");
      await writeFile(join(dir, "project", "src", "main.mbas"), 'print "MAIN"\n', "utf8");
      await writeFile(join(dir, "project", "src", "ui.mbas"), 'print "UI"\n', "utf8");

      const configuration = await loadBuildConfiguration(configPath);

      await expect(build(configuration, { configPath, target: "spectrum", readability: 0 })).resolves.toBe(['10 PRINT "MAIN"', '20 PRINT "UI"', ""].join("\n"));
    });
  });

  it("loads testMode from build configuration JSON", async () => {
    await withTempProject(async (dir) => {
      const configPath = join(dir, "metabasic.json");
      await writeFile(configPath, JSON.stringify({ testMode: true, files: ["tests.mbas"] }), "utf8");
      await writeFile(join(dir, "tests.mbas"), "test Smoke()\nassert_true 1\nend test\n", "utf8");

      const configuration = await loadBuildConfiguration(configPath);
      const output = await build(configuration, { configPath, target: "spectrum", readability: 0 });

      expect(configuration.testMode).toBe(true);
      expect(output).toContain('PRINT "TESTS: ";MBTESTS');
    });
  });

  it("loads printer-output test runner mode from build configuration JSON", async () => {
    await withTempProject(async (dir) => {
      const configPath = join(dir, "metabasic.json");
      await writeFile(configPath, JSON.stringify({ testMode: true, testPrinterOutput: true, testOutputDevice: "rs232", files: ["tests.mbas"] }), "utf8");
      await writeFile(join(dir, "tests.mbas"), "test Smoke()\nassert_true 1\nend test\n", "utf8");

      const configuration = await loadBuildConfiguration(configPath);
      const output = await build(configuration, { configPath, target: "c64", readability: 0 });

      expect(configuration.testPrinterOutput).toBe(true);
      expect(configuration.testOutputDevice).toBe("rs232");
      expect(output).toContain("OPEN 1,2,0,CHR$(6)");
      expect(output).toContain('PRINT#1,"META CONTROL PROGRAM (M.C.P.) RUN STARTED"');
    });
  });

  it("reports missing and unreadable source paths", async () => {
    await withTempProject(async (dir) => {
      await mkdir(join(dir, "not-a-file"));

      await expect(compileBuildConfiguration({ files: ["missing.mbas"] }, { baseDir: dir, target: "spectrum" })).rejects.toThrow(
        "Configured source file not found: missing.mbas."
      );
      await expect(compileBuildConfiguration({ files: ["not-a-file"] }, { baseDir: dir, target: "spectrum" })).rejects.toThrow(
        "Configured source path is not a readable file: not-a-file."
      );
    });
  });

  it("reports empty and invalid build configurations", async () => {
    await withTempProject(async (dir) => {
      const emptyPath = join(dir, "empty.json");
      const invalidPath = join(dir, "invalid.json");
      const badJsonPath = join(dir, "bad-json.json");
      await writeFile(emptyPath, JSON.stringify({ files: [] }), "utf8");
      await writeFile(invalidPath, JSON.stringify({ files: "main.mbas" }), "utf8");
      await writeFile(badJsonPath, "{", "utf8");

      await expect(loadBuildConfiguration(emptyPath)).rejects.toThrow('"files" must contain at least one source file');
      await expect(loadBuildConfiguration(invalidPath)).rejects.toThrow('"files" must be an array of source file paths');
      await writeFile(join(dir, "bad-test-mode.json"), JSON.stringify({ testMode: "yes", files: ["main.mbas"] }), "utf8");
      await expect(loadBuildConfiguration(join(dir, "bad-test-mode.json"))).rejects.toThrow('"testMode" must be a boolean');
      await writeFile(join(dir, "bad-printer-output.json"), JSON.stringify({ testPrinterOutput: "yes", files: ["main.mbas"] }), "utf8");
      await expect(loadBuildConfiguration(join(dir, "bad-printer-output.json"))).rejects.toThrow('"testPrinterOutput" must be a boolean');
      await writeFile(join(dir, "bad-test-device.json"), JSON.stringify({ testOutputDevice: "modem", files: ["main.mbas"] }), "utf8");
      await expect(loadBuildConfiguration(join(dir, "bad-test-device.json"))).rejects.toThrow('"testOutputDevice" must be "printer" or "rs232"');
      await expect(loadBuildConfiguration(badJsonPath)).rejects.toThrow("Invalid JSON");
      await expect(loadBuildConfiguration(join(dir, "missing.json"))).rejects.toThrow("Build configuration file not found");
    });
  });

  it("preserves existing single-file compilation", () => {
    expect(compileSource('print "OK"\n', { filename: "single.mbas", target: "spectrum", readability: 0 })).toBe(['10 PRINT "OK"', ""].join("\n"));
  });
});

async function withTempProject(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "mbas-build-"));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
