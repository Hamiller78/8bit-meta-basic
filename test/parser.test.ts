import { describe, expect, it } from "vitest";
import { parseSource } from "../src/parser.js";

describe("parser", () => {
  it("parses labels, PRINT, and backward GOTO", () => {
    expect(parseSource('start:\nprint "HI"\ngoto start\n', "test.mbas")).toMatchObject({
      statements: [
        { kind: "label", name: "start", location: { filename: "test.mbas", line: 1, column: 1 } },
        {
          kind: "print",
          items: [{ kind: "string", value: "HI", location: { filename: "test.mbas", line: 2, column: 7 } }],
          trailingSemicolon: false,
          location: { filename: "test.mbas", line: 2, column: 1 }
        },
        { kind: "goto", label: "start", location: { filename: "test.mbas", line: 3, column: 1 } }
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
      condition: { kind: "identifier", name: "outer" },
      thenBranch: [
        {
          kind: "if",
          condition: { kind: "identifier", name: "inner" },
          thenBranch: [{ kind: "print", items: [{ kind: "string", value: "A" }] }],
          elseBranch: []
        }
      ],
      elseBranch: [{ kind: "print", items: [{ kind: "string", value: "B" }] }]
    });
  });

  it("accepts case-insensitive keywords and preserves string literal contents", () => {
    const program = parseSource('PrInT "Warning: Don\'t Panic"\nGoTo Done\n', "case.mbas");

    expect(program.statements).toMatchObject([
      { kind: "print", items: [{ kind: "string", value: "Warning: Don't Panic" }] },
      { kind: "goto", label: "Done" }
    ]);
  });

  it("accepts ENDIF as an END IF spelling", () => {
    const program = parseSource('if confirmed then\nprint "YES"\nendif\n', "endif.mbas");

    expect(program.statements).toMatchObject([
      {
        kind: "if",
        condition: { kind: "identifier", name: "confirmed" },
        thenBranch: [{ kind: "print", items: [{ kind: "string", value: "YES" }] }],
        elseBranch: []
      }
    ]);
  });

  it("parses const, assignment, print items, and expression precedence", () => {
    const program = parseSource(
      [
        "const rows = 24",
        "urgency = sensorCount * 2 + alertLevel",
        'print "SECONDS: "; urgency;'
      ].join("\n"),
      "expr.mbas"
    );

    expect(program.statements).toMatchObject([
      { kind: "const", name: "rows", expression: { kind: "number", value: 24 } },
      {
        kind: "let",
        name: "urgency",
        expression: {
          kind: "binary",
          operator: "+",
          left: { kind: "binary", operator: "*", left: { kind: "identifier", name: "sensorCount" }, right: { kind: "number", value: 2 } },
          right: { kind: "identifier", name: "alertLevel" }
        }
      },
      {
        kind: "print",
        trailingSemicolon: true,
        items: [{ kind: "string", value: "SECONDS: " }, { kind: "identifier", name: "urgency" }]
      }
    ]);
  });

  it("parses parentheses as expression grouping", () => {
    const program = parseSource("total = (a + b) * 2\n", "group.mbas");
    expect(program.statements).toMatchObject([
      {
        kind: "let",
        expression: {
          kind: "binary",
          operator: "*",
          left: { kind: "parenthesized", expression: { kind: "binary", operator: "+" } },
          right: { kind: "number", value: 2 }
        }
      }
    ]);
  });

  it("does not accept LET as assignment syntax", () => {
    expect(() => parseSource("let urgency = 1\n", "legacy-let.mbas")).toThrow(
      'legacy-let.mbas:1: Unsupported or invalid syntax near "let"'
    );
  });

  it("parses PRINT_AT as positioned output in the AST", () => {
    const program = parseSource('print_at warningRow, 5 + x; "WARNING"; x\n', "print-at.mbas");

    expect(program.statements).toMatchObject([
      {
        kind: "print",
        at: {
          row: { kind: "identifier", name: "warningRow" },
          column: { kind: "binary", operator: "+" }
        },
        items: [{ kind: "string", value: "WARNING" }, { kind: "identifier", name: "x" }],
        trailingSemicolon: false
      }
    ]);
  });

  it("reports malformed PRINT_AT coordinates and separator", () => {
    expect(() => parseSource('print_at ,5; "NO"\n', "row.mbas")).toThrow("row.mbas:1: PRINT_AT requires a row expression");
    expect(() => parseSource('print_at 1 5; "NO"\n', "comma.mbas")).toThrow("comma.mbas:1: Expected comma between PRINT_AT row and column");
    expect(() => parseSource('print_at 1,; "NO"\n', "column.mbas")).toThrow("column.mbas:1: PRINT_AT requires a column expression");
    expect(() => parseSource('print_at 1,5 "NO"\n', "separator.mbas")).toThrow("separator.mbas:1: Expected semicolon after PRINT_AT column");
  });

  it("parses CLS with an optional colour expression and BORDER_COLOR", () => {
    expect(parseSource("cls\ncls alert_colour\nborder_color BLUE\n", "screen.mbas").statements).toMatchObject([
      { kind: "cls" },
      { kind: "cls", color: { kind: "identifier", name: "alert_colour" } },
      { kind: "border-color", color: { kind: "identifier", name: "BLUE" } }
    ]);
  });

  it("reports missing BORDER_COLOR colour", () => {
    expect(() => parseSource("border_color\n", "border.mbas")).toThrow("border.mbas:1: BORDER_COLOR requires a colour expression");
  });

  it("rejects PRINTAT and the former PRINT AT spelling", () => {
    expect(() => parseSource('printat 1,2; "NO"\n', "printat.mbas")).toThrow('printat.mbas:1: Unsupported or invalid syntax near "printat"');
    expect(() => parseSource('print at 1,2; "NO"\n', "print-at.mbas")).toThrow('print-at.mbas:1: Expected end of line, found "1"');
  });

  it("reports a missing END IF with the IF source line", () => {
    expect(() => parseSource("if confirmed then\n", "broken.mbas")).toThrow("broken.mbas:1: Missing END IF");
  });

  it("reports an unexpected ELSE", () => {
    expect(() => parseSource("else\n", "broken.mbas")).toThrow("broken.mbas:1: Unexpected ELSE");
  });

  it("reports comparison chaining with a rewrite hint", () => {
    expect(() => parseSource("if a < b < c then\nprint \"NO\"\nend if\n", "chain.mbas")).toThrow(
      "Comparison chaining is not supported"
    );
  });

  it("reports missing operands and unmatched parentheses", () => {
    expect(() => parseSource("a = 1 +\n", "operand.mbas")).toThrow("operand.mbas:1: Missing expression operand");
    expect(() => parseSource("a = (1 + 2\n", "paren.mbas")).toThrow("paren.mbas:1: Expected closing parenthesis");
  });
});
