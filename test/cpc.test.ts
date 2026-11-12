import { describe, expect, it } from "vitest";
import { compileSource } from "../src/compiler.js";
import { analyzeBasicOutput } from "../src/output-stats.js";

describe("Amstrad CPC BASIC rendering", () => {
  it("emits readable names, zero-based arrays, and CPC screen positioning", () => {
    const output = compileSource('dim score_values(3)\nscore_values(0)=42\nprint_at 3, 4, score_values(0)\n', { filename: "cpc.mbas", target: "cpc" });
    expect(output).toContain("MODE 1");
    expect(output).toContain("DIM V.SCORE.VALUES(2)");
    expect(output).toContain("V.SCORE.VALUES(0)=42");
    expect(output).toContain("LOCATE 4,3:PRINT V.SCORE.VALUES(0)");
  });

  it("reports unsupported file-existence checks with a source location", () => {
    expect(() => compileSource('found=file_exists("SAVE1")\n', { filename: "file.mbas", target: "cpc" }))
      .toThrow(/file\.mbas:1:1: FILE_EXISTS is not yet supported/);
    expect(compileSource('delete_file "SAVE1"\n', { filename: "file.mbas", target: "cpc" })).toContain('|ERA,"SAVE1.DAT"');
  });

  it("opens and closes CPC sequential data streams for array saves and loads", () => {
    const output = compileSource('dim values(2)\nsave_file "DATA1", values\nload_file "DATA1", values\n', { filename: "files.mbas", target: "cpc", readability: 2 });
    expect(output).toContain('OPENOUT "DATA1.DAT"');
    expect(output).toContain("PRINT #9,");
    expect(output).toContain("CLOSEOUT");
    expect(output).toContain('OPENIN "DATA1.DAT"');
    expect(output).toContain("INPUT #9,");
    expect(output).toContain("CLOSEIN");
    expect(() => compileSource('dim values(2)\nsave_file "DATA1", values\n', { filename: "files.mbas", target: "cpc", fileStorage: "tape" }))
      .toThrow(/support disk storage only/);
  });

  it("emits a blocking sound and preserves the keyboard buffer across availability checks", () => {
    const output = compileSource("beep 0.2, 0\nready = key_pressed()\nkey = key_code()\n", { filename: "devices.mbas", target: "cpc", readability: 2 });
    expect(output).toContain("SOUND 129,");
    expect(output).toContain("TIME");
    expect(output).toMatch(/IF V\.MBCPCKEY\$ = "" THEN V\.MBCPCKEY\$=INKEY\$/u);
    expect(output).toContain("ASC(V.MBCPCKEY$)");
  });

  it("reports CPC names in output statistics without treating native commands as variables", () => {
    const stats = analyzeBasicOutput(["10 DIM V.VALUES(2)", "20 LOCATE 4,3:V.MBTESTS=V.VALUES(0)"], "cpc");
    expect(stats.numericArrays).toEqual(["V.VALUES"]);
    expect(stats.numericVariables).toEqual(["V.MBTESTS"]);
    expect(stats.variableRoles.testRuntime).toEqual(["V.MBTESTS"]);
  });

  it("uses CPC screen reads and rejects invalid constant positions", () => {
    const output = compileSource("value=screen_code(2,3)\n", { filename: "screen.mbas", target: "cpc", readability: 2 });
    expect(output).toContain("POS(#0)");
    expect(output).toContain("VPOS(#0)");
    expect(output).toContain("ASC(COPYCHR$(#0))");
    expect(() => compileSource('print_at 26,1,"X"\n', { filename: "screen.mbas", target: "cpc" })).toThrow(/row coordinate 26/);
  });

  it("uses the CPC joystick bit field", () => {
    const output = compileSource("x=get_joystick(JOY_X)\ny=get_joystick(JOY_Y)\nf=get_joystick(JOY_FIRE1)\n", { filename: "joy.mbas", target: "cpc", readability: 2 });
    expect(output).toContain("JOY(0) AND 4");
    expect(output).toContain("JOY(0) AND 2");
    expect(output).toContain("JOY(0) AND 16");
  });
});
