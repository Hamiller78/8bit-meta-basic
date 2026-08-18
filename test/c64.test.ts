import { describe, expect, it } from "vitest";
import { compileSource } from "../src/compiler.js";

describe("C64 compiler", () => {
  it("renders assignment without LET and expands PRINT_AT to POKE/SYS plus PRINT", () => {
    expect(compileSource('x = 1\nprint_at 10, 5; "WARNING"; x\n', { filename: "c64.mbas", target: "c64" })).toBe(
      ["10 X=1", "20 POKE 214,10", "30 POKE 211,5", "40 SYS 58732", '50 PRINT "WARNING";X', ""].join("\n")
    );
  });

  it("reports C64 constant coordinate ranges", () => {
    expect(() => compileSource('print_at 25, 0; "NO"\n', { filename: "range.mbas", target: "c64" })).toThrow(
      "C64 PRINT_AT row coordinate 25 is outside the supported range 0..24"
    );
    expect(() => compileSource('print_at 0, 40; "NO"\n', { filename: "range.mbas", target: "c64" })).toThrow(
      "C64 PRINT_AT column coordinate 40 is outside the supported range 0..39"
    );
  });

  it("rejects generated lines longer than the C64 practical editable limit", () => {
    expect(() => compileSource(`print "${"X".repeat(70)}"\n`, { filename: "long-line.mbas", target: "c64" })).toThrow(
      "Generated C64 BASIC line is 81 characters, exceeding the practical editable line limit of 80."
    );
  });

  it("uses C64 environment constants and case-insensitive lookup", () => {
    expect(
      compileSource('const row = text_rows - 2\nprint_at row, TEXT_COLUMNS - 1; "EDGE"\n', {
        filename: "env.mbas",
        target: "c64"
      })
    ).toBe(["10 POKE 214,23", "20 POKE 211,39", "30 SYS 58732", '40 PRINT "EDGE"', ""].join("\n"));
  });

  it("renders GOSUB and RETURN", () => {
    expect(compileSource('gosub drawHeader\nprint "DONE"\ndrawHeader:\nprint "HEADER"\nreturn\n', { filename: "sub.mbas", target: "c64" })).toBe(
      ['10 GOSUB 30', '20 PRINT "DONE"', "30 REM DRAWHEADER:", '40 PRINT "HEADER"', "50 RETURN", ""].join("\n")
    );
  });

  it("renders FOR/NEXT with C64 compact variable mapping", () => {
    expect(
      compileSource("for row = 10 to 1 step -2\nfor column = 1 to 2\nprint row; column\nnext column\nnext row\n", {
        filename: "for.mbas",
        target: "c64",
        readability: 0
      })
    ).toBe(["10 FOR RO=10 TO 1 STEP -2", "20 FOR CO=1 TO 2", "30 PRINT RO;CO", "40 NEXT CO", "50 NEXT RO", ""].join("\n"));
  });

  it("reports invalid FOR loop variables and bounds", () => {
    expect(() => compileSource('for name$ = 1 to 3\nprint name$\nnext name$\n', { filename: "bad-for.mbas", target: "c64" })).toThrow(
      "FOR loop variable must be numeric."
    );
    expect(() => compileSource('for row = "A" to 3\nprint row\nnext row\n', { filename: "bad-for.mbas", target: "c64" })).toThrow(
      "FOR start value must be numeric."
    );
  });

  it("renders C64 CLS and every portable background colour without border or text-colour changes", () => {
    const source = ["cls", ...portableColors.map((color) => `cls ${color}`)].join("\n");
    const output = compileSource(`${source}\n`, { filename: "colors.mbas", target: "c64" });

    expect(output).toBe(
      [
        "10 PRINT CHR$(147);",
        "20 POKE 53281,0",
        "30 PRINT CHR$(147);",
        "40 POKE 53281,6",
        "50 PRINT CHR$(147);",
        "60 POKE 53281,2",
        "70 PRINT CHR$(147);",
        "80 POKE 53281,4",
        "90 PRINT CHR$(147);",
        "100 POKE 53281,5",
        "110 PRINT CHR$(147);",
        "120 POKE 53281,3",
        "130 PRINT CHR$(147);",
        "140 POKE 53281,7",
        "150 PRINT CHR$(147);",
        "160 POKE 53281,1",
        "170 PRINT CHR$(147);",
        ""
      ].join("\n")
    );
    expect(output).not.toContain("POKE 53280");
    expect(output).not.toContain("POKE 646");
  });

  it("renders C64 BORDER_COLOR for every portable colour without changing the background register", () => {
    const source = portableColors.map((color) => `border_color ${color}`).join("\n");
    const output = compileSource(`${source}\n`, { filename: "border.mbas", target: "c64" });

    expect(output).toBe(
      [
        "10 POKE 53280,0",
        "20 POKE 53280,6",
        "30 POKE 53280,2",
        "40 POKE 53280,4",
        "50 POKE 53280,5",
        "60 POKE 53280,3",
        "70 POKE 53280,7",
        "80 POKE 53280,1",
        ""
      ].join("\n")
    );
    expect(output).not.toContain("POKE 53281");
  });

  it("renders C64 TEXT_COLOR as the current text colour register", () => {
    expect(compileSource("text_color WHITE\ntext_color YELLOW\n", { filename: "text-color.mbas", target: "c64" })).toBe(
      ["10 POKE 646,1", "20 POKE 646,7", ""].join("\n")
    );
  });

  it("renders C64 global colours, supports cell text colour, and ignores cell background colour", () => {
    expect(
      compileSource('screen_background_color BLUE\nscreen_text_color WHITE\ncell_text_color YELLOW\ncell_background_color RED\nprint "OK"\n', {
        filename: "cell-colors.mbas",
        target: "c64"
      })
    ).toBe(["10 POKE 53281,6", "20 POKE 646,1", "30 POKE 646,7", '40 PRINT "OK"', ""].join("\n"));
  });

  it("deterministically maps C64 variable names that would alias in BASIC V2", () => {
    expect(
      compileSource("sensorCount = 1\nsensorState = sensorCount + 1\nprint sensorCount; sensorState\n", {
        filename: "aliases.mbas",
        target: "c64"
      })
    ).toBe(["10 SE=1", "20 V0=SE + 1", "30 PRINT SE;V0", ""].join("\n"));
  });

  it("uses compact C64 variable names when readability is low", () => {
    expect(
      compileSource("urgency = sensorCount * 2 + alertLevel\nprint urgency; sensorCount; alertLevel\n", {
        filename: "compact.mbas",
        target: "c64",
        readability: 0
      })
    ).toBe(["10 UR=SE * 2 + AL", "20 PRINT UR;SE;AL", ""].join("\n"));
  });

  it("comments first explicit assignments when readability uses compact C64 names", () => {
    expect(
      compileSource("sensorCount = 1\nalertLevel = 2\nprint sensorCount; alertLevel\n", {
        filename: "compact-comments.mbas",
        target: "c64",
        readability: 1
      })
    ).toBe(["10 REM SE=SENSORCOUNT", "20 SE=1", "30 REM AL=ALERTLEVEL", "40 AL=2", "50 PRINT SE;AL", ""].join("\n"));
  });

  it("renders string variable assignment and PRINT", () => {
    expect(
      compileSource('tickerText$ = "READY"\nprint tickerText$\n', {
        filename: "strings.mbas",
        target: "c64",
        readability: 0
      })
    ).toBe(['10 V0$="READY"', "20 PRINT V0$", ""].join("\n"));
  });

  it("folds compile-time STRING$ and SPACE$ using target constants", () => {
    expect(
      compileSource('const borderLine$ = string$("*", TEXT_COLUMNS - 2)\nprint borderLine$\nprint space$(3)\n', {
        filename: "fill.mbas",
        target: "c64"
      })
    ).toBe([`10 PRINT "${"*".repeat(38)}"`, '20 PRINT "   "', ""].join("\n"));
  });

  it("renders MID$ directly for C64", () => {
    expect(
      compileSource('tickerText$ = "HELLO WORLD"\nprint mid$(tickerText$, 2, 5)\n', {
        filename: "mid.mbas",
        target: "c64",
        readability: 0
      })
    ).toBe(['10 V0$="HELLO WORLD"', "20 PRINT MID$(V0$,2,5)", ""].join("\n"));
  });

  it("renders LEN directly for C64", () => {
    expect(
      compileSource('tickerText$ = "HELLO WORLD"\ntextLength = len(tickerText$)\nprint textLength\n', {
        filename: "len.mbas",
        target: "c64",
        readability: 0
      })
    ).toBe(['10 V0$="HELLO WORLD"', "20 TE=LEN(V0$)", "30 PRINT TE", ""].join("\n"));
  });

  it("renders CHR$ and CODE as C64 character conversion functions", () => {
    expect(
      compileSource('digit$ = chr$(48 + value)\nprint digit$; code("A")\n', {
        filename: "chars.mbas",
        target: "c64",
        readability: 0
      })
    ).toBe(['10 DI$=CHR$(48 + VA)', '20 PRINT DI$;ASC("A")', ""].join("\n"));
  });

  it("renders JIFFIES as the C64 jiffy clock", () => {
    expect(
      compileSource("lastTick = jiffies()\nprint JIFFIES_PER_SECOND\n", {
        filename: "jiffies.mbas",
        target: "c64",
        readability: 0
      })
    ).toBe(["10 LA=TI", "20 PRINT 50", ""].join("\n"));
  });

  it("renders non-blocking KEY_CODE through GET and exposes target key constants", () => {
    expect(
      compileSource("keyCode = key_code()\nprint KEY_UP; KEY_A; GAME_UP; GAME_FIRE; keyCode\n", {
        filename: "keys.mbas",
        target: "c64",
        readability: 0
      })
    ).toBe(['10 GET MB$', "20 KE=0", '30 IF MB$ <> "" THEN GOTO 50', "40 GOTO 60", "50 KE=ASC(MB$)", "60 PRINT 145;65;145;32;KE", ""].join("\n"));
  });

  it("preserves logical truth behavior in representative expressions", () => {
    expect(compileSource("if a and b or not c then\nprint \"YES\"\nend if\n", { filename: "logic.mbas", target: "c64" })).toContain(
      "IF ((((A) <> 0) AND ((B) <> 0)) <> 0) OR ((NOT (C <> 0)) <> 0) THEN GOTO"
    );
  });

  it("renders exact output for the updated warning example", () => {
    expect(compileSource(warningSource(), { filename: "warning.mbas", target: "c64" })).toBe(
      [
        "10 SENSORCOUNT=1",
        "20 ALERTLEVEL=2",
        "30 CONFIRMED=1",
        '40 V0$="DEFENCE NETWORK ONLINE"',
        "50 POKE 53280,6",
        "60 POKE 53281,6",
        "70 PRINT CHR$(147);",
        "80 REM START:",
        '90 PRINT "****************************************"',
        '100 PRINT "WARNING"',
        "110 PRINT V0$",
        '120 PRINT "SECONDS: ";60',
        "130 URGENCY=SENSORCOUNT * 2 + ALERTLEVEL",
        "140 IF ((CONFIRMED) <> 0) AND ((URGENCY >= 4) <> 0) THEN GOTO 170",
        '150 PRINT "AWAITING SECOND SOURCE AT ROW ";23',
        "160 GOTO 220",
        "170 REM __MB_1:",
        "180 POKE 214,23",
        "190 POKE 211,5",
        "200 SYS 58732",
        '210 PRINT "ATTACK CONFIRMED"',
        "220 REM __MB_2:",
        "230 GOTO 80",
        ""
      ].join("\n")
    );
  });
});

function warningSource(): string {
  return [
    "const warningRow = TEXT_ROWS - 2",
    "const initialCountdown = 5 * 12",
    'const borderLine$ = string$("*", TEXT_COLUMNS)',
    "",
    "sensorCount = 1",
    "alertLevel = 2",
    "confirmed = 1",
    'tickerText$ = "DEFENCE NETWORK ONLINE"',
    "",
    "    border_color BLUE",
    "    cls BLUE",
    "",
    "start:",
    "    print borderLine$",
    '    print "WARNING"',
    "    print tickerText$",
    '    print "SECONDS: "; initialCountdown',
    "",
    "    urgency = sensorCount * 2 + alertLevel",
    "",
    "    if confirmed and urgency >= 4 then",
    '        print_at warningRow, 5; "ATTACK CONFIRMED"',
    "    else",
    '        print "AWAITING SECOND SOURCE AT ROW "; warningRow',
    "    end if",
    "",
    "    goto start"
  ].join("\n");
}

const portableColors = ["BLACK", "BLUE", "RED", "MAGENTA", "GREEN", "CYAN", "YELLOW", "WHITE"] as const;
