import { describe, expect, it } from "vitest";
import { compileSource, compileSourceDetailed } from "../src/compiler.js";
import { isTargetId } from "../src/targets/index.js";

describe("KC 85/3 compiler", () => {
  it("swaps and restores current colours around adjacent inverted prints", () => {
    const output = compileSource('print_invert "FIRST";\nprint_invert_at 2,3,"SECOND"\nprint "NORMAL"\n', { filename: "inverse.mbas", target: "kc85" });
    expect(output.match(/VPEEK\(14243\)/gu)).toHaveLength(2);
    expect(output.match(/VPOKE 14243,/gu)).toHaveLength(2);
    expect(output).toContain('LOCATE 1,2:PRINT "SECOND"');
    expect(output.indexOf('PRINT "NORMAL"')).toBeGreaterThan(output.lastIndexOf("VPOKE 14243,"));
    expect(output.trimEnd().split("\n").every(line => line.length <= 72)).toBe(true);
    const longOutput = compileSource(`print_invert "${"X".repeat(70)}"\n`, { filename: "inverse.mbas", target: "kc85" });
    expect(longOutput.match(/VPOKE 14243,/gu)).toHaveLength(2);
    expect(longOutput).toContain(`PRINT "${"X".repeat(50)}";`);
  });
  it("registers the target and emits indexed arrays and window-relative coordinates", () => {
    expect(isTargetId("kc85")).toBe(true);
    const source = 'dim score(3)\nscore(0)=42\nprint_at 3,4,score(0)\n';
    for (const readability of [0, 2] as const) {
      const output = compileSource(source, { filename: "kc.mbas", target: "kc85", readability });
      expect(output).toContain("DIM A0(2)");
      expect(output).toContain("A0(0)=42");
      expect(output).toContain("LOCATE 2,3:PRINT A0(0)");
      expect(output.trimEnd().split("\n").every((line) => line.length <= 72)).toBe(true);
    }
  });

  it("diagnoses unsupported operations and text at their source", () => {
    expect(() => compileSource('print "é"\n', { filename: "kc.mbas", target: "kc85" }))
      .toThrow(/kc\.mbas:1.*Unsupported text character/);
    expect(() => compileSource('print "OK"\n', { filename: "kc.mbas", target: "kc85", fileStorage: "disk" }))
      .toThrow(/tape storage only/);
  });

  it("installs and reads a stable KC 85 interrupt clock", () => {
    const output = compileSource('start=jiffies()\nvalue=jiffies()-start\n', { filename: "clock.mbas", target: "kc85" });
    expect(output).toContain("OUT 142,165");
    expect(output).toContain("OUT 142,137");
    expect(output).toContain("PEEK(481)");
    expect(output).toContain("PEEK(480)");
    expect(output).toContain("POKE 492,212");
  });

  it("keeps the clock running during a blocking beep", () => {
    const output = compileSource('start=jiffies()\nbeep 1, NOTE_C4\nfinish=jiffies()\n', { filename: "clock-beep.mbas", target: "kc85" });
    expect(output.match(/OUT 142,165/gu)).toHaveLength(1);
    expect(output).toContain("OUT 140,3");
    expect(output).toContain("65536");
    expect(output.trimEnd()).toMatch(/POKE 493,[A-Z]\d$/u);
  });

  it("keeps a six-second clocked beep in a single sound segment", () => {
    const output = compileSource('start=jiffies()\nbeep 6, NOTE_C4\n', { filename: "clock-long-beep.mbas", target: "kc85" });
    expect(output).toContain("< 300");
    expect(output.match(/OUT 140,3/gu)).toHaveLength(1);
  });

  it("preserves a polled key until KEY_CODE consumes it", () => {
    const output = compileSource('ready=key_pressed()\nkey=key_code()\n', { filename: "keys.mbas", target: "kc85" });
    expect(output).toMatch(/IF [A-Z]\d\$ = "" THEN [A-Z]\d\$=INKEY\$/u);
    expect(output).toMatch(/ASC\([A-Z]\d\$\)/u);
  });

  it("uses a negative HC-BASIC RND argument for seeded randomization", () => {
    const output = compileSource('randomize 5\nvalue=rnd()\n', { filename: "random.mbas", target: "kc85" });
    expect(output).toContain("RND(-ABS(5)-1)");
    expect(output).toContain("RND(1)");
  });

  it("lowers tones to timed KC 85 SOUND commands", () => {
    const output = compileSource('beep 0.25, NOTE_C4\nbeep 6, -12\n', { filename: "sound.mbas", target: "kc85" });
    expect(output).toContain("SOUND 209,0,0,0,31,13");
    expect(output).toContain("255");
    expect(output).toContain("PEEK(504) AND 2");
    expect(output.trimEnd().split("\n").every((line) => line.length <= 72)).toBe(true);
  });

  it("converts signed free-memory results to an unsigned byte count", () => {
    const output = compileSource('value=free_memory()\n', { filename: "memory.mbas", target: "kc85" });
    expect(output).toContain("FRE(0)-65536*(FRE(0)<0)");
  });

  it("accepts a border colour request between other statements", () => {
    const output = compileSource('print "BEFORE";\nscreen_border_color RED\nprint "AFTER"\n', { filename: "border.mbas", target: "kc85" });
    expect(output).toContain('PRINT "BEFORE";');
    expect(output).toContain('PRINT "AFTER"');
  });

  it("reads a screen character while saving and restoring the cursor", () => {
    const output = compileSource('value=screen_code(2,3)\n', { filename: "screen.mbas", target: "kc85" });
    expect(output).toContain("CSRLIN(1)+1");
    expect(output).toContain("VPEEK(14240)+1");
    expect(output).toContain("ASC(VGET$)");
    expect(output.match(/LOCATE /gu)).toHaveLength(2);
    const stats = compileSourceDetailed('value=screen_code(2,3)\n', { filename: "screen.mbas", target: "kc85" }).stats;
    expect(stats.stringVariables).not.toContain("VGET$");
    expect(stats.numericVariables).not.toContain("CSRLIN");
    expect(stats.numericVariables).not.toContain("POS");
    expect(() => compileSource('value=screen_code(31,1)\n', { filename: "screen.mbas", target: "kc85" }))
      .toThrow(/SCREEN_CODE row coordinate 31/);
  });

  it("splits long literal output without changing the printed text", () => {
    const output = compileSource(`print "${"X".repeat(70)}"\n`, { filename: "long.mbas", target: "kc85" });
    expect(output).toContain(`PRINT "${"X".repeat(50)}";`);
    expect(output).toContain(`PRINT "${"X".repeat(20)}"`);
    expect(output.trimEnd().split("\n").every((line) => line.length <= 72)).toBe(true);
  });

  it("rejects an unbreakable assignment over the input limit", () => {
    expect(() => compileSource(`message$="${"X".repeat(70)}"\n`, { filename: "long.mbas", target: "kc85" }))
      .toThrow(/KC 85\/3 BASIC line.*72/);
  });
});
