import { describe, expect, it } from "vitest";
import { compileSource } from "../src/compiler.js";
import { analyzeBasicOutput } from "../src/output-stats.js";

describe("Amstrad CPC BASIC rendering", () => {
  it("assigns stable priority pens and falls back independently for text and background", () => {
    const output = compileSource('const alert = RED\nscreen_text_color WHITE\npen_colors alert, YELLOW, BLUE, GREEN\ncell_text_color RED\nprint "R"\ncell_background_color YELLOW\nprint "Y"\ncell_text_color BLUE\ncell_background_color GREEN\nscreen_text_color BLUE\n', { filename: "pens.mbas", target: "cpc" });
    expect(output).toContain("MODE 1:INK 2,6:INK 3,24");
    expect(output).toMatch(/PEN 2\n\d+ PRINT "R"/u);
    expect(output).toMatch(/PAPER 3\n\d+ PRINT "Y"/u);
    expect(output).toMatch(/PEN 1\n\d+ PAPER 0\n\d+ INK 1,1:PEN 1/u);
    expect(compileSource('cell_text_color WHITE\ncell_text_color YELLOW\ncell_text_color RED\n', { filename: "default.mbas", target: "cpc" })).toMatch(/MODE 1:INK 2,26:INK 3,24[\s\S]*PEN 2[\s\S]*PEN 3[\s\S]*PEN 1/u);
    expect(compileSource('pen_colors RED\ncell_text_color WHITE\n', { filename: "spare.mbas", target: "cpc" })).toContain("MODE 1:INK 2,6:INK 3,26");
    expect(compileSource('screen_text_color WHITE\npen_colors WHITE, RED\ncell_text_color WHITE\n', { filename: "shared.mbas", target: "cpc" })).toMatch(/MODE 1:INK 2,26:INK 3,6[\s\S]*INK 1,26:PEN 1[\s\S]*PEN 2/u);
  });

  it("validates program-wide pen priorities on every target", () => {
    for (const target of ["cpc", "spectrum", "atari800xl", "c64", "vic20", "agon"] as const) {
      expect(() => compileSource('pen_colors RED, RED\n', { filename: "pens.mbas", target })).toThrow(/pens\.mbas:1.*duplicate colours/);
      expect(() => compileSource('pen_colors RED\npen_colors BLUE\n', { filename: "pens.mbas", target })).toThrow(/pens\.mbas:2.*one PEN_COLORS/);
      expect(() => compileSource('pen_colors 3\n', { filename: "pens.mbas", target })).toThrow(/compile-time portable colour/);
      expect(() => compileSource('pen_colors\n', { filename: "pens.mbas", target })).toThrow(/requires at least one colour/);
      expect(() => compileSource('if 1 then\npen_colors RED, YELLOW\nend if\nprint "OK"\n', { filename: "pens.mbas", target })).not.toThrow();
      if (target !== "cpc") {
        const options = { filename: "pens.mbas", target };
        expect(compileSource('pen_colors RED, YELLOW\ncell_text_color BLUE\nprint "X"\n', options))
          .toBe(compileSource('cell_text_color BLUE\nprint "X"\n', options));
      }
    }
  });
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
