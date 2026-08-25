import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { compileSource } from "../src/compiler.js";

const execFileAsync = promisify(execFile);

describe("Spectrum compiler", () => {
  it("renders deterministic exact output for labels, PRINT, IF/ELSE, and backward GOTO", () => {
    const source = [
      "start:",
      '  print "WARNING"',
      "  if confirmed then",
      '    print "ATTACK CONFIRMED"',
      "  else",
      '    print "AWAITING SECOND SOURCE"',
      "  end if",
      "  goto start"
    ].join("\n");

    const expected = [
      "10 REM START:",
      '20 PRINT "WARNING"',
      "30 IF CONFIRMED THEN GO TO 60",
      '40 PRINT "AWAITING SECOND SOURCE"',
      "50 GO TO 80",
      "60 REM __MB_1:",
      '70 PRINT "ATTACK CONFIRMED"',
      "80 REM __MB_2:",
      "90 GO TO 10",
      ""
    ].join("\n");

    expect(compileSource(source, { filename: "flow.mbas", target: "spectrum" })).toBe(expected);
    expect(compileSource(source, { filename: "flow.mbas", target: "spectrum" })).toBe(expected);
  });

  it("resolves forward labels", () => {
    expect(compileSource('goto done\nprint "NO"\ndone:\nprint "YES"\n', { filename: "forward.mbas", target: "spectrum" })).toBe(
      ['10 GO TO 30', '20 PRINT "NO"', "30 REM DONE:", '40 PRINT "YES"', ""].join("\n")
    );
  });

  it("renders GOSUB and RETURN with Spectrum spelling", () => {
    expect(compileSource('gosub drawHeader\nprint "DONE"\ndrawHeader:\nprint "HEADER"\nreturn\n', { filename: "sub.mbas", target: "spectrum" })).toBe(
      ['10 GO SUB 30', '20 PRINT "DONE"', "30 REM DRAWHEADER:", '40 PRINT "HEADER"', "50 RETURN", ""].join("\n")
    );
  });

  it("can omit generated label comment lines while keeping source label comment lines", () => {
    const source = [
      "start:",
      'print "WARNING"',
      "if confirmed then",
      'print "ATTACK CONFIRMED"',
      "else",
      'print "AWAITING SECOND SOURCE"',
      "end if",
      "goto start"
    ].join("\n");

    expect(compileSource(source, { filename: "flow.mbas", target: "spectrum", readability: 1 })).toBe(
      [
        "10 REM START:",
        '20 PRINT "WARNING"',
        "30 IF CONFIRMED THEN GO TO 60",
        '40 PRINT "AWAITING SECOND SOURCE"',
        "50 GO TO 70",
        '60 PRINT "ATTACK CONFIRMED"',
        "70 GO TO 10",
        ""
      ].join("\n")
    );
  });

  it("can omit all label comment lines", () => {
    const source = [
      "start:",
      'print "WARNING"',
      "if confirmed then",
      'print "ATTACK CONFIRMED"',
      "else",
      'print "AWAITING SECOND SOURCE"',
      "end if",
      "goto start"
    ].join("\n");

    expect(compileSource(source, { filename: "flow.mbas", target: "spectrum", readability: 0 })).toBe(
      [
        '10 PRINT "WARNING"',
        "20 IF CONFIRMED THEN GO TO 50",
        '30 PRINT "AWAITING SECOND SOURCE"',
        "40 GO TO 60",
        '50 PRINT "ATTACK CONFIRMED"',
        "60 GO TO 10",
        ""
      ].join("\n")
    );
  });

  it("renders IF without ELSE", () => {
    expect(compileSource('if ready then\nprint "READY"\nend if\n', { filename: "if.mbas", target: "spectrum" })).toBe(
      ["10 IF READY THEN GO TO 30", "20 GO TO 50", "30 REM __MB_1:", '40 PRINT "READY"', "50 REM __MB_2:", ""].join("\n")
    );
  });

  it("renders FOR/NEXT with single-letter Spectrum loop variables", () => {
    expect(compileSource("for counter = 1 to 3\nprint counter\nnext counter\n", { filename: "for.mbas", target: "spectrum" })).toBe(
      ["10 FOR C=1 TO 3", "20 PRINT C", "30 NEXT C", ""].join("\n")
    );
  });

  it("renders nested Spectrum FOR/NEXT with STEP", () => {
    expect(
      compileSource("for row = 10 to 1 step -2\nfor column = 1 to 2\nprint row; column\nnext column\nnext row\n", {
        filename: "nested-for.mbas",
        target: "spectrum",
        readability: 0
      })
    ).toBe(["10 FOR R=10 TO 1 STEP -2", "20 FOR C=1 TO 2", "30 PRINT R;C", "40 NEXT C", "50 NEXT R", ""].join("\n"));
  });

  it("lowers WHILE/WEND and REPEAT/UNTIL to conditional jumps", () => {
    expect(
      compileSource(
        [
          "count = 0",
          "while count < 3",
          "print count",
          "count = count + 1",
          "wend",
          "repeat",
          "count = count - 1",
          "print count",
          "until count = 0"
        ].join("\n"),
        { filename: "loops.mbas", target: "spectrum" }
      )
    ).toBe(
      [
        "10 LET COUNT=0",
        "20 REM __MB_1:",
        "30 IF COUNT < 3 THEN GO TO 50",
        "40 GO TO 90",
        "50 REM __MB_2:",
        "60 PRINT COUNT",
        "70 LET COUNT=COUNT + 1",
        "80 GO TO 20",
        "90 REM __MB_3:",
        "100 REM __MB_4:",
        "110 LET COUNT=COUNT - 1",
        "120 PRINT COUNT",
        "130 IF COUNT = 0 THEN GO TO 150",
        "140 GO TO 100",
        "150 REM __MB_5:",
        ""
      ].join("\n")
    );
  });

  it("renders primary, unary, binary, comparison, and logical expression forms", () => {
    expect(
      compileSource(
        [
          "decimal = 1.5",
          "grouped = (a + b) * 2",
          "unary = -a + 3",
          "power = base ^ exponent * 3",
          "negativePower = -base ^ exponent",
          "if not confirmed or a <> b and c <= 10 then",
          'print "YES";',
          "end if"
        ].join("\n"),
        { filename: "forms.mbas", target: "spectrum" }
      )
    ).toBe(
      [
        "10 LET DECIMAL=1.5",
        "20 LET GROUPED=(A + B) * 2",
        "30 LET UNARY=-A + 3",
        "40 LET POWER=BASE ^ EXPONENT * 3",
        "50 LET NEGATIVEPOWER=-(BASE ^ EXPONENT)",
        "60 IF ((NOT (CONFIRMED <> 0)) <> 0) OR ((((A <> B) <> 0) AND ((C <= 10) <> 0)) <> 0) THEN GO TO 80",
        "70 GO TO 100",
        "80 REM __MB_1:",
        '90 PRINT "YES";',
        "100 REM __MB_2:",
        ""
      ].join("\n")
    );
  });

  it("evaluates constants, substitutes them, and folds constant subexpressions", () => {
    expect(
      compileSource(
        [
          "const screenRows = 24",
          "const warningRow = screenRows - 2",
          "const initialCountdown = 5 * 12",
          'print "SECONDS: "; initialCountdown',
          'print "ROW: "; warningRow + 1',
          "if true and false then",
          'print "NEVER"',
          "end if"
        ].join("\n"),
        { filename: "consts.mbas", target: "spectrum" }
      )
    ).toBe(
      [
        '10 PRINT "SECONDS: ";60',
        '20 PRINT "ROW: ";23',
        "30 IF 0 THEN GO TO 50",
        "40 GO TO 70",
        "50 REM __MB_1:",
        '60 PRINT "NEVER"',
        "70 REM __MB_2:",
        ""
      ].join("\n")
    );
  });

  it("renders assignment as Spectrum LET output and PRINT with multiple items and trailing semicolon", () => {
    expect(
      compileSource('urgency = sensorCount * 2 + alertLevel\nprint "SECONDS: "; urgency;\n', {
        filename: "let-print.mbas",
        target: "spectrum"
      })
    ).toBe(["10 LET URGENCY=SENSORCOUNT * 2 + ALERTLEVEL", '20 PRINT "SECONDS: ";URGENCY;', ""].join("\n"));
  });

  it("renders printer device output through a Spectrum stream", () => {
    expect(
      compileSource('open_device TestLog, PRINTER\nprint_device TestLog; "RESULT: "; score\nclose_device TestLog\n', {
        filename: "printer.mbas",
        target: "spectrum"
      })
    ).toBe(['10 OPEN #4,"P"', '20 PRINT #4;"RESULT: ";SCORE', "30 CLOSE #4", ""].join("\n"));
  });

  it("renders RS232 device output through a Spectrum Interface 1 text channel", () => {
    expect(
      compileSource('open_device SerialLog, RS232\nprint_device SerialLog; "RESULT: "; score\nclose_device SerialLog\n', {
        filename: "rs232.mbas",
        target: "spectrum"
      })
    ).toBe(['10 OPEN #4,"t"', '20 PRINT #4;"RESULT: ";SCORE', "30 CLOSE #4", ""].join("\n"));
  });

  it("renders text printer device output through Spectrum LPRINT", () => {
    expect(
      compileSource('open_device TestLog, TEXT_PRINTER\nprint_device TestLog; "RESULT: "; score\nclose_device TestLog\n', {
        filename: "text-printer.mbas",
        target: "spectrum",
        readability: 0
      })
    ).toBe(['10 REM OPEN TEXT_PRINTER', '20 LPRINT "RESULT: ";SCORE', "30 REM CLOSE TEXT_PRINTER", ""].join("\n"));
  });

  it("mirrors the Spectrum test runner output through LPRINT when text-printer is selected", () => {
    const output = compileSource("test Smoke()\nassert_true 1\nend test\n", {
      filename: "text-printer-tests.mbas",
      target: "spectrum",
      readability: 0,
      testMode: true,
      testPrinterOutput: true,
      testOutputDevice: "text-printer"
    });

    expect(output).toContain('LET A$="META CONTROL PROGRAM (M.C.P.) RUN STARTED"');
    expect(output).toContain("LPRINT A$");
    expect(output).toContain("LPRINT A$;");
    expect(output).toContain("POKE 23692,255");
    expect(output).not.toContain("PRINT #");
  });

  it("renders SUPPRESS_SCROLL_PROMPT as a Spectrum scroll counter refresh", () => {
    expect(compileSource('suppress_scroll_prompt\nprint "OK"\n', { filename: "scroll.mbas", target: "spectrum", readability: 0 })).toBe(
      ['10 POKE 23692,255', '20 PRINT "OK"', ""].join("\n")
    );
  });

  it("lowers Spectrum printer availability checks as a best-effort open stream assumption", () => {
    expect(
      compileSource('available = device_available(PRINTER)\nprint available\n', {
        filename: "device-available.mbas",
        target: "spectrum"
      })
    ).toBe(["10 LET AVAILABLE=1", "20 PRINT AVAILABLE", ""].join("\n"));
  });

  it("rejects printing to a device handle that was never opened", () => {
    expect(() => compileSource('print_device TestLog; "RESULT"\n', { filename: "printer.mbas", target: "spectrum" })).toThrow(
      'PRINT_DEVICE uses unknown device handle "TestLog". Open it first with OPEN_DEVICE.'
    );
  });

  it("renders positioned output with Spectrum PRINT AT from source PRINT_AT", () => {
    expect(compileSource('print_at 10, 5; "WARNING";\n', { filename: "at.mbas", target: "spectrum" })).toBe(
      ['10 PRINT AT 10,5;"WARNING";', ""].join("\n")
    );
  });

  it("reports Spectrum constant coordinate ranges", () => {
    expect(() => compileSource('print_at 22, 0; "NO"\n', { filename: "range.mbas", target: "spectrum" })).toThrow(
      "Spectrum PRINT_AT row coordinate 22 is outside the supported range 0..21"
    );
    expect(() => compileSource('print_at 0, 32; "NO"\n', { filename: "range.mbas", target: "spectrum" })).toThrow(
      "Spectrum PRINT_AT column coordinate 32 is outside the supported range 0..31"
    );
  });

  it("rejects generated lines longer than the Spectrum practical editable limit", () => {
    expect(() => compileSource(`print "${"X".repeat(630)}"\n`, { filename: "long-line.mbas", target: "spectrum" })).toThrow(
      "Generated Spectrum BASIC line is 641 characters, exceeding the practical editable line limit of 640."
    );
  });

  it("uses dense line numbering when Spectrum line numbers would exceed 9999", () => {
    const source = Array.from({ length: 1000 }, (_, index) => `print "${index}"`).join("\n");
    const output = compileSource(`${source}\n`, { filename: "many.mbas", target: "spectrum" });

    expect(output.split("\n").at(-2)).toBe('1009 PRINT "999"');
  });

  it("uses Spectrum environment constants and case-insensitive lookup", () => {
    expect(
      compileSource('const row = text_rows - 2\nprint_at row, TEXT_COLUMNS - 1; "EDGE"\n', {
        filename: "env.mbas",
        target: "spectrum"
      })
    ).toBe(['10 PRINT AT 20,31;"EDGE"', ""].join("\n"));
  });

  it("renders Spectrum CLS and every portable background colour without border or text-colour changes", () => {
    const source = ["cls", ...portableColors.map((color) => `cls ${color}`)].join("\n");
    const output = compileSource(`${source}\n`, { filename: "colors.mbas", target: "spectrum" });

    expect(output).toBe(
      [
        "10 CLS",
        "20 PAPER 0",
        "30 CLS",
        "40 PAPER 1",
        "50 CLS",
        "60 PAPER 2",
        "70 CLS",
        "80 PAPER 3",
        "90 CLS",
        "100 PAPER 4",
        "110 CLS",
        "120 PAPER 5",
        "130 CLS",
        "140 PAPER 6",
        "150 CLS",
        "160 PAPER 7",
        "170 CLS",
        ""
      ].join("\n")
    );
    expect(output).not.toContain("BORDER");
    expect(output).not.toContain("INK");
  });

  it("renders Spectrum BORDER_COLOR for every portable colour", () => {
    const source = portableColors.map((color) => `border_color ${color}`).join("\n");

    expect(compileSource(`${source}\n`, { filename: "border.mbas", target: "spectrum" })).toBe(
      ["10 BORDER 0", "20 BORDER 1", "30 BORDER 2", "40 BORDER 3", "50 BORDER 4", "60 BORDER 5", "70 BORDER 6", "80 BORDER 7", ""].join(
        "\n"
      )
    );
  });

  it("renders Spectrum TEXT_COLOR as INK", () => {
    expect(compileSource("text_color WHITE\ntext_color YELLOW\n", { filename: "text-color.mbas", target: "spectrum" })).toBe(
      ["10 INK 7", "20 INK 6", ""].join("\n")
    );
  });

  it("renders Spectrum global and cell colour commands", () => {
    expect(
      compileSource("screen_border_color BLUE\nscreen_background_color BLACK\nscreen_text_color WHITE\ncell_text_color YELLOW\ncell_background_color BLUE\n", {
        filename: "cell-colors.mbas",
        target: "spectrum"
      })
    ).toBe(["10 BORDER 1", "20 PAPER 0", "30 INK 7", "40 INK 6", "50 PAPER 1", ""].join("\n"));
  });

  it("maps long string variable names to Spectrum single-letter string variables", () => {
    expect(compileSource('tickerText$ = "READY"\nprint tickerText$\n', { filename: "strings.mbas", target: "spectrum" })).toBe(
      ['10 LET A$="READY"', "20 PRINT A$", ""].join("\n")
    );
  });

  it("folds compile-time STRING$ and SPACE$ using target constants", () => {
    expect(
      compileSource('const borderLine$ = string$("*", TEXT_COLUMNS - 2)\nprint borderLine$\nprint space$(3)\n', {
        filename: "fill.mbas",
        target: "spectrum"
      })
    ).toBe([`10 PRINT "${"*".repeat(30)}"`, '20 PRINT "   "', ""].join("\n"));
  });

  it("renders MID$ as Spectrum string slicing", () => {
    expect(compileSource('tickerText$ = "HELLO WORLD"\nprint mid$(tickerText$, 2, 5)\n', { filename: "mid.mbas", target: "spectrum" })).toBe(
      ['10 LET A$="HELLO WORLD"', "20 PRINT A$(2 TO 2 + 5 - 1)", ""].join("\n")
    );
  });

  it("renders LEN as a Spectrum string length expression", () => {
    expect(compileSource('tickerText$ = "HELLO WORLD"\ntextLength = len(tickerText$)\nprint textLength\n', { filename: "len.mbas", target: "spectrum" })).toBe(
      ['10 LET A$="HELLO WORLD"', "20 LET TEXTLENGTH=LEN A$", "30 PRINT TEXTLENGTH", ""].join("\n")
    );
  });

  it("renders CHR$ and CODE as Spectrum character conversion functions", () => {
    expect(compileSource('digit$ = chr$(48 + value)\nprint digit$; code("A"); asc("B")\n', { filename: "chars.mbas", target: "spectrum" })).toBe(
      ['10 LET A$=CHR$ (48 + VALUE)', '20 PRINT A$;CODE "A";CODE "B"', ""].join("\n")
    );
  });

  it("renders LEFT$ and RIGHT$ as Spectrum string slicing", () => {
    expect(compileSource('tickerText$ = "HELLO WORLD"\nprint left$(tickerText$, 5); right$(tickerText$, 5)\n', { filename: "sides.mbas", target: "spectrum" })).toBe(
      ['10 LET A$="HELLO WORLD"', "20 PRINT A$( TO 5);A$(LEN A$ - 5 + 1 TO )", ""].join("\n")
    );
  });

  it("renders STR$ and VAL as Spectrum conversion functions", () => {
    expect(compileSource('valueText$ = str$(score + 10)\nscore = val(valueText$)\nprint valueText$; score\n', { filename: "convert.mbas", target: "spectrum" })).toBe(
      ["10 LET A$=STR$ (SCORE + 10)", "20 LET SCORE=VAL A$", "30 PRINT A$;SCORE", ""].join("\n")
    );
  });

  it("renders numeric math functions with Spectrum spelling", () => {
    expect(compileSource("print abs(x); atn(x); cos(x); exp(x); int(x); sgn(x); sin(x); sqr(x)\n", { filename: "math.mbas", target: "spectrum" })).toBe(
      ["10 PRINT ABS X;ATN X;COS X;EXP X;INT X;SGN X;SIN X;SQR X", ""].join("\n")
    );
  });

  it("coerces integer variable assignments and renders them as numeric variables", () => {
    expect(compileSource("counter% = 3.7\nprint counter%\n", { filename: "ints.mbas", target: "spectrum" })).toBe(
      ["10 LET COUNTERI=INT (3.7)", "20 PRINT COUNTERI", ""].join("\n")
    );
  });

  it("renders zero-based numeric and integer arrays using Spectrum one-based array access", () => {
    expect(
      compileSource("dim values(3)\ndim counters%(3)\nvalues(0)=1.5\nvalues(2)=4.5\ncounters%(2)=values(2)\nprint values(0); counters%(2)\n", {
        filename: "arrays.mbas",
        target: "spectrum"
      })
    ).toBe(["10 DIM V(3)", "20 DIM C(3)", "30 LET V(1)=1.5", "40 LET V(3)=4.5", "50 LET C(3)=INT (V(3))", "60 PRINT V(1);C(3)", ""].join("\n"));
  });

  it("renders fixed-width string arrays using Spectrum string arrays", () => {
    expect(
      compileSource('dim messages$(3, 12)\nmessages$(0)="READY"\nmessages$(2)="STANDBY"\nprint messages$(0); messages$(2)\n', {
        filename: "string-arrays.mbas",
        target: "spectrum"
      })
    ).toBe(['10 DIM M$(3,12)', '20 LET M$(1,1 TO 12)="READY"', '30 LET M$(3,1 TO 12)="STANDBY"', "40 PRINT M$(1,1 TO 12);M$(3,1 TO 12)", ""].join("\n"));
  });

  it("keeps Spectrum scalar string variables distinct from string array names", () => {
    expect(
      compileSource('temp$=""\nother$=""\ndim messages$(2, 8)\nmessages$(0)="READY   "\ntemp$=messages$(0)\nother$=""\n', {
        filename: "string-array-conflict.mbas",
        target: "spectrum"
      })
    ).toBe(["10 LET A$=\"\"", "20 LET B$=\"\"", "30 DIM M$(2,8)", '40 LET M$(1,1 TO 8)="READY   "', "50 LET A$=M$(1,1 TO 8)", "60 LET B$=\"\"", ""].join("\n"));
  });

  it("renders DATA, READ, and RESTORE for Spectrum", () => {
    expect(compileSource('data 10, "READY", true\nread score, status$, confirmed\nprint score; status$; confirmed\nrestore\nread score\n', { filename: "data.mbas", target: "spectrum" })).toBe(
      ['10 DATA 10,"READY",1', "20 READ SCORE,A$,CONFIRMED", "30 PRINT SCORE;A$;CONFIRMED", "40 RESTORE", "50 READ SCORE", ""].join("\n")
    );
  });

  it("renders END as Spectrum STOP", () => {
    expect(compileSource('print "FIRST"\nend\nprint "NEVER"\n', { filename: "end-print.mbas", target: "spectrum", readability: 0 })).toBe(
      ['10 PRINT "FIRST"', "20 STOP", '30 PRINT "NEVER"', ""].join("\n")
    );
  });

  it("folds PI and E environment constants", () => {
    expect(compileSource("print pi; e\n", { filename: "constants.mbas", target: "spectrum", readability: 0 })).toBe(
      [`10 PRINT ${Math.PI};${Math.E}`, ""].join("\n")
    );
  });

  it("keeps apostrophe comments everywhere, including after PRINT", () => {
    expect(compileSource("' ignored\nvalue = 1 ' trailing\nprint value ' trailing print comment\n", { filename: "comments.mbas", target: "spectrum", readability: 0 })).toBe(
      ["10 LET VALUE=1", "20 PRINT VALUE", ""].join("\n")
    );
  });

  it("reports invalid array declarations and constant indexes", () => {
    expect(() => compileSource("dim values$(3)\n", { filename: "arrays.mbas", target: "spectrum" })).toThrow(
      "String arrays require element count and fixed width"
    );
    expect(() => compileSource("dim values(3)\nvalues(3)=1\n", { filename: "arrays.mbas", target: "spectrum" })).toThrow(
      'Array "values" index 3 is outside the supported range 0..2'
    );
    expect(() => compileSource("values(0)=1\n", { filename: "arrays.mbas", target: "spectrum" })).toThrow(
      'Array "values" must be declared with DIM before use'
    );
    expect(() => compileSource("dim abs(3)\n", { filename: "arrays.mbas", target: "spectrum" })).toThrow(
      'Cannot declare array "abs" with the same name as a built-in function'
    );
    expect(() => compileSource('dim messages$(3, 4)\nmessages$(0)="READY"\n', { filename: "arrays.mbas", target: "spectrum" })).toThrow(
      'String array "messages$" element width is 4, but assigned string has length 5'
    );
    expect(() => compileSource('dim messages$(3, 4)\nmessages$(0)=1\n', { filename: "arrays.mbas", target: "spectrum" })).toThrow(
      "String array assignments require a string expression"
    );
  });

  it("renders JIFFIES from the Spectrum FRAMES counter", () => {
    expect(compileSource("lastTick = jiffies()\nprint JIFFIES_PER_SECOND\n", { filename: "jiffies.mbas", target: "spectrum" })).toBe(
      ["10 LET LASTTICK=PEEK 23672 + 256 * PEEK 23673 + 65536 * PEEK 23674", "20 PRINT 50", ""].join("\n")
    );
  });

  it("renders RANDOMIZE and RND with Spectrum spelling", () => {
    expect(compileSource("randomize 123\nvalue = rnd()\nrandomize\nprint value\n", { filename: "rnd.mbas", target: "spectrum", readability: 0 })).toBe(
      ["10 RANDOMIZE 123", "20 LET VALUE=RND", "30 RANDOMIZE", "40 PRINT VALUE", ""].join("\n")
    );
  });

  it("renders non-blocking KEY_CODE and target key constants", () => {
    expect(
      compileSource("keyCode = key_code()\nprint KEY_UP; KEY_A; GAME_UP; GAME_FIRE; keyCode\n", {
        filename: "keys.mbas",
        target: "spectrum"
      })
    ).toBe(
      [
        "10 LET A$=INKEY$",
        "20 LET KEYCODE=0",
        '30 IF A$ <> "" THEN GO TO 50',
        "40 GO TO 70",
        "50 REM __MB_KEY_1:",
        "60 LET KEYCODE=CODE A$",
        "70 REM __MB_KEY_2:",
        "80 PRINT 11;97;113;32;KEYCODE",
        ""
      ].join("\n")
    );
  });

  it("reports invalid compile-time string fill calls", () => {
    expect(() => compileSource('print string$("ab", 1)\n', { filename: "fill.mbas", target: "spectrum" })).toThrow(
      "STRING$ first argument must be a string with exactly one character"
    );
    expect(() => compileSource("print space$(256)\n", { filename: "fill.mbas", target: "spectrum" })).toThrow(
      "SPACE$ result length must not exceed 255 characters"
    );
  });

  it("reports invalid MID$ calls", () => {
    expect(() => compileSource('print mid$(1, 2, 3)\n', { filename: "mid.mbas", target: "spectrum" })).toThrow(
      "MID$ first argument must be a string expression"
    );
    expect(() => compileSource('print mid$("ABC", "2", 1)\n', { filename: "mid.mbas", target: "spectrum" })).toThrow(
      "MID$ start argument must be numeric"
    );
  });

  it("reports invalid LEN calls", () => {
    expect(() => compileSource("print len()\n", { filename: "len.mbas", target: "spectrum" })).toThrow("LEN expects exactly one argument");
    expect(() => compileSource("print len(123)\n", { filename: "len.mbas", target: "spectrum" })).toThrow("LEN argument must be a string expression");
  });

  it("reports invalid CHR$ and CODE calls", () => {
    expect(() => compileSource("print chr$()\n", { filename: "chars.mbas", target: "spectrum" })).toThrow("CHR$ expects exactly one argument");
    expect(() => compileSource('print chr$("A")\n', { filename: "chars.mbas", target: "spectrum" })).toThrow("CHR$ argument must be numeric");
    expect(() => compileSource("print code(65)\n", { filename: "chars.mbas", target: "spectrum" })).toThrow(
      "CODE argument must be a string expression"
    );
    expect(() => compileSource("print asc(65)\n", { filename: "chars.mbas", target: "spectrum" })).toThrow(
      "ASC argument must be a string expression"
    );
  });

  it("reports invalid LEFT$ and RIGHT$ calls", () => {
    expect(() => compileSource("print left$(1, 2)\n", { filename: "sides.mbas", target: "spectrum" })).toThrow(
      "LEFT$ first argument must be a string expression"
    );
    expect(() => compileSource('print right$("ABC", "2")\n', { filename: "sides.mbas", target: "spectrum" })).toThrow(
      "RIGHT$ length argument must be numeric"
    );
  });

  it("reports invalid STR$ and VAL calls", () => {
    expect(() => compileSource("print str$()\n", { filename: "convert.mbas", target: "spectrum" })).toThrow("STR$ expects exactly one argument");
    expect(() => compileSource('print str$("A")\n', { filename: "convert.mbas", target: "spectrum" })).toThrow("STR$ argument must be numeric");
    expect(() => compileSource("print val(12)\n", { filename: "convert.mbas", target: "spectrum" })).toThrow(
      "VAL argument must be a string expression"
    );
  });

  it("reports invalid numeric math function calls", () => {
    expect(() => compileSource("print abs()\n", { filename: "math.mbas", target: "spectrum" })).toThrow("ABS expects exactly one argument");
    expect(() => compileSource('print sin("A")\n', { filename: "math.mbas", target: "spectrum" })).toThrow("SIN argument must be numeric");
  });

  it("reports invalid exponentiation operands", () => {
    expect(() => compileSource('print name$ ^ 2\n', { filename: "power.mbas", target: "spectrum" })).toThrow("Operator ^ requires numeric operands");
  });

  it("reports unsupported DATA and READ forms", () => {
    expect(() => compileSource("data rnd()\n", { filename: "data.mbas", target: "spectrum" })).toThrow(
      "DATA values must be compile-time numeric, string, or boolean values"
    );
    expect(() => compileSource("restore table\n", { filename: "data.mbas", target: "spectrum" })).toThrow("RESTORE does not support a target yet");
    expect(() => compileSource("const score = 1\nread score\n", { filename: "data.mbas", target: "spectrum" })).toThrow(
      'Cannot READ into constant "score"'
    );
    expect(() => compileSource("dim values(3)\nread values\n", { filename: "data.mbas", target: "spectrum" })).toThrow(
      'Cannot READ scalar value into array "values"'
    );
  });

  it("reports invalid integer variable uses", () => {
    expect(() => compileSource('counter% = "NO"\n', { filename: "ints.mbas", target: "spectrum" })).toThrow(
      "Integer variable assignments require a numeric expression"
    );
    expect(() => compileSource("for counter% = 1 to 3\nprint counter%\nnext counter%\n", { filename: "ints.mbas", target: "spectrum" })).toThrow(
      "FOR loop variable cannot be an integer variable yet"
    );
  });

  it("reports invalid JIFFIES calls", () => {
    expect(() => compileSource("print jiffies(1)\n", { filename: "jiffies.mbas", target: "spectrum" })).toThrow("JIFFIES expects no arguments");
  });

  it("reports invalid RANDOMIZE and RND uses", () => {
    expect(() => compileSource('randomize "seed"\n', { filename: "rnd.mbas", target: "spectrum" })).toThrow("RANDOMIZE seed must be numeric");
    expect(() => compileSource("print rnd(1)\n", { filename: "rnd.mbas", target: "spectrum" })).toThrow("RND expects no arguments");
  });

  it("reports invalid keyboard function calls", () => {
    expect(() => compileSource("print key_code(1)\n", { filename: "keys.mbas", target: "spectrum" })).toThrow("KEY_CODE expects no arguments");
    expect(() => compileSource("print key$()\n", { filename: "keys.mbas", target: "spectrum" })).toThrow('Unknown function "key$"');
  });

  it("accepts a constant alias as a CLS colour and rejects invalid colour uses", () => {
    expect(compileSource("const alert_colour = RED\ncls alert_colour\n", { filename: "alias.mbas", target: "spectrum" })).toBe(
      ["10 PAPER 2", "20 CLS", ""].join("\n")
    );
    expect(() => compileSource("const TEXT_ROWS = 1\n", { filename: "redeclare.mbas", target: "spectrum" })).toThrow(
      'redeclare.mbas:1:1: Cannot redeclare environment constant "TEXT_ROWS"'
    );
    expect(() => compileSource("text_columns = 1\n", { filename: "assign.mbas", target: "spectrum" })).toThrow(
      'Cannot assign to environment constant "text_columns"'
    );
    expect(() => compileSource("cls 1\n", { filename: "badcolor.mbas", target: "spectrum" })).toThrow(
      "CLS colour must be a compile-time portable colour"
    );
    expect(() => compileSource("cls runtimeColour\n", { filename: "runtimecolor.mbas", target: "spectrum" })).toThrow(
      'Unknown constant "runtimeColour"'
    );
    expect(() => compileSource("border_color 1\n", { filename: "badborder.mbas", target: "spectrum" })).toThrow(
      "BORDER_COLOR colour must be a compile-time portable colour"
    );
  });

  it("reports constant and assignment diagnostics", () => {
    expect(() => compileSource("const a = 1\nconst A = 2\n", { filename: "dupconst.mbas", target: "spectrum" })).toThrow(
      'dupconst.mbas:2:1: Duplicate constant "A"'
    );
    expect(() => compileSource("const a = missing + 1\n", { filename: "unknownconst.mbas", target: "spectrum" })).toThrow(
      'Unknown constant "missing"'
    );
    expect(() => compileSource("const a = 1\nA = 2\n", { filename: "assignconst.mbas", target: "spectrum" })).toThrow(
      'Cannot assign to constant "A"'
    );
    expect(() => compileSource("const a = 1 / 0\n", { filename: "zero.mbas", target: "spectrum" })).toThrow(
      "Division by zero"
    );
    expect(() => compileSource('const a = "x" - "y"\n', { filename: "types.mbas", target: "spectrum" })).toThrow(
      "Operator - requires numeric operands"
    );
  });

  it("reports undefined GOSUB labels", () => {
    expect(() => compileSource("gosub missing\n", { filename: "undef-sub.mbas", target: "spectrum" })).toThrow('Undefined label "missing".');
  });

  it("renders nested IF statements", () => {
    const output = compileSource(
      "if outer then\nif inner then\nprint \"BOTH\"\nelse\nprint \"OUTER\"\nend if\nend if\n",
      { filename: "nested.mbas", target: "spectrum" }
    );

    expect(output).toBe(
      [
        "10 IF OUTER THEN GO TO 30",
        "20 GO TO 100",
        "30 REM __MB_1:",
        "40 IF INNER THEN GO TO 70",
        '50 PRINT "OUTER"',
        "60 GO TO 90",
        "70 REM __MB_3:",
        '80 PRINT "BOTH"',
        "90 REM __MB_4:",
        "100 REM __MB_2:",
        ""
      ].join("\n")
    );
  });

  it("renders exact output for the colors example", () => {
    const source = [
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
      'print_at 2, titleColumn; "META-BASIC COLOURS"',
      "",
      "screen_text_color CYAN",
      'print_at messageRow, 0; "PRINT AND PRINT_AT"',
      "",
      "screen_text_color WHITE",
      "print ruleLine$"
    ].join("\n");

    expect(compileSource(source, { filename: "colors.mbas", target: "spectrum" })).toBe(
      [
        "10 BORDER 1",
        "20 PAPER 0",
        "30 INK 7",
        "40 CLS",
        "50 INK 6",
        "60 PAPER 1",
        '70 PRINT "--------------------------------"',
        '80 PRINT AT 2,4;"META-BASIC COLOURS"',
        "90 INK 5",
        '100 PRINT AT 4,0;"PRINT AND PRINT_AT"',
        "110 INK 7",
        '120 PRINT "--------------------------------"',
        ""
      ].join("\n")
    );
  });

  it("reports duplicate labels", () => {
    expect(() => compileSource("again:\nAgain:\n", { filename: "dup.mbas", target: "spectrum" })).toThrow(
      'dup.mbas:2:1: Duplicate label "Again"'
    );
  });

  it("reports undefined labels", () => {
    expect(() => compileSource("goto missing\n", { filename: "undef.mbas", target: "spectrum" })).toThrow(
      'undef.mbas:1:1: Undefined label "missing"'
    );
  });

  it("runs the CLI to stdout, writes files, and returns nonzero for invalid source", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mbas-"));

    try {
      const sourcePath = join(dir, "program.mbas");
      const outputPath = join(dir, "program.bas");
      const configPath = join(dir, "metabasic.json");
      await writeFile(sourcePath, 'start:\nprint "OK"\ngoto start\n', "utf8");
      await writeFile(configPath, JSON.stringify({ files: ["program.mbas"] }), "utf8");

      const stdoutRun = await runCli(sourcePath, "--target", "spectrum");
      expect(stdoutRun.stdout).toBe(['10 REM START:', '20 PRINT "OK"', "30 GO TO 10", ""].join("\n"));
      expect(stdoutRun.stderr).toBe("");

      const compactRun = await runCli(sourcePath, "--target", "spectrum", "--readability", "0");
      expect(compactRun.stdout).toBe(['10 PRINT "OK"', "20 GO TO 10", ""].join("\n"));
      expect(compactRun.stderr).toBe("");

      const configRun = await runCli("--config", configPath, "--target", "spectrum", "--readability", "0");
      expect(configRun.stdout).toBe(compactRun.stdout);
      expect(configRun.stderr).toBe("");

      const fileRun = await runCli(sourcePath, "--target", "spectrum", "-o", outputPath);
      expect(fileRun.stdout).toBe("");
      expect(fileRun.stderr).toContain("Transpiler output:");
      expect(fileRun.stderr).toContain("BASIC lines: 3 (10..30)");
      expect(fileRun.stderr).toContain("Variables total: 0");
      await expect(readFile(outputPath, "utf8")).resolves.toBe(stdoutRun.stdout);

      const invalidPath = join(dir, "invalid.mbas");
      await writeFile(invalidPath, "else\n", "utf8");
      await expect(runCli(invalidPath, "--target", "spectrum")).rejects.toMatchObject({
        code: 1
      });

      await expect(runCli(sourcePath, "--target", "atari800xl")).resolves.toMatchObject({ stderr: "" });
      await expect(runCli(sourcePath, "--target", "c64")).resolves.toMatchObject({ stderr: "" });
      await expect(runCli(sourcePath, "--target", "unknown")).rejects.toMatchObject({ code: 1 });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

function runCli(...args: string[]) {
  return execFileAsync(process.execPath, ["--import", "tsx", "src/cli.ts", ...args], {
    cwd: process.cwd()
  });
}

const portableColors = ["BLACK", "BLUE", "RED", "MAGENTA", "GREEN", "CYAN", "YELLOW", "WHITE"] as const;
