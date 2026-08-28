import { describe, expect, it } from "vitest";
import { compileSource } from "../src/compiler.js";

describe("C64 compiler", () => {
  it("renders assignment without LET and expands PRINT_AT to POKE/SYS plus PRINT", () => {
    expect(compileSource('x = 1\nprint_at 10, 5, "WARNING"; x\n', { filename: "c64.mbas", target: "c64" })).toBe(
      ["10 X=1", "20 POKE 214,10", "30 POKE 211,5", "40 SYS 58732", '50 PRINT "WARNING";X', ""].join("\n")
    );
  });

  it("ignores SUPPRESS_SCROLL_PROMPT because the C64 has no Spectrum scroll prompt", () => {
    expect(compileSource('suppress_scroll_prompt\nprint "OK"\n', { filename: "scroll.mbas", target: "c64", readability: 0 })).toBe(
      ['10 PRINT "OK"', ""].join("\n")
    );
  });

  it("reports C64 constant coordinate ranges", () => {
    expect(() => compileSource('print_at 25, 0, "NO"\n', { filename: "range.mbas", target: "c64" })).toThrow(
      "C64 PRINT_AT row coordinate 25 is outside the supported range 0..24"
    );
    expect(() => compileSource('print_at 0, 40, "NO"\n', { filename: "range.mbas", target: "c64" })).toThrow(
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
      compileSource('const row = text_rows - 2\nprint_at row, TEXT_COLUMNS - 1, "EDGE"\n', {
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

  it("renders printer device output through a C64 logical file", () => {
    expect(
      compileSource('open_device TestLog, PRINTER\nprint_device TestLog; "RESULT: "; score;\nclose_device TestLog\n', {
        filename: "printer.mbas",
        target: "c64",
        readability: 2
      })
    ).toBe(['10 OPEN 1,4', '20 PRINT#1,"RESULT: ";SC;', "30 CLOSE 1", ""].join("\n"));
  });

  it("renders RS232 device output through C64 device 2", () => {
    expect(
      compileSource('open_device SerialLog, RS232\nprint_device SerialLog; "RESULT: "; score\nclose_device SerialLog\n', {
        filename: "rs232.mbas",
        target: "c64",
        readability: 2
      })
    ).toBe(['10 OPEN 1,2,0,CHR$(10)', '20 PRINT#1,"RESULT: ";SC', "30 IF (PEEK(673) AND 1) THEN GOTO 30", "40 CLOSE 1", ""].join("\n"));
  });

  it("lowers C64 printer availability checks through ST", () => {
    expect(
      compileSource('available = device_available(PRINTER)\nprint available\n', {
        filename: "device-available.mbas",
        target: "c64",
        readability: 2
      })
    ).toBe(["10 OPEN 15,4,15", "20 CLOSE 15", "30 AV=-(ST=0): REM AVAILABLE", "40 PRINT AV", ""].join("\n"));
  });

  it("mirrors the test runner output to the C64 printer when enabled", () => {
    const output = compileSource("test Smoke()\nassert_true 1\nend test\n", {
      filename: "printer-tests.mbas",
      target: "c64",
      readability: 0,
      testMode: true,
      testPrinterOutput: true
    });

    expect(output).toContain("OPEN 15,4,15");
    expect(output).toContain("MB=-(ST=0)");
    expect(output).toContain("OPEN 1,4");
    expect(output).toContain('MB$="META CONTROL PROGRAM (M.C.P.) RUN STARTED"');
    expect(output).toContain('MB$="RUNNING Smoke..."');
    expect(output).toContain("PRINT#1,MB$");
    expect(output).toContain("PRINT#1,MB$;");
    expect(output).toContain("CLOSE 1");
  });

  it("mirrors the test runner output to C64 RS232 when selected", () => {
    const output = compileSource("test Smoke()\nassert_true 1\nend test\n", {
      filename: "rs232-tests.mbas",
      target: "c64",
      readability: 0,
      testMode: true,
      testPrinterOutput: true,
      testOutputDevice: "rs232"
    });

    expect(output).toContain("MB=1");
    expect(output).not.toContain("OPEN 15,4,15");
    expect(output).toContain("OPEN 1,2,0,CHR$(10)");
    expect(output).toContain("IF (PEEK(673) AND 1) THEN GOTO");
    expect(output).toContain('MB$="RUNNING Smoke..."');
    expect(output).toContain("PRINT#1,MB$;");
    expect(output).toContain("CLOSE 1");
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

  it("allocates more than 36 compact variable names without looping forever", () => {
    const source = Array.from({ length: 45 }, (_, index) => `generated_value_${index} = ${index}`).join("\n");
    const output = compileSource(`${source}\n`, { filename: "many-vars.mbas", target: "c64", readability: 0 });

    expect(output).toContain("10 GE=0");
    expect(output).toContain("370 VZ=36");
    expect(output).toContain("450 A7=44");
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
    ).toBe(["10 SE=1: REM SENSORCOUNT", "20 V0=SE + 1: REM SENSORSTATE", "30 PRINT SE;V0", ""].join("\n"));
  });

  it("uses compact C64 variable names with inline source comments in readable output", () => {
    expect(
      compileSource("memoryLeft = free_memory()\nmemorsy = memoryLeft + 1\ngift = memorsy + 1\ntotal = gift + 1\nprint memoryLeft; memorsy; gift; total\n", {
        filename: "token-names.mbas",
        target: "c64",
        readability: 2
      })
    ).toBe(
      [
        "10 ME=FRE(0) - (FRE(0) < 0) * 65536: REM MEMORYLEFT",
        "20 V0=ME + 1: REM MEMORSY",
        "30 GI=V0 + 1: REM GIFT",
        "40 V1=GI + 1: REM TOTAL",
        "50 PRINT ME;V0;GI;V1",
        ""
      ].join("\n")
    );
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
    ).toBe(["10 SE=1: REM SENSORCOUNT", "20 AL=2: REM ALERTLEVEL", "30 PRINT SE;AL", ""].join("\n"));
  });

  it("shortens function local variables and comments their source names in readable C64 output", () => {
    const output = compileSource('Draw(5, "OK")\nFUNCTION Draw(Row, Text$)\nLOCAL Column\nColumn = (TEXT_COLUMNS - LEN(Text$)) / 2\nPRINT_AT Row, Column, Text$\nEND FUNCTION\n', {
      filename: "local-comments.mbas",
      target: "c64",
      readability: 2
    });

    expect(output).toContain("CO=(40 - LEN(MB$)) / 2: REM COLUMN");
    expect(output).toContain("POKE 211,CO");
    expect(output).not.toContain("COLUMN=");
    expect(output).not.toContain("POKE 211,COLUMN");
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
      compileSource('tickerText$ = "HELLO WORLD"\nprint mid$(tickerText$, 2, 5); mid$(tickerText$, 7)\n', {
        filename: "mid.mbas",
        target: "c64",
        readability: 0
      })
    ).toBe(['10 V0$="HELLO WORLD"', "20 PRINT MID$(V0$,2,5);MID$(V0$,7)", ""].join("\n"));
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
      compileSource('digit$ = chr$(48 + value)\nprint digit$; code("A"); asc("B")\n', {
        filename: "chars.mbas",
        target: "c64",
        readability: 0
      })
    ).toBe(['10 DI$=CHR$(48 + VA)', '20 PRINT DI$;ASC("A");ASC("B")', ""].join("\n"));
  });

  it("renders LEFT$ and RIGHT$ directly for C64", () => {
    expect(
      compileSource('tickerText$ = "HELLO WORLD"\nprint left$(tickerText$, 5); right$(tickerText$, 5)\n', {
        filename: "sides.mbas",
        target: "c64",
        readability: 0
      })
    ).toBe(['10 V0$="HELLO WORLD"', "20 PRINT LEFT$(V0$,5);RIGHT$(V0$,5)", ""].join("\n"));
  });

  it("renders STR$ and VAL as C64 conversion functions", () => {
    expect(
      compileSource('valueText$ = str$(score + 10)\nscore = val(valueText$)\nprint valueText$; score\n', {
        filename: "convert.mbas",
        target: "c64",
        readability: 0
      })
    ).toBe(["10 VA$=STR$(SC + 10)", "20 SC=VAL(VA$)", "30 PRINT VA$;SC", ""].join("\n"));
  });

  it("renders numeric math functions with C64 spelling", () => {
    expect(
      compileSource("print abs(x); atn(x); cos(x); exp(x); int(x); sgn(x); sin(x); sqr(x)\n", {
        filename: "math.mbas",
        target: "c64",
        readability: 0
      })
    ).toBe(["10 PRINT ABS(X);ATN(X);COS(X);EXP(X);INT(X);SGN(X);SIN(X);SQR(X)", ""].join("\n"));
  });

  it("renders exponentiation with C64 spelling", () => {
    expect(
      compileSource("power = base ^ exponent * 3\nnegativePower = -base ^ exponent\n", {
        filename: "power.mbas",
        target: "c64",
        readability: 0
      })
    ).toBe(["10 V0=BA ^ EX * 3", "20 NE=-(BA ^ EX)", ""].join("\n"));
  });

  it("lowers MOD through portable INT arithmetic", () => {
    expect(compileSource("wrapped = x mod 4\nprint 10 mod 3\n", { filename: "mod.mbas", target: "c64", readability: 0 })).toBe(
      ["10 WR=(X) - INT((X) / (4)) * (4)", "20 PRINT 1", ""].join("\n")
    );
  });

  it("coerces integer variable assignments and renders native C64 integer variables", () => {
    expect(
      compileSource("counter% = 3.7\nprint counter%\n", {
        filename: "ints.mbas",
        target: "c64",
        readability: 0
      })
    ).toBe(["10 CO%=INT(3.7)", "20 PRINT CO%", ""].join("\n"));
  });

  it("renders zero-based numeric and integer arrays with native C64 upper bounds", () => {
    expect(
      compileSource("dim values(3)\ndim counters%(3)\nvalues(0)=1.5\nvalues(2)=4.5\ncounters%(2)=values(2)\nprint values(0); counters%(2)\n", {
        filename: "arrays.mbas",
        target: "c64",
        readability: 0
      })
    ).toBe(["10 DIM VA(2)", "20 DIM CO%(2)", "30 VA(0)=1.5", "40 VA(2)=4.5", "50 CO%(2)=INT(VA(2))", "60 PRINT VA(0);CO%(2)", ""].join("\n"));
  });

  it("renders fixed-width string arrays using native C64 string arrays", () => {
    expect(
      compileSource('dim messages$(3, 12)\nmessages$(0)="READY"\nmessages$(2)="STANDBY"\nprint messages$(0); messages$(2)\n', {
        filename: "string-arrays.mbas",
        target: "c64",
        readability: 0
      })
    ).toBe(['10 DIM ME$(2)', '20 ME$(0)="READY"', '30 ME$(2)="STANDBY"', "40 PRINT ME$(0);ME$(2)", ""].join("\n"));
  });

  it("renders DATA, READ, and RESTORE for C64 BASIC V2", () => {
    expect(
      compileSource('data 10, "READY", true\nread score, status$, confirmed\nprint score; status$; confirmed\nrestore\nread score\n', {
        filename: "data.mbas",
        target: "c64",
        readability: 0
      })
    ).toBe(['10 DATA 10,"READY",1', "20 READ SC,V0$,CO", "30 PRINT SC;V0$;CO", "40 RESTORE", "50 READ SC", ""].join("\n"));
  });

  it("renders END for C64 BASIC V2", () => {
    expect(compileSource('print "DONE"\nend\n', { filename: "end.mbas", target: "c64", readability: 0 })).toBe(['10 PRINT "DONE"', "20 END", ""].join("\n"));
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

  it("renders FREE_MEMORY with the C64 FRE signed-result correction", () => {
    expect(compileSource("memoryLeft = free_memory()\nprint memoryLeft\n", { filename: "memory.mbas", target: "c64", readability: 0 })).toBe(
      ["10 ME=FRE(0) - (FRE(0) < 0) * 65536", "20 PRINT ME", ""].join("\n")
    );
  });

  it("renders RANDOMIZE and RND with C64 RND argument semantics", () => {
    expect(compileSource("randomize 123\nvalue = rnd()\nrandomize\nprint value\n", { filename: "rnd.mbas", target: "c64", readability: 0 })).toBe(
      ["10 MB=RND(-(123))", "20 VA=RND(1)", "30 MB=RND(0)", "40 PRINT VA", ""].join("\n")
    );
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

  it("renders KEY_PRESSED using the C64 keyboard buffer count", () => {
    expect(
      compileSource("pressed = key_pressed()\nif key_pressed() then\nprint \"KEY\"\nend if\nprint KEY_NONE\n", {
        filename: "key-pressed.mbas",
        target: "c64",
        readability: 0
      })
    ).toBe(["10 V0=(PEEK(198) > 0)", "20 IF (PEEK(198) > 0) THEN GOTO 40", "30 GOTO 50", '40 PRINT "KEY"', "50 PRINT 0", ""].join("\n"));
  });

  it("preserves logical truth behavior in representative expressions", () => {
    expect(compileSource("if a and b or not c then\nprint \"YES\"\nend if\n", { filename: "logic.mbas", target: "c64" })).toContain(
      "IF ((((A) <> 0) AND ((B) <> 0)) <> 0) OR ((NOT (C <> 0)) <> 0) THEN GOTO"
    );
  });

  it("renders exact output for the colors example", () => {
    expect(compileSource(colorsSource(), { filename: "colors.mbas", target: "c64" })).toBe(
      [
        "10 POKE 53280,6",
        "20 POKE 53281,0",
        "30 POKE 646,1",
        "40 PRINT CHR$(147);",
        "50 POKE 646,7",
        '60 PRINT "----------------------------------------"',
        "70 POKE 214,2",
        "80 POKE 211,4",
        "90 SYS 58732",
        '100 PRINT "META-BASIC COLOURS"',
        "110 POKE 646,3",
        "120 POKE 214,4",
        "130 POKE 211,0",
        "140 SYS 58732",
        '150 PRINT "PRINT AND PRINT_AT"',
        "160 POKE 646,1",
        '170 PRINT "----------------------------------------"',
        ""
      ].join("\n")
    );
  });
});

function colorsSource(): string {
  return [
    "const titleColumn = 4",
    "const messageRow = 4",
    'const ruleLine$ = string$("-", TEXT_COLUMNS)',
    "",
    "screen_border_color BLUE",
    "screen_background_color BLACK",
    "screen_text_color WHITE",
    "cls",
    "",
    "cell_text_color YELLOW",
    "cell_background_color BLUE",
    "print ruleLine$",
    'print_at 2, titleColumn, "META-BASIC COLOURS"',
    "",
    "screen_text_color CYAN",
    'print_at messageRow, 0, "PRINT AND PRINT_AT"',
    "",
    "screen_text_color WHITE",
    "print ruleLine$"
  ].join("\n");
}

const portableColors = ["BLACK", "BLUE", "RED", "MAGENTA", "GREEN", "CYAN", "YELLOW", "WHITE"] as const;
