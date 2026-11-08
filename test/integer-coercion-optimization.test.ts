import { describe, expect, it } from "vitest";
import { compileSource } from "../src/compiler.js";

describe("integer coercion optimization", () => {
  it.each(["spectrum", "atari800xl", "c64", "vic20", "agon"] as const)("recognizes native integer array reads on %s", (target) => {
    const source = [
      "dim values%(2)", "dim ordinary(1)", "values%(0) = -3", "offset% = 1",
      "result% = values%(0)", "result% = values%(0) + offset%",
      "result% = values%(0) + 0.5", "result% = ordinary(0)"
    ].join("\n");
    const output = compileSource(source, { filename: "integer-array-coercion.mbas", target, readability: 2 });
    expect(output.match(/\bINT\b/gu)).toHaveLength(target === "spectrum" || target === "atari800xl" ? 4 : 2);
  });

  it.each(["spectrum", "atari800xl", "c64", "vic20", "agon"] as const)("recognizes native packed integer struct fields on %s", (target) => {
    const source = [
      "struct Bounds", "left%", "right%", "end struct", "dim boxes as Bounds(2)",
      "boxes(0).left% = -3", "boxes(0).right% = 4", "result% = boxes(0).left% + boxes(0).right%"
    ].join("\n");
    const output = compileSource(source, { filename: "integer-struct-coercion.mbas", target, readability: 2 });
    expect(output.match(/\bINT\b/gu)?.length ?? 0).toBe(target === "spectrum" || target === "atari800xl" ? 1 : 0);
  });

  it.each(["spectrum", "atari800xl", "c64", "vic20", "agon"] as const)("omits coercion of boolean BYTE writes on %s", (target) => {
    const output = compileSource("dim flags as byte(2)\nflags(0) = false\nflags(1) = true\n", {
      filename: "boolean-byte.mbas", target, readability: 2
    });
    expect(output).not.toMatch(/\bINT\b/u);
  });

  it.each(["spectrum", "atari800xl", "c64", "vic20", "agon"] as const)("omits coercion around boolean values on %s", (target) => {
    const source = [
      "flag% = true", "flag% = false", "flag% = left < right", "flag% = left >= right",
      "flag% = (left < right) and (right <> 0)", "flag% = left or right", "flag% = not left",
      "flag% = left + 0.5"
    ].join("\n");
    const output = compileSource(source, { filename: "boolean-coercion.mbas", target, readability: 2 });
    expect(output.match(/\bINT\b/gu)).toHaveLength(1);
    expect(output).toMatch(/\bAND\b/u);
    expect(output).toMatch(/\bOR\b/u);
  });

  it.each(["spectrum", "atari800xl", "c64", "vic20", "agon"] as const)("respects the target storage for READ and integer parameters on %s", (target) => {
    const source = [
      "data -1.25", "read source%", "destination% = source% - 1", "print Adjust(-1.25)",
      "function Adjust(value%)", "local result%", "result% = value% - 1", "return result%", "end function"
    ].join("\n");
    const output = compileSource(source, { filename: "integer-storage.mbas", target, readability: 2 });
    expect(output.match(/\bINT\b/gu)?.length ?? 0).toBe(target === "spectrum" || target === "atari800xl" ? 2 : 0);
  });

  it.each(["spectrum", "atari800xl", "c64", "vic20", "agon"] as const)("omits coercion around integer addition and subtraction on %s", (target) => {
    const output = compileSource([
      "source% = -3",
      "destination% = source% - 1",
      "destination% = (source% + 1) - sgn(value)",
      "destination% = int(value) + 1",
      "destination% = source% + value",
      "destination% = value - source%"
    ].join("\n"), { filename: "integer-arithmetic.mbas", target, readability: 2 });

    // Spectrum and Atari may store fractions in integer-named variables through READ or parameters.
    expect(output.match(/\bINT\b/gu)).toHaveLength(target === "spectrum" || target === "atari800xl" ? 5 : 3);
    expect(output).toMatch(/\bSGN\b/u);
  });

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
    expect(output.match(/\bINT\b/gu)).toHaveLength(target === "spectrum" || target === "atari800xl" ? 4 : 3);
  });
});
