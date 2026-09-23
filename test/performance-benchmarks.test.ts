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
});
