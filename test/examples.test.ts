import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compileSource } from "../src/compiler.js";

describe("example programs", () => {
  it("compiles the input demo for all targets", () => {
    const source = readFileSync("examples/input-demo.mbas", "utf8");

    expect(compileSource(source, { filename: "examples/input-demo.mbas", target: "spectrum", readability: 0 })).toContain("INKEY$");
    expect(compileSource(source, { filename: "examples/input-demo.mbas", target: "c64", readability: 0 })).toContain("GET");
    expect(compileSource(source, { filename: "examples/input-demo.mbas", target: "atari800xl", readability: 0 })).toContain("PEEK(764)");
  });
});
