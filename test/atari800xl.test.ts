import { describe, expect, it } from "vitest";
import { compileSource } from "../src/compiler.js";

describe("Atari 800XL compiler", () => {
  it("renders assignment without LET and expands PRINT AT to POSITION plus PRINT", () => {
    expect(compileSource('x = 1\nprint at 10, 5; "WARNING"; x\n', { filename: "atari.mbas", target: "atari800xl" })).toBe(
      ["10 X=1", "20 POSITION 5,10", '30 PRINT "WARNING";X', ""].join("\n")
    );
  });

  it("reports Atari constant coordinate ranges", () => {
    expect(() => compileSource('print at 24, 0; "NO"\n', { filename: "range.mbas", target: "atari800xl" })).toThrow(
      "Atari 800XL PRINT AT row coordinate 24 is outside the supported range 0..23"
    );
    expect(() => compileSource('print at 0, 40; "NO"\n', { filename: "range.mbas", target: "atari800xl" })).toThrow(
      "Atari 800XL PRINT AT column coordinate 40 is outside the supported range 0..39"
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
        '50 PRINT "WARNING"',
        '60 PRINT "SECONDS: ";60',
        "70 URGENCY=SENSORCOUNT * 2 + ALERTLEVEL",
        "80 IF ((CONFIRMED) <> 0) AND ((URGENCY >= 4) <> 0) THEN GOTO 100",
        "90 GOTO 140",
        "100 REM __MB_1:",
        "110 POSITION 5,10",
        '120 PRINT "ATTACK CONFIRMED"',
        "130 GOTO 160",
        "140 REM __MB_3:",
        '150 PRINT "AWAITING SECOND SOURCE AT ROW ";22',
        "160 REM __MB_2:",
        "170 GOTO 40",
        ""
      ].join("\n")
    );
  });
});

function warningSource(): string {
  return [
    "const screenRows = 24",
    "const warningRow = screenRows - 2",
    "const initialCountdown = 5 * 12",
    "",
    "sensorCount = 1",
    "alertLevel = 2",
    "confirmed = 1",
    "",
    "start:",
    '    print "WARNING"',
    '    print "SECONDS: "; initialCountdown',
    "",
    "    urgency = sensorCount * 2 + alertLevel",
    "",
    "    if confirmed and urgency >= 4 then",
    '        print at 10, 5; "ATTACK CONFIRMED"',
    "    else",
    '        print "AWAITING SECOND SOURCE AT ROW "; warningRow',
    "    end if",
    "",
    "    goto start"
  ].join("\n");
}
