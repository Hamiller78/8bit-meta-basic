import { describe, expect, it } from "vitest";
import { compileSource } from "../src/compiler.js";

const enumDispatchSource = [
  "enum State",
  "Idle",
  "Active",
  "Done",
  "end enum",
  "state = Active",
  "if state = Idle then",
  "goto idleHandler",
  "end if",
  "if state = Active then",
  "goto activeHandler",
  "end if",
  "if state = Done then",
  "goto doneHandler",
  "end if",
  "goto fallback",
  "idleHandler:",
  "print 0",
  "end",
  "activeHandler:",
  "print 1",
  "end",
  "doneHandler:",
  "print 2",
  "end",
  "fallback:",
  "print -1",
  "end"
].join("\n");

describe("control-flow optimization", () => {
  it("uses native one-based ON GOTO dispatch after folding zero-based enum members", () => {
    const atari = compileSource(enumDispatchSource, { filename: "enum-dispatch.mbas", target: "atari800xl", readability: 0 });
    expect(atari).toMatch(/ON 1 \+ ABS\(.+ = 1\) \+ 2 \* ABS\(.+ = 2\) \+ 3 \* ABS\(.+ = 3\) GOTO/u);
    const c64 = compileSource(enumDispatchSource, { filename: "enum-dispatch.mbas", target: "c64", readability: 0 });
    expect(c64).toMatch(/ON [A-Z][A-Z0-9]* \+ 1 GOTO \d+,\d+,\d+/u);
    expect(c64).not.toMatch(/IF [A-Z][A-Z0-9]* = [012] THEN GOTO/u);
  });

  it("uses a straight IF chain for Spectrum computed dispatch", () => {
    const output = compileSource(enumDispatchSource, { filename: "enum-dispatch.mbas", target: "spectrum", readability: 0 });
    expect(output).not.toContain(" ON ");
    expect(output.match(/IF STATE \+ 1 = [123] THEN GO TO/g)).toHaveLength(3);
  });

  it("inlines a short conditional body after THEN", () => {
    const output = compileSource('if ready then\nprint "READY"\nend if\n', { filename: "branch.mbas", target: "spectrum", readability: 0 });
    expect(output).toBe('10 IF READY <> 0 THEN PRINT "READY"\n');
  });

  it("retains the direct compound condition when inlining the body", () => {
    const output = compileSource('if left = 0 or right = 0 then\nprint "MISSING"\nend if\n', { filename: "compound-branch.mbas", target: "spectrum", readability: 0 });

    expect(output).toContain('IF ((LEFT = 0) <> 0) OR ((RIGHT = 0) <> 0) THEN PRINT "MISSING"');
  });

  it("uses native ON GOSUB for enum call dispatch and IF GOSUB on Spectrum", () => {
    const source = [
      "enum State", "Idle", "Active", "Done", "end enum", "state = Active",
      "if state = Idle then", "IdleHandler()", "end if",
      "if state = Active then", "ActiveHandler()", "end if",
      "if state = Done then", "DoneHandler()", "end if",
      'print "AFTER"', "end",
      "FUNCTION IdleHandler()", 'print "IDLE"', "return 0", "END FUNCTION",
      "FUNCTION ActiveHandler()", 'print "ACTIVE"', "return 0", "END FUNCTION",
      "FUNCTION DoneHandler()", 'print "DONE"', "return 0", "END FUNCTION"
    ].join("\n");

    const atari = compileSource(source, { filename: "call-dispatch.mbas", target: "atari800xl", readability: 0 });
    expect(atari).toMatch(/ON 1 \+ ABS\(.+ = 1\) \+ 2 \* ABS\(.+ = 2\) \+ 3 \* ABS\(.+ = 3\) GOSUB/u);
    expect(atari).not.toMatch(/IF .+ < 1.+ > 3.+ THEN/u);
    const c64 = compileSource(source, { filename: "call-dispatch.mbas", target: "c64", readability: 0 });
    expect(c64).toMatch(/ON [A-Z][A-Z0-9]* \+ 1 GOSUB \d+,\d+,\d+/u);
    const spectrum = compileSource(source, { filename: "call-dispatch.mbas", target: "spectrum", readability: 0 });
    expect(spectrum.match(/IF STATE \+ 1 = [123] THEN GO SUB/g)).toHaveLength(3);
  });

  it("omits the join jump when one IF/ELSE branch transfers", () => {
    const output = compileSource('if ready then\ngoto done\nelse\nprint "WAIT"\nend if\nprint "AFTER"\ndone:\nend\n', {
      filename: "terminal-branch.mbas", target: "spectrum", readability: 2
    });

    expect(output.match(/GO TO/g)).toHaveLength(2);
    expect(output).not.toMatch(/GO TO \d+\n\d+ REM __MB_\d+:\n\d+ GO TO/u);
  });

  it("packs a simple loop onto one release line", () => {
    const output = compileSource('for index = 1 to 3\nprint index\nnext index\n', { filename: "loop.mbas", target: "c64", readability: 0 });
    expect(output).toMatch(/^10 FOR [A-Z][A-Z0-9]*=1 TO 3:PRINT [A-Z][A-Z0-9]*:NEXT [A-Z][A-Z0-9]*\n$/u);
  });

  it("falls back to a branch when an inline C64 conditional would be too long", () => {
    const text = "X".repeat(58);
    const output = compileSource(`if ready then\nprint "${text}"\nend if\n`, { filename: "long-conditional.mbas", target: "c64", readability: 0 });
    expect(output.split("\n").filter(Boolean)).toHaveLength(3);
    expect(output).toMatch(/^10 IF [A-Z][A-Z0-9]* = 0 THEN 30\n20 PRINT/u);
  });

  it("packs target instructions originating from one Meta-BASIC statement in release output", () => {
    expect(compileSource("cls BLUE\n", { filename: "packing.mbas", target: "spectrum", readability: 0 })).toBe("10 PAPER 1:CLS\n");
    expect(compileSource("cls BLUE\n", { filename: "packing.mbas", target: "spectrum", readability: 2 })).toBe("10 PAPER 1\n20 CLS\n");
  });
});
