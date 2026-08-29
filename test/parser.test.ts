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

  it("parses GOSUB and RETURN statements", () => {
    expect(parseSource('gosub drawHeader\nprint "DONE"\ndrawHeader:\nreturn\n', "sub.mbas")).toMatchObject({
      statements: [
        { kind: "gosub", label: "drawHeader", location: { filename: "sub.mbas", line: 1, column: 1 } },
        { kind: "print", items: [{ kind: "string", value: "DONE" }] },
        { kind: "label", name: "drawHeader" },
        { kind: "return", location: { filename: "sub.mbas", line: 4, column: 1 } }
      ]
    });
  });

  it("parses printer device output statements", () => {
    expect(parseSource('open_device TestLog, PRINTER\nprint_device TestLog; "RESULT: "; score;\nclose_device TestLog\n', "printer.mbas")).toMatchObject({
      statements: [
        { kind: "open-device", handle: "TestLog", device: "printer" },
        {
          kind: "print-device",
          handle: "TestLog",
          items: [{ kind: "string", value: "RESULT: " }, { kind: "identifier", name: "score" }],
          trailingSemicolon: true
        },
        { kind: "close-device", handle: "TestLog" }
      ]
    });
  });

  it("parses RS232 device output statements", () => {
    expect(parseSource('open_device SerialLog, RS232\nprint_device SerialLog; "PING"\nclose_device SerialLog\n', "rs232.mbas")).toMatchObject({
      statements: [
        { kind: "open-device", handle: "SerialLog", device: "rs232" },
        { kind: "print-device", handle: "SerialLog", items: [{ kind: "string", value: "PING" }] },
        { kind: "close-device", handle: "SerialLog" }
      ]
    });
  });

  it("parses text printer device output statements", () => {
    expect(parseSource('open_device TestLog, TEXT_PRINTER\nprint_device TestLog; "PING"\nclose_device TestLog\n', "text-printer.mbas")).toMatchObject({
      statements: [
        { kind: "open-device", handle: "TestLog", device: "text-printer" },
        { kind: "print-device", handle: "TestLog", items: [{ kind: "string", value: "PING" }] },
        { kind: "close-device", handle: "TestLog" }
      ]
    });
  });

  it("parses shared drive device output statements", () => {
    expect(parseSource('open_device TestLog, SHARED_DRIVE\nprint_device TestLog; "PING"\nclose_device TestLog\n', "shared-drive.mbas")).toMatchObject({
      statements: [
        { kind: "open-device", handle: "TestLog", device: "shared-drive" },
        { kind: "print-device", handle: "TestLog", items: [{ kind: "string", value: "PING" }] },
        { kind: "close-device", handle: "TestLog" }
      ]
    });
  });

  it("rejects unsupported portable device names", () => {
    expect(() => parseSource("open_device Log, MODEM\n", "device.mbas")).toThrow("OPEN_DEVICE currently supports PRINTER, TEXT_PRINTER, SHARED_DRIVE, and RS232");
  });

  it("parses FUNCTION blocks with parameters, locals, and return expressions", () => {
    expect(parseSource("FUNCTION AddBonus(Score, Bonus)\nLOCAL Result\nResult = Score + Bonus\nRETURN Result\nEND FUNCTION\n", "fn.mbas")).toMatchObject({
      statements: [
        {
          kind: "function",
          name: "AddBonus",
          parameters: ["Score", "Bonus"],
          body: [
            { kind: "local", names: ["Result"] },
            { kind: "let", name: "Result", expression: { kind: "binary", operator: "+" } },
            { kind: "return", expression: { kind: "identifier", name: "Result" } }
          ]
        }
      ]
    });
  });

  it("parses INLINE FUNCTION blocks", () => {
    expect(parseSource("INLINE FUNCTION Emit(Value)\nPRINT Value\nEND FUNCTION\n", "inline.mbas")).toMatchObject({
      statements: [
        {
          kind: "function",
          inline: true,
          name: "Emit",
          parameters: ["Value"],
          body: [{ kind: "print", items: [{ kind: "identifier", name: "Value" }] }]
        }
      ]
    });
  });

  it("parses GLOBALS blocks", () => {
    expect(parseSource('globals\nScore = 0\nName$ = "READY"\nend globals\n', "globals.mbas")).toMatchObject({
      statements: [
        {
          kind: "globals",
          body: [
            { kind: "let", name: "Score", expression: { kind: "number", value: 0 } },
            { kind: "let", name: "Name$", expression: { kind: "string", value: "READY" } }
          ]
        }
      ]
    });
  });

  it("parses STRUCT blocks", () => {
    expect(parseSource("struct Queue\nRow\nText$(10)\nend struct\n", "struct.mbas")).toMatchObject({
      statements: [
        {
          kind: "struct",
          name: "Queue",
          fields: [
            { name: "Row", dimensions: [] },
            { name: "Text$", dimensions: [{ kind: "number", value: 10 }] }
          ]
        }
      ]
    });
  });

  it("parses struct field access and element move commands", () => {
    expect(parseSource("Queue(0).Row = 7\nprint Queue(0).Row\ninsert_element(Queue, 1, NewItem)\nremove_element(Queue, 0)\n", "struct-access.mbas")).toMatchObject({
      statements: [
        { kind: "struct-field-let", base: "Queue", field: "Row", indices: [{ kind: "number", value: 0 }] },
        { kind: "print", items: [{ kind: "struct-field-access", base: "Queue", field: "Row", indices: [{ kind: "number", value: 0 }] }] },
        { kind: "insert-element", target: { kind: "identifier", name: "Queue" }, index: { kind: "number", value: 1 }, value: { kind: "identifier", name: "NewItem" } },
        { kind: "remove-element", target: { kind: "identifier", name: "Queue" }, index: { kind: "number", value: 0 } }
      ]
    });
  });

  it("parses ENUM blocks with automatic and explicit values", () => {
    expect(parseSource("enum AlertState\nIdle\nWarning = 3\nDanger\nend enum\n", "enum.mbas")).toMatchObject({
      statements: [
        {
          kind: "enum",
          name: "AlertState",
          members: [
            { name: "Idle" },
            { name: "Warning", expression: { kind: "number", value: 3 } },
            { name: "Danger" }
          ]
        }
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

  it("parses FOR/NEXT blocks with optional STEP", () => {
    const program = parseSource("for counter = 10 to 1 step -2\nprint counter\nnext counter\n", "for.mbas");

    expect(program.statements).toMatchObject([
      {
        kind: "for",
        variable: "counter",
        start: { kind: "number", value: 10 },
        limit: { kind: "number", value: 1 },
        step: { kind: "unary", operator: "-" },
        body: [{ kind: "print", items: [{ kind: "identifier", name: "counter" }] }]
      }
    ]);
  });

  it("parses EXIT FOR and CONTINUE FOR", () => {
    const program = parseSource("for index = 1 to 3\ncontinue for\nexit for\nnext index\n", "loop-control.mbas");

    expect(program.statements).toMatchObject([
      {
        kind: "for",
        body: [{ kind: "continue-for" }, { kind: "exit-for" }]
      }
    ]);
  });

  it("parses WHILE/WEND and REPEAT/UNTIL blocks", () => {
    const program = parseSource(
      "while count < 3\nprint count\nwend\nrepeat\ncount = count - 1\nuntil count = 0\n",
      "loops.mbas"
    );

    expect(program.statements).toMatchObject([
      {
        kind: "while",
        condition: { kind: "binary", operator: "<" },
        body: [{ kind: "print", items: [{ kind: "identifier", name: "count" }] }]
      },
      {
        kind: "repeat-until",
        body: [{ kind: "let", name: "count", expression: { kind: "binary", operator: "-" } }],
        condition: { kind: "binary", operator: "=" }
      }
    ]);
  });

  it("reports mismatched or missing NEXT statements", () => {
    expect(() => parseSource("for row = 1 to 2\nnext column\n", "badnext.mbas")).toThrow("NEXT column does not match FOR row.");
    expect(() => parseSource("for row = 1 to 2\nprint row\n", "missingnext.mbas")).toThrow("Missing NEXT for FOR block.");
    expect(() => parseSource("next row\n", "unexpectednext.mbas")).toThrow("Unexpected NEXT without matching FOR.");
  });

  it("reports mismatched or missing loop delimiters", () => {
    expect(() => parseSource("while ready\nprint ready\n", "missing-wend.mbas")).toThrow("Missing WEND for WHILE block.");
    expect(() => parseSource("repeat\nprint ready\n", "missing-until.mbas")).toThrow("Missing UNTIL for REPEAT block.");
    expect(() => parseSource("wend\n", "unexpected-wend.mbas")).toThrow("Unexpected WEND without matching WHILE.");
    expect(() => parseSource("until ready\n", "unexpected-until.mbas")).toThrow("Unexpected UNTIL without matching REPEAT.");
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

  it("parses MOD with multiplication precedence", () => {
    const program = parseSource("wrapped = x + y mod 4 * 2\n", "mod.mbas");

    expect(program.statements).toMatchObject([
      {
        kind: "let",
        expression: {
          kind: "binary",
          operator: "+",
          right: {
            kind: "binary",
            operator: "*",
            left: { kind: "binary", operator: "MOD" },
            right: { kind: "number", value: 2 }
          }
        }
      }
    ]);
  });

  it("parses string variable assignment and PRINT items", () => {
    const program = parseSource('tickerText$ = "READY"\nprint tickerText$\n', "strings.mbas");

    expect(program.statements).toMatchObject([
      { kind: "let", name: "tickerText$", expression: { kind: "string", value: "READY" } },
      { kind: "print", items: [{ kind: "identifier", name: "tickerText$" }] }
    ]);
  });

  it("parses DIM, array element assignment, and array reads", () => {
    const program = parseSource("dim values(3)\nvalues(0) = 1\nprint values(2)\n", "arrays.mbas");

    expect(program.statements).toMatchObject([
      { kind: "dim", name: "values", dimensions: [{ kind: "number", value: 3 }] },
      { kind: "array-let", name: "values", indices: [{ kind: "number", value: 0 }], expression: { kind: "number", value: 1 } },
      { kind: "print", items: [{ kind: "function-call", name: "values", args: [{ kind: "number", value: 2 }] }] }
    ]);
  });

  it("parses DATA, READ, and bare RESTORE", () => {
    const program = parseSource('data 10, "READY", true\nread score, status$, confirmed\nrestore\n', "data.mbas");

    expect(program.statements).toMatchObject([
      { kind: "data", values: [{ kind: "number", value: 10 }, { kind: "string", value: "READY" }, { kind: "boolean", value: true }] },
      { kind: "read", targets: ["score", "status$", "confirmed"] },
      { kind: "restore" }
    ]);
  });

  it("parses fixed-width string arrays", () => {
    const program = parseSource('dim messages$(3, 12)\nmessages$(0) = "READY"\nprint messages$(0)\n', "string-arrays.mbas");

    expect(program.statements).toMatchObject([
      { kind: "dim", name: "messages$", dimensions: [{ kind: "number", value: 3 }, { kind: "number", value: 12 }] },
      { kind: "array-let", name: "messages$", indices: [{ kind: "number", value: 0 }], expression: { kind: "string", value: "READY" } },
      { kind: "print", items: [{ kind: "function-call", name: "messages$", args: [{ kind: "number", value: 0 }] }] }
    ]);
  });

  it("parses function calls in expressions", () => {
    const program = parseSource('const borderLine$ = string$("*", TEXT_COLUMNS - 2)\nprint space$(3)\n', "functions.mbas");

    expect(program.statements).toMatchObject([
      {
        kind: "const",
        name: "borderLine$",
        expression: {
          kind: "function-call",
          name: "string$",
          args: [{ kind: "string", value: "*" }, { kind: "binary", operator: "-" }]
        }
      },
      { kind: "print", items: [{ kind: "function-call", name: "space$", args: [{ kind: "number", value: 3 }] }] }
    ]);
  });

  it("parses standalone function calls distinctly from array assignments", () => {
    const program = parseSource("DrawHeader()\nSetLevel(3)\n", "calls.mbas");

    expect(program.statements).toMatchObject([
      { kind: "function-call-statement", expression: { kind: "function-call", name: "DrawHeader", args: [] } },
      { kind: "function-call-statement", expression: { kind: "function-call", name: "SetLevel", args: [{ kind: "number", value: 3 }] } }
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

  it("parses exponentiation with higher precedence than multiplication and unary minus", () => {
    const program = parseSource("total = -base ^ exponent * 3\nchain = 2 ^ 3 ^ 2\n", "power.mbas");

    expect(program.statements).toMatchObject([
      {
        kind: "let",
        name: "total",
        expression: {
          kind: "binary",
          operator: "*",
          left: {
            kind: "unary",
            operator: "-",
            operand: {
              kind: "binary",
              operator: "^",
              left: { kind: "identifier", name: "base" },
              right: { kind: "identifier", name: "exponent" }
            }
          },
          right: { kind: "number", value: 3 }
        }
      },
      {
        kind: "let",
        name: "chain",
        expression: {
          kind: "binary",
          operator: "^",
          left: { kind: "binary", operator: "^", left: { kind: "number", value: 2 }, right: { kind: "number", value: 3 } },
          right: { kind: "number", value: 2 }
        }
      }
    ]);
  });

  it("does not accept LET as assignment syntax", () => {
    expect(() => parseSource("let urgency = 1\n", "legacy-let.mbas")).toThrow(
      'legacy-let.mbas:1:1: Unsupported or invalid syntax near "let"'
    );
  });

  it("parses PRINT_AT as positioned output in the AST", () => {
    const program = parseSource('print_at warningRow, 5 + x, "WARNING"; x\n', "print-at.mbas");

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
    expect(() => parseSource('print_at ,5, "NO"\n', "row.mbas")).toThrow("PRINT_AT requires a row expression");
    expect(() => parseSource('print_at 1 5, "NO"\n', "comma.mbas")).toThrow("Expected comma between PRINT_AT row and column");
    expect(() => parseSource('print_at 1,, "NO"\n', "column.mbas")).toThrow("PRINT_AT requires a column expression");
    expect(() => parseSource('print_at 1,5 "NO"\n', "separator.mbas")).toThrow("Expected comma after PRINT_AT column");
    expect(() => parseSource('print_at 1,5; "NO"\n', "old-separator.mbas")).toThrow("Expected comma after PRINT_AT column");
  });

  it("parses CLS and global/cell colour commands", () => {
    expect(
      parseSource(
        "cls\ncls alert_colour\nborder_color BLUE\nscreen_border_color BLACK\nscreen_background_color BLUE\ntext_color YELLOW\nscreen_text_color WHITE\ncell_text_color RED\ncell_background_color CYAN\n",
        "screen.mbas"
      ).statements
    ).toMatchObject([
      { kind: "cls" },
      { kind: "cls", color: { kind: "identifier", name: "alert_colour" } },
      { kind: "border-color", color: { kind: "identifier", name: "BLUE" } },
      { kind: "border-color", color: { kind: "identifier", name: "BLACK" } },
      { kind: "screen-background-color", color: { kind: "identifier", name: "BLUE" } },
      { kind: "text-color", color: { kind: "identifier", name: "YELLOW" } },
      { kind: "text-color", color: { kind: "identifier", name: "WHITE" } },
      { kind: "cell-text-color", color: { kind: "identifier", name: "RED" } },
      { kind: "cell-background-color", color: { kind: "identifier", name: "CYAN" } }
    ]);
  });

  it("parses SUPPRESS_SCROLL_PROMPT as a no-argument screen command", () => {
    expect(parseSource("suppress_scroll_prompt\n", "screen.mbas").statements).toMatchObject([{ kind: "suppress-scroll-prompt" }]);
    expect(() => parseSource("suppress_scroll_prompt 1\n", "screen.mbas")).toThrow('Expected end of line, found "1"');
  });

  it("parses PROGRAM_MODE as a no-argument runtime setup command", () => {
    expect(parseSource("program_mode\n", "screen.mbas").statements).toMatchObject([{ kind: "program-mode" }]);
    expect(() => parseSource("program_mode 1\n", "screen.mbas")).toThrow('Expected end of line, found "1"');
  });

  it("reports missing BORDER_COLOR colour", () => {
    expect(() => parseSource("border_color\n", "border.mbas")).toThrow("BORDER_COLOR requires a colour expression");
  });

  it("reports missing TEXT_COLOR colour", () => {
    expect(() => parseSource("text_color\n", "text.mbas")).toThrow("TEXT_COLOR requires a colour expression");
  });

  it("rejects PRINTAT and the former PRINT AT spelling", () => {
    expect(() => parseSource('printat 1,2; "NO"\n', "printat.mbas")).toThrow('Unsupported or invalid syntax near "printat"');
    expect(() => parseSource('print at 1,2; "NO"\n', "print-at.mbas")).toThrow('Expected end of line, found "1"');
  });

  it("reports a missing END IF with the IF source line", () => {
    expect(() => parseSource("if confirmed then\n", "broken.mbas")).toThrow("broken.mbas:1:1: Missing END IF");
  });

  it("reports an unexpected ELSE", () => {
    expect(() => parseSource("else\n", "broken.mbas")).toThrow("broken.mbas:1:1: Unexpected ELSE");
  });

  it("reports comparison chaining with a rewrite hint", () => {
    expect(() => parseSource("if a < b < c then\nprint \"NO\"\nend if\n", "chain.mbas")).toThrow(
      "Comparison chaining is not supported"
    );
  });

  it("reports missing operands and unmatched parentheses", () => {
    expect(() => parseSource("a = 1 +\n", "operand.mbas")).toThrow("operand.mbas:1:8: Missing expression operand");
    expect(() => parseSource("a = (1 + 2\n", "paren.mbas")).toThrow("Expected closing parenthesis");
  });
});
