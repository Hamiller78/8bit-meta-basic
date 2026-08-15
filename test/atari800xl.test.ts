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

  it("preserves logical truth behavior in representative expressions", () => {
    expect(compileSource("if a and b or not c then\nprint \"YES\"\nend if\n", { filename: "logic.mbas", target: "atari800xl" })).toContain(
      "IF ((((A) <> 0) AND ((B) <> 0)) <> 0) OR ((NOT (C <> 0)) <> 0) THEN GOTO"
    );
  });

  it("renders exact output for the updated warning example", () => {
    const source = warningSource();

    expect(compileSource(source, { filename: "warning.mbas", target: "atari800xl" })).toBe(
      [
        "10 SENSORCOUNT=1",
        "20 ALERTLEVEL=2",
        "30 CONFIRMED=1",
        "40 REM START:",
        "50 SETCOLOR 4,7,8",
        "60 SETCOLOR 2,7,8",
        "70 PRINT CHR$(125);",
        '80 PRINT "WARNING"',
        '90 PRINT "SECONDS: ";60',
        "100 URGENCY=SENSORCOUNT * 2 + ALERTLEVEL",
        "110 IF ((CONFIRMED) <> 0) AND ((URGENCY >= 4) <> 0) THEN GOTO 130",
        "120 GOTO 170",
        "130 REM __MB_1:",
        "140 POSITION 5,22",
        '150 PRINT "ATTACK CONFIRMED"',
        "160 GOTO 190",
        "170 REM __MB_3:",
        '180 PRINT "AWAITING SECOND SOURCE AT ROW ";22',
        "190 REM __MB_2:",
        "200 GOTO 40",
        ""
      ].join("\n")
    );
  });
});

function warningSource(): string {
  return [
    "const warningRow = TEXT_ROWS - 2",
    "const initialCountdown = 5 * 12",
    "",
    "sensorCount = 1",
    "alertLevel = 2",
    "confirmed = 1",
    "",
    "start:",
    "    border_color BLUE",
    "    cls BLUE",
    '    print "WARNING"',
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
