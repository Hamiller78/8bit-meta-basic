import { describe, expect, it } from "vitest";
import { analyzeBasicOutput, formatOutputStats } from "../src/output-stats.js";

describe("BASIC output statistics", () => {
  it("recognizes every DIM in a packed BASIC line", () => {
    const stats = analyzeBasicOutput(["10 DIM Q(2):DIM Q$(2):DIM M(2)"], "c64");

    expect(stats.numericArrays).toEqual(["M", "Q"]);
    expect(stats.stringArrays).toEqual(["Q$"]);
    expect(stats.numericArrays).not.toContain("DIM");
  });

  it("does not split on a colon inside a string literal", () => {
    const stats = analyzeBasicOutput(['10 PRINT "A:B":DIM V(2)'], "c64");

    expect(stats.numericArrays).toEqual(["V"]);
  });

  it("estimates final rendered bytes per source module", () => {
    const lines = ['10 PRINT "MAIN"', '20 PRINT "UI"', '30 GOTO 10'];
    const main = "C:\\project\\main.mbas";
    const ui = "C:\\project\\ui.mbas";
    const stats = analyzeBasicOutput(lines, "c64", [main, ui, main], [main, ui]);

    expect(stats.estimatedCodeBytes).toBe(lines.reduce((total, line) => total + [...line].length + 1, 0));
    expect(stats.modules).toEqual([
      {
        sourceFile: main,
        displayName: "main.mbas",
        lineCount: 2,
        estimatedBytes: [...lines[0]].length + [...lines[2]].length + 2,
      },
      {
        sourceFile: ui,
        displayName: "ui.mbas",
        lineCount: 1,
        estimatedBytes: [...lines[1]].length + 1,
      },
    ]);
    expect(formatOutputStats(stats)).toMatch(/main\.mbas: \d+ bytes \(\d+\.\d%, 2 lines\)/);
  });

  it("reports target-generated lines separately from configured modules", () => {
    const main = "/project/main.mbas";
    const stats = analyzeBasicOutput(["10 PRINT 1", "20 END"], "spectrum", [main, "<generated>"], [main]);

    expect(stats.modules.map((module) => module.displayName)).toEqual(["main.mbas", "<generated>"]);
  });
});
