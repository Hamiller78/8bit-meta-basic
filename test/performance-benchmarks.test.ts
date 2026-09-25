import { describe, expect, it } from "vitest";
import { build, loadBuildConfiguration } from "../src/build-configuration.js";

describe("performance benchmarks", () => {
  it("routes the Atari string-array results to the Altirra shared drive", async () => {
    const configPath = "performance-tests/string-arrays/atari.metabasic.json";
    const configuration = await loadBuildConfiguration(configPath);
    const output = await build(configuration, {
      configPath,
      target: "atari800xl",
      readability: 0,
      atariSharedDriveSpec: "H6:MCP.TXT"
    });

    expect(output).toContain('OPEN #1,8,0,"H6:MCP.TXT"');
    expect(output).toContain('PRINT #1;"STRING ARRAY PERFORMANCE"');
    expect(output).not.toContain('OPEN #1,8,0,"P:"');
  });

  it("builds BYTE and numerical comparison cases for every target", async () => {
    const configPath = "performance-tests/byte-arrays/metabasic.json";
    const configuration = await loadBuildConfiguration(configPath);
    for (const target of ["spectrum", "atari800xl", "c64"] as const) {
      const output = await build(configuration, { configPath, target, readability: 0 });
      expect(output).toContain("BYTE ARRAY PERFORMANCE");
      expect(output).toContain("BYTE READ WRITE");
      expect(output).toContain("NUMERIC READ WRITE");
      expect(output).toContain("BYTE CALCULATION");
      expect(output).toContain("NUMERIC CALCULATION");
    }
  });

  it("routes C64 BYTE benchmark results to RS232", async () => {
    const configPath = "performance-tests/byte-arrays/c64.metabasic.json";
    const configuration = await loadBuildConfiguration(configPath);
    const output = await build(configuration, { configPath, target: "c64", readability: 0 });

    expect(output).toContain("open 1,2,0,chr$(10)");
    expect(output).toContain('print#1,"BYTE ARRAY PERFORMANCE"');
    expect(output).not.toContain("open 1,4");
  });
});
