import { describe, expect, it } from "vitest";
import { compileSource } from "../src/compiler.js";

const arraySource = [
  "dim values as byte(4)",
  "values(0) = 65",
  "values(1) = values(0) + 1",
  "print values(1)"
].join("\n");

describe("BYTE storage", () => {
  it("uses character storage and numeric conversions on Spectrum", () => {
    const output = compileSource(arraySource, { filename: "byte.mbas", target: "spectrum", readability: 2 });
    expect(output).toContain("DIM V$(4)");
    expect(output).toContain("V$(1)=CHR$ (INT (65))");
    expect(output).toContain("CODE (V$(1)) + 1");
    expect(output).toContain("PRINT CODE (V$(2))");
  });

  it("uses character storage and numeric conversions on Atari", () => {
    const output = compileSource(arraySource, { filename: "byte.mbas", target: "atari800xl", readability: 2 });
    expect(output).toContain("DIM VALUESMBBYTE$(4)");
    expect(output).toContain("VALUESMBBYTE$(0 + 1,0 + 1)=CHR$(INT(65))");
    expect(output).toContain("ASC(VALUESMBBYTE$(0 + 1,0 + 1)) + 1");
    expect(output).toContain("PRINT ASC(VALUESMBBYTE$(1 + 1,1 + 1))");
  });

  it("uses native integer arrays on C64", () => {
    const output = compileSource(arraySource, { filename: "byte.mbas", target: "c64", readability: 2 });
    expect(output).toContain("DIM VA%(3)");
    expect(output).toContain("VA%(0)=INT(65)");
    expect(output).toContain("VA%(1)=INT(VA%(0) + 1)");
    expect(output).toContain("PRINT VA%(1)");
  });

  it("uses compact BYTE backing storage in scalar structs and struct arrays", () => {
    const source = [
      "struct Item",
      "  state as byte",
      "  priority as byte",
      "  score",
      "end struct",
      "dim item as Item",
      "dim items as Item(3)",
      "item.state = 7",
      "items(0).priority = item.state + 1",
      "print items(0).priority"
    ].join("\n");

    const spectrum = compileSource(source, { filename: "struct-byte.mbas", target: "spectrum", readability: 2 });
    expect(spectrum).toMatch(/DIM [A-Z]\$\(3\)/);
    expect(spectrum).toContain("CHR$");
    expect(spectrum).toContain("CODE");

    const atari = compileSource(source, { filename: "struct-byte.mbas", target: "atari800xl", readability: 2 });
    expect(atari).toContain("DIM ITEMSSTATEMBBYTE$(3)");
    expect(atari).toContain("DIM ITEMSPRIORITYMBBYTE$(3)");
    expect(atari).toContain("ASC(");

    const c64 = compileSource(source, { filename: "struct-byte.mbas", target: "c64", readability: 2 });
    expect(c64).toMatch(/DIM [A-Z0-9]{1,2}%\(2,1\)/);
    expect(c64).not.toContain("CHR$(");
  });

  it("rejects invalid BYTE declarations and constant values", () => {
    expect(() => compileSource("dim values as byte(2, 2)\n", { filename: "byte.mbas", target: "c64" }))
      .toThrow("supports a scalar or exactly one element-count dimension");
    expect(() => compileSource("dim values as byte(2)\nvalues(0) = 256\n", { filename: "byte.mbas", target: "c64" }))
      .toThrow("outside the supported range 0..255");
    expect(() => compileSource("dim values as byte(2)\nvalues(0) = 1.5\n", { filename: "byte.mbas", target: "c64" }))
      .toThrow("outside the supported range 0..255");
  });

  it("supports compact scalar BYTE storage", () => {
    const source = "dim value as byte\nvalue = 4\nvalue = value + 1\nprint value\n";
    expect(compileSource(source, { filename: "scalar-byte.mbas", target: "spectrum", readability: 2 })).toMatch(/PRINT CODE [A-Z]\$/);
    expect(compileSource(source, { filename: "scalar-byte.mbas", target: "atari800xl", readability: 2 })).toContain("PRINT ASC(VALUEMBBYTE$)");
    expect(compileSource(source, { filename: "scalar-byte.mbas", target: "c64", readability: 2 })).toContain("PRINT VA%");
  });

  it("keeps BYTE storage distinct from a string with the same base name", () => {
    const source = "dim value as byte\nvalue$ = \"TEXT\"\nvalue = 65\nprint value; value$\n";
    const spectrum = compileSource(source, { filename: "byte-name.mbas", target: "spectrum", readability: 2 });
    const assignedStrings = [...spectrum.matchAll(/LET ([A-Z]\$)=/g)].map((match) => match[1]);
    expect(new Set(assignedStrings).size).toBe(2);

    const atari = compileSource(source, { filename: "byte-name.mbas", target: "atari800xl", readability: 2 });
    expect(atari).toContain("VALUEMBBYTE$");
    expect(atari).toContain("VALUE$");
  });
});
