import { describe, expect, it } from "vitest";
import { compileSource } from "../src/compiler.js";

describe("comparison normalization", () => {
  for (const target of ["spectrum", "atari800xl", "c64", "vic20", "agon"] as const) {
    it(`uses comparison truth directly on ${target} while normalizing numeric operands`, () => {
      const output = compileSource(
        "result = (a < b) and v\nother = (a = b) or (a >= b)\n",
        { filename: "comparison-logic.mbas", target, readability: 2 }
      );
      expect(output).toContain("(A < B) AND ((V) <> 0)");
      expect(output).toContain("(A = B) OR (A >= B)");
    });
  }
});
