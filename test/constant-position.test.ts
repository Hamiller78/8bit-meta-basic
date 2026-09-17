import { describe, expect, it } from "vitest";
import { compileSource } from "../src/compiler.js";

describe("compile-time cursor coordinates", () => {
  const source = "set_pos int(TEXT_ROWS / 2) + 2, int((TEXT_COLUMNS - 16) / 2) + 1\n";

  it("emits literal Spectrum coordinates", () => {
    expect(compileSource(source, { filename: "position.mbas", target: "spectrum", readability: 0 })).toBe('10 PRINT AT 12,8;"";\n');
  });

  it("emits literal Atari coordinates", () => {
    expect(compileSource(source, { filename: "position.mbas", target: "atari800xl", readability: 0 })).toBe('10 POSITION 12,13\n20 PRINT "";\n');
  });

  it("emits literal C64 coordinates", () => {
    expect(compileSource(source, { filename: "position.mbas", target: "c64", readability: 0 })).toBe('10 POKE 214,13\n20 POKE 211,12\n30 SYS 58732\n40 PRINT "";\n');
  });

  it("folds constant INT toward negative infinity but keeps variable INT at runtime", () => {
    for (const target of ["spectrum", "atari800xl", "c64"] as const) {
      const output = compileSource("print int(-1.2); int(value)\n", { filename: "int.mbas", target, readability: 0 });
      expect(output).toContain("PRINT -2;INT");
    }
  });
});
