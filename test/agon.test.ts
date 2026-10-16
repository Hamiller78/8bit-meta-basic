import { describe, expect, it } from "vitest";
import { compileSource } from "../src/compiler.js";
import { targetEnvironments } from "../src/targets/environment.js";

describe("Agon Light BBC BASIC lowering", () => {
  it("reads and swaps the current text colours once for adjacent inverted prints", () => {
    const output = compileSource('print_invert "A"\nprint_invert_at 2, 3, "B"\n', {
      filename: "invert.mbas",
      target: "agon"
    });

    expect(output.match(/VDU 23,0,148,128/gu)).toHaveLength(1);
    expect(output.match(/VDU 23,0,148,129/gu)).toHaveLength(1);
    expect(output).toContain("VDU 17,MBINVERSEBACKGROUND%");
    expect(output).toContain("VDU 17,128 + MBINVERSEFOREGROUND%");
    expect(output).toContain("VDU 17,MBINVERSEFOREGROUND%");
    expect(output).toContain("VDU 17,128 + MBINVERSEBACKGROUND%");
    expect(output).toContain('PRINT "A"');
    expect(output).toContain('PRINT TAB(2,1);"B"');
  });

  it("uses the configured 80 by 30 text mode and BBC BASIC positioned output", () => {
    const output = compileSource('x = 1\nprint_at 10, 5, "WARNING"; x\n', { filename: "agon.mbas", target: "agon" });
    expect(output).toContain("MODE 3");
    expect(output).toContain('PRINT TAB(4,9);"WARNING";X');
    expect(targetEnvironments.agon.textColumns).toBe(80);
    expect(targetEnvironments.agon.textRows).toBe(30);
  });

  it("keeps Meta-BASIC arrays zero based and discards fixed string widths", () => {
    const output = compileSource('dim values(3)\ndim messages$(3, 12)\nmessages$(0) = "READY"\n', { filename: "arrays.mbas", target: "agon" });
    expect(output).toContain("DIM V_VALUES(2)");
    expect(output).toContain("DIM MESSAGES$(2)");
    expect(output).toContain('MESSAGES$(0)="READY"');
  });

  it("uses BBC BASIC cursor, timing, memory, keyboard, and screen-reading primitives", () => {
    const source = [
      "set_pos 3, 4",
      'print "A";',
      "set_column 2",
      "key = key_code()",
      "memory = free_memory()",
      "tick = jiffies()",
      "cell = screen_code(2, 3)"
    ].join("\n") + "\n";
    const output = compileSource(source, { filename: "runtime.mbas", target: "agon" });
    expect(output).toContain("PRINT TAB(3,2);");
    expect(output).toContain("PRINT TAB(1,VPOS);");
    expect(output).toContain("INKEY(0)");
    expect(output).toContain("HIMEM-TOP");
    expect(output).toContain("=TIME");
    expect(output).toContain("VDU 23,0,131,MBSCREENCOLUMN% - 1;MBSCREENROW% - 1;");
    expect(output).toContain("MBSCREENVALUE%=USR(65524)");
  });

  it("maps portable CODE to BBC BASIC ASC", () => {
    const output = compileSource('value = code("7")\n', { filename: "code.mbas", target: "agon" });
    expect(output).toContain('V_VALUE=ASC("7")');
  });

  it("keeps international characters readable in UTF-8 BBC BASIC listings", () => {
    const output = compileSource('value$ = "PRÄSIDENT"\n', { filename: "international.mbas", target: "agon" });
    expect(output).toContain('V_VALUE$="PRÄSIDENT"');
    expect(output).not.toContain("CHR$(196)");
    expect(() => compileSource('value$ = "Ж"\n', { filename: "international.mbas", target: "agon" })).toThrow(/international\.mbas:1.*Unsupported Agon text character/u);
  });

  it("maps portable colours to BBC text colours", () => {
    const foreground = compileSource(
      ["BLACK", "BLUE", "RED", "MAGENTA", "GREEN", "CYAN", "YELLOW", "WHITE"]
        .map((color) => `screen_text_color ${color}`)
        .join("\n") + "\n",
      { filename: "foreground-colours.mbas", target: "agon" }
    );
    expect(foreground.match(/COLOUR \d+/gu)).toEqual([
      "COLOUR 0", "COLOUR 4", "COLOUR 1", "COLOUR 5",
      "COLOUR 2", "COLOUR 6", "COLOUR 3", "COLOUR 7"
    ]);

    const output = compileSource("screen_text_color YELLOW\nscreen_background_color BLUE\nscreen_border_color RED\ncls\n", { filename: "colours.mbas", target: "agon" });
    expect(output).toContain("COLOUR 3");
    expect(output).toContain("COLOUR 132");
    expect(output).toContain("COLOUR 129");
    expect(output).toContain("CLS");
  });

  it("seeds BBC BASIC through RND because it has no RANDOMIZE statement", () => {
    const output = compileSource("randomize\nrandomize 42\n", { filename: "random.mbas", target: "agon" });
    expect(output).toContain("MBRND=RND(-TIME)");
    expect(output).toContain("MBRND=RND(-42)");
    expect(output).not.toContain("RANDOMIZE");
  });

  it("writes device output as readable text instead of BBC binary records", () => {
    const source = [
      "open_device Log, SHARED_DRIVE",
      'print_device Log; "TESTS: "; 5',
      'print_device Log; "DONE";',
      "close_device Log"
    ].join("\n") + "\n";
    const output = compileSource(source, { filename: "log.mbas", target: "agon" });
    expect(output).toMatch(/MBOUTPUT\$="TESTS: "\+STR\$\(5\):FOR MBOUTPUTINDEX%=1 TO LEN\(MBOUTPUT\$\):BPUT#MBDEVICE0%,ASC\(MID\$\(MBOUTPUT\$,MBOUTPUTINDEX%,1\)\):NEXT:BPUT#MBDEVICE0%,10/u);
    expect(output).toMatch(/MBOUTPUT\$="DONE":FOR MBOUTPUTINDEX%=1 TO LEN\(MBOUTPUT\$\):BPUT#MBDEVICE0%,ASC\(MID\$\(MBOUTPUT\$,MBOUTPUTINDEX%,1\)\):NEXT/u);
    expect(output).not.toContain("PRINT#");
  });

  it("protects readable identifiers whose prefixes are BBC BASIC keywords", () => {
    const output = compileSource("total = 1\ncount = total\ndim values(2)\n", { filename: "names.mbas", target: "agon" });
    expect(output).toContain("V_TOTAL=1");
    expect(output).toContain("V_COUNT=V_TOTAL");
    expect(output).toContain("DIM V_VALUES(1)");
  });

  it("uses stack-free loops when EXIT FOR bypasses BBC BASIC's NEXT", () => {
    const source = "for index = 1 to 5\nif index = 3 then\nexit for\nend if\nnext index\n";
    const output = compileSource(source, { filename: "flow.mbas", target: "agon" });
    expect(output).toMatch(/MBFORLIMIT=5/u);
    expect(output).toMatch(/MBFORSTEP=1/u);
    expect(output).not.toContain("NEXT INDEX");
    expect(output).toMatch(/GOTO \d+/u);
    expect(output).not.toContain("EXIT FOR");
  });

  it("uses stack-free loops when a function can return from the loop body", () => {
    const source = "function Find()\nfor index = 0 to 3\nif index = 2 then\nreturn index\nend if\nnext index\nreturn -1\nend function\nresult = Find()\n";
    const output = compileSource(source, { filename: "return-loop.mbas", target: "agon" });
    expect(output).toContain("MBFORLIMIT=3");
    expect(output).not.toMatch(/FOR INDEX|NEXT INDEX/u);
  });
});
