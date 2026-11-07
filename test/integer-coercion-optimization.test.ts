import { describe, expect, it } from "vitest";
import { compileSource } from "../src/compiler.js";

describe("integer coercion optimization", () => {
  it.each(["spectrum", "atari800xl", "c64", "vic20", "agon"] as const)("omits only provably redundant coercions on %s", (target) => {
    const output = compileSource([
      "source% = -3",
      "destination% = (source%)",
      "destination% = sgn(value)",
      "destination% = 4",
      "destination% = -1.25",
      "destination% = value",
      "destination% = source% / 2"
    ].join("\n"), { filename: "integer-coercion.mbas", target, readability: 2 });

    expect(output).toMatch(/\bSGN\b/u);
    expect(output).toMatch(/INT\s*\(-1\.25\)/u);
    expect(output.match(/\bINT\b/gu)).toHaveLength(3);
  });
});
