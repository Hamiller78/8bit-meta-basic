import { describe, expect, it } from "vitest";
import { compileSource } from "../src/compiler.js";

describe("Atari 800XL compiler", () => {
  it("renders assignment without LET and expands PRINT_AT to POSITION plus PRINT", () => {
    expect(compileSource('x = 1\nprint_at 10, 5; "WARNING"; x\n', { filename: "atari.mbas", target: "atari800xl" })).toBe(
      ["10 X=1", "20 POSITION 5,10", '30 PRINT "WARNING";X', ""].join("\n")
    );
  });

  it("reports Atari constant coordinate ranges", () => {
    expect(() => compileSource('print_at 24, 0; "NO"\n', { filename: "range.mbas", target: "atari800xl" })).toThrow(
      "Atari 800XL PRINT_AT row coordinate 24 is outside the supported range 0..23"
    );
    expect(() => compileSource('print_at 0, 40; "NO"\n', { filename: "range.mbas", target: "atari800xl" })).toThrow(
      "Atari 800XL PRINT_AT column coordinate 40 is outside the supported range 0..39"
    );
  });

  it("rejects generated lines longer than the Atari practical editable limit", () => {
    expect(() => compileSource(`print "${"X".repeat(110)}"\n`, { filename: "long-line.mbas", target: "atari800xl" })).toThrow(
      "Generated Atari 800XL BASIC line is 121 characters, exceeding the practical editable line limit of 120."
    );
  });

  it("uses Atari environment constants and case-insensitive lookup", () => {
    expect(
      compileSource('const row = text_rows - 2\nprint_at row, TEXT_COLUMNS - 1; "EDGE"\n', {
        filename: "env.mbas",
        target: "atari800xl"
      })
    ).toBe(["10 POSITION 39,22", '20 PRINT "EDGE"', ""].join("\n"));
  });

  it("renders GOSUB and RETURN", () => {
    expect(compileSource('gosub drawHeader\nprint "DONE"\ndrawHeader:\nprint "HEADER"\nreturn\n', { filename: "sub.mbas", target: "atari800xl" })).toBe(
      ['10 GOSUB 30', '20 PRINT "DONE"', "30 REM DRAWHEADER:", '40 PRINT "HEADER"', "50 RETURN", ""].join("\n")
    );
  });

  it("renders FOR/NEXT with readable Atari variable names", () => {
    expect(
      compileSource("for row = 10 to 1 step -2\nfor column = 1 to 2\nprint row; column\nnext column\nnext row\n", {
        filename: "for.mbas",
        target: "atari800xl"
      })
    ).toBe(
      ["10 FOR ROW=10 TO 1 STEP -2", "20 FOR COLUMN=1 TO 2", "30 PRINT ROW;COLUMN", "40 NEXT COLUMN", "50 NEXT ROW", ""].join("\n")
    );
  });

  it("renders Atari CLS and every portable background colour without text-colour changes", () => {
    const source = ["cls", ...portableColors.map((color) => `cls ${color}`)].join("\n");
    const output = compileSource(`${source}\n`, { filename: "colors.mbas", target: "atari800xl" });

    expect(output).toBe(
      [
        "10 PRINT CHR$(125);",
        "20 SETCOLOR 2,0,0",
        "30 PRINT CHR$(125);",
        "40 SETCOLOR 2,7,8",
        "50 PRINT CHR$(125);",
        "60 SETCOLOR 2,3,8",
        "70 PRINT CHR$(125);",
        "80 SETCOLOR 2,5,8",
        "90 PRINT CHR$(125);",
        "100 SETCOLOR 2,12,8",
        "110 PRINT CHR$(125);",
        "120 SETCOLOR 2,10,8",
        "130 PRINT CHR$(125);",
        "140 SETCOLOR 2,13,12",
        "150 PRINT CHR$(125);",
        "160 SETCOLOR 2,0,14",
        "170 PRINT CHR$(125);",
        ""
      ].join("\n")
    );
    expect(output).not.toContain("SETCOLOR 1");
    expect(output).not.toContain("GRAPHICS");
  });

  it("renders Atari BORDER_COLOR for every portable colour", () => {
    const source = portableColors.map((color) => `border_color ${color}`).join("\n");

    expect(compileSource(`${source}\n`, { filename: "border.mbas", target: "atari800xl" })).toBe(
      [
        "10 SETCOLOR 4,0,0",
        "20 SETCOLOR 4,7,8",
        "30 SETCOLOR 4,3,8",
        "40 SETCOLOR 4,5,8",
        "50 SETCOLOR 4,12,8",
        "60 SETCOLOR 4,10,8",
        "70 SETCOLOR 4,13,12",
        "80 SETCOLOR 4,0,14",
        ""
      ].join("\n")
    );
  });

  it("renders Atari TEXT_COLOR as SETCOLOR 1", () => {
    expect(compileSource("text_color WHITE\ntext_color YELLOW\n", { filename: "text-color.mbas", target: "atari800xl" })).toBe(
      ["10 SETCOLOR 1,0,14", "20 SETCOLOR 1,13,12", ""].join("\n")
    );
  });

  it("renders Atari global colours and ignores cell colour commands in GRAPHICS 0", () => {
    expect(
      compileSource('screen_background_color BLUE\nscreen_text_color WHITE\ncell_text_color YELLOW\ncell_background_color RED\nprint "OK"\n', {
        filename: "cell-colors.mbas",
        target: "atari800xl"
      })
    ).toBe(["10 SETCOLOR 2,7,8", "20 SETCOLOR 1,0,14", '30 PRINT "OK"', ""].join("\n"));
  });

  it("renders string variable assignment with required DIM and PRINT", () => {
    expect(compileSource('tickerText$ = "READY"\nprint tickerText$\n', { filename: "strings.mbas", target: "atari800xl" })).toBe(
      ['10 DIM TICKERTEXT$(255)', '20 TICKERTEXT$="READY"', "30 PRINT TICKERTEXT$", ""].join("\n")
    );
  });

  it("renders string self-append using Atari substring assignment", () => {
    expect(compileSource('tickerText$ = "READY"\ntickerText$ = tickerText$ + " NOW"\n', { filename: "append.mbas", target: "atari800xl" })).toBe(
      ['10 DIM TICKERTEXT$(255)', '20 TICKERTEXT$="READY"', '30 TICKERTEXT$(LEN(TICKERTEXT$)+1)=" NOW"', ""].join("\n")
    );
  });

  it("lowers string concatenation assignments into Atari substring appends", () => {
    expect(
      compileSource('prefix$ = "N.A.R.F."\nstatus$ = prefix$ + " " + "OFFLINE"\n', { filename: "concat.mbas", target: "atari800xl" })
    ).toBe(
      [
        '10 DIM PREFIX$(255)',
        '20 PREFIX$="N.A.R.F."',
        '30 DIM STATUS$(255)',
        "40 STATUS$=PREFIX$",
        '50 STATUS$(LEN(STATUS$)+1)=" "',
        '60 STATUS$(LEN(STATUS$)+1)="OFFLINE"',
        ""
      ].join("\n")
    );
  });

  it("uses a temporary Atari string when concatenation reads the destination after overwriting would change it", () => {
    expect(compileSource('status$ = "OFFLINE"\nstatus$ = "N.A.R.F. " + status$\n', { filename: "prepend.mbas", target: "atari800xl" })).toBe(
      [
        '10 DIM STATUS$(255)',
        '20 STATUS$="OFFLINE"',
        '30 DIM MBTEMP$(255)',
        '40 MBTEMP$="N.A.R.F. "',
        "50 MBTEMP$(LEN(MBTEMP$)+1)=STATUS$",
        "60 STATUS$=MBTEMP$",
        ""
      ].join("\n")
    );
  });

  it("lowers string concatenation in PRINT items through an Atari temporary string", () => {
    expect(compileSource('status$ = "READY"\nprint status$ + " NOW"\n', { filename: "print-concat.mbas", target: "atari800xl" })).toBe(
      [
        '10 DIM STATUS$(255)',
        '20 STATUS$="READY"',
        '30 DIM MBTEMP$(255)',
        "40 MBTEMP$=STATUS$",
        '50 MBTEMP$(LEN(MBTEMP$)+1)=" NOW"',
        "60 PRINT MBTEMP$",
        ""
      ].join("\n")
    );
  });

  it("folds compile-time STRING$ and SPACE$ using target constants", () => {
    expect(
      compileSource('const borderLine$ = string$("*", TEXT_COLUMNS - 2)\nprint borderLine$\nprint space$(3)\n', {
        filename: "fill.mbas",
        target: "atari800xl"
      })
    ).toBe([`10 PRINT "${"*".repeat(38)}"`, '20 PRINT "   "', ""].join("\n"));
  });

  it("renders MID$ as Atari string slicing", () => {
    expect(compileSource('tickerText$ = "HELLO WORLD"\nprint mid$(tickerText$, 2, 5)\n', { filename: "mid.mbas", target: "atari800xl" })).toBe(
      ['10 DIM TICKERTEXT$(255)', '20 TICKERTEXT$="HELLO WORLD"', "30 PRINT TICKERTEXT$(2,2 + 5 - 1)", ""].join("\n")
    );
  });

  it("renders LEN as an Atari string length expression", () => {
    expect(compileSource('tickerText$ = "HELLO WORLD"\ntextLength = len(tickerText$)\nprint textLength\n', { filename: "len.mbas", target: "atari800xl" })).toBe(
      ['10 DIM TICKERTEXT$(255)', '20 TICKERTEXT$="HELLO WORLD"', "30 TEXTLENGTH=LEN(TICKERTEXT$)", "40 PRINT TEXTLENGTH", ""].join("\n")
    );
  });

  it("renders CHR$ and CODE as Atari character conversion functions", () => {
    expect(compileSource('digit$ = chr$(48 + value)\nprint digit$; code("A")\n', { filename: "chars.mbas", target: "atari800xl" })).toBe(
      ['10 DIM DIGIT$(255)', "20 DIGIT$=CHR$(48 + VALUE)", '30 PRINT DIGIT$;ASC("A")', ""].join("\n")
    );
  });

  it("renders STR$ and VAL as Atari conversion functions", () => {
    expect(compileSource('valueText$ = str$(score + 10)\nscore = val(valueText$)\nprint valueText$; score\n', { filename: "convert.mbas", target: "atari800xl" })).toBe(
      ['10 DIM VALUETEXT$(255)', "20 VALUETEXT$=STR$(SCORE + 10)", "30 SCORE=VAL(VALUETEXT$)", "40 PRINT VALUETEXT$;SCORE", ""].join("\n")
    );
  });

  it("renders numeric math functions with Atari spelling", () => {
    expect(compileSource("print abs(x); atn(x); cos(x); exp(x); int(x); sgn(x); sin(x); sqr(x)\n", { filename: "math.mbas", target: "atari800xl" })).toBe(
      ["10 PRINT ABS(X);ATN(X);COS(X);EXP(X);INT(X);SGN(X);SIN(X);SQR(X)", ""].join("\n")
    );
  });

  it("renders exponentiation with Atari spelling", () => {
    expect(compileSource("power = base ^ exponent * 3\nnegativePower = -base ^ exponent\n", { filename: "power.mbas", target: "atari800xl" })).toBe(
      ["10 POWER=BASE ^ EXPONENT * 3", "20 NEGATIVEPOWER=-(BASE ^ EXPONENT)", ""].join("\n")
    );
  });

  it("coerces integer variable assignments and renders them as numeric variables", () => {
    expect(compileSource("counter% = 3.7\nprint counter%\n", { filename: "ints.mbas", target: "atari800xl" })).toBe(
      ["10 COUNTERI=INT(3.7)", "20 PRINT COUNTERI", ""].join("\n")
    );
  });

  it("renders zero-based numeric and integer arrays with native Atari upper bounds", () => {
    expect(
      compileSource("dim values(3)\ndim counters%(3)\nvalues(0)=1.5\nvalues(2)=4.5\ncounters%(2)=values(2)\nprint values(0); counters%(2)\n", {
        filename: "arrays.mbas",
        target: "atari800xl"
      })
    ).toBe(["10 DIM VALUES(2)", "20 DIM COUNTERSI(2)", "30 VALUES(0)=1.5", "40 VALUES(2)=4.5", "50 COUNTERSI(2)=INT(VALUES(2))", "60 PRINT VALUES(0);COUNTERSI(2)", ""].join("\n"));
  });

  it("renders fixed-width string arrays using one Atari backing string", () => {
    expect(
      compileSource('dim messages$(3, 12)\nmessages$(0)="READY"\nmessages$(2)="STANDBY"\nprint messages$(0); messages$(2)\n', {
        filename: "string-arrays.mbas",
        target: "atari800xl"
      })
    ).toBe(
      [
        "10 DIM MESSAGES$(36)",
        '20 MESSAGES$(1,12)="READY       "',
        '30 MESSAGES$(25,36)="STANDBY     "',
        "40 PRINT MESSAGES$(1,12);MESSAGES$(25,36)",
        ""
      ].join("\n")
    );
  });

  it("renders DATA, READ, and RESTORE for Atari BASIC", () => {
    expect(compileSource('data 10, "READY", true\nread score, status$, confirmed\nprint score; status$; confirmed\nrestore\nread score\n', { filename: "data.mbas", target: "atari800xl" })).toBe(
      ['10 DATA 10,"READY",1', "20 DIM STATUS$(255)", "30 READ SCORE,STATUS$,CONFIRMED", "40 PRINT SCORE;STATUS$;CONFIRMED", "50 RESTORE", "60 READ SCORE", ""].join("\n")
    );
  });

  it("renders JIFFIES from the Atari real-time clock", () => {
    expect(compileSource("lastTick = jiffies()\nprint JIFFIES_PER_SECOND\n", { filename: "jiffies.mbas", target: "atari800xl" })).toBe(
      ["10 LASTTICK=PEEK(20) + PEEK(19) * 256 + PEEK(18) * 65536", "20 PRINT 50", ""].join("\n")
    );
  });

  it("renders RND and ignores RANDOMIZE on Atari BASIC", () => {
    expect(compileSource("randomize 123\nvalue = rnd()\nrandomize\nprint value\n", { filename: "rnd.mbas", target: "atari800xl", readability: 0 })).toBe(
      ["10 VALUE=RND(0)", "20 PRINT VALUE", ""].join("\n")
    );
  });

  it("lowers non-blocking KEY_CODE through CH at PEEK(764) and resets consumed keys", () => {
    expect(
      compileSource("keyCode = key_code()\nprint KEY_UP; KEY_A; GAME_UP; GAME_FIRE; keyCode\n", {
        filename: "keys.mbas",
        target: "atari800xl"
      })
    ).toBe(
      [
        "10 KEYCODE=PEEK(764)",
        "20 IF KEYCODE <> 255 THEN GOTO 40",
        "30 GOTO 60",
        "40 REM __MB_KEY_1:",
        "50 POKE 764,255",
        "60 REM __MB_KEY_2:",
        "70 PRINT 142;63;142;33;KEYCODE",
        ""
      ].join("\n")
    );
  });

  it("preserves logical truth behavior in representative expressions", () => {
    expect(compileSource("if a and b or not c then\nprint \"YES\"\nend if\n", { filename: "logic.mbas", target: "atari800xl" })).toContain(
      "IF ((((A) <> 0) AND ((B) <> 0)) <> 0) OR ((NOT (C <> 0)) <> 0) THEN GOTO"
    );
  });

  it("renders exact output for the colors example", () => {
    const source = colorsSource();

    expect(compileSource(source, { filename: "colors.mbas", target: "atari800xl" })).toBe(
      [
        "10 SETCOLOR 4,7,8",
        "20 SETCOLOR 2,0,0",
        "30 SETCOLOR 1,0,14",
        "40 PRINT CHR$(125);",
        '50 PRINT "----------------------------------------"',
        "60 POSITION 4,2",
        '70 PRINT "META-BASIC COLOURS"',
        "80 SETCOLOR 1,10,8",
        "90 POSITION 0,4",
        '100 PRINT "PRINT AND PRINT_AT"',
        "110 SETCOLOR 1,0,14",
        '120 PRINT "----------------------------------------"',
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
    'print_at 2, titleColumn; "META-BASIC COLOURS"',
    "",
    "screen_text_color CYAN",
    'print_at messageRow, 0; "PRINT AND PRINT_AT"',
    "",
    "screen_text_color WHITE",
    "print ruleLine$"
  ].join("\n");
}

const portableColors = ["BLACK", "BLUE", "RED", "MAGENTA", "GREEN", "CYAN", "YELLOW", "WHITE"] as const;
