import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("build scripts", () => {
  it("creates Atari LST bytes with Atari line endings", async () => {
    const { toAtariListingBytes } = await import("../scripts/build-target.mjs");

    expect([...toAtariListingBytes("10 PRINT \"OK\"\r\n20 GOTO 10\n")]).toEqual([
      0x31,
      0x30,
      0x20,
      0x50,
      0x52,
      0x49,
      0x4e,
      0x54,
      0x20,
      0x22,
      0x4f,
      0x4b,
      0x22,
      0x9b,
      0x32,
      0x30,
      0x20,
      0x47,
      0x4f,
      0x54,
      0x4f,
      0x20,
      0x31,
      0x30,
      0x9b
    ]);
  });

  it("rejects non-ASCII text in Atari LST output for now", async () => {
    const { toAtariListingBytes } = await import("../scripts/build-target.mjs");

    expect(() => toAtariListingBytes("10 PRINT \"ä\"\n")).toThrow("ASCII");
  });

  it("creates Atari DOS-compatible filenames for disk directories", async () => {
    const { toAtariDosFileName } = await import("../scripts/build-target.mjs");

    expect(toAtariDosFileName("colors", "lst")).toBe("COLORS.LST");
    expect(toAtariDosFileName("long-example_name", "basic")).toBe("LONGEXAM.BAS");
    expect(toAtariDosFileName("narf", ".bas")).toBe("NARF.BAS");
  });

  it("configures Atari tokenization before ATR packaging", async () => {
    const config = JSON.parse(await readFile("scripts/tools.example.json", "utf8"));
    const tools = config.atari800xl.tools;

    expect(tools.map((tool: { name: string }) => tool.name)).toEqual(["basicParser", "dir2atr"]);
    expect(tools[0]).toMatchObject({
      inputArtifact: "basic",
      outputExtension: ".tokenized.bas",
      copyToArtifact: "atariDiskDirectory",
      copyExtension: "BAS"
    });
    expect(tools[1]).toMatchObject({
      inputArtifact: "atariDiskDirectory",
      outputExtension: ".atr"
    });
    expect(config.atari800xl.emulator).toMatchObject({
      name: "Altirra",
      testOutputDevice: "shared-drive",
      sharedDrivePath: "build/altirra_drive",
      sharedDriveOutputPath: "build/altirra_drive/MCP.TXT",
      args: ["{artifact}"],
      artifactArgs: {
        atr: ["/disk", "{artifact}"],
        "tokenized-bas": ["/runbas", "{artifact}"]
      }
    });
  });

  it("configures the C64 emulator launch command", async () => {
    const config = JSON.parse(await readFile("scripts/tools.example.json", "utf8"));

    expect(config.c64.emulator).toMatchObject({
      name: "x64sc",
      testOutputDevice: "rs232",
      args: ["-autostart", "{artifact}", "-autostart-warp"]
    });
  });

  it("configures C64 RS232 capture through a local endpoint", async () => {
    const config = JSON.parse(await readFile("scripts/tools.example.json", "utf8"));

    expect(config.c64.emulator.rs232OutputPath).toBe("build/rs232/{profile}/{target}/{sourceName}.txt");
    expect(config.c64.emulator.rs232Args).toContain("{rs232Endpoint}");
    expect(config.c64.emulator.rs232Args).not.toContain("{rs232Output}");
  });

  it("configures the Spectrum emulator launch command", async () => {
    const config = JSON.parse(await readFile("scripts/tools.example.json", "utf8"));

    expect(config.spectrum.emulator).toMatchObject({
      name: "Fuse",
      testOutputDevice: "text-printer",
      args: ["-tape", "{artifact}", "-auto-play"]
    });
  });

  it("finds all configured emulator launch targets", async () => {
    const { configuredLaunchTargets } = await import("../scripts/launch-all-targets.mjs");

    expect(
      configuredLaunchTargets({
        spectrum: { emulator: { path: "fuse" } },
        atari800xl: { emulator: { path: "" } },
        c64: { emulator: { path: "x64sc" } }
      }).map((entry: { target: string }) => entry.target)
    ).toEqual(["spectrum", "c64"]);
  });

  it("derives build artifact names from single sources and project configs", async () => {
    const { programIdentity } = await import("../scripts/build-target.mjs");

    expect(programIdentity(process.cwd(), "examples/colors.mbas").name).toBe("colors");
    expect(programIdentity(process.cwd(), "examples/colors.mbas", "examples/multifile/metabasic.json").name).toBe("multifile");
    expect(programIdentity(process.cwd(), "examples/colors.mbas", "examples/demo-build.json").name).toBe("demo-build");
    expect(programIdentity(process.cwd(), "examples/colors.mbas", undefined, "examples/project-demo").name).toBe("project-demo");
  });

  it("writes conventional project build configs for source and test mode", async () => {
    const { writeProjectBuildConfig } = await import("../scripts/build-target.mjs");
    const dir = await mkdtemp(join(tmpdir(), "mbas-project-"));

    await mkdir(join(dir, "demo", "source"), { recursive: true });
    await mkdir(join(dir, "demo", "tests"), { recursive: true });
    await writeFile(join(dir, "demo", "source", "main.mbas"), 'print "MAIN"\n', "utf8");
    await writeFile(join(dir, "demo", "source", "math.mbas"), "function Double(Value)\nreturn Value * 2\nend function\n", "utf8");
    await writeFile(join(dir, "demo", "tests", "math-tests.mbas"), "test DoubleWorks()\nassert_eq 8, Double(4)\nend test\n", "utf8");

    const sourceConfigPath = await writeProjectBuildConfig({ cwd: dir, projectPath: "demo", outDir: "build" });
    const testConfigPath = await writeProjectBuildConfig({ cwd: dir, projectPath: "demo", outDir: "build", testMode: true });
    const printerConfigPath = await writeProjectBuildConfig({ cwd: dir, projectPath: "demo", outDir: "build", testMode: true, testPrinterOutput: true, testOutputDevice: "rs232" });
    const sourceConfig = JSON.parse(await readFile(sourceConfigPath, "utf8"));
    const testConfig = JSON.parse(await readFile(testConfigPath, "utf8"));
    const printerConfig = JSON.parse(await readFile(printerConfigPath, "utf8"));

    expect(sourceConfig.testMode).toBe(false);
    expect(sourceConfig.files.map((file: string) => file.endsWith(".mbas"))).toEqual([true, true]);
    expect(testConfig.testMode).toBe(true);
    expect(testConfig.files).toHaveLength(3);
    expect(testConfig.files.at(-1)).toContain("math-tests.mbas");
    expect(printerConfig.testPrinterOutput).toBe(true);
    expect(printerConfig.testOutputDevice).toBe("rs232");
  });

  it("filters conventional project tests by module name", async () => {
    const { writeProjectBuildConfig } = await import("../scripts/build-target.mjs");
    const dir = await mkdtemp(join(tmpdir(), "mbas-project-module-"));

    await mkdir(join(dir, "demo", "source"), { recursive: true });
    await mkdir(join(dir, "demo", "tests"), { recursive: true });
    await writeFile(join(dir, "demo", "source", "main.mbas"), 'print "MAIN"\n', "utf8");
    await writeFile(join(dir, "demo", "source", "math.mbas"), "function Double(Value)\nreturn Value * 2\nend function\n", "utf8");
    await writeFile(join(dir, "demo", "tests", "math-tests.mbas"), "test MathWorks()\nassert_true 1\nend test\n", "utf8");
    await writeFile(join(dir, "demo", "tests", "ui-tests.mbas"), "test UiWorks()\nassert_true 1\nend test\n", "utf8");

    const testConfigPath = await writeProjectBuildConfig({ cwd: dir, projectPath: "demo", outDir: "build", testMode: true, moduleName: "math" });
    const testConfig = JSON.parse(await readFile(testConfigPath, "utf8"));

    expect(testConfig.files).toHaveLength(3);
    expect(testConfig.files.at(-1)).toContain("math-tests.mbas");
    expect(testConfig.files.join("\n")).not.toContain("ui-tests.mbas");
  });

  it("creates conventional project and module scaffolds without overwriting files", async () => {
    const { addModule, createProject } = await import("../scripts/scaffold-project.mjs");
    const dir = await mkdtemp(join(tmpdir(), "mbas-scaffold-"));

    await createProject({ cwd: dir, projectPath: "demo" });
    await addModule({ cwd: dir, projectPath: "demo", moduleName: "math" });

    expect(await readFile(join(dir, "demo", "source", "main.mbas"), "utf8")).toContain('print "DEMO"');
    expect(await readFile(join(dir, "demo", "tests", "main-tests.mbas"), "utf8")).toContain("test ProjectStarts()");
    expect(await readFile(join(dir, "demo", "source", "math.mbas"), "utf8")).toContain("function MathDouble(Value)");
    expect(await readFile(join(dir, "demo", "tests", "math-tests.mbas"), "utf8")).toContain("test MathDoubleWorks()");
    await expect(addModule({ cwd: dir, projectPath: "demo", moduleName: "math" })).rejects.toThrow("Refusing to overwrite existing file");
  });

  it("finds all Meta-BASIC sources in one directory", async () => {
    const { findMbasSources } = await import("../scripts/build-directory.mjs");
    const dir = await mkdtemp(join(tmpdir(), "mbas-dir-"));

    await writeFile(join(dir, "beta.MBAS"), "print \"B\"\n", "utf8");
    await writeFile(join(dir, "alpha.mbas"), "print \"A\"\n", "utf8");
    await writeFile(join(dir, "notes.txt"), "ignore me\n", "utf8");

    expect(await findMbasSources(".", { cwd: dir })).toEqual(["./alpha.mbas", "./beta.MBAS"]);
  });
});
