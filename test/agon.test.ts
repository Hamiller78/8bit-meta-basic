import { describe, expect, it } from "vitest";
import { compileSource } from "../src/compiler.js";
import { targetEnvironments } from "../src/targets/environment.js";

describe("Agon Light BBC BASIC lowering", () => {
  it("uses the configured 80 by 30 text mode and BBC BASIC positioned output", () => {
    const output = compileSource('x = 1\nprint_at 10, 5, "WARNING"; x\n', { filename: "agon.mbas", target: "agon" });
    expect(output).toContain("MODE 3");
    expect(output).toContain('PRINT TAB(4,9);"WARNING";X');
    expect(targetEnvironments.agon.textColumns).toBe(80);
    expect(targetEnvironments.agon.textRows).toBe(30);
  });

  it("keeps Meta-BASIC arrays zero based and discards fixed string widths", () => {
    const output = compileSource('dim values(3)\ndim messages$(3, 12)\nmessages$(0) = "READY"\n', { filename: "arrays.mbas", target: "agon" });
    expect(output).toContain("DIM VALUES(2)");
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
    expect(output).toContain("GET((3)-1,(2)-1)");
  });

  it("maps portable colours to BBC text colours", () => {
    const output = compileSource("screen_text_color YELLOW\nscreen_background_color BLUE\ncls\n", { filename: "colours.mbas", target: "agon" });
    expect(output).toContain("COLOUR 6");
    expect(output).toContain("COLOUR 129");
    expect(output).toContain("CLS");
  });
});
