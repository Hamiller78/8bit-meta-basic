import { describe, expect, it } from "vitest";
import { parseSource } from "../src/parser.js";

describe("parser", () => {
  it("parses labels, PRINT, and backward GOTO", () => {
    expect(parseSource('start:\nprint "HI"\ngoto start\n', "test.mbas")).toEqual({
      statements: [
        { kind: "label", name: "start", location: { filename: "test.mbas", line: 1 } },
        { kind: "print", literal: '"HI"', location: { filename: "test.mbas", line: 2 } },
        { kind: "goto", label: "start", location: { filename: "test.mbas", line: 3 } }
      ]
    });
  });

  it("parses nested IF statements and optional ELSE blocks", () => {
    const program = parseSource(
      [
        "if outer then",
        "  if inner then",
        '    print "A"',
        "  end if",
        "else",
        '  print "B"',
        "end if"
      ].join("\n"),
      "nested.mbas"
    );

    expect(program.statements).toHaveLength(1);
    expect(program.statements[0]).toMatchObject({
      kind: "if",
      condition: "outer",
      thenBranch: [
        {
          kind: "if",
          condition: "inner",
          thenBranch: [{ kind: "print", literal: '"A"' }],
          elseBranch: []
        }
      ],
      elseBranch: [{ kind: "print", literal: '"B"' }]
    });
  });

  it("accepts case-insensitive keywords and preserves string literal contents", () => {
    const program = parseSource('PrInT "Warning: Don\'t Panic"\nGoTo Done\n', "case.mbas");

    expect(program.statements).toEqual([
      { kind: "print", literal: '"Warning: Don\'t Panic"', location: { filename: "case.mbas", line: 1 } },
      { kind: "goto", label: "Done", location: { filename: "case.mbas", line: 2 } }
    ]);
  });

  it("reports a missing END IF with the IF source line", () => {
    expect(() => parseSource("if confirmed then\n", "broken.mbas")).toThrow("broken.mbas:1: Missing END IF");
  });

  it("reports an unexpected ELSE", () => {
    expect(() => parseSource("else\n", "broken.mbas")).toThrow("broken.mbas:1: Unexpected ELSE");
  });
});
