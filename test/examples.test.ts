import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
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
});
