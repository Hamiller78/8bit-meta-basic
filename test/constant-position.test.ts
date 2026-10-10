import { describe, expect, it } from "vitest";
import { compileSource } from "../src/compiler.js";

describe("compile-time cursor coordinates", () => {
  const source = "set_pos int(TEXT_ROWS / 2) + 2, int((TEXT_COLUMNS - 16) / 2) + 1\n";

  it("emits literal Spectrum coordinates", () => {
    expect(compileSource(source, { filename: "position.mbas", target: "spectrum", readability: 0 })).toBe("10 PRINT AT 12,8;\n");
  });

  it("emits literal Atari coordinates", () => {
    expect(compileSource(source, { filename: "position.mbas", target: "atari800xl", readability: 0 })).toBe("10 POSITION 12,13\n");
  });

  it("emits literal C64 coordinates", () => {
    expect(compileSource(source, { filename: "position.mbas", target: "c64", readability: 0 })).toBe("10 POKE 214,13:POKE 211,12:SYS 58732\n");
  });

  it("sets only the current column on every target", () => {
    const columnSource = "set_column int((TEXT_COLUMNS - 16) / 2) + 1\n";
    expect(compileSource(columnSource, { filename: "column.mbas", target: "spectrum", readability: 0 })).toBe(
      "10 PRINT AT 24-PEEK 23689,8;\n"
    );
    expect(compileSource(columnSource, { filename: "column.mbas", target: "atari800xl", readability: 0 })).toBe(
      "10 POKE 85,12\n"
    );
    expect(compileSource(columnSource, { filename: "column.mbas", target: "c64", readability: 0 })).toBe(
      "10 POKE 211,12\n"
    );
  });

  it("checks constant SET_COLUMN coordinates against each target", () => {
    expect(() => compileSource("set_column 33\n", { filename: "column.mbas", target: "spectrum" })).toThrow(
      "Spectrum SET_COLUMN column coordinate 33 is outside the supported range 1..32"
    );
    expect(() => compileSource("set_column 41\n", { filename: "column.mbas", target: "atari800xl" })).toThrow(
      "Atari 800XL SET_COLUMN column coordinate 41 is outside the supported range 1..40"
    );
    expect(() => compileSource("set_column 0\n", { filename: "column.mbas", target: "c64" })).toThrow(
      "C64 SET_COLUMN column coordinate 0 is outside the supported range 1..40"
    );
  });

  it("folds constant INT toward negative infinity but keeps variable INT at runtime", () => {
    for (const target of ["spectrum", "atari800xl", "c64"] as const) {
      const output = compileSource("print int(-1.2); int(value)\n", { filename: "int.mbas", target, readability: 0 });
      expect(output).toContain("PRINT -2;INT");
    }
  });
});
