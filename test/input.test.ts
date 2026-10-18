import { describe, expect, it } from "vitest";
import { compileSource } from "../src/compiler.js";
import { parseSource } from "../src/parser.js";

describe("INPUT", () => {
  it("parses scalar variables and scalar struct fields", () => {
    expect(parseSource("input name$, age, person.name$\n", "input.mbas").statements).toMatchObject([
      {
        kind: "input",
        targets: [
          { kind: "scalar", name: "name$" },
          { kind: "scalar", name: "age" },
          { kind: "struct-field", base: "person", field: "name$" }
        ]
      }
    ]);
  });

  it("renders native keyboard INPUT on every target and preserves integer coercion", () => {
    const source = [
      "struct Person",
      "name$(20)",
      "age%",
      "end struct",
      "dim person as Person",
      "input person.name$",
      "input person.age%"
    ].join("\n");

    const spectrum = compileSource(source, { filename: "input.mbas", target: "spectrum", readability: 2 });
    expect(spectrum).toContain("INPUT A$");
    expect(spectrum).toMatch(/INPUT MBT\d+/u);
    expect(spectrum).toMatch(/INPUT A\$\n\d+ PRINT ""/u);
    expect(spectrum).toMatch(/INPUT MBT\d+\n\d+ PRINT ""/u);
    expect(spectrum).toMatch(/LET PERSONAGEI=INT MBT\d+/u);

    const atari = compileSource(source, { filename: "input.mbas", target: "atari800xl", readability: 2 });
    expect(atari).toContain("DIM PERSONNAME$(255)");
    expect(atari).toContain("INPUT PERSONNAME$");
    expect(atari).toMatch(/PERSONAGEI=INT\(MBT\d+\)/u);

    const c64 = compileSource(source, { filename: "input.mbas", target: "c64", readability: 2 });
    expect(c64).toMatch(/INPUT [A-Z][A-Z0-9]?\$/u);
    expect(c64).toMatch(/[A-Z][A-Z0-9]?%=INT\([A-Z][A-Z0-9]?\)/u);

    const agon = compileSource(source, { filename: "input.mbas", target: "agon", readability: 2 });
    expect(agon).toContain("INPUT PERSON_NAME$");
    expect(agon).toMatch(/PERSON_AGE%=INT\(MBT\d+\)/u);
  });

  it("finishes the current output line after Spectrum INPUT", () => {
    const spectrum = compileSource('print "NAME";\ninput name$\nprint "DONE"\n', {
      filename: "input.mbas",
      target: "spectrum",
      readability: 2
    });

    expect(spectrum).toMatch(/PRINT "NAME";\n\d+ INPUT A\$\n\d+ PRINT ""\n\d+ PRINT "DONE"/u);
  });

  it("rejects constants, whole arrays, whole structs, and indexed targets for now", () => {
    expect(() => compileSource("const answer = 42\ninput answer\n", { filename: "input.mbas", target: "c64" }))
      .toThrow('Cannot INPUT into constant "answer".');
    expect(() => compileSource("dim values(2)\ninput values\n", { filename: "input.mbas", target: "atari800xl" }))
      .toThrow('Cannot INPUT a scalar value into array "values".');
    expect(() => parseSource("input values(0)\n", "input.mbas"))
      .toThrow("INPUT into array elements is not supported yet");
    expect(() => compileSource("struct Person\nage\nend struct\ndim person as Person\ninput person\n", { filename: "input.mbas", target: "spectrum" }))
      .toThrow('Cannot INPUT into whole struct value "person"; name a scalar field.');
  });
});
