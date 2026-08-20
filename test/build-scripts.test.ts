import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
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
      args: ["-autostart", "{artifact}", "-autostart-warp"]
    });
  });

  it("configures the Spectrum emulator launch command", async () => {
    const config = JSON.parse(await readFile("scripts/tools.example.json", "utf8"));

    expect(config.spectrum.emulator).toMatchObject({
      name: "Fuse",
      args: ["-tape", "{artifact}", "-auto-play"]
    });
  });

  it("finds all configured emulator launch targets", async () => {
    const { configuredLaunchTargets } = await import("../scripts/launch-all.mjs");

    expect(
      configuredLaunchTargets({
        spectrum: { emulator: { path: "fuse" } },
        atari800xl: { emulator: { path: "" } },
        c64: { emulator: { path: "x64sc" } }
      }).map((entry: { target: string }) => entry.target)
    ).toEqual(["spectrum", "c64"]);
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
