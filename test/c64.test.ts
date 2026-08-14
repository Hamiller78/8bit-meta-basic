import { describe, expect, it } from "vitest";
import { compileSource } from "../src/compiler.js";

describe("C64 compiler", () => {
  it("renders assignment without LET and expands PRINT AT to POKE/SYS plus PRINT", () => {
    expect(compileSource('x = 1\nprint at 10, 5; "WARNING"; x\n', { filename: "c64.mbas", target: "c64" })).toBe(
      ["10 X=1", "20 POKE 214,10", "30 POKE 211,5", "40 SYS 58732", '50 PRINT "WARNING";X', ""].join("\n")
    );
  });

  it("reports C64 constant coordinate ranges", () => {
    expect(() => compileSource('print at 25, 0; "NO"\n', { filename: "range.mbas", target: "c64" })).toThrow(
      "C64 PRINT AT row coordinate 25 is outside the supported range 0..24"
    );
    expect(() => compileSource('print at 0, 40; "NO"\n', { filename: "range.mbas", target: "c64" })).toThrow(
      "C64 PRINT AT column coordinate 40 is outside the supported range 0..39"
    );
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
        '50 PRINT "WARNING"',
        '60 PRINT "SECONDS: ";60',
        "70 URGENCY=SENSORCOUNT * 2 + ALERTLEVEL",
        "80 IF ((CONFIRMED) <> 0) AND ((URGENCY >= 4) <> 0) THEN GOTO 100",
        "90 GOTO 160",
        "100 REM __MB_1:",
        "110 POKE 214,10",
        "120 POKE 211,5",
        "130 SYS 58732",
        '140 PRINT "ATTACK CONFIRMED"',
        "150 GOTO 180",
        "160 REM __MB_3:",
        '170 PRINT "AWAITING SECOND SOURCE AT ROW ";22',
        "180 REM __MB_2:",
        "190 GOTO 40",
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
