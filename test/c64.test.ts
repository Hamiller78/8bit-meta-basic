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

  it("deterministically maps C64 variable names that would alias in BASIC V2", () => {
    expect(
      compileSource("sensorCount = 1\nsensorState = sensorCount + 1\nprint sensorCount; sensorState\n", {
        filename: "aliases.mbas",
        target: "c64"
      })
    ).toBe(["10 V0=1", "20 V1=V0 + 1", "30 PRINT V0;V1", ""].join("\n"));
  });

  it("uses compact C64 variable names when readability is low", () => {
    expect(
      compileSource("urgency = sensorCount * 2 + alertLevel\nprint urgency; sensorCount; alertLevel\n", {
        filename: "compact.mbas",
        target: "c64",
        readability: 0
      })
    ).toBe(["10 V0=V1 * 2 + V2", "20 PRINT V0;V1;V2", ""].join("\n"));
  });

  it("comments first explicit assignments when readability uses compact C64 names", () => {
    expect(
      compileSource("sensorCount = 1\nalertLevel = 2\nprint sensorCount; alertLevel\n", {
        filename: "compact-comments.mbas",
        target: "c64",
        readability: 1
      })
    ).toBe(["10 REM V0=SENSORCOUNT", "20 V0=1", "30 REM V1=ALERTLEVEL", "40 V1=2", "50 PRINT V0;V1", ""].join("\n"));
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
        "40 REM START:",
        "50 POKE 53280,6",
        "60 POKE 53281,6",
        "70 PRINT CHR$(147);",
        '80 PRINT "WARNING"',
        '90 PRINT "SECONDS: ";60',
        "100 URGENCY=SENSORCOUNT * 2 + ALERTLEVEL",
        "110 IF ((CONFIRMED) <> 0) AND ((URGENCY >= 4) <> 0) THEN GOTO 130",
        "120 GOTO 190",
        "130 REM __MB_1:",
        "140 POKE 214,23",
        "150 POKE 211,5",
        "160 SYS 58732",
        '170 PRINT "ATTACK CONFIRMED"',
        "180 GOTO 210",
        "190 REM __MB_3:",
        '200 PRINT "AWAITING SECOND SOURCE AT ROW ";23',
        "210 REM __MB_2:",
        "220 GOTO 40",
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
